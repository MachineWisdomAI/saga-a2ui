import type { ServerToClientMessage } from '@lynx-js/genui/a2ui';
import type { ActionBinding, InstanceHandle } from '@saga-a2ui/core/actions';
import type { InstanceSlot, SlotProbe } from '../adapter/instance-slot.js';
import type { ActionButtonEvents, LynxTap } from '../adapter/kind.js';
import { onBackground, onMainThread, trace } from '../trace.js';
import {
  archiveNote,
  cancelOrder,
  failingAction,
  pendingRows,
  pendingSessions,
  presentation,
  submitOrder,
} from './definitions.js';
import type { SessionHolder } from './session.js';
import type { SetupObserver } from './setup.js';

// Test driver, background thread only. The browser tests send one command at a time with
// `sendGlobalEvent` and read the reply from the probe module. Nothing here is part of the
// adapter: it holds the per-instance handles and bindings that application setup produced, only so
// a test can dispose, rebind and fire a captured closure on a chosen instance.
//
// `rebindable` is a lookup table used by this driver alone. No activation path reads it: a tap
// reaches a callable through the instance's own slot.

declare const SystemInfo: Record<string, unknown> | undefined;

const rebindable = {
  'submit-order': submitOrder,
  'cancel-order': cancelOrder,
  'archive-note': archiveNote,
  failing: failingAction,
};
type RebindName = keyof typeof rebindable;

type Command = { readonly id: number; readonly op: string } & Readonly<
  Record<string, unknown>
>;

export interface Driver {
  readonly observer: SetupObserver;
  readonly probe: (slot: InstanceSlot, event: SlotProbe) => void;
  readonly onMount: (slot: InstanceSlot) => void;
}

export function installHarness(holder: SessionHolder): Driver {
  const slots = new Map<string, InstanceSlot>();
  const handles = new Map<string, InstanceHandle<ActionButtonEvents>>();
  const bindings = new Map<string, ActionBinding>();
  const captured = new Map<string, (event: LynxTap) => unknown>();
  const watchLog: Array<Record<string, unknown>> = [];
  const labelOf = (handle: InstanceHandle<ActionButtonEvents>): string =>
    `${handle.id}@${handle.dataPath}`;

  const driver: Driver = {
    observer: {
      discovered(handle) {
        handles.set(labelOf(handle), handle);
      },
      bound(handle, binding) {
        const label = labelOf(handle);
        bindings.set(label, binding);
        binding.subscribe(() =>
          trace({ ev: 'binding-state', label, phase: binding.state.phase }),
        );
      },
    },
    probe(slot, event) {
      if (event.type === 'closed') {
        if (slots.get(slot.label) === slot) slots.delete(slot.label);
        handles.delete(slot.label);
        bindings.delete(slot.label);
      }
      const { type, ...rest } = event;
      const { where: _where, ...detail } = rest as { where?: unknown } & Record<
        string,
        unknown
      >;
      watchLog.push({ label: slot.label, type, ...detail });
      trace({ ev: 'probe', label: slot.label, type, ...detail });
    },
    onMount(slot) {
      slots.set(slot.label, slot);
    },
  };

  const slotOf = (label: unknown): InstanceSlot => {
    const slot = typeof label === 'string' ? slots.get(label) : undefined;
    if (slot === undefined)
      throw new Error(`no open instance '${String(label)}'`);
    return slot;
  };

  const operations: Record<string, (command: Command) => unknown> = {
    push(command) {
      const before = holder.current().rejections.length;
      holder.push(command['messages'] as ServerToClientMessage[]);
      return { rejected: holder.current().rejections.slice(before) };
    },
    reset() {
      holder.reset();
      return { generation: holder.current().generation };
    },
    state() {
      return {
        generation: holder.current().generation,
        instances: [...slots.entries()].map(([label, slot]) => ({
          label,
          live: slot.installation !== undefined,
          epoch: slot.getSnapshot().epoch,
          keyProp: slot.getSnapshot().keyProp ?? null,
          bound: bindings.has(label),
          bindingPhase: bindings.get(label)?.state.phase ?? null,
        })),
        setupErrors: holder
          .current()
          .setupErrors.map((error) =>
            error instanceof Error ? error.message : String(error),
          ),
        presentation: Object.fromEntries(presentation),
      };
    },
    dispose(command) {
      const binding = bindings.get(String(command['label']));
      if (binding === undefined) throw new Error('no binding to dispose');
      binding.dispose();
      return { phase: binding.state.phase };
    },
    rebind(command) {
      const label = String(command['label']);
      const handle = handles.get(label);
      if (handle === undefined) throw new Error(`no handle '${label}'`);
      const binding = handle.bindAction(
        'activate',
        rebindable[command['definition'] as RebindName],
      );
      bindings.set(label, binding);
      return { phase: binding.state.phase };
    },
    'bind-again'(command) {
      const handle = handles.get(String(command['label']));
      if (handle === undefined) throw new Error('no handle');
      try {
        handle.bindAction(
          'activate',
          rebindable[command['definition'] as RebindName],
        );
        return { threw: false };
      } catch (error) {
        return {
          threw: true,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    'capture-tap'(command) {
      const tap = slotOf(command['label']).currentTap;
      if (tap === undefined) throw new Error('no committed tap closure');
      captured.set(String(command['name']), tap);
      return { captured: true };
    },
    'fire-captured'(command) {
      const tap = captured.get(String(command['name']));
      if (tap === undefined) throw new Error('nothing captured');
      return { outcome: tap({ type: 'tap' }) };
    },
    'fire-current'(command) {
      const tap = slotOf(command['label']).currentTap;
      return { outcome: tap === undefined ? 'no-tap' : tap({ type: 'tap' }) };
    },
    'read-prop'(command) {
      const handle = handles.get(String(command['label']));
      return {
        value:
          handle === undefined
            ? null
            : (handle.read(String(command['prop'])) ?? null),
      };
    },
    'watch-log'() {
      return { log: watchLog.splice(0) };
    },
    'fire-forged'(command) {
      // A token with the current installation and epoch but a key the render did not show: only the
      // live key comparison at the tap can refuse it.
      const slot = slotOf(command['label']);
      const snapshot = slot.getSnapshot();
      if (snapshot.installation === undefined) throw new Error('not open');
      return {
        outcome: slot.activate(
          {
            installation: snapshot.installation,
            epoch: snapshot.epoch,
            binding: snapshot.binding,
            shownKey: command['shownKey'],
          },
          { type: 'tap' },
        ),
      };
    },
    'set-store'(command) {
      // Writes the signal store directly, inside one batch, the way a processor update does.
      const surface = slotOf(command['label']).where?.surface;
      if (surface === undefined) throw new Error('not open');
      surface.store.updateBatch(
        command['updates'] as Array<{ path: string; value: unknown }>,
      );
      return { written: (command['updates'] as unknown[]).length };
    },
    describe(command) {
      const where = slotOf(command['label']).where;
      return {
        componentId: where?.componentId ?? null,
        sourceComponentId: where?.sourceComponentId ?? null,
        dataContextPath: where?.dataContextPath ?? null,
      };
    },
    // What a definition value carries. Nothing records which environment its callbacks were written
    // for, so `bindAction` could not reject a mismatch even if one existed.
    'definition-shape'() {
      const plan = (submitOrder as unknown as { plan?: object }).plan ?? {};
      return {
        definitionKeys: Object.getOwnPropertyNames(submitOrder).sort(),
        planKeys: Object.getOwnPropertyNames(plan).sort(),
        frozen: Object.isFrozen(submitOrder),
      };
    },
    // ACT4: the test answers the pending prerequisite or releases a row's work, in the order it chooses.
    'pending-sessions'() {
      return {
        count: pendingSessions.length,
        rows: pendingRows.map((row) => row.noteId),
      };
    },
    'answer-session'(command) {
      const answer = pendingSessions.shift();
      if (answer === undefined) throw new Error('no pending session request');
      answer(command['answer'] === 'signed-out' ? 'signed-out' : 'signed-in');
      return { answered: true };
    },
    'release-row'(command) {
      const index = pendingRows.findIndex(
        (row) => row.noteId === command['noteId'],
      );
      if (index < 0) throw new Error('no pending row work');
      pendingRows.splice(index, 1)[0]?.release();
      return { released: true };
    },
    'clear-store'() {
      holder.current().store.clear();
      return { cleared: true };
    },
    'runtime-facts'() {
      return runtimeFacts();
    },
    // Two separate facts: the runtime has an AbortController, and a network API honors it. This
    // starts a request the test server never answers, aborts it after `afterMs`, and reports how
    // the request promise settled. The server reports whether the connection was dropped.
    async 'abort-fetch'(command) {
      const controller = new AbortController();
      const started = Date.now();
      const settled = fetch(String(command['url']), {
        signal: controller.signal,
      }).then(
        () => 'resolved',
        (error: unknown) =>
          (error as { name?: string } | undefined)?.name ?? String(error),
      );
      setTimeout(() => controller.abort(), Number(command['afterMs'] ?? 150));
      const outcome = await settled;
      return {
        outcome,
        elapsedMs: Date.now() - started,
        signalAborted: controller.signal.aborted,
      };
    },
  };

  if (onBackground()) {
    trace({ ev: 'booted' });
    const emitter = lynx.getJSModule('GlobalEventEmitter');
    emitter.addListener('saga:cmd', (...args: unknown[]) => {
      const command = args[0] as Command;
      const fail = (error: unknown): void => {
        trace({
          ev: 'reply',
          id: command.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      };
      try {
        const operation = operations[command.op];
        if (operation === undefined)
          throw new Error(`unknown op ${command.op}`);
        Promise.resolve(operation(command)).then((result) => {
          trace({ ev: 'reply', id: command.id, ok: true, result });
        }, fail);
      } catch (error) {
        fail(error);
      }
    });
  }
  return driver;
}

function runtimeFacts(): Record<string, unknown> {
  const scope = globalThis as Record<string, unknown>;
  const facts: Record<string, unknown> = {
    background: onBackground(),
    mainThread: onMainThread(),
    typeofDocument: typeof document,
    typeofWindow: typeof window,
    typeofWorkerGlobalScope: typeof scope['WorkerGlobalScope'],
    selfIsWorker:
      typeof scope['WorkerGlobalScope'] === 'function' &&
      (scope['self'] as object) instanceof
        (scope['WorkerGlobalScope'] as new () => object),
    typeofAbortController: typeof AbortController,
    typeofAbortSignal: typeof AbortSignal,
    typeofFetch: typeof fetch,
    typeofLynxFetch: typeof (scope['lynx'] as { fetch?: unknown } | undefined)
      ?.fetch,
    typeofQueueMicrotask: typeof queueMicrotask,
    typeofSetTimeout: typeof setTimeout,
    typeofPerformance: typeof performance,
    systemInfo: typeof SystemInfo === 'undefined' ? null : SystemInfo,
  };
  if (typeof AbortController === 'function') {
    const controller = new AbortController();
    let events = 0;
    controller.signal.addEventListener('abort', () => (events += 1));
    controller.abort();
    facts['abortSignalAborted'] = controller.signal.aborted;
    facts['abortEventsDelivered'] = events;
    facts['abortReasonName'] =
      (controller.signal.reason as { name?: string } | undefined)?.name ?? null;
  }
  return facts;
}
