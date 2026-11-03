import { App } from '@modelcontextprotocol/ext-apps';
import {
  AppBridge,
  type McpUiHostCapabilities,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { hostLinksFromApp } from './host-links.js';

// The host link callback, exercised with a real `App` and `AppBridge` joined by an in-memory
// transport. The host's own handler is the only place a link can be opened, so what it receives
// is the observable effect.

const toClose: { app: App; bridge: AppBridge }[] = [];

async function connected(
  capabilities: McpUiHostCapabilities,
  onOpenLink?: (url: string) => Promise<{ isError?: boolean }>,
): Promise<App> {
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    { name: 'test-host', version: '0.0.0' },
    capabilities,
  );
  if (onOpenLink) bridge.onopenlink = ({ url }) => onOpenLink(url);
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await app.connect(viewSide);
  toClose.push({ app, bridge });
  return app;
}

afterEach(async () => {
  for (const { app, bridge } of toClose.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

describe('opening a link through the host', () => {
  it('sends the validated URL to the host and reports that it opened', async () => {
    const received: string[] = [];
    const app = await connected({ openLinks: {} }, async (url) => {
      received.push(url);
      return {};
    });
    await expect(
      hostLinksFromApp(app).open('https://docs.example.com/guide'),
    ).resolves.toBe('opened');
    expect(received).toEqual(['https://docs.example.com/guide']);
  });

  it('reports a denial when the host refuses the request', async () => {
    const app = await connected({ openLinks: {} }, async () => ({
      isError: true,
    }));
    await expect(
      hostLinksFromApp(app).open('https://docs.example.com/'),
    ).resolves.toBe('denied');
  });

  it('reports a failure when the host cannot be reached for the request', async () => {
    const app = await connected({ openLinks: {} }, async () => {
      throw new Error('host exploded');
    });
    await expect(
      hostLinksFromApp(app).open('https://docs.example.com/'),
    ).resolves.toBe('failed');
  });

  it('reports the capability as unavailable and makes no request when the host does not advertise it', async () => {
    const received: string[] = [];
    const app = await connected({}, async (url) => {
      received.push(url);
      return {};
    });
    await expect(
      hostLinksFromApp(app).open('https://docs.example.com/'),
    ).resolves.toBe('unavailable');
    expect(received).toEqual([]);
  });

  it('reports unavailable and makes no request once the signal has aborted', async () => {
    const received: string[] = [];
    const app = await connected({ openLinks: {} }, async (url) => {
      received.push(url);
      return {};
    });
    const lifetime = new AbortController();
    const links = hostLinksFromApp(app, lifetime.signal);
    await expect(links.open('https://docs.example.com/a')).resolves.toBe(
      'opened',
    );
    lifetime.abort();
    await expect(links.open('https://docs.example.com/b')).resolves.toBe(
      'unavailable',
    );
    expect(received).toEqual(['https://docs.example.com/a']);
  });

  it('reports unavailable when the signal aborts while the request is outstanding', async () => {
    let release: (() => void) | undefined;
    const app = await connected({ openLinks: {} }, async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return {};
    });
    const lifetime = new AbortController();
    const pending = hostLinksFromApp(app, lifetime.signal).open(
      'https://docs.example.com/',
    );
    await expect.poll(() => release).toBeDefined();
    lifetime.abort();
    release?.();
    await expect(pending).resolves.toBe('unavailable');
  });

  it('reports the capability as unavailable before the view has connected', async () => {
    const app = new App(
      { name: 'unconnected', version: '0.0.0' },
      {},
      { autoResize: false },
    );
    await expect(
      hostLinksFromApp(app).open('https://docs.example.com/'),
    ).resolves.toBe('unavailable');
  });
});
