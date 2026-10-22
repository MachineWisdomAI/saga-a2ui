// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import {
  answerCard,
  answerData,
  cardsLayout,
  openSession,
  rawSurfaceUnder,
  SURFACE_ID,
  trusted,
  type Session,
} from './fixture.test-support.js';

// Layer A: the card under the upstream surface of a raw message session, where a component can be
// replaced by protocol messages. A bound surface changes data only and never exposes the session,
// so these cases, whose subject is the replacement of a component, cannot go through it.

let mounted: Mounted | undefined;
const sessions: Session[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const session of sessions.splice(0)) session.dispose();
  mounted = undefined;
});

function start(markdown: string) {
  const session = openSession(cardsLayout([answerCard], answerData(markdown)));
  sessions.push(session);
  const host = trusted();
  mounted = mount();
  mounted.render(rawSurfaceUnder(host.view, session.surface));
  return { session, host, view: mounted };
}

const byTestId = (view: Mounted, id: string): HTMLElement[] => [
  ...view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const replaceCard = (...components: object[]) => [
  { version: 'v0.9', updateComponents: { surfaceId: SURFACE_ID, components } },
];

describe('a card whose component the protocol replaces', () => {
  it('rebuilds cleanly when a component update replaces the card, and drops the old card with its controls', async () => {
    const { session, host, view } = start(
      '[old](https://docs.example.com/old)',
    );
    const oldLink = byTestId(view, 'md-link')[0]!;
    await act(async () =>
      session.ingest(
        replaceCard({ id: 'card', component: 'Text', text: 'plain now' }),
      ),
    );
    expect(byTestId(view, 'card-root')).toEqual([]);
    expect(view.container.textContent).toContain('plain now');
    expect(oldLink.isConnected).toBe(false);
    view.press(oldLink as HTMLButtonElement);
    await view.settle();
    expect(host.requests).toEqual([]);
    // Putting a card back starts it afresh: nothing of the old card's state returns.
    await act(async () =>
      session.ingest(
        replaceCard({
          id: 'card',
          component: 'FaithfulCard',
          contractVersion: 1,
          markdown: { path: '/answer' },
        }),
      ),
    );
    expect(
      byTestId(view, 'md-link-status')[0]?.getAttribute('data-outcome'),
    ).toBeNull();
  });

  it('retires a control the moment A2UI disposes its node, even before React has unmounted it', async () => {
    const { session, host, view } = start('[a](https://docs.example.com/a)');
    const control = byTestId(view, 'md-link')[0]!;
    // The resolver disposes the replaced node synchronously; React learns of it on its next
    // render, which has not happened yet.
    session.ingest(
      replaceCard({ id: 'card', component: 'Text', text: 'replaced' }),
    );
    expect(control.isConnected).toBe(true);
    view.press(control as HTMLButtonElement);
    await view.settle();
    expect(host.requests).toEqual([]);
    expect(byTestId(view, 'card-root')).toEqual([]);
  });
});
