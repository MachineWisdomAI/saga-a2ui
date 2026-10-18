import { expect, type Locator, type Page } from '@playwright/test';

// Page-side driver for the built Lynx Web fixture. The page holds no reference into the Lynx
// background thread. Commands leave as global events; observations arrive as JSON records
// through a native module, and are read here.

export interface ProbeRecord {
  readonly seq: number;
  readonly at?: number;
  readonly receivedAt?: number;
  readonly ev: string;
  readonly [key: string]: unknown;
}

export interface InstanceState {
  readonly label: string;
  readonly live: boolean;
  readonly epoch: number;
  readonly keyProp: string | null;
  readonly bound: boolean;
  readonly bindingPhase: string | null;
}

export interface FixtureState {
  readonly generation: number;
  readonly instances: readonly InstanceState[];
  readonly setupErrors: readonly string[];
  readonly presentation: Readonly<Record<string, string>>;
}

export class Fixture {
  #nextId = 1;

  private constructor(readonly page: Page) {}

  static async open(page: Page): Promise<Fixture> {
    const fixture = new Fixture(page);
    await page.goto('/');
    await expect.poll(() => fixture.records().then((all) => all.some((record) => record.ev === 'booted')), { timeout: 30_000 }).toBe(true);
    return fixture;
  }

  /** Starts recording removals of elements, by ID, from the rendered tree. */
  watchRemovals(): Promise<void> {
    return this.page.evaluate(() => (window as unknown as { sagaWatchRemoval(): void }).sagaWatchRemoval());
  }

  removals(): Promise<Array<{ id: string; at: number }>> {
    return this.page.evaluate(() => (window as unknown as { sagaRemovals: Array<{ id: string; at: number }> }).sagaRemovals.slice());
  }

  /** Scrolls the first scrollable list container by `top` pixels, inside the page. */
  async scrollList(top: number): Promise<void> {
    await this.page.evaluate((to) => {
      const list = document.querySelector('lynx-view')?.shadowRoot?.querySelector('x-list') as HTMLElement | null;
      if (!list) throw new Error('no list');
      list.scrollTop = to;
      list.dispatchEvent(new Event('scroll'));
    }, top);
    await this.page.waitForTimeout(400);
  }

  records(): Promise<ProbeRecord[]> {
    return this.page.evaluate(() => (window as unknown as { sagaRecords: ProbeRecord[] }).sagaRecords.slice());
  }

  async recordsOf(ev: string): Promise<ProbeRecord[]> {
    return (await this.records()).filter((record) => record.ev === ev);
  }

  /** Sends one command to the background thread and waits for its reply. */
  async send<Result = Record<string, unknown>>(op: string, args: Record<string, unknown> = {}): Promise<Result> {
    const id = this.#nextId++;
    await this.page.evaluate(
      ({ id: commandId, op: operation, args: rest }) => {
        (window as unknown as { sagaSend(command: unknown): void }).sagaSend({ id: commandId, op: operation, ...rest });
      },
      { id, op, args },
    );
    let reply: ProbeRecord | undefined;
    await expect
      .poll(async () => {
        reply = (await this.records()).find((record) => record.ev === 'reply' && record['id'] === id);
        return reply !== undefined;
      }, { message: `reply to ${op}`, timeout: 15_000 })
      .toBe(true);
    if (reply?.['ok'] !== true) throw new Error(`command ${op} failed: ${String(reply?.['error'])}`);
    return reply['result'] as Result;
  }

  push(...messages: readonly unknown[]): Promise<{ rejected: Array<Record<string, unknown>> }> {
    return this.send('push', { messages });
  }

  state(): Promise<FixtureState> {
    return this.send<FixtureState>('state');
  }

  /** Waits until the background reports exactly these instance labels as live. */
  async untilLive(...labels: readonly string[]): Promise<FixtureState> {
    let last: FixtureState | undefined;
    await expect
      .poll(async () => {
        last = await this.state();
        return last.instances.filter((instance) => instance.live).map((instance) => instance.label).sort();
      }, { timeout: 20_000 })
      .toEqual([...labels].sort());
    return last as FixtureState;
  }

  /** The rendered element of a component ID, found inside the lynx-view's shadow tree. */
  control(componentId: string): Locator {
    return this.page.locator(`[id="${componentId}"]`).first();
  }

  async tap(componentId: string): Promise<void> {
    await this.control(componentId).click();
  }

  /** An upstream control has no stable ID attribute in the DOM; it is found by its visible label. */
  async tapLabelled(label: string): Promise<void> {
    await this.page.getByText(label, { exact: true }).first().click();
  }

  /** The slot probe events since the last call, in the order the background reported them. */
  async watchLog(): Promise<Array<{ label: string; type: string; [key: string]: unknown }>> {
    return (await this.send<{ log: Array<{ label: string; type: string }> }>('watch-log')).log;
  }

  async instance(label: string): Promise<InstanceState> {
    const found = (await this.state()).instances.find((instance) => instance.label === label);
    if (found === undefined) throw new Error(`no instance ${label}`);
    return found;
  }

  invocations(): Promise<ProbeRecord[]> {
    return this.recordsOf('invoke');
  }

  /** Waits for the number of recorded invocations, then returns them. */
  async untilInvocations(count: number): Promise<ProbeRecord[]> {
    await expect.poll(async () => (await this.invocations()).length, { timeout: 10_000 }).toBe(count);
    return this.invocations();
  }

  /** Lets queued background work run, then asserts no further invocation arrived. */
  async stillInvocations(count: number): Promise<void> {
    await this.page.waitForTimeout(400);
    expect((await this.invocations()).length).toBe(count);
  }
}
