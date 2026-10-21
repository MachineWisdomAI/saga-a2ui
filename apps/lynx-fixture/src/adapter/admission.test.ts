import { describe, expect, it } from 'vitest';
import { a2uiV0_9Decoder } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { admit, createAdmittingMessageStore } from './admission.js';
import { notesLayout, ordersLayout } from '../../e2e/messages.js';

// The admission rule is a pure function of one message and the bound control names, so it is
// checked in plain Node. What GenUI then does with an admitted message is only observable on the
// real renderer: see e2e/attachment.spec.ts.

const controls: ReadonlySet<string> = new Set(['ActionButton']);
const surface = 's';
const update = (...components: Array<Record<string, unknown>>) =>
  ({
    version: 'v0.9',
    updateComponents: { surfaceId: surface, components },
  }) as never;

describe('admission of a message for a bound control', () => {
  it('rejects the whole message when a bound control carries a protocol action of either shape', () => {
    for (const action of [
      { event: { name: 'x' } },
      { functionCall: { call: 'f', args: {} } },
    ]) {
      const result = admit(
        update(
          { id: 'a', component: 'Text', text: 'ok' },
          { id: 'b', component: 'ActionButton', child: 'c', action },
        ),
        controls,
      );
      expect(result).toEqual({
        kind: 'rejected',
        rejection: {
          surfaceId: surface,
          componentId: 'b',
          reason: 'action-on-bound-control',
        },
      });
    }
  });

  it('keeps an upstream Button action and any other component untouched', () => {
    const message = update({
      id: 'help',
      component: 'Button',
      child: 'l',
      action: { event: { name: 'open_help' } },
    });
    expect(admit(message, controls)).toEqual({ kind: 'admitted', message });
  });

  it('sets the source ID over any value the agent supplied, without mutating the input', () => {
    const original = update({
      id: 'row',
      component: 'ActionButton',
      child: 'c',
      sagaSourceId: 'spoofed',
    });
    const result = admit(original, controls);
    expect(result.kind).toBe('admitted');
    const admitted = (
      result as {
        message: {
          updateComponents: { components: Array<Record<string, unknown>> };
        };
      }
    ).message;
    expect(admitted.updateComponents.components[0]?.['sagaSourceId']).toBe(
      'row',
    );
    expect(
      (
        original as unknown as {
          updateComponents: { components: Array<Record<string, unknown>> };
        }
      ).updateComponents.components[0]?.['sagaSourceId'],
    ).toBe('spoofed');
  });

  it('passes messages that are not component updates through', () => {
    const message = {
      version: 'v0.9',
      updateDataModel: { surfaceId: surface, path: '/', value: {} },
    } as never;
    expect(admit(message, controls)).toEqual({ kind: 'admitted', message });
  });
});

describe('the admitting message store', () => {
  it('appends admitted messages in order, drops a rejected one and reports it once', () => {
    const rejected: unknown[] = [];
    const store = createAdmittingMessageStore({
      controls,
      onRejected: (rejection) => rejected.push(rejection),
    });
    store.push([
      update({ id: 'ok', component: 'Text', text: 'a' }),
      update({
        id: 'bad',
        component: 'ActionButton',
        child: 'c',
        action: { event: { name: 'x' } },
      }),
      update({ id: 'ok2', component: 'Text', text: 'b' }),
    ]);
    expect(store.getSnapshot()).toHaveLength(2);
    expect(rejected).toEqual([
      {
        surfaceId: surface,
        componentId: 'bad',
        reason: 'action-on-bound-control',
      },
    ]);
  });
});

// GenUI 0.7.0 interprets the protocol with its own `@a2ui/web_core` 0.10.6 processor; SAGA's core
// decoder is 0.13.0. This fixture adds no validation path of its own and weakens none. It checks
// what the two agree on for the messages the real renderer is driven with, and records a gap: the
// core decoder checks the envelope and does not authorize an action, so `action` on a control the
// Lynx adapter binds is refused only by the admission rule above, on the GenUI path.
describe('the fixture layouts under the SAGA core decoder (0.13.0)', () => {
  it('accepts every message the Lynx runtime is driven with, one validated message each', () => {
    for (const layout of [
      ordersLayout,
      notesLayout([{ id: 'n1', title: 'One' }]),
    ]) {
      const result = a2uiV0_9Decoder.decode(layout);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.messages).toHaveLength(layout.length);
    }
  });

  it('does not itself refuse a protocol action on the bound control: that refusal is the admission rule', () => {
    const withAction = update({
      id: 'b',
      component: 'ActionButton',
      child: 'c',
      action: { event: { name: 'x' } },
    });
    expect(a2uiV0_9Decoder.decode(withAction).ok).toBe(true);
    expect(admit(withAction, controls).kind).toBe('rejected');
  });
});
