import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, test, type Frame, type Page } from '@playwright/test';
import type { HostedResource } from './host-fixture/host.js';

// Regression coverage for the test-only host fixture's image policy. The fixture builds the
// view's Content-Security-Policy from the resource's own metadata, so the policy that matters is
// the one actually applied to the mounted iframe. These tests mount the real built view in its
// sandboxed iframe and observe real image loads against controlled local servers, so a blocked
// image cannot be mistaken for a dead URL.

const builtView = new URL('../dist/view/view.html', import.meta.url);

// A minimal, valid image served with a matching content type: an allowed request can only
// succeed when the CSP permits it.
const IMAGE_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
const IMAGE_TYPE = 'image/svg+xml';

interface LocalImageServer {
  readonly origin: string;
  readonly imageUrl: string;
  requestCount: () => number;
  close: () => Promise<void>;
}

function startImageServer(): Promise<LocalImageServer> {
  return new Promise((resolve) => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': IMAGE_TYPE, 'cache-control': 'no-store' });
      response.end(IMAGE_BODY);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('image server has no port');
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({
        origin,
        imageUrl: `${origin}/image.svg`,
        requestCount: () => requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface ImageOutcome {
  readonly loaded: boolean;
  readonly errored: boolean;
  readonly violatedDirective: string;
}

test.describe('host fixture image policy', () => {
  let allowed: LocalImageServer;
  let other: LocalImageServer;
  let viewHtml: string;

  test.beforeAll(async () => {
    [allowed, other, viewHtml] = await Promise.all([
      startImageServer(),
      startImageServer(),
      readFile(builtView, 'utf8'),
    ]);
  });

  test.afterAll(async () => {
    await allowed.close();
    await other.close();
  });

  async function mount(page: Page, resourceDomains: string[]): Promise<Frame> {
    await page.goto('/host-fixture/index.html');
    const resource: HostedResource = { html: viewHtml, csp: { connectDomains: [], resourceDomains } };
    await page.evaluate((value) => window.mountView?.(value), resource);
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    if (frame === undefined) throw new Error('the host fixture did not mount a view frame');
    return frame;
  }

  // The policy actually applied to the mounted document, not the fixture's source text.
  function policyOf(frame: Frame): Promise<string> {
    return frame.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
    );
  }

  // Loads an image inside the mounted view and reports the real outcome. A short settle window
  // avoids depending on the order of the error and violation events.
  function loadImage(frame: Frame, url: string): Promise<ImageOutcome> {
    return frame.evaluate(
      (source) =>
        new Promise<ImageOutcome>((resolve) => {
          const outcome: { loaded: boolean; errored: boolean; violatedDirective: string } = {
            loaded: false,
            errored: false,
            violatedDirective: '',
          };
          document.addEventListener('securitypolicyviolation', (event) => {
            outcome.violatedDirective = event.violatedDirective;
          });
          const image = document.createElement('img');
          image.addEventListener('load', () => {
            outcome.loaded = true;
          });
          image.addEventListener('error', () => {
            outcome.errored = true;
          });
          document.body.append(image);
          image.src = source;
          setTimeout(() => resolve(outcome), 1000);
        }),
      url,
    );
  }

  test('an empty image allowlist emits an explicit img-src none directive', async ({ page }) => {
    const frame = await mount(page, []);
    const policy = await policyOf(frame);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    // An empty resource list must produce an explicit `img-src 'none'`, not a bare `img-src`.
    expect(policy).toContain("img-src 'none'");
  });

  test('an empty image allowlist blocks a reachable image', async ({ page }) => {
    const frame = await mount(page, []);
    // The server answers, so only the CSP can be stopping the view from loading it.
    const reachable = await fetch(allowed.imageUrl);
    expect(reachable.status).toBe(200);
    await reachable.arrayBuffer();
    const requestsBefore = allowed.requestCount();

    const outcome = await loadImage(frame, allowed.imageUrl);
    expect(outcome.loaded).toBe(false);
    expect(outcome.errored).toBe(true);
    expect(outcome.violatedDirective).toBe('img-src');
    // The blocked image never reached the server.
    expect(allowed.requestCount()).toBe(requestsBefore);
  });

  test('a populated allowlist loads its named origin and blocks another', async ({ page }) => {
    const frame = await mount(page, [allowed.origin]);
    const policy = await policyOf(frame);
    expect(policy).toContain(`img-src ${allowed.origin}`);

    const permitted = await loadImage(frame, allowed.imageUrl);
    expect(permitted.loaded).toBe(true);
    expect(permitted.errored).toBe(false);
    expect(permitted.violatedDirective).toBe('');

    const otherBefore = other.requestCount();
    const denied = await loadImage(frame, other.imageUrl);
    expect(denied.loaded).toBe(false);
    expect(denied.errored).toBe(true);
    expect(denied.violatedDirective).toBe('img-src');
    // The denied origin's request never reached its server either.
    expect(other.requestCount()).toBe(otherBefore);
  });
});
