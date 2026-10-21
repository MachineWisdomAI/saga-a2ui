import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  expect,
  test,
  type Frame,
  type FrameLocator,
  type Page,
} from '@playwright/test';
import {
  startTestHost,
  type TestHost,
} from '../../../packages/mcp/src/server/http-host.test-support.js';
import {
  directive,
  probeFont,
  probeImage,
  PROBE_WIDTH,
  settle,
} from './asset-probes.js';
import { observeNetwork } from './description-harness.js';
import type { HostedResource } from './host-fixture/host.js';

// The installed React card consumer (examples/react-card-consumer) as an MCP host receives it. Each
// page under test is one self-contained HTML document that scripts/build-react-card-consumer.ts built
// from the packed core, components, mcp and react packages alone; the consumer's own MCP server
// serves it over a real MCP connection, the served bytes are mounted in the sandboxed iframe of the
// local host fixture, and tool results reach the page only over that fixture's real AppBridge.
//
// What this proves: the installed packages render the card from one immutable resource with external
// runtime assets unavailable; answers, replacement, failure clearing, reload and disposal work from
// the tool result alone; the brand's tokens, trusted artwork and trusted font apply identically to
// two brands of one implementation; and MCP content cannot reach a trusted artwork or font slot,
// directly or by data/blob conversion, in either mode and with empty or configured origin lists.
//
// What it does not: it is local Chromium evidence with a fixture host and answered requests, not
// the actual-host acceptance of ChatGPT web, Claude web or the Alexa+ simulator, not the SDK #33
// authenticated browse/Play recipe, and not a registry install or an npm publication (the packages
// are private and unversioned; they are installed from packed tarballs).

const dist = new URL('../dist/react-card-consumer/', import.meta.url);
const builtServer = new URL(
  '../dist/react-card-consumer-server/server.mjs',
  import.meta.url,
);

const BRANDS = {
  neutral: {
    name: 'Neutral Notes',
    fontFamily: 'NeutralMark',
    artwork: { width: 48, height: 24 },
  },
  harbor: {
    name: 'Harbor Notes',
    fontFamily: 'HarborMark',
    artwork: { width: 64, height: 32 },
  },
} as const;
type Brand = keyof typeof BRANDS;
const BRAND_NAMES = Object.keys(BRANDS) as Brand[];

const IMAGE_HOST = 'images.example.com';
const IMAGE = `https://${IMAGE_HOST}/chart.png`;
const FONT_ORIGIN = 'https://fonts.example.com';
const BLOB_URL = 'blob:null/00000000-0000-4000-8000-000000000000';

type Level = 'standard' | 'strict';
const LEVELS: readonly Level[] = ['standard', 'strict'];
interface Lists {
  readonly name: string;
  readonly imageHosts: readonly string[];
  readonly fontOrigins: readonly string[];
}
const LISTS: readonly Lists[] = [
  { name: 'empty origin lists', imageHosts: [], fontOrigins: [] },
  {
    name: 'one image host and several font origins',
    imageHosts: [IMAGE_HOST],
    fontOrigins: [FONT_ORIGIN, `${FONT_ORIGIN}:8443`],
  },
];

type CreateCardServer = (
  html: string,
  settings: {
    filename: string;
    policyConfiguration: unknown;
    answer: (question: string) => Promise<{ markdown: string }>;
  },
) => McpServer;
let createCardServer: CreateCardServer;
const pages = {} as Record<Brand, Buffer>;
let identity: {
  readonly packedTarballSha256: Record<string, string>;
  readonly installedVersions: Record<string, string>;
  readonly builtPages: Record<Brand, { readonly sha256: string }>;
  readonly builtServer: { readonly sha256: string };
};
const hosts: TestHost[] = [];
const clients: Client[] = [];

test.beforeAll(async () => {
  ({ createCardServer } = (await import(
    pathToFileURL(builtServer.pathname).href
  )) as { createCardServer: CreateCardServer });
  for (const brand of BRAND_NAMES)
    pages[brand] = await readFile(new URL(`${brand}.html`, dist));
  identity = JSON.parse(await readFile(new URL('identity.json', dist), 'utf8'));
});

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

// ---------------------------------------------------------------------------------------------
// Serving and mounting

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

interface Served {
  readonly uri: string;
  readonly resource: HostedResource;
  /** Every question the consumer's server was asked: the only provider call there is. */
  readonly asked: string[];
  call(question: string): Promise<ToolResult>;
}

/** The consumer's own MCP server for `brand` under `configuration`, read back as a host would. `answers` maps a question to the Markdown the server answers it with. */
async function serve(
  brand: Brand,
  configuration: unknown,
  answers: ReadonlyMap<string, string> = new Map(),
): Promise<Served> {
  const asked: string[] = [];
  const host = await startTestHost({
    jsonResponse: true,
    buildServer: () =>
      createCardServer(pages[brand].toString('utf8'), {
        filename: `${brand}.html`,
        policyConfiguration: configuration,
        answer: async (question) => {
          asked.push(question);
          if (question.includes('fail'))
            throw new Error('The answer service is unavailable.');
          return {
            markdown:
              answers.get(question) ??
              `# Answer ${asked.length}\n\nThe server was asked: **${question}**`,
          };
        },
      }),
  });
  hosts.push(host);
  const client = await host.connect();
  clients.push(client);
  const { tools } = await client.listTools();
  const uri = (
    tools.find((tool) => tool.name === 'answer_question')?._meta as
      { ui: { resourceUri: string } } | undefined
  )?.ui.resourceUri;
  if (uri === undefined)
    throw new Error('answer_question is not linked to a view');
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content))
    throw new Error('resources/read returned no text');
  const csp = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp;
  return {
    uri,
    resource: { html: content.text, csp },
    asked,
    call: (question) =>
      client.callTool({ name: 'answer_question', arguments: { question } }),
  };
}

interface Session {
  /** Every https request that reached the network layer, in order (answered locally unless the session blocks the network). */
  readonly requests: string[];
  /** Every request made by a view frame, whatever its address. */
  readonly frameRequests: string[];
  /** Page errors and console errors. */
  readonly problems: string[];
  /** Every URL the host's open-link handler received. */
  readonly openLinks: string[];
  mount(served: Served): Promise<{ frame: Frame; view: FrameLocator }>;
}

/**
 * One host page. With `blockedNetwork` every request except the fixture's own is refused, so the
 * view renders only from the bytes it was served; otherwise https requests are answered locally and
 * recorded (so a blocked image or font is proved by the absence of a request).
 */
async function startSession(
  page: Page,
  options: {
    readonly blockedNetwork?: boolean;
    readonly openLinks?: boolean;
  } = {},
): Promise<Session> {
  const requests: string[] = [];
  const frameRequests: string[] = [];
  const problems: string[] = [];
  const openLinks: string[] = [];
  // Counts what the page does with object URLs and font faces, so "content never converted to a blob or font" is observed, not inferred.
  await page.addInitScript(() => {
    const probe = { blobUrls: 0, fontFaces: 0 };
    (window as unknown as { __sagaProbe: typeof probe }).__sagaProbe = probe;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      probe.blobUrls += 1;
      return create(object);
    };
    const NativeFontFace = window.FontFace;
    window.FontFace = new Proxy(NativeFontFace, {
      construct(target, args, newTarget) {
        probe.fontFaces += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  if (options.blockedNetwork === true) {
    await page.route(
      (url) => url.hostname !== '127.0.0.1',
      (route) => route.abort('blockedbyclient'),
    );
  } else {
    await observeNetwork(page, requests);
  }
  if (options.openLinks === true) {
    await page.exposeFunction(
      'handleOpenLink',
      async (params: { url: string }) => {
        openLinks.push(params.url);
        return {};
      },
    );
  }
  page.on('request', (request) => {
    if (request.frame() !== page.mainFrame()) frameRequests.push(request.url());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/host-fixture/index.html');
  return {
    requests,
    frameRequests,
    problems,
    openLinks,
    async mount(served) {
      await page.evaluate(
        (resource) => window.mountView?.(resource),
        served.resource,
      );
      const frame = page
        .frames()
        .find((candidate) => candidate !== page.mainFrame());
      if (frame === undefined)
        throw new Error('the host fixture did not mount a view frame');
      return { frame, view: page.frameLocator('iframe[title="MCP App view"]') };
    },
  };
}

const deliver = (page: Page, result: unknown) =>
  page.evaluate(
    (payload) => window.deliverToolResult?.(payload as never),
    result,
  );
const content = (view: FrameLocator) => view.getByTestId('card-content');
const status = (view: FrameLocator) => view.getByTestId('answer-status');

/** Mounts, then delivers the result of a real tool call. */
async function mountWithAnswer(
  page: Page,
  session: Session,
  served: Served,
  question: string,
) {
  const mounted = await session.mount(served);
  await deliver(page, await served.call(question));
  return mounted;
}

// ---------------------------------------------------------------------------------------------
// Observations inside the view

interface Slots {
  /** The trusted template's artwork address. */
  readonly artwork: string;
  /** The trusted stylesheet's artwork and the fonts the document holds, with their loading state. */
  readonly banner: string;
  readonly faces: readonly string[];
  /** Length and hash of every CSS rule in the document, and how many style elements and images it holds outside the card. */
  readonly rules: string;
  readonly styleElements: number;
  readonly images: number;
  /** What the page has done with object URLs and font faces. */
  readonly blobUrls: number;
  readonly fontFaces: number;
}

/** A snapshot of everything a trusted template or stylesheet slot is made of. Fonts are awaited first so the state is stable. */
function slotsOf(frame: Frame, brand: Brand): Promise<Slots> {
  return frame.evaluate(async (family) => {
    await document.fonts.load(`16px "${family}"`, 'A');
    const fnv = (text: string): string => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index += 1)
        hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
      return `${text.length}:${hash.toString(16)}`;
    };
    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) =>
        Array.from(sheet.cssRules).map((rule) => rule.cssText),
      )
      .join('\n');
    const probe = (
      window as unknown as {
        __sagaProbe: { blobUrls: number; fontFaces: number };
      }
    ).__sagaProbe;
    return {
      artwork: (document.querySelector('.card-artwork') as HTMLImageElement)
        .src,
      banner: getComputedStyle(
        document.querySelector('.card-banner') as HTMLElement,
      ).backgroundImage,
      faces: Array.from(
        document.fonts,
        (face) => `${face.family}:${face.status}`,
      ),
      rules: fnv(rules),
      styleElements: document.querySelectorAll('style').length,
      images: Array.from(document.querySelectorAll('img')).filter(
        (image) => !image.classList.contains('card-artwork'),
      ).length,
      blobUrls: probe.blobUrls,
      fontFaces: probe.fontFaces,
    };
  }, BRANDS[brand].fontFamily);
}

const computed = (
  locator: ReturnType<FrameLocator['locator']>,
  property: string,
) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Loads the trusted artwork the template and the stylesheet carry, from their embedded bytes, and reports what the browser decoded. */
function artworkOf(frame: Frame) {
  return frame.evaluate(async () => {
    const image = document.querySelector('.card-artwork') as HTMLImageElement;
    await image.decode();
    const banner = /url\("?([^")]+)"?\)/.exec(
      getComputedStyle(document.querySelector('.card-banner') as HTMLElement)
        .backgroundImage,
    )?.[1];
    const loaded = banner === undefined ? undefined : new Image();
    if (loaded !== undefined && banner !== undefined) {
      await new Promise<void>((resolve) => {
        loaded.addEventListener('load', () => resolve());
        loaded.addEventListener('error', () => resolve());
        loaded.src = banner;
      });
    }
    return {
      template: {
        width: image.naturalWidth,
        height: image.naturalHeight,
        embedded: image.src.startsWith('data:image/svg+xml'),
      },
      stylesheet: {
        width: loaded?.naturalWidth ?? 0,
        embedded: banner?.startsWith('data:image/svg+xml') === true,
      },
    };
  });
}

/** Loads the trusted font through the document's own @font-face rule and measures one "A" set in it. */
function fontOf(frame: Frame, family: string) {
  return frame.evaluate(async (name) => {
    const loaded = await document.fonts.load(`16px "${name}"`, 'A');
    const text = document.createElement('span');
    text.textContent = 'A';
    text.style.cssText = `position:absolute;left:0;top:0;white-space:pre;font:16px "${name}", monospace`;
    document.body.append(text);
    const width = text.getBoundingClientRect().width;
    text.remove();
    const title = document.querySelector('.card-title') as HTMLElement;
    return {
      faces: loaded.length,
      width,
      titleFamily: getComputedStyle(title).fontFamily,
      titleVisible: title.getBoundingClientRect().width > 0,
    };
  }, family);
}

// ---------------------------------------------------------------------------------------------
// One implementation, two brands

for (const brand of BRAND_NAMES) {
  const { name, fontFamily, artwork } = BRANDS[brand];

  test.describe(`${brand} brand`, () => {
    test('renders from the one served document with every external runtime asset unavailable', async ({
      page,
    }) => {
      const session = await startSession(page, { blockedNetwork: true });
      const served = await serve(brand, { level: 'standard' });
      const { frame, view } = await session.mount(served);

      // Before any result: the neutral initial state, no card text and no canned answer.
      await expect(view.getByRole('heading', { name })).toBeVisible();
      await expect(status(view)).toHaveText('Waiting for the answer…');
      await expect(content(view)).toHaveText('');
      expect(await frame.evaluate(() => document.body.innerText)).not.toMatch(
        /Dates and figs|You asked|Answer \d/,
      );

      // The trusted artwork and font are in the document's own bytes and display, with nothing fetched.
      expect(await artworkOf(frame)).toEqual({
        template: { ...artwork, embedded: true },
        stylesheet: { width: artwork.width, embedded: true },
      });
      expect(await fontOf(frame, fontFamily)).toMatchObject({
        faces: 1,
        width: PROBE_WIDTH,
        titleVisible: true,
      });

      await deliver(page, await served.call('first question'));
      await expect(status(view)).toHaveText('Answer');
      await expect(
        content(view).getByRole('heading', { name: 'Answer 1' }),
      ).toBeVisible();
      expect(session.frameRequests).toEqual([]); // no chunk, import, stylesheet, image or font was requested
      expect(session.requests).toEqual([]);
      expect(session.problems).toEqual([]);
    });

    test('shows distinct answers from the one resource with replacement, failure clearing and recovery, never rebuilding it', async ({
      page,
    }) => {
      const session = await startSession(page);
      const served = await serve(brand, { level: 'standard' });
      const { frame, view } = await session.mount(served);
      // The document and the React tree the first result lands in: later results must reuse both.
      await frame.evaluate(() => {
        const marker = {
          origin: performance.timeOrigin,
          main: document.querySelector('main'),
        };
        (window as unknown as { __kept: typeof marker }).__kept = marker;
      });

      const uris: string[] = [];
      for (const [index, question] of [
        'first question',
        'second question',
        'a third, different question',
      ].entries()) {
        const result = await served.call(question);
        uris.push(
          (result._meta as { ui: { resourceUri: string } }).ui.resourceUri,
        );
        await deliver(page, result);
        await expect(
          content(view).getByRole('heading', { name: `Answer ${index + 1}` }),
        ).toBeVisible();
        await expect(content(view)).toContainText(
          `The server was asked: ${question}`,
        );
        if (index > 0)
          await expect(view.getByText('first question')).toHaveCount(0); // replacement leaves nothing of the earlier answer
      }
      expect(uris).toEqual([served.uri, served.uri, served.uri]);
      expect(served.asked).toEqual([
        'first question',
        'second question',
        'a third, different question',
      ]);
      expect(
        await frame.evaluate(() => {
          const kept = (
            window as unknown as {
              __kept: { origin: number; main: Element | null };
            }
          ).__kept;
          return {
            sameDocument: kept.origin === performance.timeOrigin,
            sameTree:
              kept.main !== null &&
              kept.main === document.querySelector('main'),
          };
        }),
      ).toEqual({ sameDocument: true, sameTree: true });
      // The resource the host would read again is still byte for byte the one it mounted.
      const again = await serve(brand, { level: 'standard' });
      expect(again.resource.html).toBe(served.resource.html);

      // A failure, a result outside the published output and a result with no structured content each clear the answer.
      const failures = [
        await served.call('please fail'),
        {
          content: [],
          structuredContent: { contractVersion: 2, markdown: 'Wrong version.' },
        },
        { content: [], structuredContent: { contractVersion: 1, markdown: 7 } },
        { content: [{ type: 'text', text: 'plain' }] },
      ];
      expect((failures[0] as ToolResult).isError).toBe(true);
      for (const failure of failures) {
        await deliver(page, await served.call('prior question'));
        await expect(content(view)).toContainText('prior question');
        await deliver(page, failure);
        await expect(status(view)).toHaveText('The answer could not be shown.');
        await expect(content(view)).toHaveText('');
        await expect(view.getByText('prior question')).toHaveCount(0);
        await deliver(page, await served.call('recovered question'));
        await expect(status(view)).toHaveText('Answer');
        await expect(content(view)).toContainText('recovered question');
      }
      expect(session.problems).toEqual([]);
    });

    test('rebuilds its complete state from one delivered result after a reload, and disposal ends the view', async ({
      page,
    }) => {
      const session = await startSession(page);
      const served = await serve(brand, { level: 'standard' });
      const first = await session.mount(served);
      await deliver(page, await served.call('before the reload'));
      await expect(content(first.view)).toContainText('before the reload');

      // A reload: the host mounts the same resource again and delivers only the latest complete result.
      const reload = await session.mount(served);
      await expect(status(reload.view)).toHaveText('Waiting for the answer…'); // neutral again: nothing carried over
      await expect(content(reload.view)).toHaveText('');
      await deliver(page, await served.call('after the reload'));
      await expect(content(reload.view)).toContainText('after the reload');
      await expect(reload.view.getByText('before the reload')).toHaveCount(0);
      await expect(reload.view.getByRole('heading', { name })).toHaveCount(1);
      expect(
        page.frames().filter((frame) => frame !== page.mainFrame()),
      ).toHaveLength(1);

      // A host teardown stops delivery: a late result, valid or not, changes nothing.
      await page.evaluate(() => window.teardownView?.());
      await deliver(page, await served.call('after teardown')).catch(
        () => undefined,
      );
      await deliver(page, { isError: true, content: [] }).catch(
        () => undefined,
      );
      await page.waitForTimeout(300);
      await expect(content(reload.view)).toContainText('after the reload');
      await expect(reload.view.getByText('after teardown')).toHaveCount(0);
      await expect(status(reload.view)).toHaveText('Answer');

      // The page going away unmounts the card.
      await reload.frame.evaluate(() =>
        window.dispatchEvent(new Event('pagehide')),
      );
      await expect(reload.view.getByTestId('card-root')).toHaveCount(0);
      await expect(reload.view.locator('main')).toHaveCount(0);
    });

    test('applies the brand through the card tokens and its own trusted font, with one stylesheet from the installed package', async ({
      page,
    }) => {
      const session = await startSession(page);
      const served = await serve(
        brand,
        { level: 'standard' },
        new Map([
          [
            'typography',
            [
              '# Heading',
              '',
              'Body text with a [guide](https://docs.example.com/guide), `code` and a table.',
              '',
              '| Item | Note |',
              '| --- | --- |',
              '| one | two |',
            ].join('\n'),
          ],
        ]),
      );
      const { frame, view } = await mountWithAnswer(
        page,
        session,
        served,
        'typography',
      );
      const card = view.getByTestId('card-root');
      const body = content(view).locator('p').first();
      await expect(body).toBeVisible();

      const app = view.locator('main.card-app');
      const family = await computed(card, 'font-family');
      expect(family).toBe(await computed(app, 'font-family')); // the card follows the application unless a token is set
      const probe = await card.evaluate((element) => {
        const ruler = document.createElement('div');
        ruler.style.cssText = 'position:absolute;visibility:hidden;width:60ch';
        element.append(ruler);
        const width = ruler.getBoundingClientRect().width;
        ruler.remove();
        return width;
      });
      const readingWidth = parseFloat(await computed(card, 'max-inline-size'));
      const link = content(view).getByRole('button', { name: /guide/ });
      const host = content(view).getByTestId('md-link-host');
      const table = content(view).locator('th').first();
      const code = content(view).locator('code').first();

      if (brand === 'harbor') {
        expect(family).toBe('"Helvetica Neue", Arial, sans-serif');
        expect(await computed(card, 'font-size')).toBe('17px');
        expect(await computed(card, 'line-height')).toBe('27.2px');
        expect(await computed(card, 'color')).toBe('rgb(16, 32, 46)');
        expect(readingWidth).toBeCloseTo(probe, 1); // 60ch, in the card's own font
        expect(await computed(link, 'color')).toBe('rgb(0, 90, 156)');
        expect(await computed(host, 'color')).toBe('rgb(74, 90, 104)');
        expect(await computed(table, 'border-top-color')).toBe(
          'rgb(157, 184, 204)',
        );
        expect(await computed(code, 'background-color')).toBe(
          'rgb(219, 232, 242)',
        );
        expect(await computed(app, 'background-color')).toBe(
          'rgb(238, 245, 251)',
        );
        expect(await computed(view.locator('.card-title'), 'color')).toBe(
          'rgb(0, 90, 156)',
        );
      } else {
        // No token is set: every one keeps its documented fallback.
        expect(family).toBe('system-ui, sans-serif');
        expect(await computed(card, 'font-size')).toBe(
          await computed(app, 'font-size'),
        );
        expect(await computed(card, 'color')).toBe('rgb(31, 35, 40)');
        expect(readingWidth).toBeGreaterThan(0);
        const seventy = await card.evaluate((element) => {
          const ruler = document.createElement('div');
          ruler.style.cssText =
            'position:absolute;visibility:hidden;width:70ch';
          element.append(ruler);
          const width = ruler.getBoundingClientRect().width;
          ruler.remove();
          return width;
        });
        expect(readingWidth).toBeCloseTo(seventy, 1); // the default 70ch
        expect(await computed(link, 'color')).toBe('rgb(31, 35, 40)'); // the accent falls back to the inherited colour
        expect(await computed(table, 'border-top-color')).toBe(
          'rgb(153, 153, 153)',
        );
        expect(await computed(code, 'background-color')).toBe(
          'rgba(127, 127, 127, 0.15)',
        );
        expect(await computed(view.locator('.card-title'), 'color')).toBe(
          'rgb(9, 105, 218)',
        );
      }
      // The brand's own trusted font is applied to the title, with a readable fallback stack behind it.
      const font = await fontOf(frame, fontFamily);
      expect(font.titleFamily).toContain(fontFamily);
      expect(font).toMatchObject({
        faces: 1,
        width: PROBE_WIDTH,
        titleVisible: true,
      });
      await expect(view.locator('.card-title')).toHaveText(name);

      // The card's stylesheet is scoped: elements outside the card keep the application's styling.
      const outside = await frame.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('.card-status') as HTMLElement,
          ).maxWidth,
      );
      expect(outside).toBe('none');
    });

    test('records the package and resource identities, which match the bytes served', async ({}, testInfo) => {
      const html = pages[brand].toString('utf8');
      const served = await serve(brand, { level: 'standard' });
      // The served document is the built page plus exactly the policy-derived restrictions and configuration.
      const stripped = served.resource.html
        .replace(
          /<meta http-equiv="Content-Security-Policy" content="[^"]+">/,
          '',
        )
        .replace(
          /<script type="application\/json" id="saga-content-policy">[^<]*<\/script>/,
          '',
        );
      expect(stripped).toBe(html);
      expect(identity.builtPages[brand].sha256).toBe(
        createHash('sha256').update(pages[brand]).digest('hex'),
      );
      expect(served.uri).toBe(
        `ui://views/${brand}.${createHash('sha256').update(served.resource.html).digest('hex').slice(0, 32)}.html`,
      );
      expect(identity.installedVersions).toMatchObject({
        react: '19.3.1',
        'react-dom': '19.3.1',
        '@a2ui/react': '0.13.0',
        '@a2ui/web_core': '0.13.0',
      });
      expect(Object.keys(identity.packedTarballSha256).sort()).toEqual([
        'components',
        'core',
        'mcp',
        'react',
      ]);
      for (const hash of Object.values(identity.packedTarballSha256))
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // The React the document ships is the version the identity record names.
      expect(html.includes('19.3.1')).toBe(true);
      await testInfo.attach(`identities-${brand}.json`, {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            brand,
            resourceUri: served.uri,
            builtPage: identity.builtPages[brand],
            packedTarballSha256: identity.packedTarballSha256,
            installedVersions: identity.installedVersions,
            builtServer: identity.builtServer,
          },
          null,
          2,
        ),
      });
    });
  });
}

test('two brands are the same implementation: the resources differ and the served policy and behavior do not', async ({
  page,
}) => {
  const [neutral, harbor] = await Promise.all([
    serve('neutral', { level: 'standard' }),
    serve('harbor', { level: 'standard' }),
  ]);
  expect(neutral.uri).not.toBe(harbor.uri);
  const policyOf = (html: string) =>
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(
      html,
    )?.[1];
  expect(policyOf(neutral.resource.html)).toBe(policyOf(harbor.resource.html));
  expect(neutral.resource.csp).toEqual(harbor.resource.csp);

  const session = await startSession(page);
  for (const [served, brand] of [
    [neutral, 'neutral'],
    [harbor, 'harbor'],
  ] as const) {
    const { view } = await mountWithAnswer(
      page,
      session,
      served,
      'same question',
    );
    await expect(content(view)).toContainText(
      'The server was asked: same question',
    );
    await expect(
      view.getByRole('heading', { name: BRANDS[brand].name }),
    ).toBeVisible();
  }
});

// ---------------------------------------------------------------------------------------------
// Resource policy, matched by the document the host mounted

for (const level of LEVELS) {
  for (const lists of LISTS) {
    test.describe(`${level} mode with ${lists.name}`, () => {
      const configuration = {
        level,
        imageHosts: lists.imageHosts,
        fontOrigins: lists.fontOrigins,
      };
      const baseline = level === 'standard' ? 'data: blob:' : 'data:';
      const images = lists.imageHosts
        .map((host) => `https://${host}`)
        .join(' ');
      const fonts = [...lists.fontOrigins].sort().join(' ');
      const brand: Brand = 'harbor';

      test('the mounted document carries one img-src and one font-src that extend the mode baseline, and the host declaration matches', async ({
        page,
      }) => {
        const session = await startSession(page);
        const served = await serve(brand, configuration);
        const { frame } = await session.mount(served);
        const policies = await frame.evaluate(() =>
          Array.from(
            document.querySelectorAll(
              'meta[http-equiv="Content-Security-Policy"]',
            ),
            (meta) => meta.getAttribute('content') ?? '',
          ),
        );
        // The host fixture adds its own policy beside the document's; the document's is the one the server embedded, once.
        const embedded =
          /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(
            served.resource.html,
          )?.[1];
        expect(embedded).toBeDefined();
        expect(policies.filter((policy) => policy === embedded)).toHaveLength(
          1,
        );
        expect(policies).toHaveLength(2);
        const documentPolicy = embedded as string;
        expect(directive(documentPolicy, 'img-src')).toEqual([
          `img-src ${baseline} ${images}`.trim(),
        ]);
        expect(directive(documentPolicy, 'font-src')).toEqual([
          `font-src ${baseline} ${fonts}`.trim(),
        ]);
        expect(served.resource.html).toContain(documentPolicy);
        // The host is told every declared origin once, and nothing for the data: and blob: baseline.
        expect([...served.resource.csp.resourceDomains].sort()).toEqual(
          lists.imageHosts.length === 0
            ? []
            : [
                `${FONT_ORIGIN}`,
                `${FONT_ORIGIN}:8443`,
                `https://${IMAGE_HOST}`,
              ],
        );
        expect(served.resource.csp.resourceDomains.join(' ')).not.toMatch(
          /data:|blob:/,
        );
        // The document's own copy of the configuration is the policy the view enforces: Strict shows its controls only as Strict.
        const answers = new Map([
          [
            'with an image',
            `Text and ![chart](${IMAGE}) and [a link](https://docs.example.com/guide).`,
          ],
        ]);
        const withAnswer = await serve(brand, configuration, answers);
        const mounted = await mountWithAnswer(
          page,
          session,
          withAnswer,
          'with an image',
        );
        await expect(mounted.view.getByTestId('card-controls')).toHaveCount(
          level === 'strict' ? 1 : 0,
        );
        expect(session.problems).toEqual([]);
      });

      test('trusted data artwork and a data font in the resource display and load, with nothing fetched', async ({
        page,
      }) => {
        const session = await startSession(page);
        const { frame } = await session.mount(
          await serve(brand, configuration),
        );
        expect(await artworkOf(frame)).toEqual({
          template: { ...BRANDS[brand].artwork, embedded: true },
          stylesheet: { width: BRANDS[brand].artwork.width, embedded: true },
        });
        expect(await fontOf(frame, BRANDS[brand].fontFamily)).toMatchObject({
          faces: 1,
          width: PROBE_WIDTH,
        });
        expect(session.requests).toEqual([]);
        expect(session.frameRequests).toEqual([]);
        expect(session.problems).toEqual([]);
      });

      test('a blob image and a blob font load in Standard only; Strict blocks them, with or without configured origins, and keeps readable text', async ({
        page,
      }) => {
        const session = await startSession(page);
        const { frame } = await session.mount(
          await serve(brand, configuration),
        );
        const data = await probeImage(frame, 'data');
        expect(data).toMatchObject({ loaded: true, violations: [] });
        const blob = await probeImage(frame, 'blob');
        if (level === 'standard') {
          expect(blob).toMatchObject({ loaded: true, violations: [] });
        } else {
          expect(blob.loaded).toBe(false);
          expect(blob.violations).toContain('img-src');
        }
        for (const via of ['api', 'css'] as const) {
          expect(await probeFont(frame, 'data', via)).toEqual({
            loaded: true,
            size: PROBE_WIDTH,
            violations: [],
            readable: true,
          });
          const outcome = await probeFont(frame, 'blob', via);
          if (level === 'standard') {
            expect(outcome).toEqual({
              loaded: true,
              size: PROBE_WIDTH,
              violations: [],
              readable: true,
            });
          } else {
            expect(outcome.loaded).toBe(false);
            expect(outcome.violations).toContain('font-src');
            expect(outcome.size).not.toBe(PROBE_WIDTH);
            expect(outcome.readable).toBe(true);
          }
        }
        // The card around them stays readable whatever was blocked.
        await deliver(
          page,
          await (await serve(brand, configuration)).call('still readable'),
        );
        await expect(
          page
            .frameLocator('iframe[title="MCP App view"]')
            .getByTestId('answer-status'),
        ).toHaveText('Answer');
        expect(session.requests).toEqual([]);
      });

      test('content images follow the mode and the configured hosts through the installed card', async ({
        page,
      }) => {
        const session = await startSession(page);
        const answers = new Map([
          [
            'image',
            `Look: ![chart](${IMAGE}) and ![elsewhere](https://elsewhere.example.net/x.png) and ![inline](data:image/png;base64,AAAA) and ![object](${BLOB_URL}).`,
          ],
        ]);
        const { view, frame } = await mountWithAnswer(
          page,
          session,
          await serve(brand, configuration, answers),
          'image',
        );
        const shown = content(view).getByTestId('md-image');
        const blocked = content(view).getByTestId('md-image-blocked');
        const listed = lists.imageHosts.length > 0;

        if (level === 'strict') {
          expect(session.requests).toEqual([]); // no content-image request before consent
          await expect(shown).toHaveCount(0);
          const show = view.getByRole('button', { name: 'Show images' });
          if (listed) {
            await expect(show).toBeEnabled();
            await show.click();
            await expect(shown).toHaveCount(1);
          } else {
            await expect(show).toBeDisabled(); // nothing could load: consent is not offered as a way around the lists
            await expect(shown).toHaveCount(0);
          }
        } else {
          await expect(shown).toHaveCount(listed ? 1 : 0);
          // Standard lets the browser wait until the image is near the viewport: bring it near.
          if (listed) await shown.scrollIntoViewIfNeeded();
        }
        await settle(frame);
        expect(session.requests).toEqual(listed ? [IMAGE] : []);
        // Everything else stays text in its place, whatever the mode or consent.
        await expect(blocked).toHaveCount(listed ? 3 : 4);
        const sources = await content(view)
          .locator('img')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLImageElement).src),
          );
        expect(sources.every((source) => source === IMAGE)).toBe(true);
      });

      // An answer is untrusted. It reaches the card only through the tool result, the A2UI data model and
      // the restricted Markdown reader. The resource now permits data: (and, in Standard, blob:) images
      // and fonts for the application's own artwork, so what keeps an answer out of those slots is the
      // shared content decision plus the application's fixed template. Hostile answers go through the
      // real MCP tool result and binding, with every consent the reader can give.
      test('supplied content cannot reach template or CSS artwork and font slots, directly or by data/blob conversion', async ({
        page,
      }) => {
        const session = await startSession(page, { openLinks: true });
        const hostile = [
          `![data](data:image/png;base64,AAAA) ![blob](${BLOB_URL}) ![remote](${IMAGE})`,
          '',
          `<img src="data:image/png;base64,AAAA"> <style>@font-face{font-family:${BRANDS[brand].fontFamily};src:url(${FONT_ORIGIN}/steal.woff2)}.card-artwork{display:none}</style>`,
          '',
          `[data link](data:font/woff2;base64,AAAA) [blob link](${BLOB_URL}) [font](${FONT_ORIGIN}/steal.woff2)`,
          '',
          `@font-face{font-family:Evil2;src:url(${FONT_ORIGIN}/?q=ANSWER-SECRET)}`,
        ].join('\n');
        const served = await serve(
          brand,
          configuration,
          new Map([['hostile', hostile]]),
        );
        const { frame, view } = await session.mount(served);
        const before = await slotsOf(frame, brand);

        // The application's own artwork address, offered back to the card as content in every form.
        const trustedArtwork = before.artwork;
        const echoed = [
          `![self](<${trustedArtwork}>)`,
          `[self](<${trustedArtwork}>)`,
          `<img src="${trustedArtwork}">`,
        ].join('\n\n');
        await deliver(page, await served.call('hostile'));
        await expect(content(view)).toContainText('@font-face{font-family:'); // visible as text, never applied
        const show = view.getByRole('button', { name: 'Show images' });
        if ((await show.count()) > 0 && (await show.isEnabled()))
          await show.click(); // Strict: the reader's consent, given
        await deliver(page, {
          content: [],
          structuredContent: {
            contractVersion: 1,
            markdown: `${hostile}\n\n${echoed}`,
          },
        });
        if ((await show.count()) > 0 && (await show.isEnabled()))
          await show.click();
        await settle(frame);

        // Only the one permitted HTTPS image can render; no data or blob image, link, style or font reaches the DOM.
        const sources = await content(view)
          .locator('img')
          .evaluateAll((nodes) =>
            nodes.map((node) => (node as HTMLImageElement).src),
          );
        expect(sources.every((source) => source === IMAGE)).toBe(true);
        await expect(
          content(view).locator(
            'style, link, a, svg, object, embed, iframe, [style]',
          ),
        ).toHaveCount(0);
        // The trusted slots are exactly what the document shipped: same artwork, stylesheet rules, style elements and font faces,
        // no image beyond the permitted one, and the page converted nothing into a blob URL or a font face.
        const after = await slotsOf(frame, brand);
        expect(after.artwork).toBe(before.artwork);
        expect(after).toEqual({ ...before, images: sources.length });
        expect(after).toMatchObject({
          blobUrls: 0,
          fontFaces: 0,
          styleElements: before.styleElements,
        });
        expect(await artworkOf(frame)).toMatchObject({
          template: { ...BRANDS[brand].artwork, embedded: true },
        });
        expect(await fontOf(frame, BRANDS[brand].fontFamily)).toMatchObject({
          faces: 1,
          width: PROBE_WIDTH,
        });

        // Nothing asked the font origin for anything, and no link was activated.
        expect(
          session.requests.filter((url) => url.startsWith(FONT_ORIGIN)),
        ).toEqual([]);
        expect(
          session.requests.some((url) => url.includes('ANSWER-SECRET')),
        ).toBe(false);
        expect(session.openLinks).toEqual([]);
        expect(
          session.frameRequests.filter(
            (url) => url.startsWith('blob:') || url.startsWith('data:'),
          ),
        ).toEqual([]);
      });

      test('extra fields in a result select no asset, CSS, template or policy', async ({
        page,
      }) => {
        const session = await startSession(page);
        const { frame, view } = await session.mount(
          await serve(brand, configuration),
        );
        const before = await slotsOf(frame, brand);
        await deliver(page, {
          content: [],
          structuredContent: {
            contractVersion: 1,
            markdown: 'Plain text, no other effect.',
            artwork: before.artwork.replace('svg', 'png'),
            fontUrl: `${FONT_ORIGIN}/steal.woff2`,
            css: '.saga-card { display: none }',
            brand: 'Evil',
            policy: {
              level: level === 'strict' ? 'standard' : 'strict',
              imageHosts: ['evil.example'],
            },
            template: '<img src="x" onerror="alert(1)">',
          },
        });
        await expect(content(view)).toContainText(
          'Plain text, no other effect.',
        );
        await expect(view.getByTestId('card-root')).toBeVisible();
        await expect(
          view.getByRole('heading', { name: BRANDS[brand].name }),
        ).toBeVisible();
        await expect(view.getByTestId('card-controls')).toHaveCount(0); // no image or link in the text, so no Strict controls in either mode
        expect(await slotsOf(frame, brand)).toEqual(before);
        expect(session.problems).toEqual([]);
        expect(session.requests).toEqual([]);
      });
    });
  }

  test.describe(`${level} mode remote fonts from the declared origins`, () => {
    const configuration = {
      level,
      imageHosts: [IMAGE_HOST],
      fontOrigins: [FONT_ORIGIN, `${FONT_ORIGIN}:8443`],
    };

    test('a font from a declared origin loads with CORS and without consent; an undeclared origin, port or scheme is blocked before any request', async ({
      page,
    }) => {
      const session = await startSession(page);
      const { frame } = await session.mount(
        await serve('harbor', configuration),
      );
      expect(
        await probeFont(frame, { url: `${FONT_ORIGIN}/ok.woff2` }),
      ).toEqual({
        loaded: true,
        size: PROBE_WIDTH,
        violations: [],
        readable: true,
      });
      expect(
        await probeFont(frame, { url: `${FONT_ORIGIN}:8443/ok.woff2?v=3` }),
      ).toEqual({
        loaded: true,
        size: PROBE_WIDTH,
        violations: [],
        readable: true,
      });
      expect(session.requests).toEqual([
        `${FONT_ORIGIN}/ok.woff2`,
        `${FONT_ORIGIN}:8443/ok.woff2?v=3`,
      ]);
      for (const url of [
        'https://other.example.net/ok.woff2',
        `${FONT_ORIGIN}:9443/ok.woff2`,
        'https://sub.fonts.example.com/ok.woff2',
        'http://fonts.example.com/ok.woff2',
      ]) {
        const outcome = await probeFont(frame, { url });
        expect(outcome.loaded, url).toBe(false);
        expect(outcome.violations, url).toContain('font-src');
        expect(outcome.readable, url).toBe(true);
      }
      // The image host grants no font, and a font origin grants no content image.
      expect(
        (await probeFont(frame, { url: `https://${IMAGE_HOST}/ok.woff2` }))
          .violations,
      ).toContain('font-src');
      expect(
        (await probeImage(frame, { url: `${FONT_ORIGIN}/ok.png` })).violations,
      ).toContain('img-src');
      expect(session.requests).toEqual([
        `${FONT_ORIGIN}/ok.woff2`,
        `${FONT_ORIGIN}:8443/ok.woff2?v=3`,
      ]);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Image consent ends with the view

test('Strict image consent ends when the host tears the view down', async ({
  page,
}) => {
  const session = await startSession(page);
  const answers = new Map([['image', `Look: ![chart](${IMAGE}).`]]);
  const { view } = await mountWithAnswer(
    page,
    session,
    await serve(
      'harbor',
      { level: 'strict', imageHosts: [IMAGE_HOST] },
      answers,
    ),
    'image',
  );
  await expect(content(view).getByTestId('md-image')).toHaveCount(0);
  await view.getByRole('button', { name: 'Show images' }).click();
  await expect(content(view).getByTestId('md-image')).toHaveCount(1);

  await page.evaluate(() => window.teardownView?.());
  await expect(content(view).getByTestId('md-image')).toHaveCount(0); // the view's consent scope was retired
  await expect(view.getByTestId('images-toggle')).toBeDisabled();
});

test('Strict image consent ends when a new tool result replaces the selection, even with equal Markdown, and a fresh press can grant again', async ({
  page,
}) => {
  const session = await startSession(page);
  const markdown = `Look: ![chart](${IMAGE}).`;
  const answers = new Map([
    ['first', markdown],
    ['second', markdown],
    ['third', markdown],
  ]);
  const served = await serve(
    'harbor',
    { level: 'strict', imageHosts: [IMAGE_HOST] },
    answers,
  );
  const { view } = await mountWithAnswer(page, session, served, 'first');
  const images = content(view).getByTestId('md-image');
  const show = view.getByRole('button', { name: 'Show images' });
  await show.click();
  await expect(images).toHaveCount(1);

  // A distinct question with identical Markdown is a new selection: the earlier grant does not carry over.
  await deliver(page, await served.call('second'));
  await expect(images).toHaveCount(0);
  await expect(show).toBeEnabled();
  expect(served.asked).toEqual(['first', 'second']);

  // A fresh press grants again for this selection only.
  await show.click();
  await expect(images).toHaveCount(1);

  // A failed result replaces the selection as well, and a recovered equal answer starts without consent.
  await deliver(page, await served.call('please fail'));
  await expect(status(view)).toHaveText('The answer could not be shown.');
  await expect(images).toHaveCount(0);
  await deliver(page, await served.call('third'));
  await expect(status(view)).toHaveText('Answer');
  await expect(images).toHaveCount(0);
  await expect(show).toBeEnabled();
  expect(session.problems).toEqual([]);
});

test('a link in the answer leaves only as a request to the host, which decides', async ({
  page,
}) => {
  const session = await startSession(page, { openLinks: true });
  const answers = new Map([
    ['link', 'Read [the guide](https://docs.example.com/guide).'],
  ]);
  const { view } = await mountWithAnswer(
    page,
    session,
    await serve('neutral', { level: 'standard' }, answers),
    'link',
  );
  const link = content(view).getByRole('button', { name: /the guide/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect
    .poll(() => session.openLinks)
    .toEqual(['https://docs.example.com/guide']);
});
