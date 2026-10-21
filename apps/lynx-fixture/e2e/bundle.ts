import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reads the sections of a Lynx Web template (`*.web.bundle`). The layout is the one the runtime's
// own decoder reads (`@lynx-js/web-core` decode worker): an 8-byte magic header, a little-endian
// version, then sections of `label u32, length u32, content`. The Manifest section holds the
// background-thread chunks and the LepusCode section holds the main-thread chunks, each as a
// count followed by `keyLength, key, valueLength, value` entries.

const MAGIC = 'SDRAWROF'; // two little-endian 32-bit words, 'SDRA' then 'WROF'
const SECTION = { manifest: 1, lepusCode: 3, configurations: 6 } as const;

export interface TemplateSections {
  /** Background-thread code, by chunk name. */
  readonly background: Readonly<Record<string, string>>;
  /** Main-thread code, by chunk name. */
  readonly mainThread: Readonly<Record<string, string>>;
  readonly configuration: Readonly<Record<string, string>>;
}

function readBinaryMap(buffer: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  let offset = 0;
  const count = buffer.readUInt32LE(offset);
  offset += 4;
  for (let index = 0; index < count; index += 1) {
    const keyLength = buffer.readUInt32LE(offset);
    offset += 4;
    const key = buffer.subarray(offset, offset + keyLength).toString('utf8');
    offset += keyLength;
    const valueLength = buffer.readUInt32LE(offset);
    offset += 4;
    result[key] = buffer
      .subarray(offset, offset + valueLength)
      .toString('utf8');
    offset += valueLength;
  }
  return result;
}

export function readTemplate(file: string): TemplateSections {
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 8).toString('latin1') !== MAGIC)
    throw new Error('not a Lynx Web template');
  let background: Record<string, string> = {};
  let mainThread: Record<string, string> = {};
  let configuration: Record<string, string> = {};
  let offset = 12; // magic (8) + version (4)
  while (offset < buffer.length) {
    const label = buffer.readUInt32LE(offset);
    const length = buffer.readUInt32LE(offset + 4);
    const content = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length;
    if (label === SECTION.manifest) background = readBinaryMap(content);
    else if (label === SECTION.lepusCode) mainThread = readBinaryMap(content);
    else if (label === SECTION.configurations) {
      configuration = JSON.parse(content.toString('utf16le')) as Record<
        string,
        string
      >;
    }
  }
  return { background, mainThread, configuration };
}

export const builtBundle = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'main.web.bundle',
);

export const contains = (
  code: Readonly<Record<string, string>>,
  needle: string,
): boolean => Object.values(code).some((chunk) => chunk.includes(needle));
