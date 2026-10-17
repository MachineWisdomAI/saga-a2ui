import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type Frame, type FrameLocator, type Page } from '@playwright/test';
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
const IMAGE_HOST = 'images.example.com';
const IMAGE = `https://${IMAGE_HOST}/ok.png`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

interface Opened {
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
}

interface OpenOptions {
  readonly imageHosts?: readonly string[];
  readonly description: string;
  /** How the host treats links: absent (no capability), allow, deny, or a custom handler. */
  readonly hostLinks?: 'absent' | 'allow' | 'deny' | ((url: string) => Promise<{ isError?: boolean }>);
  /** Rewrites the served document, e.g. to remove the restrictions or corrupt the configuration. */
  readonly transformHtml?: (html: string) => string;
  /** Skip waiting for the host handshake (a view that refuses to start never completes it). */
  readonly expectStart?: boolean;
}

const listeners: EpisodeListener[] = [];
const clients: Client[] = [];

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});

function policyOf(imageHosts: readonly string[]): ContentPolicy {
  const created = createContentPolicy({ imageHosts });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

async function serveResource(options: OpenOptions): Promise<{ resource: HostedResource; client: Client }> {
  const listener = await startEpisodeListener({
    viewHtml: await readFile(builtView, 'utf8'),
    catalog: { find: (id) => ({ id, title: 'Episode title', description: options.description }) },
    contentPolicy: policyOf(options.imageHosts ?? []),
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

async function open(page: Page, options: OpenOptions): Promise<Opened> {
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
  };
}

const imageRequests = (requests: readonly string[]) => requests.filter((url) => /\.(png|svg)$/.test(new URL(url).pathname));

test.describe('ordinary and hostile descriptions', () => {
  test('keeps text, formatting and order, and leaves the supplied string unchanged', async ({ page }) => {
    const description = ['First paragraph with *emphasis*.', '', '> A quotation.', '', '- one', '- two', '', 'Last **strong** line.'].join('\n');
    const { view } = await open(page, { description });
    const content = view.getByTestId('description-content');
    await expect(content.locator('p').first()).toHaveText('First paragraph with emphasis.');
    await expect(content.locator('em')).toHaveText('emphasis');
    await expect(content.locator('blockquote')).toHaveText('A quotation.');
    await expect(content.locator('li')).toHaveText(['one', 'two']);
    await expect(content.locator('strong')).toHaveText('strong');
    // Reading order: the blocks appear in the order they were written.
    const kinds = await content.evaluate((element) => Array.from(element.children, (child) => child.tagName));
    expect(kinds).toEqual(['P', 'BLOCKQUOTE', 'UL', 'P']);
  });

  test('raw HTML, scripts and unsupported syntax stay visible text and execute nothing', async ({ page }) => {
    const description =
      '<script>window.__pwned = 1</script><img src="https://images.example.com/x.png" onerror="window.__pwned = 2"> ' +
      '<b>bold</b> ~~struck~~ [js](javascript:window.__pwned=3)';
    const { view, frame, requests } = await open(page, { description, imageHosts: [IMAGE_HOST] });
    const content = view.getByTestId('description-content');
    await expect(content).toContainText('<script>window.__pwned = 1</script>');
    await expect(content).toContainText('<b>bold</b>');
    await expect(content).toContainText('~~struck~~');
    await expect(content).toContainText('[js](javascript:window.__pwned=3)');
    await expect(content.locator('script, b, button, a, img')).toHaveCount(0);
    expect(await frame.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(requests).toEqual([]);
  });

  test('an over-long description is refused explicitly, without truncation', async ({ page }) => {
    const { view, frame } = await open(page, { description: 'short' });
    await expect(view.getByTestId('description-content')).toHaveText('short');
    await frame.evaluate(() =>
      window.sagaSend?.({
        version: 'v0.9',
        updateDataModel: { surfaceId: 'fixture', path: '/description', value: 'a'.repeat(2001) },
      }),
    );
    await expect(view.getByTestId('description-limit')).toContainText('too long');
    await expect(view.getByTestId('description-limit')).toContainText('2001');
    await expect(view.getByTestId('description-content')).toHaveCount(0);
  });
});

test.describe('Standard links go only through the host callback', () => {
  const description = 'Read the [guide](https://Docs.Example.com/guide?a=1) today.';

  test('shows the parsed hostname visibly and in the accessible name, then sends the validated URL once', async ({ page }) => {
    const { view, openLinkCalls, navigations } = await open(page, { description, hostLinks: 'allow' });
    const button = view.getByRole('button', { name: 'guide (docs.example.com)' });
    await expect(button).toBeVisible();
    await expect(view.getByTestId('md-link-host')).toHaveText('(docs.example.com)');
    expect(openLinkCalls).toEqual([]); // nothing is requested before activation

    await button.click();
    await expect(view.getByTestId('md-link-status')).toHaveText('The host was asked to open this link.');
    expect(openLinkCalls).toEqual(['https://docs.example.com/guide?a=1']);
    expect(navigations).toEqual([]);
  });

  test('is activatable from the keyboard', async ({ page }) => {
    const { view, openLinkCalls } = await open(page, { description, hostLinks: 'allow' });
    await view.getByRole('button', { name: /guide/ }).focus();
    await page.keyboard.press('Enter');
    await expect(view.getByTestId('md-link-status')).not.toBeEmpty();
    expect(openLinkCalls).toHaveLength(1);
  });

  test('a denied request leaves readable inert feedback and does not navigate', async ({ page }) => {
    const { view, openLinkCalls, navigations, requests } = await open(page, { description, hostLinks: 'deny' });
    const pagesBefore = page.context().pages().length;
    await view.getByRole('button', { name: /guide/ }).click();
    const status = view.getByTestId('md-link-status');
    await expect(status).toContainText('The host did not open this link.');
    await expect(status).toContainText('Destination: https://docs.example.com/guide?a=1');
    expect(openLinkCalls).toEqual(['https://docs.example.com/guide?a=1']);
    expect(page.context().pages()).toHaveLength(pagesBefore); // no window.open fallback
    expect(navigations).toEqual([]);
    expect(requests).toEqual([]);
  });

  test('a host without the capability gives inert feedback and receives no request', async ({ page }) => {
    const { view, openLinkCalls, navigations } = await open(page, { description, hostLinks: 'absent' });
    const pagesBefore = page.context().pages().length;
    await view.getByRole('button', { name: /guide/ }).click();
    await expect(view.getByTestId('md-link-status')).toContainText('This host cannot open links.');
    await expect(view.getByTestId('md-link-status')).toContainText('Destination: https://docs.example.com/guide?a=1');
    expect(openLinkCalls).toEqual([]);
    expect(page.context().pages()).toHaveLength(pagesBefore);
    expect(navigations).toEqual([]);
  });

  test('non-HTTPS, relative and credentialed links are inert text with no callback', async ({ page }) => {
    const { view, openLinkCalls } = await open(page, {
      description: '[plain](http://example.com/a) [rel](/relative) [cred](https://user:pw@example.com/)',
      hostLinks: 'allow',
    });
    await expect(view.getByTestId('md-link-inert')).toHaveCount(3);
    await expect(view.getByTestId('md-link')).toHaveCount(0);
    await view.getByTestId('md-link-inert').first().click();
    expect(openLinkCalls).toEqual([]);
  });

  test('a result that arrives after the description changed is ignored', async ({ page }) => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { view, frame, openLinkCalls } = await open(page, {
      description,
      hostLinks: async () => {
        await gate;
        return {};
      },
    });
    await view.getByRole('button', { name: /guide/ }).click();
    await expect.poll(() => openLinkCalls.length).toBe(1);
    await frame.evaluate(() =>
      window.sagaSend?.({
        version: 'v0.9',
        updateDataModel: { surfaceId: 'fixture', path: '/description', value: 'Read the [guide](https://docs.example.com/guide?a=1) today.' },
      }),
    );
    release?.();
    await page.waitForTimeout(200);
    await expect(view.getByTestId('md-link-status')).toBeEmpty();
  });
});

test.describe('Standard images', () => {
  test('load nothing under the default empty allowlist', async ({ page }) => {
    const { view, requests, resource } = await open(page, { description: `A picture: ![chart](${IMAGE})` });
    await expect(view.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'host-not-allowed');
    await expect(view.getByTestId('md-image')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
    expect(resource.csp.resourceDomains).toEqual([]);
  });

  test('load only an exactly listed HTTPS host; suffix tricks, subdomains, credentials and non-HTTPS are never requested', async ({ page }) => {
    const description = [
      `![ok](${IMAGE})`,
      `![suffix](https://${IMAGE_HOST}.evil.test/s.png)`,
      `![sub](https://a.${IMAGE_HOST}/sub.png)`,
      `![parent](https://example.com/parent.png)`,
      `![cred](https://user:pw@${IMAGE_HOST}/cred.png)`,
      `![port](https://${IMAGE_HOST}:8443/port.png)`,
      `![plain](http://${IMAGE_HOST}/plain.png)`,
    ].join(' ');
    const { view, requests } = await open(page, { description, imageHosts: [IMAGE_HOST] });
    const loaded = view.getByTestId('md-image');
    await expect(loaded).toHaveCount(1);
    await expect.poll(() => loaded.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    await expect(view.getByTestId('md-image-blocked')).toHaveCount(6);
    await page.waitForTimeout(300);
    expect(imageRequests(requests)).toEqual([IMAGE]);
    expect(requests).toEqual([IMAGE]);
  });

  test('a redirect from a listed host to an undeclared destination is not followed', async ({ page }) => {
    const { view, requests } = await open(page, {
      description: `![bounce](https://${IMAGE_HOST}/redirect-out.png)`,
      imageHosts: [IMAGE_HOST],
    });
    await expect(view.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'load-failed');
    // The listed host was asked; the redirect target never was.
    expect(requests).toEqual([`https://${IMAGE_HOST}/redirect-out.png`]);
  });

  test('stay inert when the document does not carry the derived restrictions', async ({ page }) => {
    const { view, requests } = await open(page, {
      description: `![chart](${IMAGE})`,
      imageHosts: [IMAGE_HOST],
      transformHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    });
    await expect(view.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'enforcement-unestablished');
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
  });
});

// The host's own policy grants `resourceDomains` to scripts, styles, fonts, media and images
// alike. The control mounts the same listed origin without the document's restrictions and shows
// each probe really loads there; with them, only the image does.
test.describe('image-only resource restrictions', () => {
  interface ProbeOutcome {
    readonly violations: string[];
    readonly scriptRan: boolean;
  }

  async function probe(frame: Frame): Promise<ProbeOutcome> {
    return frame.evaluate(
      (host) =>
        new Promise<{ violations: string[]; scriptRan: boolean }>((resolve) => {
          const violations: string[] = [];
          document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective));
          const script = document.createElement('script');
          script.src = `https://${host}/probe.js`;
          document.head.append(script);
          const sheet = document.createElement('link');
          sheet.rel = 'stylesheet';
          sheet.href = `https://${host}/probe.css`;
          document.head.append(sheet);
          void new FontFace('probe', `url(https://${host}/probe.woff2)`).load().catch(() => undefined);
          const audio = document.createElement('audio');
          audio.preload = 'auto';
          audio.src = `https://${host}/probe.mp3`;
          document.body.append(audio);
          audio.load();
          setTimeout(
            () => resolve({ violations, scriptRan: (window as unknown as { __external?: number }).__external === 1 }),
            1000,
          );
        }),
      IMAGE_HOST,
    );
  }

  const nonImageRequests = (requests: readonly string[]) =>
    requests.filter((url) => /probe\.(js|css|woff2|mp3)$/.test(url));

  test('without the document restrictions the same origin can load scripts, styles, fonts and media (control)', async ({ page }) => {
    const { frame, requests, resource } = await open(page, {
      description: 'text',
      imageHosts: [IMAGE_HOST],
      transformHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    });
    expect(resource.csp.resourceDomains).toEqual([`https://${IMAGE_HOST}`]);
    const outcome = await probe(frame);
    expect(outcome.scriptRan).toBe(true);
    expect(nonImageRequests(requests).map((url) => new URL(url).pathname).sort()).toEqual([
      '/probe.css',
      '/probe.js',
      '/probe.mp3',
      '/probe.woff2',
    ]);
  });

  test('with them the listed origin loads images only; scripts, styles, fonts and media are blocked before any request', async ({ page }) => {
    const { frame, requests, resource } = await open(page, { description: 'text', imageHosts: [IMAGE_HOST] });
    const outcome = await probe(frame);
    expect(outcome.scriptRan).toBe(false);
    expect(outcome.violations.sort()).toEqual(['font-src', 'media-src', 'script-src-elem', 'style-src-elem']);
    expect(nonImageRequests(requests)).toEqual([]);

    // Positive control: the same origin still serves an image to the view.
    const image = await frame.evaluate(
      (url) =>
        new Promise<boolean>((resolve) => {
          const element = document.createElement('img');
          element.addEventListener('load', () => resolve(true));
          element.addEventListener('error', () => resolve(false));
          element.src = url;
        }),
      IMAGE,
    );
    expect(image).toBe(true);
    expect(requests).toContain(IMAGE);

    // The document carries the policy-derived restrictions, alongside the host's own.
    const policies = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'), (meta) => meta.getAttribute('content')),
    );
    expect(policies).toContain(policyOf([IMAGE_HOST]).resource.contentSecurityPolicy);
    expect(policies.some((value) => value?.includes(`script-src 'unsafe-inline' https://${IMAGE_HOST}`))).toBe(true);
    expect(resource.html).toContain(policyOf([IMAGE_HOST]).resource.contentSecurityPolicy);
  });

  test('the view cannot connect anywhere either', async ({ page }) => {
    const { frame, requests } = await open(page, { description: 'text', imageHosts: [IMAGE_HOST] });
    const violated = await frame.evaluate(
      (host) =>
        new Promise<string>((resolve) => {
          document.addEventListener('securitypolicyviolation', (event) => resolve(event.effectiveDirective));
          fetch(`https://${host}/data.json`).catch(() => undefined);
        }),
      IMAGE_HOST,
    );
    expect(violated).toBe('connect-src');
    expect(requests).toEqual([]);
  });
});

test.describe('policy and resource identity', () => {
  test('the mounted document carries the policy its resource was built from, and policy variants differ', async ({ page }) => {
    const withHost = await serveResource({ description: 'x', imageHosts: [IMAGE_HOST] });
    const withoutHost = await serveResource({ description: 'x' });
    expect(withHost.resource.html).not.toBe(withoutHost.resource.html);
    expect(withHost.resource.csp.resourceDomains).toEqual([`https://${IMAGE_HOST}`]);
    expect(withoutHost.resource.csp.resourceDomains).toEqual([]);

    const { frame } = await open(page, { description: 'x', imageHosts: [IMAGE_HOST] });
    const embedded = await frame.evaluate(() => document.getElementById('saga-content-policy')?.textContent);
    expect(JSON.parse(embedded ?? 'null')).toEqual({ level: 'standard', imageHosts: [IMAGE_HOST] });
  });

  test('an invalid embedded policy fails before anything is mounted', async ({ page }) => {
    const { view } = await open(page, {
      description: `![chart](${IMAGE})`,
      imageHosts: [IMAGE_HOST],
      expectStart: false,
      transformHtml: (html) => html.replace(`"imageHosts":["${IMAGE_HOST}"]`, '"imageHosts":["*.example.com"]'),
    });
    await expect(view.getByTestId('view-problem')).toContainText('This view cannot start');
    await expect(view.locator('a2ui-surface')).toHaveCount(0);
    await expect(view.getByTestId('md-image')).toHaveCount(0);
  });
});
