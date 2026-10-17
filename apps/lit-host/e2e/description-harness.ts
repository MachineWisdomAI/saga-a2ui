import { readFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { createContentPolicy, type ContentPolicy } from '../src/content/policy.js';
import { EPISODE_TOOL_NAME } from '../src/mcp/episode.js';
import { startEpisodeListener, type EpisodeListener } from '../src/mcp/listener.js';
import type { HostedResource } from './host-fixture/host.js';

// Descriptions rendered by the built view, in the sandboxed iframe of the local host fixture,
// against a real MCP listener. Every https request the view makes is observed at the browser's
// network boundary (and answered locally, so no test depends on the internet): a blocked image
// is proved by the absence of a request, not by a source-text assertion. The host's link
// callback is the fixture's real `ui/open-link` handler.

const builtView = new URL('../dist/view/view.html', import.meta.url);
export const IMAGE_HOST = 'images.example.com';
export const IMAGE = `https://${IMAGE_HOST}/ok.png`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

export interface Opened {
  readonly page: Page;
  readonly view: FrameLocator;
  readonly frame: Frame;
  readonly resource: HostedResource;
  /** Every https request that reached the network layer, in order. */
  readonly requests: string[];
  /** Every URL the host's open-link handler received. */
  readonly openLinkCalls: string[];
  /** Main-frame and iframe navigations after the view mounted. */
  readonly navigations: string[];
  /** The host delivers the tool result for another episode, as it does on a new selection. */
  deliverEpisode(episodeId: string): Promise<void>;
  /** The host asks the view to tear down (`ui/resource-teardown`). */
  teardown(): Promise<void>;
}

export interface OpenOptions {
  readonly imageHosts?: readonly string[];
  /** The trusted content level. Defaults to Standard. */
  readonly level?: 'standard' | 'strict';
  /** Strict only: how blocked fragments first appear. */
  readonly blockedPresentation?: 'placeholder' | 'inert-text';
  /** The description every episode has, or one chosen by episode id. */
  readonly description: string | ((episodeId: string) => string);
  /** How the host treats links: absent (no capability), allow, deny, or a custom handler. */
  readonly hostLinks?: 'absent' | 'allow' | 'deny' | ((url: string) => Promise<{ isError?: boolean }>);
  /** Rewrites the served document, e.g. to remove the restrictions or corrupt the configuration. */
  readonly transformHtml?: (html: string) => string;
  /** Skip waiting for the host handshake (a view that refuses to start never completes it). */
  readonly expectStart?: boolean;
}

const listeners: EpisodeListener[] = [];
const clients: Client[] = [];

/** Closes every listener and client the spec opened. Each spec registers it with `test.afterEach`. */
export async function cleanupServedResources(): Promise<void> {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
}

export function policyOf(imageHosts: readonly string[], settings: object = {}): ContentPolicy {
  const created = createContentPolicy({ imageHosts, ...settings });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

function policyFor(options: OpenOptions): ContentPolicy {
  return policyOf(options.imageHosts ?? [], {
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.blockedPresentation === undefined ? {} : { blockedPresentation: options.blockedPresentation }),
  });
}

export async function serveResource(options: OpenOptions): Promise<{ resource: HostedResource; client: Client }> {
  const listener = await startEpisodeListener({
    viewHtml: await readFile(builtView, 'utf8'),
    catalog: {
      find: (id) => ({
        id,
        title: 'Episode title',
        description: typeof options.description === 'function' ? options.description(id) : options.description,
      }),
    },
    contentPolicy: policyFor(options),
    port: 0,
  });
  listeners.push(listener);
  const client = new Client({ name: 'e2e-host', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
  clients.push(client);
  const { tools } = await client.listTools();
  const uri = (tools[0]?._meta as { ui: { resourceUri: string } }).ui.resourceUri;
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  const ui = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui;
  return { resource: { html: options.transformHtml?.(content.text) ?? content.text, csp: ui.csp }, client };
}

/** Answers every https request locally and records it. Redirects and probes have fixed paths. */
async function observeNetwork(page: Page, requests: string[]): Promise<void> {
  await page.route(/^https:\/\//, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (url.pathname === '/redirect-out.png') {
      return route.fulfill({ status: 302, headers: { ...cors, location: 'https://other.example.net/stolen.png' } });
    }
    if (url.pathname.endsWith('.js')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'text/javascript', body: 'window.__external = 1;' });
    }
    if (url.pathname.endsWith('.css')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'text/css', body: 'body { color: red; }' });
    }
    if (url.pathname.endsWith('.woff2')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'font/woff2', body: 'not a font' });
    }
    if (url.pathname.endsWith('.mp3')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: 'not audio' });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'image/svg+xml', body: SVG });
  });
}

export async function open(page: Page, options: OpenOptions): Promise<Opened> {
  const requests: string[] = [];
  const openLinkCalls: string[] = [];
  const navigations: string[] = [];
  await observeNetwork(page, requests);
  const links = options.hostLinks ?? 'absent';
  if (links !== 'absent') {
    await page.exposeFunction('handleOpenLink', async (params: { url: string }) => {
      openLinkCalls.push(params.url);
      if (typeof links === 'function') return links(params.url);
      return links === 'deny' ? { isError: true } : {};
    });
  }
  const { resource, client } = await serveResource(options);
  await page.goto('/host-fixture/index.html');
  const mounted = page.evaluate((value) => window.mountView?.(value), resource);
  if (options.expectStart === false) {
    void mounted.catch(() => undefined);
    await expect.poll(() => page.frames().length).toBe(2); // the iframe exists; the handshake never completes
  } else {
    await mounted;
  }
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (frame === undefined) throw new Error('the host fixture did not mount a view frame');
  if (options.expectStart !== false) {
    const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'ep-1' } });
    await page.evaluate((payload) => window.deliverToolResult?.(payload), result as never);
  }
  page.on('framenavigated', (navigated) => navigations.push(navigated.url()));
  return {
    page,
    view: page.frameLocator('iframe[title="MCP App view"]'),
    frame,
    resource,
    requests,
    openLinkCalls,
    navigations,
    async deliverEpisode(episodeId) {
      const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId } });
      await page.evaluate((payload) => window.deliverToolResult?.(payload), result as never);
    },
    async teardown() {
      await page.evaluate(() => window.teardownView?.());
    },
  };
}

export const imageRequests = (requests: readonly string[]) => requests.filter((url) => /\.(png|svg)$/.test(new URL(url).pathname));
