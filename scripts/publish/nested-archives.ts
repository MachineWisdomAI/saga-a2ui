import { gunzipSync } from 'node:zlib';
import { ZipError, readZip, type ZipEntry } from './zip.js';

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
  if (
    data.length >= 262 &&
    Buffer.from(data.subarray(257, 262)).toString('latin1') === 'ustar'
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
const label = (value: string): string => value.replace(/[^\x20-\x7e]/g, '?');

const cString = (bytes: Buffer): string => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
};

class Unreadable extends Error {}

/** The regular files of a tar. Anything the reader does not understand makes the whole archive unreadable. */
function readTar(
  data: Buffer,
  maxBytes: number,
  maxEntries: number,
): ZipEntry[] {
  const members: ZipEntry[] = [];
  let at = 0;
  let total = 0;
  while (at + 512 <= data.length) {
    const header = data.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    if (header[124]! & 0x80) throw new Unreadable('a size it cannot read');
    const size = Number.parseInt(cString(header.subarray(124, 136)).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Unreadable('a damaged header');
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = cString(header.subarray(345, 500));
    const name = cString(header.subarray(0, 100));
    at += 512;
    if (at + size > data.length) throw new Unreadable('truncated data');
    if (type === '0' || type === '\0') {
      total += size;
      if (total > maxBytes || members.length + 1 > maxEntries)
        throw new Unreadable('more than the scan limits');
      members.push({
        path: prefix === '' ? name : `${prefix}/${name}`,
        data: data.subarray(at, at + size),
      });
    }
    at += Math.ceil(size / 512) * 512;
  }
  return members;
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
      const data = Buffer.from(entry.data);
      if (kind === 'zip')
        inner = readZip(data, {
          maxBytes: budget.bytes,
          maxEntries: budget.entries,
        });
      else if (kind === 'tar')
        inner = readTar(data, budget.bytes, budget.entries);
      else {
        const plain = gunzipSync(data, {
          maxOutputLength: Math.max(budget.bytes, 1),
        });
        inner = [{ path: 'content', data: plain }];
      }
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
