import path from 'node:path';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

// Whether a listing image is a real image (CLI3 #66, CLI4 #67). A PNG is read the way a decoder
// reads it and an SVG is accepted only by an established XML parser, so a file that merely begins
// like an image is not certified. Icons and screenshots are judged by the host's own limits; the
// structure checks are the same for both.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_ICON = 48;
const MAX_RASTER = 4096;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
  readonly data: Buffer;
}

/**
 * The structure of a PNG, read the way a decoder does: the signature, every chunk's length and
 * CRC, one `IHDR` first with a legal combination of fields, a palette where the color type needs
 * one, contiguous `IDAT` data, and `IEND` last with nothing after it. A string is what is wrong.
 */
function readPng(bytes: Buffer): PngHeader | string {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return 'does not start with the PNG signature';
  let offset = 8;
  let header: Omit<PngHeader, 'data'> | undefined;
  let sawPalette = false;
  let sawData = false;
  let dataEnded = false;
  let ended = false;
  const data: Buffer[] = [];
  while (offset < bytes.length) {
    if (ended) return 'has data after its IEND chunk';
    if (offset + 12 > bytes.length) return 'is truncated inside a chunk header';
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return 'has a chunk with an invalid type';
    if (length > 0x7fffffff || offset + 12 + length > bytes.length)
      return `is truncated inside its ${type} chunk`;
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      bytes.readUInt32BE(offset + 8 + length)
    )
      return `has a ${type} chunk whose checksum is wrong`;
    if (header === undefined && type !== 'IHDR')
      return 'does not begin with an IHDR chunk';
    if (type === 'IHDR') {
      if (header !== undefined || length !== 13)
        return 'has an invalid IHDR chunk';
      const width = body.readUInt32BE(0);
      const height = body.readUInt32BE(4);
      const [bitDepth, colorType, compression, filter, interlace] = [
        body[8]!,
        body[9]!,
        body[10]!,
        body[11]!,
        body[12]!,
      ];
      if (
        width === 0 ||
        height === 0 ||
        width > 0x7fffffff ||
        height > 0x7fffffff
      )
        return 'has an empty or oversized image';
      if (
        PNG_DEPTHS[colorType]?.includes(bitDepth) !== true ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      )
        return 'has an IHDR chunk with an illegal combination of fields';
      header = {
        width,
        height,
        bitDepth,
        colorType,
        interlaced: interlace === 1,
      };
    } else if (type === 'PLTE') {
      if (sawData || length === 0 || length % 3 !== 0 || length > 768)
        return 'has an invalid palette';
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (dataEnded) return 'has IDAT chunks that are not contiguous';
      sawData = true;
      data.push(Buffer.from(body));
    } else {
      if (sawData) dataEnded = true;
      if (type === 'IEND') {
        if (length !== 0) return 'has a non-empty IEND chunk';
        ended = true;
      } else if (type.charCodeAt(0) < 0x61)
        return `uses the critical chunk ${type}, which this check cannot verify`;
    }
    offset += 12 + length;
  }
  if (header === undefined) return 'has no IHDR chunk';
  if (!ended) return 'is truncated: it has no IEND chunk';
  if (!sawData) return 'has no image data (IDAT)';
  if (header.colorType === 3 && !sawPalette)
    return 'needs a palette (PLTE) and has none';
  return { ...header, data: Buffer.concat(data) };
}

/** Whether the compressed image data inflates to exactly the rows the header promises, each with a legal filter byte. */
function pngPixelProblem(png: PngHeader): string | null {
  const bitsPerPixel = (PNG_CHANNELS[png.colorType] ?? 0) * png.bitDepth;
  const passes = png.interlaced
    ? ADAM7.map(
        ([x, y, dx, dy]) =>
          [
            Math.ceil((png.width - x) / dx),
            Math.ceil((png.height - y) / dy),
          ] as const,
      ).filter(([w, h]) => w > 0 && h > 0)
    : [[png.width, png.height] as const];
  const expected = passes.reduce(
    (sum, [w, h]) => sum + h * (1 + Math.ceil((w * bitsPerPixel) / 8)),
    0,
  );
  let pixels: Buffer;
  try {
    pixels = inflateSync(png.data, { maxOutputLength: expected + 1 });
  } catch {
    return 'has image data that does not decompress to the expected size';
  }
  if (pixels.length !== expected)
    return `has ${pixels.length} bytes of pixel data; ${expected} are needed`;
  let at = 0;
  for (const [w, h] of passes) {
    const row = 1 + Math.ceil((w * bitsPerPixel) / 8);
    for (let y = 0; y < h; y += 1, at += row)
      if (pixels[at]! > 4) return 'has a row with an invalid filter type';
  }
  return null;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

interface XmlDocument {
  readonly documentElement: {
    readonly localName: string;
    readonly namespaceURI: string | null;
  } | null;
  getElementsByTagName(name: string): {
    readonly length: number;
    item(index: number): { readonly textContent: string | null } | null;
  };
}
type XmlParser = (text: string) => XmlDocument;

let xmlParser: XmlParser | { readonly unavailable: string } | undefined;

/**
 * An established XML parser (jsdom's, the repository's root development dependency; it wraps the
 * `saxes` parser, which enforces the XML grammar including entity references, names, namespaces and
 * attribute uniqueness), or the reason none could be loaded. This tool does not keep a grammar of
 * its own: what the parser rejects is not certified, and when no parser can be loaded validity is
 * reported as unknown instead of being guessed at.
 */
function loadXmlParser(): XmlParser | { readonly unavailable: string } {
  if (xmlParser !== undefined) return xmlParser;
  try {
    const require = createRequire(import.meta.url);
    const { JSDOM } = require('jsdom') as {
      JSDOM: new (html: string) => {
        window: {
          DOMParser: new () => {
            parseFromString(text: string, type: string): XmlDocument;
          };
        };
      };
    };
    const { DOMParser } = new JSDOM('').window;
    xmlParser = (text) =>
      new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch (error) {
    xmlParser = {
      unavailable: `the XML parser (jsdom) could not be loaded: ${(error as Error).message}`,
    };
  }
  return xmlParser;
}

/** The outcome of checking an icon whose validity cannot be established here. */
export interface IconUnverified {
  readonly unverified: string;
}

/**
 * `null` when `text` is one well-formed XML document whose root element is an SVG `svg` element, a
 * string saying what is wrong when the XML parser rejects it, or `IconUnverified` when no parser is
 * available. Entity declarations are refused before parsing: an icon has no use for them.
 */
function svgStructureProblem(text: string): string | IconUnverified | null {
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text))
    return 'has a document type declaration with an internal subset or entities';
  const parse = loadXmlParser();
  if (typeof parse !== 'function') return { unverified: parse.unavailable };
  const document = parse(text);
  const failure = document.getElementsByTagName('parsererror');
  if (failure.length > 0 || document.documentElement === null) {
    const reason = (failure.item(0)?.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    return `is not well-formed XML${reason === '' ? '' : ` (${reason.slice(0, 160)})`}`;
  }
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE)
    return `has a root element that is not an svg element in the ${SVG_NAMESPACE} namespace`;
  return null;
}

/** `null` when the file is a usable icon: a complete, valid square PNG or well-formed SVG of at least 48 by 48 and at most 5 MiB. */
export function iconProblem(
  file: string,
  data: Uint8Array,
): string | IconUnverified | null {
  if (data.length > MAX_IMAGE_BYTES) return `${file} is larger than 5 MiB.`;
  const bytes = Buffer.from(data);
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') {
    const png = readPng(bytes);
    if (typeof png === 'string')
      return `${file} is not a valid PNG: it ${png}.`;
    const { width, height } = png;
    if (width !== height)
      return `${file} is ${width}x${height}; icons must be square.`;
    if (width < MIN_ICON || width > MAX_RASTER)
      return `${file} is ${width}x${height}; icons must be between ${MIN_ICON} and ${MAX_RASTER} pixels.`;
    const pixels = pngPixelProblem(png);
    return pixels === null ? null : `${file} is not a valid PNG: it ${pixels}.`;
  }
  if (extension === '.svg') {
    const text = bytes.toString('utf8');
    const structure = svgStructureProblem(text);
    if (structure !== null)
      return typeof structure === 'string'
        ? `${file} is not a complete SVG document: it ${structure}.`
        : { unverified: `${file}: ${structure.unverified}` };
    const root = /<svg\b[^>]*>/i.exec(text);
    if (root === null) return `${file} is not an SVG document.`;
    const attribute = (name: string): string | undefined =>
      new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root[0])?.[1];
    const number = (value: string | undefined): number | undefined =>
      value !== undefined && /^\s*\d+(\.\d+)?(px)?\s*$/.test(value)
        ? Number.parseFloat(value)
        : undefined;
    const width = number(attribute('width'));
    const height = number(attribute('height'));
    let side: number | undefined;
    if (width !== undefined && height !== undefined)
      side = width === height ? width : undefined;
    else {
      const box = attribute('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      side =
        box !== undefined &&
        box.length === 4 &&
        box.every(Number.isFinite) &&
        box[2] === box[3]
          ? box[2]
          : undefined;
    }
    if (side === undefined)
      return `${file} needs square numeric width and height or a square viewBox.`;
    return side < MIN_ICON
      ? `${file} is ${side} units square; icons must be at least ${MIN_ICON}.`
      : null;
  }
  return `${file} is not a PNG or SVG; those are the formats this check can verify.`;
}

const MIN_SCREENSHOT_WIDTH = 1000;
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_SCREENSHOT_PIXELS = 25_000_000;

/**
 * `null` when the bytes are a complete, valid PNG at least 1000 pixels wide, which is what Claude's
 * connector directory asks of a carousel screenshot (https://claude.com/docs/connectors/building/submission).
 * What the bytes show (the app response alone, without the prompt) is not something a check can
 * see; the bounds on size and pixels only keep the check itself bounded.
 */
export function screenshotProblem(
  file: string,
  data: Uint8Array,
): string | null {
  if (data.length > MAX_SCREENSHOT_BYTES)
    return `${file} is larger than ${MAX_SCREENSHOT_BYTES / (1024 * 1024)} MiB.`;
  const png = readPng(Buffer.from(data));
  if (typeof png === 'string')
    return `${file} is not a valid PNG: it ${png}. Screenshots must be PNG; video and GIF are not accepted.`;
  if (png.width < MIN_SCREENSHOT_WIDTH)
    return `${file} is ${png.width} pixels wide; screenshots must be at least ${MIN_SCREENSHOT_WIDTH}.`;
  if (png.width * png.height > MAX_SCREENSHOT_PIXELS)
    return `${file} is ${png.width}x${png.height}; this check reads at most ${MAX_SCREENSHOT_PIXELS} pixels.`;
  const pixels = pngPixelProblem(png);
  return pixels === null ? null : `${file} is not a valid PNG: it ${pixels}.`;
}

/** The pixel size a PNG's header declares, or `null` when it is not a PNG this check can read. */
export function pngSize(
  data: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  const png = readPng(Buffer.from(data));
  return typeof png === 'string'
    ? null
    : { width: png.width, height: png.height };
}
