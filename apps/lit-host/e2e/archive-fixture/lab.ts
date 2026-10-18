import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ServerRequest, ServerRequestOptions, ServerTransport } from '@saga-a2ui/core/actions';
import type { ArchiveEnvironment, ArchiveMessage } from './archive.js';

// A test-controlled application environment for the browser pages. The page owns it; the Playwright
// spec decides when each prerequisite and each protected request answers, so the order in which
// things settle is the spec's choice. It counts prerequisite requests and protected-operation
// requests apart, which is the accounting the contract asks for. It is a fixture, not a host.

export interface PendingRequest {
  readonly noteId: string;
  readonly toolName: string;
  /** What the runtime asked for: the time left on the work deadline, or less. */
  readonly timeout: number | undefined;
  readonly aborted: () => boolean;
  answer(reply: CallToolResult): void;
  reject(message: string): void;
}

export interface ArchiveLab {
  /** Protected-operation requests that reached the transport, in order. */
  readonly requests: PendingRequest[];
  /** The prerequisites’ own requests, counted apart from the protected operation. */
  readonly counts: { sessions: number; confirms: number; audits: number; records: number };
  /** When true the session check waits for `releaseSession` instead of answering. */
  holdSession: boolean;
  signedIn: boolean;
  readonly heldSessions: (() => void)[];
  failRecord: boolean;
  releaseSession(): void;
  readonly shown: { noteId: string | undefined; kind: ArchiveMessage['kind']; retry: boolean | undefined }[];
}

export function createArchiveLab(show: (noteId: string | undefined, message: ArchiveMessage) => void): {
  readonly lab: ArchiveLab;
  readonly environment: ArchiveEnvironment;
} {
  const requests: PendingRequest[] = [];
  const heldSessions: (() => void)[] = [];
  const lab: ArchiveLab = {
    requests,
    counts: { sessions: 0, confirms: 0, audits: 0, records: 0 },
    holdSession: false,
    signedIn: true,
    heldSessions,
    failRecord: false,
    releaseSession: () => heldSessions.shift()?.(),
    shown: [],
  };

  const transport: ServerTransport<CallToolResult> = {
    callServerTool(request: ServerRequest, options?: ServerRequestOptions): Promise<CallToolResult> {
      return new Promise((resolve, reject) => {
        const signal = options?.signal;
        requests.push({
          noteId: String(request.arguments?.noteId),
          toolName: request.name,
          timeout: options?.timeout,
          aborted: () => signal?.aborted === true,
          answer: resolve,
          reject: (message) => reject(new Error(message)),
        });
        // A client that aborts stops waiting. It does not recall what it sent.
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };

  const environment: ArchiveEnvironment = {
    transport,
    async session() {
      lab.counts.sessions += 1;
      if (lab.holdSession) await new Promise<void>((resolve) => heldSessions.push(resolve));
      return lab.signedIn ? { userKey: 'u-1' } : undefined;
    },
    async confirm() {
      lab.counts.confirms += 1;
      return true;
    },
    async audit() {
      lab.counts.audits += 1;
      return true;
    },
    async recordArchived() {
      lab.counts.records += 1;
      if (lab.failRecord) throw new Error('the view could not record it');
    },
    async refreshList() {
      return undefined;
    },
    show(noteId, message) {
      lab.shown.push({ noteId, kind: message.kind, retry: 'retry' in message ? message.retry : undefined });
      show(noteId, message);
    },
  };
  return { lab, environment };
}

/** What the user reads for each message. Nothing here invites a retry while the effect is unknown. */
export function wording(message: ArchiveMessage): string {
  switch (message.kind) {
    case 'not-sent':
      return `No archive request was sent (${message.why})`;
    case 'archived':
      return `Archived at ${message.archivedAt}`;
    case 'archived-view-failed':
      return `Archived at ${message.archivedAt}, but this view could not be updated`;
    case 'declined':
      return 'The server declined the request';
    case 'status-unknown':
      return 'The archive status is unknown';
  }
}
