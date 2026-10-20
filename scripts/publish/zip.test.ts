import { describe, expect, it } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { ZipError, readZip, writeZip } from './zip.js';

// The archive the ChatGPT portal receives: reproducible bytes, and a reader that refuses what an
// extractor must never follow.

const text = (value: string): Buffer => Buffer.from(value, 'utf8');
const files = [
  { path: 'plugin.json', data: text('{"name":"a"}\n') },
  { path: 'assets/logo.svg', data: text('<svg/>') },
];

describe('writeZip', () => {
  it('gives the same bytes for the same files in any order', () => {
    expect(writeZip(files).equals(writeZip([...files].reverse()))).toBe(true);
  });

  it('round-trips the files and records no time that could change the digest', () => {
    const bytes = writeZip(files);
    expect(readZip(bytes).map((entry) => [entry.path, Buffer.from(entry.data).toString()]).sort()).toEqual([
      ['assets/logo.svg', '<svg/>'],
      ['plugin.json', '{"name":"a"}\n'],
    ]);
    // 1980-01-01, the earliest time a ZIP can hold, in every header.
    expect(bytes.readUInt16LE(12)).toBe(33);
  });

  it.each(['../escape.txt', '/absolute.txt', 'a//b.txt', 'a\\b.txt', 'dir/', ''])('refuses to write the path %j', (entryPath) => {
    expect(() => writeZip([{ path: entryPath, data: text('x') }])).toThrow(ZipError);
  });

  it('refuses the same path twice', () => {
    expect(() => writeZip([files[0]!, files[0]!])).toThrow(/twice/);
  });
});

describe('readZip', () => {
  it('refuses an entry that leaves the archive root', () => {
    // "aa/b" and "../b" have the same length, so the name can be replaced in both headers.
    const bytes = writeZip([{ path: 'aa/b', data: text('x') }]);
    const forged = Buffer.from(bytes.toString('latin1').replaceAll('aa/b', '../b'), 'latin1');
    expect(() => readZip(forged)).toThrow(/not a path inside the archive root/);
  });

  it('refuses data that does not match its checksum', () => {
    const bytes = Buffer.from(writeZip([{ path: 'a.txt', data: text('hello') }]));
    bytes.write('J', bytes.indexOf('hello'), 'latin1');
    expect(() => readZip(bytes)).toThrow(/checksum/);
  });

  it('refuses a link recorded in the file attributes', () => {
    const bytes = Buffer.from(writeZip([{ path: 'a.txt', data: text('target') }]));
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
    expect(() => readZip(bytes)).toThrow(/not a regular file/);
  });

  it('reads a deflated entry made by another tool', () => {
    const data = text('compressed '.repeat(20));
    const name = text('c.txt');
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const body = Buffer.concat([local, name, packed]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(body.length, 16);
    const [entry] = readZip(Buffer.concat([body, central, name, end]));
    expect(Buffer.from(entry!.data).equals(data)).toBe(true);
  });

  it('refuses bytes that are not a ZIP', () => {
    expect(() => readZip(text('not a zip'))).toThrow(/not a ZIP archive/);
  });
});
