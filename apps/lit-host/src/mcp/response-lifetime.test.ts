import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServerBudgets } from '@saga-a2ui/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import { bindResponseToLifetime } from './response-lifetime.js';

// What Node reports when a response is destroyed before the peer took it all is not constant: on
// some current Node releases `destroy()` on a response with its data already handed to the transport
// emits `finish` (with `writableFinished` and `destroyed` both true) and then `close`. The listener's
// own real-socket test cannot force that ordering, so this one stands in for the transport and
// produces exactly the sequence an independent diagnostic observed on Node 24 and 26.

class StandInResponse extends EventEmitter {
  destroyed = false;
  writableFinished = false;
  writableEnded = true;
  headersSent = true;

  /** Forced destruction as those releases report it: finish while already destroyed, then close. */
  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writableFinished = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }

  /** The peer took every byte. */
  deliver(): void {
    this.writableFinished = true;
    this.emit('finish');
    this.emit('close');
  }
}

function admit(requestMs: number) {
  const lifetime = createServerBudgets({
    operationMs: requestMs,
    requestMs,
  }).startRequest();
  const res = new StandInResponse();
  const closed = vi.fn();
  bindResponseToLifetime(
    new EventEmitter() as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    lifetime,
    undefined,
    closed,
  );
  return { lifetime, res, closed };
}

describe('a finite response the deadline destroyed', () => {
  it('is not delivery even though the transport reports finish on forced destruction', async () => {
    const { lifetime, closed } = admit(40);
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    });
    expect(closed).toHaveBeenCalledWith(false); // the listener's observation: not delivered
    expect(lifetime.cause).toMatchObject({ kind: 'request-timeout' });
    expect(lifetime.causes).toHaveLength(1); // the timeout alone: not a completion, and no second cause
  });

  it('is delivery when the peer took the whole response in time', () => {
    const { lifetime, res, closed } = admit(5_000);
    res.deliver();
    expect(lifetime.cause).toEqual({ kind: 'completed' });
    expect(lifetime.causes).toEqual([]);
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('is a disconnect when the caller went away before the response was taken', () => {
    const { lifetime, res, closed } = admit(5_000);
    res.destroyed = true; // the socket closed under it
    res.emit('close');
    expect(lifetime.cause).toMatchObject({ kind: 'disconnected' });
    expect(closed).toHaveBeenCalledWith(false);
  });
});
