import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import type { ReleaseInput } from './release-input.js';
import { sha256, fail, pass, unknown, type Finding } from './record.js';
import { readZip, ZipError, type ZipEntry } from './zip.js';

// The ChatGPT target of publication (CLI3 #66): what goes into the plugin ZIP and the rules the ZIP
// is checked against. The format is the Agent Plugins 1.0.0 portable package that OpenAI documents
// for the plugin directory: root `plugin.json` and `mcp.json` (official schemas, validated here
// with the MCP SDK's JSON Schema validator), assets, and OpenAI's listing, review and publication
// fields under `extensions["com.openai"]`. Rules were checked against OpenAI's documentation on
// DOCUMENTATION_DATE:
//   https://developers.openai.com/plugins/build/plugins
//   https://developers.openai.com/plugins/deploy/submission
//   https://developers.openai.com/plugins/deploy/app-review
//   https://developers.openai.com/plugins/plugin-guidelines
//
// Recorded decisions:
// - OpenAI's guide shows an `extensions["com.openai"].auth` object inside an `mcp.json` server, but
//   the official 1.0.0 schema (closed server variants, "defines no OAuth configuration") rejects
//   it. The package follows the schema and declares no authentication; the publisher configures
//   authentication in the submission portal's connection form.
// - Only a skills-free, hook-free, `.app.json`-free package is produced: the portal cannot accept
//   app references or lifecycle hooks.

export const DOCUMENTATION_DATE = '2026-10-20';
export const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

const SCHEMA_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schemas', 'agent-plugins-1.0.0');
/** The official files as copied; a changed or missing copy makes the validator unavailable (scripts/publish/schemas/agent-plugins-1.0.0/README.md). */
const PINNED_SCHEMAS = {
  'plugin.schema.json': '0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883',
  'mcp.schema.json': '6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb',
} as const;

/** A validator of the two manifests. It reports the first problems it finds, or `null` when the value conforms. */
export interface ManifestValidators {
  readonly identity: string;
  validatePlugin(value: unknown): string | null;
  validateMcp(value: unknown): string | null;
}

export type ValidatorLoad = { readonly ok: true; readonly validators: ManifestValidators } | { readonly ok: false; readonly problem: string };

function validatorLibraryVersion(): string {
  try {
    let directory = path.dirname(fileURLToPath(import.meta.resolve('@modelcontextprotocol/client')));
    for (let depth = 0; depth < 4; depth += 1, directory = path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: string }).version ?? 'unknown version';
    }
  } catch {
    // fall through
  }
  return 'unknown version';
}

/** The official Agent Plugins 1.0.0 schemas, verified against their pinned digests, behind the MCP SDK's Ajv validator. */
export function loadOfficialValidators(directory: string = SCHEMA_DIRECTORY): ValidatorLoad {
  const schemas: Record<string, object> = {};
  for (const [file, expected] of Object.entries(PINNED_SCHEMAS)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(directory, file), 'utf8');
    } catch {
      return { ok: false, problem: `The official schema ${file} is missing from ${directory}.` };
    }
    if (sha256(text) !== expected) return { ok: false, problem: `${file} differs from the pinned Agent Plugins 1.0.0 schema (sha256 ${expected}); it was not used.` };
    schemas[file] = JSON.parse(text) as object;
  }
  try {
    const ajv = new AjvJsonSchemaValidator();
    const plugin = ajv.getValidator(schemas['plugin.schema.json'] as object);
    const mcp = ajv.getValidator(schemas['mcp.schema.json'] as object);
    const check = (validate: typeof plugin) => (value: unknown): string | null => {
      const result = validate(value);
      return result.valid ? null : result.errorMessage;
    };
    return {
      ok: true,
      validators: {
        identity: `Agent Plugins 1.0.0 plugin.schema.json sha256:${PINNED_SCHEMAS['plugin.schema.json']} and mcp.schema.json sha256:${PINNED_SCHEMAS['mcp.schema.json']}, validated by @modelcontextprotocol/client ${validatorLibraryVersion()} (Ajv)`,
        validatePlugin: check(plugin),
        validateMcp: check(mcp),
      },
    };
  } catch (error) {
    return { ok: false, problem: `The JSON Schema validator could not be set up: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------------------------
// Building the package
// ---------------------------------------------------------------------------------------------

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

/** The package-relative path an asset is stored at: `assets/<file name>`. */
const assetEntryPath = (source: string): string => `assets/${path.basename(source)}`;

export interface AssembledPackage {
  readonly entries: readonly ZipEntry[];
  /** Assets named in the input that could not be read, with the reason. */
  readonly unreadableAssets: readonly { readonly source: string; readonly reason: string }[];
}

/** The files of the ChatGPT plugin ZIP for a release input. Nothing is validated here; `checkArchive` checks what was built. */
export function assemblePackage(input: ReleaseInput, directory: string): AssembledPackage {
  const { listing } = input;
  const assetFields = { logo: input.assets.logo, composerIcon: input.assets.composerIcon, logoDark: input.assets.logoDark, composerIconDark: input.assets.composerIconDark };
  const entries: ZipEntry[] = [];
  const unreadableAssets: { source: string; reason: string }[] = [];
  const stored = new Map<string, string>();
  for (const source of new Set(Object.values(assetFields).filter((value): value is string => value !== undefined))) {
    const entryPath = assetEntryPath(source);
    const earlier = stored.get(entryPath);
    if (earlier !== undefined) {
      unreadableAssets.push({ source, reason: `It has the same file name as ${earlier}; asset file names must be distinct.` });
      continue;
    }
    stored.set(entryPath, source);
    try {
      const file = path.resolve(directory, source);
      if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('It is not a regular file.');
      // An asset is copied into a package that is published, so it must come from the application's own directory.
      const root = fs.realpathSync(directory);
      const real = fs.realpathSync(file);
      if (!real.startsWith(`${root}${path.sep}`)) throw new Error('It is outside the directory of the release input.');
      entries.push({ path: entryPath, data: fs.readFileSync(real) });
    } catch (error) {
      unreadableAssets.push({ source, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'It does not exist.' : (error as Error).message });
    }
  }
  const reference = (source: string | undefined): string | undefined => (source === undefined ? undefined : `./${assetEntryPath(source)}`);
  const withoutUndefined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, inner]) => inner !== undefined)) as T;

  const plugin = withoutUndefined({
    $schema: PLUGIN_SCHEMA_ID,
    name: input.name,
    version: input.version,
    description: input.description,
    author: withoutUndefined({ name: input.publisher.name, email: input.publisher.email, url: input.publisher.url }),
    homepage: input.homepage,
    repository: input.repository,
    license: input.license,
    keywords: input.keywords,
    extensions: {
      'com.openai': withoutUndefined({
        interface: withoutUndefined({
          displayName: listing.displayName,
          shortDescription: listing.shortDescription,
          longDescription: listing.longDescription,
          developerName: input.publisher.name,
          category: listing.category,
          capabilities: listing.capabilities,
          websiteURL: listing.websiteURL,
          supportURL: listing.supportURL,
          privacyPolicyURL: listing.privacyPolicyURL,
          termsOfServiceURL: listing.termsOfServiceURL,
          defaultPrompt: listing.defaultPrompt,
          brandColor: listing.brandColor,
          brandColorDark: listing.brandColorDark,
          composerIcon: reference(assetFields.composerIcon),
          composerIconDark: reference(assetFields.composerIconDark),
          logo: reference(assetFields.logo),
          logoDark: reference(assetFields.logoDark),
        }),
        review: input.review,
        publication: input.publication,
      }),
    },
  });
  const mcp = { $schema: MCP_SCHEMA_ID, mcpServers: { [input.name]: { type: 'streamable-http', url: input.endpoint.url } } };
  entries.push({ path: 'plugin.json', data: json(plugin) }, { path: 'mcp.json', data: json(mcp) });
  return { entries, unreadableAssets };
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A problem with a URL a listing publishes, or `null`. */
function publishedUrlProblem(label: string, value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value === '') return `${label} is required.`;
  if (value.length > maxLength) return `${label} is longer than ${maxLength} characters.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} is not an absolute URL.`;
  }
  if (url.protocol !== 'https:') return `${label} must use HTTPS.`;
  if (url.username !== '' || url.password !== '') return `${label} must not contain credentials.`;
  return null;
}

/** Whether a host name could be reached from outside the publisher's own network. IP literals are refused: the portal verifies a domain. */
function isPublicHostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (!host.includes('.') || host.endsWith('.')) return false;
  return !['localhost', 'local', 'internal', 'lan', 'home.arpa', 'localdomain'].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** `null` when the URL is a stable public HTTPS MCP endpoint, otherwise what is wrong with it. */
export function endpointUrlProblem(value: string): string | null {
  const problem = publishedUrlProblem('The endpoint URL', value, 2048);
  if (problem !== null) return problem;
  const url = new URL(value);
  if (url.hash !== '') return 'The endpoint URL must not contain a fragment.';
  if (!isPublicHostName(url.hostname)) return `The endpoint host ${url.hostname} is a local or testing address; ChatGPT submission needs a stable public HTTPS endpoint.`;
  return null;
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

function textProblem(label: string, value: unknown, max: number, required = true): string | null {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || value.trim() === '') return `${label} is required.`;
  return value.length > max ? `${label} is ${value.length} characters; the limit is ${max}.` : null;
}

/** The listing and manifest rules of OpenAI's submission documentation, applied to the generated `plugin.json`. */
export function listingProblems(plugin: Record<string, unknown>): string[] {
  const problems: (string | null)[] = [];
  const name = plugin.name;
  if (typeof name !== 'string' || name.length > 64 || !PACKAGE_NAME.test(name)) problems.push('name must be at most 64 characters of lowercase letters, digits and single hyphens.');
  problems.push(typeof plugin.version === 'string' && SEMVER.test(plugin.version) ? null : 'version must be an explicit semantic version such as 1.0.0.');
  problems.push(textProblem('description', plugin.description, 4000));
  const author = plugin.author;
  if (!isRecord(author)) problems.push('author is required.');
  else {
    problems.push(textProblem('author.name', author.name, 120));
    problems.push(textProblem('author.email', author.email, 320, false));
    if (author.url !== undefined) problems.push(publishedUrlProblem('author.url', author.url, 2048));
  }
  if (plugin.homepage !== undefined) problems.push(publishedUrlProblem('homepage', plugin.homepage, 2048));

  const openai = isRecord(plugin.extensions) ? plugin.extensions['com.openai'] : undefined;
  const listing = isRecord(openai) ? openai.interface : undefined;
  if (!isRecord(listing)) {
    problems.push('extensions["com.openai"].interface is required.');
    return problems.filter((problem): problem is string => problem !== null);
  }
  problems.push(textProblem('interface.displayName', listing.displayName, 30));
  problems.push(textProblem('interface.shortDescription', listing.shortDescription, 30));
  problems.push(textProblem('interface.longDescription', listing.longDescription, 4000));
  problems.push(textProblem('interface.developerName', listing.developerName, 80));
  problems.push(textProblem('interface.category', listing.category, 200));
  for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) problems.push(publishedUrlProblem(`interface.${field}`, listing[field], 1024));
  if (listing.capabilities !== undefined) {
    const capabilities = listing.capabilities;
    if (!Array.isArray(capabilities) || capabilities.length > 20 || capabilities.some((one) => typeof one !== 'string' || one.length > 120)) problems.push('interface.capabilities must be at most 20 labels of at most 120 characters.');
  }
  if (listing.defaultPrompt !== undefined) {
    const prompts = listing.defaultPrompt;
    if (!Array.isArray(prompts) || prompts.length > 3 || prompts.some((one) => typeof one !== 'string' || one.length > 128 || one.trim() === '')) problems.push('interface.defaultPrompt must be at most 3 prompts of at most 128 characters.');
    else {
      if (new Set(prompts).size !== prompts.length) problems.push('interface.defaultPrompt entries must be unique.');
      if (prompts.some((one) => /(^|\s)@\w/.test(one as string))) problems.push('interface.defaultPrompt must not contain an @mention.');
    }
  }
  if (listing.brandColor !== undefined) {
    if (typeof listing.brandColor !== 'string' || !COLOR.test(listing.brandColor)) problems.push('interface.brandColor must be #RRGGBB.');
    else if (contrast(listing.brandColor, '#FFFFFF') < 2) problems.push('interface.brandColor needs at least 2:1 contrast against white.');
  }
  if (listing.brandColorDark !== undefined) {
    if (typeof listing.brandColorDark !== 'string' || !COLOR.test(listing.brandColorDark)) problems.push('interface.brandColorDark must be #RRGGBB.');
    else if (contrast(listing.brandColorDark, '#212121') < 2) problems.push('interface.brandColorDark needs at least 2:1 contrast against #212121.');
  }
  return problems.filter((problem): problem is string => problem !== null);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_ICON = 48;
const MAX_RASTER = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

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
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'does not start with the PNG signature';
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
    if (length > 0x7fffffff || offset + 12 + length > bytes.length) return `is truncated inside its ${type} chunk`;
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return `has a ${type} chunk whose checksum is wrong`;
    if (header === undefined && type !== 'IHDR') return 'does not begin with an IHDR chunk';
    if (type === 'IHDR') {
      if (header !== undefined || length !== 13) return 'has an invalid IHDR chunk';
      const width = body.readUInt32BE(0);
      const height = body.readUInt32BE(4);
      const [bitDepth, colorType, compression, filter, interlace] = [body[8]!, body[9]!, body[10]!, body[11]!, body[12]!];
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return 'has an empty or oversized image';
      if (PNG_DEPTHS[colorType]?.includes(bitDepth) !== true || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return 'has an IHDR chunk with an illegal combination of fields';
      header = { width, height, bitDepth, colorType, interlaced: interlace === 1 };
    } else if (type === 'PLTE') {
      if (sawData || length === 0 || length % 3 !== 0 || length > 768) return 'has an invalid palette';
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
      } else if (type.charCodeAt(0) < 0x61) return `uses the critical chunk ${type}, which this check cannot verify`;
    }
    offset += 12 + length;
  }
  if (header === undefined) return 'has no IHDR chunk';
  if (!ended) return 'is truncated: it has no IEND chunk';
  if (!sawData) return 'has no image data (IDAT)';
  if (header.colorType === 3 && !sawPalette) return 'needs a palette (PLTE) and has none';
  return { ...header, data: Buffer.concat(data) };
}

/** Whether the compressed image data inflates to exactly the rows the header promises, each with a legal filter byte. */
function pngPixelProblem(png: PngHeader): string | null {
  const bitsPerPixel = (PNG_CHANNELS[png.colorType] ?? 0) * png.bitDepth;
  const passes = png.interlaced
    ? ADAM7.map(([x, y, dx, dy]) => [Math.ceil((png.width - x) / dx), Math.ceil((png.height - y) / dy)] as const).filter(([w, h]) => w > 0 && h > 0)
    : [[png.width, png.height] as const];
  const expected = passes.reduce((sum, [w, h]) => sum + h * (1 + Math.ceil((w * bitsPerPixel) / 8)), 0);
  let pixels: Buffer;
  try {
    pixels = inflateSync(png.data, { maxOutputLength: expected + 1 });
  } catch {
    return 'has image data that does not decompress to the expected size';
  }
  if (pixels.length !== expected) return `has ${pixels.length} bytes of pixel data; ${expected} are needed`;
  let at = 0;
  for (const [w, h] of passes) {
    const row = 1 + Math.ceil((w * bitsPerPixel) / 8);
    for (let y = 0; y < h; y += 1, at += row) if (pixels[at]! > 4) return 'has a row with an invalid filter type';
  }
  return null;
}

/** Whether `text` is one complete, well-formed XML document whose root element is `svg`. A string is what is wrong. */
function svgStructureProblem(text: string): string | null {
  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  while (at < text.length) {
    if (text[at] !== '<') {
      const next = text.indexOf('<', at);
      const chunk = text.slice(at, next < 0 ? text.length : next);
      if (stack.length === 0 && chunk.trim() !== '') return 'has text outside its root element';
      at = next < 0 ? text.length : next;
      continue;
    }
    const closer = text.startsWith('<!--', at) ? '-->' : text.startsWith('<![CDATA[', at) ? ']]>' : text.startsWith('<?', at) ? '?>' : undefined;
    if (closer !== undefined) {
      if (closer === ']]>' && stack.length === 0) return 'has character data outside its root element';
      const end = text.indexOf(closer, at + 2);
      if (end < 0) return 'has an unterminated comment, instruction or CDATA section';
      at = end + closer.length;
      continue;
    }
    if (/^<!DOCTYPE/i.test(text.slice(at, at + 9))) {
      if (rootSeen) return 'has a document type declaration after its root element';
      const end = text.indexOf('>', at);
      if (end < 0 || /<!ENTITY/i.test(text.slice(at, end + 1)) || text.slice(at, end).includes('[')) return 'has a document type declaration with an internal subset or entities';
      at = end + 1;
      continue;
    }
    tag.lastIndex = at;
    const match = tag.exec(text);
    if (match === null) return 'has a malformed tag';
    const [whole, closing, name, attributes, selfClosing] = match as unknown as [string, string, string, string, string];
    if (closing === '/') {
      if (attributes.trim() !== '' || selfClosing === '/' || stack.pop() !== name) return `has a closing tag </${name}> that matches no open element`;
      if (stack.length === 0) rootClosed = true;
    } else {
      if (rootClosed) return 'has more than one root element';
      const names = [...attributes.matchAll(/\s([A-Za-z_][\w.:-]*)\s*=/g)].map((one) => one[1]);
      if (new Set(names).size !== names.length) return `has an element <${name}> with a repeated attribute`;
      if (!rootSeen) {
        if (name !== 'svg' && !name.endsWith(':svg')) return 'has a root element that is not svg';
        rootSeen = true;
      }
      if (selfClosing === '/') {
        if (stack.length === 0) rootClosed = true;
      } else stack.push(name);
    }
    at += whole.length;
  }
  if (!rootSeen) return 'has no root element';
  return stack.length > 0 || !rootClosed ? `is truncated: <${stack[stack.length - 1] ?? 'svg'}> is never closed` : null;
}

/** `null` when the file is a usable icon: a complete, valid square PNG or well-formed SVG of at least 48 by 48 and at most 5 MiB. */
export function iconProblem(file: string, data: Uint8Array): string | null {
  if (data.length > MAX_IMAGE_BYTES) return `${file} is larger than 5 MiB.`;
  const bytes = Buffer.from(data);
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') {
    const png = readPng(bytes);
    if (typeof png === 'string') return `${file} is not a valid PNG: it ${png}.`;
    const { width, height } = png;
    if (width !== height) return `${file} is ${width}x${height}; icons must be square.`;
    if (width < MIN_ICON || width > MAX_RASTER) return `${file} is ${width}x${height}; icons must be between ${MIN_ICON} and ${MAX_RASTER} pixels.`;
    const pixels = pngPixelProblem(png);
    return pixels === null ? null : `${file} is not a valid PNG: it ${pixels}.`;
  }
  if (extension === '.svg') {
    const text = bytes.toString('utf8');
    const structure = svgStructureProblem(text);
    if (structure !== null) return `${file} is not a complete SVG document: it ${structure}.`;
    const root = /<svg\b[^>]*>/i.exec(text);
    if (root === null) return `${file} is not an SVG document.`;
    const attribute = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root[0])?.[1];
    const number = (value: string | undefined): number | undefined => (value !== undefined && /^\s*\d+(\.\d+)?(px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined);
    const width = number(attribute('width'));
    const height = number(attribute('height'));
    let side: number | undefined;
    if (width !== undefined && height !== undefined) side = width === height ? width : undefined;
    else {
      const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      side = box !== undefined && box.length === 4 && box.every(Number.isFinite) && box[2] === box[3] ? box[2] : undefined;
    }
    if (side === undefined) return `${file} needs square numeric width and height or a square viewBox.`;
    return side < MIN_ICON ? `${file} is ${side} units square; icons must be at least ${MIN_ICON}.` : null;
  }
  return `${file} is not a PNG or SVG; those are the formats this check can verify.`;
}

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['credential assignment', /["']?(?:client_?secret|api_?key|password|passwd|access_?token|auth_?token|private_?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
];

/** Names of the kinds of secret found in text, never the secret itself. */
export function secretKinds(text: string): string[] {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

/**
 * `text` with every secret-looking span and every literal credential this run holds replaced by a
 * marker. It is the last step before anything is printed: a finding's wording is built to carry no
 * secret, and this keeps a mistake in one of them from becoming a disclosure.
 */
export function redactSecrets(text: string, literals: readonly string[] = []): string {
  let redacted = text;
  for (const literal of literals) if (literal !== '') redacted = redacted.split(literal).join('[redacted credential]');
  for (const [kind, pattern] of SECRET_PATTERNS) redacted = redacted.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), `[redacted ${kind}]`);
  return redacted;
}

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.svg', '.html', '.js', '.css']);

// ---------------------------------------------------------------------------------------------
// Checking the built archive
// ---------------------------------------------------------------------------------------------

export interface ArchiveCheck {
  readonly findings: readonly Finding[];
  readonly entries: readonly ZipEntry[];
  /** The generated `plugin.json`, read back out of the archive, when it could be parsed. */
  readonly plugin: Record<string, unknown> | undefined;
}

export interface ArchiveCheckOptions {
  readonly validators: ValidatorLoad;
  /** The endpoint URL the package must declare. */
  readonly endpointUrl: string;
  /** Literal values that must not appear anywhere in the archive, such as a credential used for discovery. */
  readonly forbiddenLiterals: readonly string[];
}

function parseJsonEntry(entries: readonly ZipEntry[], name: string): { value?: unknown; problem?: string } {
  const entry = entries.find((one) => one.path === name);
  if (entry === undefined) return { problem: `${name} is missing from the archive.` };
  try {
    return { value: JSON.parse(Buffer.from(entry.data).toString('utf8')) };
  } catch {
    return { problem: `${name} is not valid JSON.` };
  }
}

/** Checks the bytes that would be uploaded, not the files they were assembled from. */
export function checkArchive(archive: Uint8Array, options: ArchiveCheckOptions): ArchiveCheck {
  let entries: ZipEntry[];
  try {
    entries = readZip(archive);
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    return { findings: [fail('package.archive', 'The package is not a usable ZIP archive.', 'Regenerate the package.', error.message)], entries: [], plugin: undefined };
  }
  const findings: Finding[] = [pass('package.archive', `The package is a well-formed ZIP archive of ${entries.length} files.`)];

  const pluginJson = parseJsonEntry(entries, 'plugin.json');
  const mcpJson = parseJsonEntry(entries, 'mcp.json');
  const plugin = pluginJson.problem === undefined && isRecord(pluginJson.value) ? pluginJson.value : undefined;

  // Official schemas. An unavailable validator is unknown, never a pass.
  if (!options.validators.ok) {
    const repair = 'Restore scripts/publish/schemas/agent-plugins-1.0.0 from the repository and rerun.';
    findings.push(unknown('package.manifest', 'plugin.json was not validated: the official validator is unavailable.', repair, options.validators.problem));
    findings.push(unknown('package.mcp-config', 'mcp.json was not validated: the official validator is unavailable.', repair, options.validators.problem));
  } else {
    const { validators } = options.validators;
    const manifestProblem = pluginJson.problem ?? validators.validatePlugin(pluginJson.value);
    findings.push(manifestProblem === null ? pass('package.manifest', 'plugin.json conforms to the Agent Plugins 1.0.0 schema.') : fail('package.manifest', 'plugin.json does not conform to the Agent Plugins 1.0.0 schema.', 'Correct the release input fields it names.', manifestProblem));
    const mcpProblem = mcpJson.problem ?? validators.validateMcp(mcpJson.value);
    findings.push(mcpProblem === null ? pass('package.mcp-config', 'mcp.json conforms to the Agent Plugins 1.0.0 schema.') : fail('package.mcp-config', 'mcp.json does not conform to the Agent Plugins 1.0.0 schema.', 'Correct the endpoint in the release input.', mcpProblem));
  }

  // ChatGPT's own rules for the MCP server entry.
  const servers = isRecord(mcpJson.value) && isRecord(mcpJson.value.mcpServers) ? Object.values(mcpJson.value.mcpServers) : [];
  const mcpRuleProblems: string[] = [];
  if (servers.length !== 1) mcpRuleProblems.push(`The package must declare exactly one MCP server; it declares ${servers.length}.`);
  for (const server of servers) {
    if (!isRecord(server)) continue;
    if (server.type !== 'streamable-http') mcpRuleProblems.push('The server must use the streamable-http transport.');
    if (server.url !== options.endpointUrl) mcpRuleProblems.push('The server URL differs from the endpoint in the release input.');
    if (isRecord(server.headers) && Object.keys(server.headers).length > 0) mcpRuleProblems.push('Public submission rejects server headers; they would also publish whatever they carry.');
  }
  findings.push(mcpRuleProblems.length === 0 ? pass('package.mcp-server', 'The package declares one streamable-http server at the release input endpoint, with no headers.') : fail('package.mcp-server', 'The MCP server entry breaks a ChatGPT submission rule.', 'Correct endpoint.url in the release input.', mcpRuleProblems.join(' ')));

  // Listing text and limits.
  const listing = plugin === undefined ? ['plugin.json could not be read.'] : listingProblems(plugin);
  findings.push(listing.length === 0 ? pass('package.listing', 'The listing text, links and branding meet the submission limits.') : fail('package.listing', `The listing has ${listing.length} problem${listing.length === 1 ? '' : 's'}.`, 'Correct the listed fields in the release input.', listing.join(' ')));

  // Assets referenced by the manifest.
  const openai = plugin !== undefined && isRecord(plugin.extensions) ? plugin.extensions['com.openai'] : undefined;
  const face = isRecord(openai) && isRecord(openai.interface) ? openai.interface : {};
  const referenced = ['logo', 'composerIcon', 'logoDark', 'composerIconDark'].flatMap((field) => (face[field] === undefined ? [] : [{ field, value: face[field] }]));
  const assetProblems: string[] = [];
  for (const required of ['logo', 'composerIcon']) if (face[required] === undefined) assetProblems.push(`interface.${required} is required.`);
  for (const { field, value } of referenced) {
    if (typeof value !== 'string' || !/^\.\/assets\/[^/]+$/.test(value)) {
      assetProblems.push(`interface.${field} must be a ./assets/ path.`);
      continue;
    }
    const entry = entries.find((one) => one.path === value.slice(2));
    if (entry === undefined) assetProblems.push(`interface.${field} points to ${value}, which is not in the package.`);
    else {
      const problem = iconProblem(entry.path, entry.data);
      if (problem !== null) assetProblems.push(problem);
    }
  }
  findings.push(assetProblems.length === 0 ? pass('package.assets', 'The logo and composer icon are present, square and within the size limits.') : fail('package.assets', `The assets have ${assetProblems.length} problem${assetProblems.length === 1 ? '' : 's'}.`, 'Add or correct the asset files named in the release input.', assetProblems.join(' ')));

  // Components the portal cannot accept, and fields it rejects.
  const excluded: string[] = [];
  if (entries.some((one) => one.path === '.app.json' || one.path.startsWith('hooks/'))) excluded.push('The package contains an app reference or lifecycle hooks.');
  if (isRecord(openai) && (openai.apps !== undefined || openai.hooks !== undefined)) excluded.push('extensions["com.openai"] declares apps or hooks.');
  const texts = entries.filter((one) => TEXT_EXTENSIONS.has(path.extname(one.path).toLowerCase())).map((one) => ({ path: one.path, text: Buffer.from(one.data).toString('utf8') }));
  for (const { path: file, text } of texts) if (/"(?:test_credentials|reviewer_instructions)"/.test(text)) excluded.push(`${file} carries reviewer credentials or instructions, which the portal rejects and which never belong in a package.`);
  findings.push(excluded.length === 0 ? pass('package.components', 'The package has no app references, hooks or reviewer credentials.') : fail('package.components', 'The package contains something the portal rejects.', 'Remove it from the release input.', excluded.join(' ')));

  // Secrets: patterns that look like credentials, and literal values this run was given.
  const leaks: string[] = [];
  for (const { path: file, text } of texts) {
    const kinds = secretKinds(text);
    if (kinds.length > 0) leaks.push(`${file} contains what looks like a ${kinds.join(', ')}.`);
  }
  for (const entry of entries) for (const literal of options.forbiddenLiterals) if (literal !== '' && Buffer.from(entry.data).includes(literal)) leaks.push(`${entry.path} contains the credential supplied for discovery.`);
  findings.push(leaks.length === 0 ? pass('package.secrets', 'No credential was found in the package.') : fail('package.secrets', 'The package appears to contain a secret.', 'Remove the secret from the release input or its assets; credentials belong in the host portal.', leaks.join(' ')));

  return { findings, entries, plugin };
}
