import net from 'node:net';

// A raw TCP connection that speaks HTTP/1.1 by hand, for qualification of what a listener does with a
// connection: a client library hides the framing, the pipelining and the close, and these are exactly
// what an early answer to an unfinished request body is about. Test support only; nothing ships it.

/** One complete HTTP/1.1 response, parsed from the bytes the listener wrote. */
export interface RawResponse {
  readonly status: number;
  /** Header names are lower-cased; a repeated header keeps its last value. */
  readonly headers: Readonly<Record<string, string>>;
  /** The decoded body: the Content-Length bytes, or the de-chunked chunks. */
  readonly body: string;
}

/** What `readResponse` found when no complete response arrived. */
export class IncompleteResponseError extends Error {
  constructor(
    readonly reason: 'timeout' | 'closed',
    readonly received: string,
  ) {
    super(
      `No complete response arrived (${reason}); received ${JSON.stringify(received)}.`,
    );
    this.name = 'IncompleteResponseError';
  }
}

type Parsed =
  | {
      readonly kind: 'complete';
      readonly response: RawResponse;
      readonly used: number;
    }
  | { readonly kind: 'need-more' }
  | {
      readonly kind: 'until-close';
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly headEnd: number;
    };

/** Parses one response from the front of `text`, or says what is missing. */
function parseResponse(text: string): Parsed {
  const headEnd = text.indexOf('\r\n\r\n');
  if (headEnd < 0) return { kind: 'need-more' };
  const [statusLine = '', ...lines] = text.slice(0, headEnd).split('\r\n');
  const status = /^HTTP\/1\.1 (\d{3})(?: |$)/.exec(statusLine)?.[1];
  if (status === undefined)
    throw new Error(
      `Not an HTTP/1.1 status line: ${JSON.stringify(statusLine)}`,
    );
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0)
      throw new Error(`Not a header line: ${JSON.stringify(line)}`);
    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  const code = Number(status);
  const start = headEnd + 4;
  if (code < 200 || code === 204 || code === 304) {
    return {
      kind: 'complete',
      response: { status: code, headers, body: '' },
      used: start,
    };
  }
  if (headers['transfer-encoding']?.toLowerCase() === 'chunked') {
    let at = start;
    let body = '';
    for (;;) {
      const lineEnd = text.indexOf('\r\n', at);
      if (lineEnd < 0) return { kind: 'need-more' };
      const size = Number.parseInt(
        text.slice(at, lineEnd).split(';')[0] ?? '',
        16,
      );
      if (!Number.isInteger(size) || size < 0)
        throw new Error(
          `Not a chunk size: ${JSON.stringify(text.slice(at, lineEnd))}`,
        );
      if (size === 0) {
        // No trailers are expected; the terminating chunk ends with an empty line.
        if (text.slice(lineEnd, lineEnd + 4) === '\r\n\r\n')
          return {
            kind: 'complete',
            response: { status: code, headers, body },
            used: lineEnd + 4,
          };
        return { kind: 'need-more' };
      }
      const dataEnd = lineEnd + 2 + size;
      if (text.length < dataEnd + 2) return { kind: 'need-more' };
      if (text.slice(dataEnd, dataEnd + 2) !== '\r\n')
        throw new Error('A chunk is not followed by CRLF.');
      body += text.slice(lineEnd + 2, dataEnd);
      at = dataEnd + 2;
    }
  }
  const length = headers['content-length'];
  if (length !== undefined) {
    const size = Number(length);
    if (!Number.isInteger(size) || size < 0)
      throw new Error(`Not a Content-Length: ${JSON.stringify(length)}`);
    if (text.length < start + size) return { kind: 'need-more' };
    return {
      kind: 'complete',
      response: {
        status: code,
        headers,
        body: text.slice(start, start + size),
      },
      used: start + size,
    };
  }
  return { kind: 'until-close', status: code, headers, headEnd: start };
}

/**
 * One TCP connection to a listener. Bytes are written as given, responses are read one at a time with
 * their framing checked, and bytes beyond the response that was asked for stay available for the next
 * read (`pending`), so a second answer that was written too early or twice shows up instead of vanishing.
 */
export class RawHttpConnection {
  /** Resolves when the peer has closed the socket. */
  readonly closed: Promise<void>;
  #received = '';
  #closed = false;
  #wake: (() => void) | undefined;

  private constructor(private readonly socket: net.Socket) {
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      this.#received += chunk;
      this.#wake?.();
    });
    socket.on('error', () => undefined);
    this.closed = new Promise<void>((resolve) =>
      socket.once('close', () => {
        this.#closed = true;
        this.#wake?.();
        resolve();
      }),
    );
  }

  static async open(target: string): Promise<RawHttpConnection> {
    const url = new URL(target);
    const socket = net.connect(Number(url.port), url.hostname);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return new RawHttpConnection(socket);
  }

  /** Bytes received and not yet consumed by a `readResponse`. */
  get pending(): string {
    return this.#received;
  }

  /** Whether the peer has closed the socket. */
  get isClosed(): boolean {
    return this.#closed;
  }

  /** The local port, which names this connection: it is unchanged across requests that reuse it. */
  get localPort(): number | undefined {
    return this.socket.localPort;
  }

  write(bytes: string): void {
    this.socket.write(bytes, 'latin1');
  }

  /**
   * Writes a request head for `method path` and, after the blank line, the `body` bytes given now.
   * `declaredLength` is the Content-Length announced, so a body can be left unfinished on purpose.
   */
  request(
    method: string,
    target: string,
    options: {
      readonly host?: string;
      readonly headers?: readonly string[];
      readonly declaredLength?: number;
      readonly body?: string;
    } = {},
  ): void {
    const url = new URL(target);
    this.write(
      [
        `${method} ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${options.host ?? url.host}`,
        ...(options.declaredLength === undefined
          ? []
          : [
              'Content-Type: application/json',
              `Content-Length: ${options.declaredLength}`,
            ]),
        ...(options.headers ?? []),
        '',
        options.body ?? '',
      ].join('\r\n'),
    );
  }

  /** Waits up to `timeoutMs` for the next complete response and consumes exactly its bytes. */
  async readResponse(timeoutMs: number): Promise<RawResponse> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const parsed = parseResponse(this.#received);
      if (parsed.kind === 'complete') {
        this.#received = this.#received.slice(parsed.used);
        return parsed.response;
      }
      if (parsed.kind === 'until-close' && this.#closed) {
        const body = this.#received.slice(parsed.headEnd);
        this.#received = '';
        return { status: parsed.status, headers: parsed.headers, body };
      }
      if (this.#closed)
        throw new IncompleteResponseError('closed', this.#received);
      const left = deadline - Date.now();
      if (left <= 0)
        throw new IncompleteResponseError('timeout', this.#received);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.#wake = undefined;
    }
  }

  /** Waits up to `timeoutMs` for the peer to close; true when it did. */
  async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.#closed) return true;
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const closed = this.closed.then(() => true as const);
    try {
      return await Promise.race([closed, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  destroy(): void {
    this.socket.destroy();
  }
}
