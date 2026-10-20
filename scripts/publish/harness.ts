import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { FetchLike } from '@modelcontextprotocol/client';
import { afterAll, beforeAll } from 'vitest';
import { startListener, type Listener } from '../../templates/lit-node/server/listener.js';
import { runCli, type Environment } from '../saga.js';
import type { ValidatorLoad } from './chatgpt.js';
import type { PluginValidator } from './claude-plugin.js';
import { publicationTool } from './publish.js';
import { RECORD_FILE, type PublicationRecord } from './record.js';

// The harness of the publication tests (CLI3 #66, CLI4 #67): a complete fixture application (a release
// input, assets, a build and package manifest in scripts/publish/fixture/notes-app) whose view is
// served by the real qualified lit-node listener, read through the command line. The published URL
// is a public HTTPS name; the network seam routes it to that local listener and records every
// JSON-RPC method the command sent, so "no tool was called" is observed and not assumed.
//
// Importing this module starts the listener and removes the scratch directory after the importing
// test file: its hooks register in that file's context.

export const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(here, 'fixture', 'notes-app');
export const PUBLISHED = 'https://notes.example.com/status/mcp';

export const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-publish-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let listener: Listener;
export const viewHtml = fs.readFileSync(path.join(FIXTURE, 'build', 'view.html'), 'utf8');
beforeAll(async () => {
  listener = await startListener({ html: viewHtml, verifier: { verifyAccessToken: () => Promise.reject(new Error('this fixture is public')) }, authorize: async () => true, port: 0 });
});
afterAll(async () => listener.close());

/** A fresh copy of the fixture application that a case may damage. */
export function copyFixture(): string {
  const directory = fs.mkdtempSync(path.join(root, 'app-'));
  fs.cpSync(FIXTURE, directory, { recursive: true });
  return directory;
}

export const workspace = (): string => fs.mkdtempSync(path.join(root, 'cwd-'));
export const editInput = (app: string, change: (input: Record<string, any>) => void): void => {
  const file = path.join(app, 'saga-publication.json');
  const input = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
  change(input);
  fs.writeFileSync(file, JSON.stringify(input, null, 2));
};

/** The release input's Claude connector section: everything the portal asks for, as the application owner would supply it. */
export const connector = (): Record<string, any> => ({
  name: 'Notes Fixture',
  oneLiner: 'Shows whether the Notes Fixture service is running.',
  description: 'Shows whether the Notes Fixture service is running, in a card inside the conversation. It only reports status and reads nothing from your account.',
  categories: ['Developer Tools'],
  slug: 'notes-fixture',
  documentationURL: 'https://notes.example.com/docs',
  privacyPolicyURL: 'https://notes.example.com/privacy',
  support: { email: 'support@notes.example.com', url: 'https://notes.example.com/support' },
  icon: 'assets/icon.svg',
  screenshots: [1, 2, 3].map((n) => ({ file: `screenshots/${n}.png`, prompt: `Is the notes service running? (${n})` })),
  useCases: { primary: ['Check whether the notes service is running'], prerequisites: 'Nothing: the connector needs no account.', access: 'read' },
  authentication: { mode: 'none' },
  dataHandling: { apiOwnership: 'first-party', personalHealthData: false, sponsoredContent: false },
  allowedLinkUris: ['https://notes.example.com'],
  reviewContact: { name: 'Fixture Reviewer', email: 'review@notes.example.com' },
});

/** A copy of the fixture application with its Claude section and the three carousel screenshots the section names. */
export function claudeApp(change: (connector: Record<string, any>, input: Record<string, any>) => void = () => undefined): string {
  const app = copyFixture();
  fs.mkdirSync(path.join(app, 'screenshots'));
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(app, 'screenshots', `${n}.png`), png(600, 600, 1000));
  editInput(app, (input) => {
    input.claude = { connector: connector() };
    change(input.claude.connector, input);
  });
  return app;
}

export interface Wire {
  /** Every JSON-RPC method the command sent to the endpoint, in order. */
  readonly methods: string[];
  readonly fetch: FetchLike;
}

/** The network seam: routes the published URL to the local listener and records the methods sent. */
export function wire(rewrite?: (method: string, response: Response) => Promise<Response> | Response, options: { readonly ignoreCursors?: boolean } = {}): Wire {
  const methods: string[] = [];
  return {
    methods,
    fetch: async (_url, init) => {
      let method = init?.method ?? 'GET';
      let sent = init;
      if (typeof init?.body === 'string') {
        const request = JSON.parse(init.body) as { method?: string; params?: { cursor?: unknown } };
        method = request.method ?? method;
        // A server that offers pages forever is simulated by a listener that serves its one page whatever cursor it is given.
        if (options.ignoreCursors === true && request.params?.cursor !== undefined) {
          delete request.params.cursor;
          sent = { ...init, body: JSON.stringify(request) };
        }
      }
      methods.push(method);
      const response = await fetch(listener.statusUrl, sent);
      return rewrite === undefined ? response : rewrite(method, response);
    },
  };
}

export interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface Options {
  readonly cwd?: string;
  readonly wire?: Wire;
  readonly validators?: ValidatorLoad;
  readonly pluginValidator?: PluginValidator;
  readonly environment?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly onOutput?: (text: string) => void;
  /** The clock of a handoff record. */
  readonly now?: () => Date;
}

export async function saga(args: readonly string[], options: Options = {}): Promise<Run> {
  let out = '';
  let err = '';
  const environment: Environment = {
    cwd: options.cwd ?? workspace(),
    sdkVersion: () => '0.0.0-candidate.g0123456789ab',
    stageDemo: () => Promise.reject(new Error('publish builds no demonstration')),
    publication: { load: async () => publicationTool, environment: options.environment ?? {}, fetch: (options.wire ?? wire()).fetch, validators: options.validators, pluginValidator: options.pluginValidator, now: options.now },
    stdout: (text) => {
      out += text;
      options.onOutput?.(text);
    },
    stderr: (text) => (err += text),
    signal: options.signal,
  };
  return { code: await runCli(args, environment), out, err };
}

/** A network seam that edits the JSON-RPC result of one method. */
export const editing = (target: string, edit: (result: Record<string, any>) => void, options: { readonly ignoreCursors?: boolean } = {}): Wire =>
  wire(async (method, response) => {
    if (method !== target) return response;
    const body = JSON.parse(await response.text()) as { result: Record<string, any> };
    edit(body.result);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }, options);

export const recordOf = (directory: string): PublicationRecord => JSON.parse(fs.readFileSync(path.join(directory, RECORD_FILE), 'utf8')) as PublicationRecord;
export const status = (record: PublicationRecord, id: string): string | undefined => record.findings.find((finding) => finding.id === id)?.status;
export const listing = (directory: string): string[] => (fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []);

/** A square PNG of the given size, made without a library. `rows` is how many pixel rows the image data holds (the header always promises `size`). */
export function png(size: number, rows = size, width = size): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.concat(Array.from({ length: rows }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x23)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

