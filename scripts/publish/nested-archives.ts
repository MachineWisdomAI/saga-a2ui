import { gunzipSync } from 'node:zlib';
import { ZipError, readZip, safeArchivePath, type ZipEntry } from './zip.js';

// Looking inside archives that a package carries (CLI3 #66, CLI4 #67). A skill or asset can be a
// ZIP, a gzip or a tar, and a credential inside one is invisible to a scan that reads only the
// outer bytes. This opens those three formats, a bounded number of levels deep and within a fixed
// budget of files and bytes. A format the scan cannot open (bzip2, xz, zstd, 7z, RAR), an archive
// that is damaged, encrypted or over the budget, and nesting beyond the depth limit are reported
// as not inspected, never skipped: the caller refuses what it could not read.

export const MAX_NESTED_DEPTH = 3;
export const MAX_NESTED_ENTRIES = 1000;
export const MAX_NESTED_BYTES = 16 * 1024 * 1024;

export interface ExpandedArchives {
  /** Every entry given, then every member found inside an archive; a member's path is `archive!/member`. */
  readonly entries: readonly ZipEntry[];
  /** One sentence per archive or member that could not be inspected, naming it and the reason. */
  readonly uninspected: readonly string[];
}

const startsWith = (data: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((byte, index) => data[index] === byte);

type Kind = 'zip' | 'gzip' | 'tar' | 'unsupported' | 'none';

function kindOf(data: Uint8Array): Kind {
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  // An empty archive is only its end record; nothing is inside it to inspect.
  if (startsWith(data, [0x50, 0x4b, 0x05, 0x06])) return 'none';
  if (startsWith(data, [0x1f, 0x8b])) return 'gzip';
  // A tar is recognised by its magic or, for the older formats without one, by a header block whose
  // checksum is correct for its own bytes.
  if (
    data.length >= 262 &&
    Buffer.from(data.subarray(257, 262)).toString('latin1') === 'ustar'
  )
    return 'tar';
  if (
    data.length >= BLOCK &&
    data[0] !== 0 &&
    checksumMatches(Buffer.from(data.subarray(0, BLOCK)))
  )
    return 'tar';
  if (
    startsWith(data, [0x42, 0x5a, 0x68]) && // bzip2: "BZh", a level, then the block magic
    data[3] !== undefined &&
    data[3] >= 0x31 &&
    data[3] <= 0x39 &&
    startsWith(data.subarray(4), [0x31, 0x41, 0x59, 0x26, 0x53, 0x59])
  )
    return 'unsupported';
  for (const magic of [
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // xz
    [0x28, 0xb5, 0x2f, 0xfd], // zstd
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR
  ])
    if (startsWith(data, magic)) return 'unsupported';
  return 'none';
}

/** A path as it is shown in a finding: printable characters only. */
export const label = (value: string): string =>
  value.replace(/[^\x20-\x7e]/g, '?');

const cString = (bytes: Buffer): string => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
};

class Unreadable extends Error {}

const BLOCK = 512;

/** The octal field of a tar header: digits only, optionally padded with spaces and NULs. */
function octal(field: Buffer): number | undefined {
  const digits = field.toString('latin1').replace(/^[ \0]+|[ \0]+$/g, '');
  if (!/^[0-7]+$/.test(digits)) return undefined;
  const value = Number.parseInt(digits, 8);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Whether a header block carries a correct checksum (the sum of its bytes, its own field counted as spaces). */
function checksumMatches(header: Buffer): boolean {
  const recorded = octal(header.subarray(148, 156));
  if (recorded === undefined) return false;
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    const byte = index >= 148 && index < 156 ? 0x20 : header[index]!;
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return recorded === unsigned || recorded === signed;
}

/**
 * The records of a PAX extended header (`<length> <key>=<value>\n`). Only `path` changes what the
 * next entry is called; a `size`, a sparse map or a character-set switch changes how the data
 * after it is read, which this reader does not follow, so those make the archive unreadable.
 */
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const digits = space < 0 ? '' : data.subarray(at, space).toString('latin1');
    const length = Number(digits);
    if (
      !/^[1-9][0-9]{0,9}$/.test(digits) ||
      space + 1 >= at + length ||
      at + length > data.length ||
      data[at + length - 1] !== 0x0a
    )
      throw new Unreadable('a damaged extended header');
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals < 1) throw new Unreadable('a damaged extended header');
    records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  for (const key of records.keys())
    if (key === 'size' || key === 'hdrcharset' || key.startsWith('GNU.sparse'))
      throw new Unreadable(
        'an extended header it cannot follow (size, sparse or character set)',
      );
  return records;
}

/**
 * The regular files of a tar, named as an extractor would name them (ustar prefix, PAX `path`,
 * GNU long name). The archive must be well formed: every header has a correct checksum, every
 * data area is present, and it ends with two empty blocks and nothing else. A link, device,
 * sparse or other member the reader does not understand makes the whole archive unreadable, so
 * nothing in it is skipped without being looked at.
 */
function readTar(
  data: Buffer,
  maxBytes: number,
  maxEntries: number,
): ZipEntry[] {
  const members: ZipEntry[] = [];
  let at = 0;
  let total = 0;
  let pendingPath: string | undefined;
  for (;;) {
    if (at + BLOCK > data.length)
      throw new Unreadable(
        at === data.length ? 'no end-of-archive marker' : 'truncated data',
      );
    const header = data.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) {
      const rest = data.subarray(at + BLOCK);
      if (rest.length < BLOCK || !rest.every((byte) => byte === 0))
        throw new Unreadable('a damaged end-of-archive marker');
      if (pendingPath !== undefined)
        throw new Unreadable('an extended header with no member after it');
      return members;
    }
    if (!checksumMatches(header)) throw new Unreadable('a damaged header');
    if (header[124]! & 0x80) throw new Unreadable('a size it cannot read');
    const size = octal(header.subarray(124, 136));
    if (size === undefined) throw new Unreadable('a damaged header');
    const type = String.fromCharCode(header[156] ?? 0);
    at += BLOCK;
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    if (at + padded > data.length) throw new Unreadable('truncated data');
    total += size;
    if (total > maxBytes) throw new Unreadable('more than the scan limits');
    const body = data.subarray(at, at + size);
    at += padded;

    if (type === 'x' || type === 'g') {
      const records = paxRecords(body);
      if (type === 'g') {
        if (records.has('path'))
          throw new Unreadable('a global extended header that renames files');
      } else if (records.has('path')) pendingPath = records.get('path');
      continue;
    }
    if (type === 'L') {
      pendingPath = cString(body);
      continue;
    }
    if (type !== '5' && type !== '0' && type !== '\0')
      throw new Unreadable('a member that is not a regular file');

    const posix =
      Buffer.from(header.subarray(257, 263)).toString('latin1') === 'ustar\0';
    const prefix = posix ? cString(header.subarray(345, 500)) : '';
    const name = cString(header.subarray(0, 100));
    const named = pendingPath ?? (prefix === '' ? name : `${prefix}/${name}`);
    pendingPath = undefined;
    // A folder: type 5, or the older convention of a trailing slash. It holds no data of its own.
    if (type === '5' || named.endsWith('/')) {
      if (size !== 0) throw new Unreadable('a folder entry with data');
      continue;
    }
    const memberPath = named.replace(/^(?:\.\/)+/, '');
    if (!safeArchivePath(memberPath))
      throw new Unreadable('a member path outside the archive root');
    if (members.length + 1 > maxEntries)
      throw new Unreadable('more than the scan limits');
    members.push({ path: memberPath, data: body });
  }
}

/** The entries given, plus everything found by opening the archives among them. */
export function expandArchives(entries: readonly ZipEntry[]): ExpandedArchives {
  const all: ZipEntry[] = [];
  const uninspected: string[] = [];
  let bytes = 0;
  let members = 0;

  const visit = (entry: ZipEntry, depth: number): void => {
    all.push(entry);
    const kind = kindOf(entry.data);
    if (kind === 'none') return;
    const name = label(entry.path);
    if (kind === 'unsupported') {
      uninspected.push(
        `${name} is an archive in a format that cannot be opened here.`,
      );
      return;
    }
    if (depth >= MAX_NESTED_DEPTH) {
      uninspected.push(
        `${name} is an archive nested more than ${MAX_NESTED_DEPTH} levels deep.`,
      );
      return;
    }
    const budget = {
      bytes: MAX_NESTED_BYTES - bytes,
      entries: MAX_NESTED_ENTRIES - members,
    };
    let inner: ZipEntry[];
    try {
      // Nothing is opened once either allowance is spent: the cumulative budget fails closed.
      if (budget.bytes <= 0 || budget.entries <= 0)
        throw new Unreadable('more than the scan limits');
      const data = Buffer.from(entry.data);
      if (kind === 'zip')
        inner = readZip(data, {
          maxBytes: budget.bytes,
          maxEntries: budget.entries,
        });
      else if (kind === 'tar')
        inner = readTar(data, budget.bytes, budget.entries);
      else {
        const plain = gunzipSync(data, { maxOutputLength: budget.bytes });
        inner = [{ path: 'content', data: plain }];
      }
      // Whatever the reader returned is checked against what is left before it is accepted.
      if (
        inner.length > budget.entries ||
        inner.reduce((sum, one) => sum + one.data.length, 0) > budget.bytes
      )
        throw new Unreadable('more than the scan limits');
    } catch (error) {
      uninspected.push(
        `${name} is an archive that could not be opened (${
          error instanceof ZipError
            ? label(error.message).replace(/\.$/, '')
            : error instanceof Unreadable
              ? error.message
              : 'it is damaged, or larger than the scan limits'
        }).`,
      );
      return;
    }
    members += inner.length;
    bytes += inner.reduce((sum, one) => sum + one.data.length, 0);
    for (const one of inner)
      visit({ path: `${entry.path}!/${one.path}`, data: one.data }, depth + 1);
  };

  for (const entry of entries) visit(entry, 0);
  return { entries: all, uninspected };
}
