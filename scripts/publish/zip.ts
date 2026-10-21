import { crc32, inflateRawSync } from 'node:zlib';

// The ZIP a host's portal work starts from (CLI3 #66, CLI4 #67): the ChatGPT package or the Claude dossier. The writer stores every entry uncompressed, in
// sorted order, with one fixed timestamp and fixed attributes, so the same files always produce the
// same bytes and therefore the same digest; a compressor's output can change with its version.
// The reader is what the validators use: they check the archive that would be uploaded, not the
// files it was assembled from, and refuse the paths an extractor must never follow.

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** Forward-slash path below the archive root. */
  readonly path: string;
  readonly data: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
/** 1980-01-01 00:00:00, the earliest time a ZIP can record. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_NAMES = 0x0800;
/** A regular file with mode 0644, in the Unix attribute layout. */
const REGULAR_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const FILE_TYPE_MASK = 0o170000;
const REGULAR_FILE = 0o100000;

/** A path an extractor may place inside the archive root and nowhere else. */
export function safeArchivePath(entryPath: string): boolean {
  if (
    entryPath === '' ||
    entryPath.startsWith('/') ||
    entryPath.includes('\\') ||
    entryPath.includes('\0') ||
    entryPath.endsWith('/')
  )
    return false;
  return entryPath
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..');
}

/** The bytes of a ZIP holding exactly `entries`, byte-for-byte reproducible from them. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const seen = new Set<string>();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of sorted) {
    if (!safeArchivePath(entry.path))
      throw new ZipError(
        `${JSON.stringify(entry.path)} is not a path that can be placed in an archive.`,
      );
    if (seen.has(entry.path))
      throw new ZipError(`${entry.path} appears twice.`);
    seen.add(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, ZIP 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(REGULAR_FILE_ATTRIBUTES, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_DIRECTORY, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Reads every entry of a ZIP, refusing what an extractor must not follow: a path outside the root,
 * a repeated path, a directory entry, a link, an encrypted or unsupported entry, or data that does
 * not match its recorded checksum and size.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const archive = Buffer.from(bytes);
  const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || archive.length - endAt < 22)
    throw new ZipError(
      'The file is not a ZIP archive: its end record is missing.',
    );
  const count = archive.readUInt16LE(endAt + 10);
  let cursor = archive.readUInt32LE(endAt + 16);
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    if (
      cursor + 46 > archive.length ||
      archive.readUInt32LE(cursor) !== CENTRAL_HEADER
    )
      throw new ZipError('The archive directory is damaged.');
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressed = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const attributes = archive.readUInt32LE(cursor + 38);
    const localAt = archive.readUInt32LE(cursor + 42);
    const entryPath = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!safeArchivePath(entryPath))
      throw new ZipError(
        `The archive contains ${JSON.stringify(entryPath)}, which is not a path inside the archive root.`,
      );
    if (seen.has(entryPath))
      throw new ZipError(`The archive contains ${entryPath} twice.`);
    seen.add(entryPath);
    const fileType = (attributes >>> 16) & FILE_TYPE_MASK;
    if (fileType !== 0 && fileType !== REGULAR_FILE)
      throw new ZipError(
        `${entryPath} is not a regular file (a link or special file).`,
      );
    if ((flags & 1) !== 0) throw new ZipError(`${entryPath} is encrypted.`);
    if (
      localAt + 30 > archive.length ||
      archive.readUInt32LE(localAt) !== LOCAL_HEADER
    )
      throw new ZipError(`The record for ${entryPath} is damaged.`);
    const dataAt =
      localAt +
      30 +
      archive.readUInt16LE(localAt + 26) +
      archive.readUInt16LE(localAt + 28);
    const raw = archive.subarray(dataAt, dataAt + compressed);
    if (raw.length !== compressed)
      throw new ZipError(`The data of ${entryPath} is truncated.`);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else
      throw new ZipError(
        `${entryPath} uses compression method ${method}, which is not supported.`,
      );
    if (data.length !== size || crc32(data) !== expectedCrc)
      throw new ZipError(`${entryPath} does not match its recorded checksum.`);
    entries.push({ path: entryPath, data });
  }
  return entries;
}
