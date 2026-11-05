import { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import {
  DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
  registerPublicOperation,
  type OperationView,
} from './index.js';
import { startTestHost, type TestHost } from './http-host.test-support.js';

// The official server counts the array elements and object members of one tools/call `arguments`
// payload only when it is given a limit; with none it parses and validates whatever the body
// holds, up to the transport's byte limit. The tests below call a real server over Streamable
// HTTP the way a client does, so what they show is what an application inherits.

const VIEW: OperationView = {
  uri: 'ui://test/echo.html',
  title: 'Echo view',
  html: '<!doctype html><title>echo</title>',
  csp: CLOSED_VIEW_CSP,
};

// A tolerant (non-strict) object schema, as a plain `z.object` is: it ignores members it does
// not declare, so only the server's element limit can refuse an oversized payload.
const EchoInput = z.object({ word: z.string().min(1).max(16) });
const EchoOutput = z.strictObject({ word: z.string() });

function buildServer(options?: { maxToolInputElements?: number }) {
  return (): McpServer => {
    const server = new McpServer(
      { name: 'limit-test', version: '0.0.0' },
      options,
    );
    registerPublicOperation(server, {
      name: 'echo',
      title: 'Echo',
      description: 'Returns the word it was given.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      input: EchoInput,
      output: EchoOutput,
      view: VIEW,
      failures: {
        absent: 'Nothing to echo.',
        unavailable: 'Echo is unavailable.',
        invalidOutput: 'The echo could not be shown.',
      },
      handle: (input) => ({ kind: 'record', record: input }),
      project: (record) => ({
        text: record.word,
        data: { word: record.word },
      }),
    });
    return server;
  };
}

/** An argument payload with the given number of array elements beside the declared member. */
const payload = (elements: number) => ({
  word: 'hello',
  padding: new Array<number>(elements).fill(0),
});

// The server counts every array element and object member: the two members of the payload
// object (`word` and `padding`) plus the padding array's elements.
const PAYLOAD_MEMBERS = 2;
/** The largest padding that still fits the limit: exactly the limit's count. */
const LARGEST_FITTING_PADDING =
  DEFAULT_MAX_TOOL_INPUT_ELEMENTS - PAYLOAD_MEMBERS;
/** One element over the limit: the same payload shape with one more padding element. */
const ONE_OVER_PADDING = LARGEST_FITTING_PADDING + 1;

let host: TestHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

describe('the default tool input element limit', () => {
  it('is a finite whole number the official server accepts', () => {
    expect(Number.isSafeInteger(DEFAULT_MAX_TOOL_INPUT_ELEMENTS)).toBe(true);
    expect(DEFAULT_MAX_TOOL_INPUT_ELEMENTS).toBeGreaterThanOrEqual(1);
    expect(() =>
      buildServer({
        maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
      })(),
    ).not.toThrow();
  });

  it('refuses an oversized payload before the tool runs, and still serves a legitimate call', async () => {
    host = await startTestHost({
      buildServer: buildServer({
        maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
      }),
      jsonResponse: true,
    });
    const client = await host.connect();

    const legitimate = await client.callTool({
      name: 'echo',
      arguments: { word: 'hello' },
    });
    expect(legitimate.isError).not.toBe(true);
    expect(legitimate.structuredContent).toEqual({ word: 'hello' });

    // The largest payload that still fits: its two members plus the padding array's elements
    // total exactly the limit.
    const fits = await client.callTool({
      name: 'echo',
      arguments: payload(LARGEST_FITTING_PADDING),
    });
    expect(fits.isError).not.toBe(true);

    const refused = await client.callTool({
      name: 'echo',
      arguments: payload(ONE_OVER_PADDING),
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(
      /more than the maximum of 256 elements/,
    );
  });

  it('is what separates a server that refuses from one that parses the whole payload', async () => {
    host = await startTestHost({
      buildServer: buildServer(),
      jsonResponse: true,
    });
    const client = await host.connect();
    const result = await client.callTool({
      name: 'echo',
      // The very payload the limited server refuses above, one element over the limit.
      arguments: payload(ONE_OVER_PADDING),
    });
    // The official server's own default: no limit, so that payload is accepted.
    expect(result.isError).not.toBe(true);
  });
});
