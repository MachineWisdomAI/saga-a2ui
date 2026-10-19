import { brotliCompressSync, crc32, deflateSync } from 'node:zlib';

// Trusted artwork and a font for the resource-permission specs, built from scratch so no third-party
// asset is vendored and the bytes are fully understood.
//
// The image is a 3x2 raster PNG (`pngBytes()`), so a loaded copy is recognizable by its natural size.
// The font has two glyphs: an empty `.notdef` (advance 0.5 em) and an empty "A" (advance 2 em). Text
// set in it is invisible but measurable: an "A" is 2 em wide, wider than any fallback face makes it,
// so a measurement shows whether this font, and not a fallback, was actually used. `fontBytes()`
// returns a TrueType file and `woff2Bytes()` the same font as WOFF2 (untransformed tables).

/** The natural size of the artwork: no fallback or error image has it. */
export const ARTWORK_SIZE = { width: 3, height: 2 } as const;

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A 3x2 opaque RGBA PNG. */
export function pngBytes(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(ARTWORK_SIZE.width, 0);
  header.writeUInt32BE(ARTWORK_SIZE.height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(ARTWORK_SIZE.width * 4, 0x80)]);
  const pixels = Buffer.concat(Array.from({ length: ARTWORK_SIZE.height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const imageDataUrl = (): string => `data:image/png;base64,${pngBytes().toString('base64')}`;

const UNITS_PER_EM = 1000;
/** The advance of "A" in em: 2, wide enough that no fallback face produces it for a letter A. */
export const PROBE_ADVANCE_EM = 2;

function u16(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeUInt16BE(value & 0xffff, index * 2));
  return out;
}

function u32(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => out.writeUInt32BE(value >>> 0, index * 4));
  return out;
}

function pad4(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
}

function checksum(data: Buffer): number {
  const padded = pad4(data);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) sum = (sum + padded.readUInt32BE(offset)) >>> 0;
  return sum;
}

function nameTable(family: string): Buffer {
  const strings = [family, 'Regular', family, family].map((value) => Buffer.from(value, 'utf16le').swap16());
  const ids = [1, 2, 4, 6];
  const header = Buffer.concat([u16(0, ids.length, 6 + ids.length * 12)]);
  let offset = 0;
  const records = ids.map((id, index) => {
    const text = strings[index] as Buffer;
    const record = u16(3, 1, 0x409, id, text.length, offset);
    offset += text.length;
    return record;
  });
  return Buffer.concat([header, ...records, ...strings]);
}

/** The font's tables in the order a WOFF2 file lists them (glyf directly before loca). */
function tables(family: string): ReadonlyArray<readonly [tag: string, data: Buffer]> {
  const head = Buffer.concat([
    u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5),
    u16(0x000b, UNITS_PER_EM),
    Buffer.alloc(16), // created and modified
    u16(0, 0, 0, 0, 0, 8, 2, 0, 0), // bounds, macStyle, lowestRecPPEM, fontDirectionHint, indexToLocFormat, glyphDataFormat
  ]);
  const hhea = Buffer.concat([
    u32(0x00010000),
    u16(800, -200, 0, PROBE_ADVANCE_EM * UNITS_PER_EM, 0, 0, 0, 1, 0, 0),
    Buffer.alloc(8), // reserved
    u16(0, 2),
  ]);
  const maxp = Buffer.concat([u32(0x00010000), u16(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0)]);
  const hmtx = u16(500, 0, PROBE_ADVANCE_EM * UNITS_PER_EM, 0);
  const cmap = Buffer.concat([
    u16(0, 1, 3, 1),
    u32(12),
    // Format 4: one segment mapping U+0041 to glyph 1, and the required final segment.
    u16(4, 32, 0, 4, 4, 1, 0),
    u16(0x41, 0xffff, 0),
    u16(0x41, 0xffff),
    u16(1 - 0x41, 1),
    u16(0, 0),
  ]);
  const os2 = Buffer.concat([
    u16(0, 500, 400, 5, 0),
    u16(650, 600, 0, 75, 650, 600, 0, 350, 50, 300, 0),
    Buffer.alloc(10), // panose
    u32(0, 0, 0, 0),
    Buffer.from('NONE', 'ascii'),
    u16(0x40, 0x41, 0x41, 800, -200, 0, 1000, 200),
  ]);
  const post = Buffer.concat([u32(0x00030000, 0), u16(-100, 50), u32(0, 0, 0, 0, 0)]);
  const glyf = Buffer.alloc(4);
  const loca = u16(0, 0, 0);
  return [
    ['OS/2', os2],
    ['cmap', cmap],
    ['glyf', glyf],
    ['loca', loca],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['maxp', maxp],
    ['name', nameTable(family)],
    ['post', post],
  ];
}

/** A TrueType file with the probe glyphs, named `family`. */
export function fontBytes(family = 'Probe'): Buffer {
  const parts = [...tables(family)].sort(([a], [b]) => (a < b ? -1 : 1));
  const directory: Buffer[] = [];
  const bodies: Buffer[] = [];
  let offset = 12 + 16 * parts.length;
  for (const [tag, data] of parts) {
    directory.push(Buffer.concat([Buffer.from(tag, 'ascii'), u32(checksum(data), offset, data.length)]));
    const padded = pad4(data);
    bodies.push(padded);
    offset += padded.length;
  }
  const entrySelector = Math.floor(Math.log2(parts.length));
  const searchRange = 16 * 2 ** entrySelector;
  const file = Buffer.concat([
    u32(0x00010000),
    u16(parts.length, searchRange, entrySelector, parts.length * 16 - searchRange),
    ...directory,
    ...bodies,
  ]);
  // checkSumAdjustment: 0xB1B0AFBA minus the sum of the whole file, stored in the head table.
  const headRecord = parts.findIndex(([tag]) => tag === 'head');
  let headOffset = 12 + 16 * parts.length;
  for (let index = 0; index < headRecord; index += 1) headOffset += pad4((parts[index] as [string, Buffer])[1]).length;
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headOffset + 8);
  return file;
}

// WOFF2 known-table indices for the tags above (the specification's table of known tags).
const WOFF2_TAG_INDEX: Readonly<Record<string, number>> = {
  cmap: 0,
  head: 1,
  hhea: 2,
  hmtx: 3,
  maxp: 4,
  name: 5,
  'OS/2': 6,
  post: 7,
  glyf: 10,
  loca: 11,
};

function base128(value: number): Buffer {
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return Buffer.from(bytes);
}

/** The same font as WOFF2, with every table stored untransformed. */
export function woff2Bytes(family = 'Probe'): Buffer {
  const truetype = fontBytes(family);
  const parts = tables(family);
  const directory = parts.map(([tag, data]) => {
    // glyf and loca use transform version 3, the null transform; the others use version 0.
    const nullTransform = tag === 'glyf' || tag === 'loca' ? 0xc0 : 0;
    return Buffer.concat([Buffer.from([(WOFF2_TAG_INDEX[tag] as number) | nullTransform]), base128(data.length)]);
  });
  const compressed = brotliCompressSync(Buffer.concat(parts.map(([, data]) => data)));
  const body = pad4(Buffer.concat([...directory, compressed]));
  const header = Buffer.concat([
    Buffer.from('wOF2', 'ascii'),
    u32(0x00010000, 48 + body.length, parts.length << 16),
    u32(truetype.length, compressed.length),
    u16(1, 0),
    u32(0, 0, 0, 0, 0),
  ]);
  return Buffer.concat([header, body]);
}

export const fontDataUrl = (format: 'ttf' | 'woff2' = 'woff2', family = 'Probe'): string =>
  format === 'woff2'
    ? `data:font/woff2;base64,${woff2Bytes(family).toString('base64')}`
    : `data:font/ttf;base64,${fontBytes(family).toString('base64')}`;
