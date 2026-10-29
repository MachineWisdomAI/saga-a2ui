import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { FetchLike } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startListener,
  type Listener,
  type ListenerOptions,
} from '../../templates/lit-node/server/listener.js';
import {
  buildStarter,
  prepareStarter,
  type BuiltStarter,
} from '../build-starter.js';
import { createWorkDirectory } from '../packed-consumer.js';
import { runCli } from '../saga.js';
import type { ValidatorLoad } from './chatgpt.js';
import {
  FIXTURE,
  PUBLISHED,
  copyFixture,
  editInput,
  editing,
  here,
  listing,
  png,
  recordOf,
  root,
  saga,
  status,
  viewHtml,
  wire,
  workspace,
  type Options,
  type Run,
  type Wire,
} from './harness.js';
import {
  ARCHIVE_FILES,
  RECORD_FILE,
  sha256,
  type PublicationRecord,
} from './record.js';
import { readZip } from './zip.js';

// `saga publish check|prepare --target chatgpt` as a maintainer runs it, on the fixture application of
// harness.ts.

const ARCHIVE_FILE = ARCHIVE_FILES.chatgpt;

const release = (app: string): string =>
  path.join(app, 'saga-publication.json');
const check = (
  app: string,
  options?: Options,
  extra: string[] = [],
): Promise<Run> =>
  saga(
    [
      'publish',
      'check',
      '--target',
      'chatgpt',
      '--release',
      release(app),
      ...extra,
    ],
    options,
  );
const prepare = (
  app: string,
  out: string,
  options?: Options,
  extra: string[] = [],
): Promise<Run> =>
  saga(
    [
      'publish',
      'prepare',
      '--target',
      'chatgpt',
      '--release',
      release(app),
      '--out',
      out,
      ...extra,
    ],
    options,
  );

describe('a ready application', () => {
  it('packages SAGA branding when the application supplies no assets', async () => {
    const app = copyFixture();
    editInput(app, (input) => {
      delete input.assets;
    });
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code, run.out + run.err).toBe(0);
    const out = path.join(cwd, 'publication');
    const entries = readZip(fs.readFileSync(path.join(out, ARCHIVE_FILE)));
    const files = new Map(entries.map((entry) => [entry.path, entry.data]));
    const manifest = JSON.parse(files.get('plugin.json')!.toString());
    const branding = manifest.extensions['com.openai'].interface;
    expect(branding.logo).toBe('./assets/saga-a2ui/icon.svg');
    expect(branding.composerIcon).toBe('./assets/saga-a2ui/icon.svg');
    expect(files.get('assets/saga-a2ui/icon.svg')?.toString()).toContain(
      '<title>SAGA A2UI</title>',
    );
    expect(status(recordOf(out), 'package.assets')).toBe('pass');
  });

  it('keeps a supplied logo while defaulting an omitted composer icon', async () => {
    const app = copyFixture();
    editInput(app, (input) => {
      input.assets = { logo: 'assets/logo.svg' };
    });
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });
    expect(run.code, run.out + run.err).toBe(0);
    const entries = readZip(
      fs.readFileSync(path.join(cwd, 'publication', ARCHIVE_FILE)),
    );
    const files = new Map(entries.map((entry) => [entry.path, entry.data]));
    const manifest = JSON.parse(files.get('plugin.json')!.toString());
    expect(manifest.extensions['com.openai'].interface.logo).toBe(
      './assets/logo.svg',
    );
    expect(manifest.extensions['com.openai'].interface.composerIcon).toBe(
      './assets/saga-a2ui/icon.svg',
    );
    expect(files.get('assets/logo.svg')).toEqual(
      fs.readFileSync(path.join(app, 'assets/logo.svg')),
    );
  });

  it('check passes every check, reads the endpoint without calling a tool, and writes nothing', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const seen = wire();
    const run = await check(app, { cwd, wire: seen });

    expect(run.err).toBe('');
    expect(run.out).toContain('saga publish check (chatgpt): ready');
    expect(run.code).toBe(0);
    expect(run.out).not.toMatch(/FAIL|unknown/);
    expect(seen.methods).toContain('tools/list');
    expect(seen.methods).toContain('resources/read');
    expect(seen.methods).not.toContain('tools/call');
    expect(listing(cwd)).toEqual([]);
    expect(run.out).toContain(
      'Nothing was deployed, uploaded, submitted or published.',
    );
    // The owner-only steps are listed as pending, and a prepared package is never called live.
    expect(run.out).toMatch(/Pending handoff/);
    expect(run.out).toMatch(
      /OpenAI organization has completed individual or business verification/,
    );
  });

  it('accepts a nested view when its relative filename matches the deployed resource', async () => {
    const app = copyFixture();
    fs.mkdirSync(path.join(app, 'build', 'nested'));
    fs.renameSync(
      path.join(app, 'build', 'view.html'),
      path.join(app, 'build', 'nested', 'view.html'),
    );
    editInput(app, (input) => (input.build.views = ['nested/view.html']));
    const listener = await startListener({
      filename: 'nested/view.html',
      html: viewHtml,
      verifier: {
        verifyAccessToken: async () => {
          throw new Error('public fixture');
        },
      },
      authorize: async () => true,
      port: 0,
    });
    try {
      const run = await check(app, {
        wire: {
          methods: [],
          fetch: (_url, init) => fetch(listener.statusUrl, init),
        },
      });
      expect(run.code, run.out + run.err).toBe(0);
      expect(run.out).toContain('pass    endpoint.views');
    } finally {
      await listener.close();
    }
  });

  it('prepare writes a valid package and a record bound to its digest, naming the publisher and not the operator', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code, run.out + run.err).toBe(0);
    const out = path.join(cwd, 'publication');
    expect(listing(out)).toEqual([ARCHIVE_FILE, RECORD_FILE]);
    const record = recordOf(out);
    const archive = fs.readFileSync(path.join(out, ARCHIVE_FILE));
    expect(record.verdict).toBe('ready');
    expect(record.artifact?.sha256).toBe(sha256(archive));
    expect(record.artifact?.files.map((file) => file.path)).toEqual([
      'assets/icon.svg',
      'assets/logo.svg',
      'mcp.json',
      'plugin.json',
    ]);
    expect(record.submission.state).toBe('not-submitted');
    expect(record.endpoint.toolCallsDuringDiscovery).toBe(0);
    expect(record.endpoint.deploymentIdentity.status).toBe('established');
    expect(record.endpoint.tools.map((tool) => tool.name)).toEqual([
      'get_status',
    ]);
    expect(record.endpoint.resources).toHaveLength(1);
    expect(record.inputs.views[0]?.sha256).toBe(sha256(viewHtml));
    expect(record.endpoint.resources[0]?.sha256).toBe(sha256(viewHtml));
    // The fixture declares placeholder versions and installs nothing: declared and installed are different facts.
    expect(record.application.sagaPackages).toEqual({
      declared: {
        '@saga-a2ui/core': '0.0.0-candidate.g0123456789ab',
        '@saga-a2ui/mcp': '0.0.0-candidate.g0123456789ab',
      },
      installed: { '@saga-a2ui/core': null, '@saga-a2ui/mcp': null },
    });
    expect(record.endpoint.complete).toBe(true);
    expect(record.application.publisher.name).toBe('Notes Fixture Publisher');
    expect(record.application.contributors.map((one) => one.name)).toEqual([
      'Fixture Contributor',
    ]);

    const entries = readZip(archive);
    const plugin = JSON.parse(
      Buffer.from(
        entries.find((entry) => entry.path === 'plugin.json')!.data,
      ).toString('utf8'),
    ) as Record<string, any>;
    const mcp = JSON.parse(
      Buffer.from(
        entries.find((entry) => entry.path === 'mcp.json')!.data,
      ).toString('utf8'),
    ) as Record<string, any>;
    expect(plugin.author.name).toBe('Notes Fixture Publisher');
    expect(plugin.extensions['com.openai'].interface.developerName).toBe(
      'Notes Fixture Publisher',
    );
    expect(plugin.extensions['com.openai'].interface.logo).toBe(
      './assets/logo.svg',
    );
    expect(mcp.mcpServers['notes-fixture']).toEqual({
      type: 'streamable-http',
      url: PUBLISHED,
    });
    // The contributor is credited in the record; the listing publisher is the application's.
    expect(JSON.stringify(plugin)).not.toContain('Fixture Contributor');
  });

  it('reproduces the package and record bytes from unchanged inputs', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'first', { cwd })).code).toBe(0);
    expect((await prepare(app, 'second', { cwd })).code).toBe(0);

    for (const file of [ARCHIVE_FILE, RECORD_FILE])
      expect(
        fs
          .readFileSync(path.join(cwd, 'second', file))
          .equals(fs.readFileSync(path.join(cwd, 'first', file))),
        file,
      ).toBe(true);
  });

  it('accepts a PNG icon of the required size', async () => {
    const app = copyFixture();
    fs.writeFileSync(path.join(app, 'assets', 'logo.png'), png(64));
    editInput(app, (input) => (input.assets.logo = 'assets/logo.png'));
    const cwd = workspace();

    const run = await prepare(app, 'publication', { cwd });
    expect(run.code, run.out).toBe(0);
    expect(
      status(recordOf(path.join(cwd, 'publication')), 'package.assets'),
    ).toBe('pass');
  });
});

describe('deployment identity', () => {
  it('stays unknown, never ready, when the release input does not say what the deployment reports', async () => {
    const app = copyFixture();
    editInput(app, (input) => delete input.endpoint.expectedServer);
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish prepare (chatgpt): incomplete');
    expect(run.out).toMatch(/Deployment identity: unknown/);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(record.endpoint.deploymentIdentity.status).toBe('unknown');
    expect(status(record, 'endpoint.identity')).toBe('unknown');
    // Nothing failed, so the package is still prepared for the owner's handoff.
    expect(listing(path.join(cwd, 'publication'))).toEqual([
      ARCHIVE_FILE,
      RECORD_FILE,
    ]);
  });

  it('blocks when the deployment is not the one the release input declares', async () => {
    const app = copyFixture();
    editInput(
      app,
      (input) => (input.endpoint.expectedServer.version = '9.9.9'),
    );
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('blocked');
    expect(record.endpoint.deploymentIdentity.status).toBe('mismatch');
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
  });
});

describe('inputs that must prevent a ready claim', () => {
  const blocked = async (
    damage: (app: string) => void,
    expectedFinding: string,
    options: Options = {},
    extra: string[] = [],
  ): Promise<{ run: Run; record: PublicationRecord; out: string }> => {
    const app = copyFixture();
    damage(app);
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, ...options }, extra);
    const out = path.join(cwd, 'publication');
    expect(run.code).toBe(1);
    const record = recordOf(out);
    expect(record.verdict).toBe('blocked');
    expect(
      status(record, expectedFinding),
      `${expectedFinding}\n${run.out}`,
    ).toBe('fail');
    // A failed check leaves a record and no package that could be mistaken for a complete one.
    expect(listing(out)).toEqual([RECORD_FILE]);
    expect(record.artifact).toBeNull();
    return { run, record, out };
  };

  it('a missing asset', async () => {
    await blocked(
      (app) => fs.rmSync(path.join(app, 'assets', 'icon.svg')),
      'package.asset-files',
    );
  });

  it('an icon that is not square', async () => {
    await blocked(
      (app) =>
        fs.writeFileSync(
          path.join(app, 'assets', 'logo.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"></svg>',
        ),
      'package.assets',
    );
  });

  it('an invalid manifest identity', async () => {
    const { record } = await blocked(
      (app) => editInput(app, (input) => (input.name = 'Notes Fixture')),
      'package.manifest',
    );
    expect(status(record, 'package.listing')).toBe('fail');
  });

  it('listing text beyond the host limits', async () => {
    const { record } = await blocked(
      (app) =>
        editInput(
          app,
          (input) =>
            (input.listing.displayName =
              'A display name that is far too long to list'),
        ),
      'package.listing',
    );
    expect(
      record.findings.find((finding) => finding.id === 'package.listing')
        ?.detail,
    ).toMatch(/displayName/);
  });

  it('a non-HTTPS privacy policy link', async () => {
    await blocked(
      (app) =>
        editInput(
          app,
          (input) =>
            (input.listing.privacyPolicyURL =
              'http://notes.example.com/privacy'),
        ),
      'package.listing',
    );
  });

  it('a secret in the listing text, without echoing the secret', async () => {
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
    const { run, out } = await blocked(
      (app) =>
        editInput(
          app,
          (input) => (input.listing.longDescription += ` ${secret}`),
        ),
      'package.secrets',
    );
    expect(run.out).not.toContain(secret);
    expect(fs.readFileSync(path.join(out, RECORD_FILE), 'utf8')).not.toContain(
      'abcdefghijklmnopqrstuvwxyz0123456789',
    );
  });

  it('the credential supplied for discovery appearing anywhere in the package', async () => {
    const token = 'discovery-credential-0123456789';
    const { run, out } = await blocked(
      (app) =>
        editInput(
          app,
          (input) => (input.listing.longDescription += ` ${token}`),
        ),
      'package.secrets',
      { environment: { NOTES_TOKEN: token } },
      ['--bearer-env', 'NOTES_TOKEN'],
    );
    expect(run.out).not.toContain(token);
    expect(fs.readFileSync(path.join(out, RECORD_FILE), 'utf8')).not.toContain(
      token,
    );
  });

  it('reviewer credentials in the release input', async () => {
    const app = copyFixture();
    editInput(app, (input) => (input.review.test_credentials = 'user:pass'));
    const run = await check(app);
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/does not match saga-publication\/1/);
  });

  it('a local endpoint address', async () => {
    await blocked(
      (app) =>
        editInput(
          app,
          (input) => (input.endpoint.url = 'https://localhost:3000/status/mcp'),
        ),
      'endpoint.url',
    );
  });

  it('a built view that is not the one the endpoint serves (a stale or wrong deployment)', async () => {
    const { record } = await blocked(
      (app) =>
        fs.appendFileSync(
          path.join(app, 'build', 'view.html'),
          '<!-- rebuilt -->\n',
        ),
      'endpoint.views',
    );
    expect(
      record.findings.find((finding) => finding.id === 'endpoint.views')
        ?.detail,
    ).toMatch(/does not serve view\.html/);
  });

  it('explains a filename mismatch when the endpoint serves the same bytes under another name', async () => {
    const { record } = await blocked((app) => {
      fs.mkdirSync(path.join(app, 'build', 'nested'));
      fs.renameSync(
        path.join(app, 'build', 'view.html'),
        path.join(app, 'build', 'nested', 'view.html'),
      );
      editInput(app, (input) => (input.build.views = ['nested/view.html']));
    }, 'endpoint.views');
    const detail = record.findings.find(
      (finding) => finding.id === 'endpoint.views',
    )?.detail;
    expect(detail).toMatch(
      /serves the bytes of nested\/view\.html as ui:\/\/views\/view\./,
    );
    expect(detail).toContain(
      'Use the same relative filename in build.views and viewUriForHtml',
    );
    expect(detail).toContain('build.views is relative to build.directory');
  });

  it('rejects served bytes that disagree with a 32-character URI fingerprint', async () => {
    const { record } = await blocked(() => undefined, 'endpoint.views', {
      wire: editing('resources/read', (result) => {
        result.contents[0].text += '\n<!-- changed served bytes -->';
      }),
    });
    expect(
      record.findings.find((finding) => finding.id === 'endpoint.views')
        ?.detail,
    ).toMatch(
      /ui:\/\/views\/view\.[0-9a-f]{32}\.html names a digest that is not the digest of the bytes served/,
    );
  });

  it('a missing build', async () => {
    await blocked(
      (app) => fs.rmSync(path.join(app, 'build'), { recursive: true }),
      'build.directory',
    );
  });

  it('a view listed in the release input that the build does not contain', async () => {
    await blocked(
      (app) => editInput(app, (input) => input.build.views.push('other.html')),
      'build.views',
    );
  });

  it('a view or asset that leads outside the application', async () => {
    await blocked(
      (app) =>
        editInput(
          app,
          (input) => (input.build.views = ['../saga-publication.json']),
        ),
      'build.views',
    );
    const outside = path.join(root, 'outside-secret.svg');
    fs.writeFileSync(
      outside,
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>',
    );
    const { record } = await blocked(
      (app) =>
        editInput(
          app,
          (input) => (input.assets.logo = path.relative(app, outside)),
        ),
      'package.asset-files',
    );
    expect(
      record.findings.find((finding) => finding.id === 'package.asset-files')
        ?.detail,
    ).toMatch(/outside the directory of the release input/);
  });

  describe('an icon that is not a complete, valid image', () => {
    const withLogo =
      (name: string, data: Buffer | string) =>
      (app: string): void => {
        fs.writeFileSync(path.join(app, 'assets', name), data);
        editInput(app, (input) => (input.assets.logo = `assets/${name}`));
      };
    const whole = png(64);

    it('a PNG cut off after its header', async () => {
      const { record } = await blocked(
        withLogo('logo.png', whole.subarray(0, 24)),
        'package.assets',
      );
      expect(
        record.findings.find((finding) => finding.id === 'package.assets')
          ?.detail,
      ).toMatch(/logo\.png is not a valid PNG: it is truncated/);
    });

    it('a PNG without its IEND chunk', async () => {
      await blocked(
        withLogo('logo.png', whole.subarray(0, whole.length - 12)),
        'package.assets',
      );
    });

    it('a PNG with a damaged chunk', async () => {
      const damaged = Buffer.from(whole);
      damaged[damaged.length - 20] = damaged[damaged.length - 20]! ^ 0xff;
      const { record } = await blocked(
        withLogo('logo.png', damaged),
        'package.assets',
      );
      expect(
        record.findings.find((finding) => finding.id === 'package.assets')
          ?.detail,
      ).toMatch(/checksum is wrong/);
    });

    it('a PNG with data after its end', async () => {
      await blocked(
        withLogo('logo.png', Buffer.concat([whole, Buffer.from('trailing')])),
        'package.assets',
      );
    });

    it('a PNG whose image data is shorter than its header promises', async () => {
      const { record } = await blocked(
        withLogo('logo.png', png(64, 10)),
        'package.assets',
      );
      expect(
        record.findings.find((finding) => finding.id === 'package.assets')
          ?.detail,
      ).toMatch(/bytes of pixel data/);
    });

    it('an SVG whose root element is never closed', async () => {
      const { record } = await blocked(
        withLogo(
          'logo.svg',
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/>',
        ),
        'package.assets',
      );
      expect(
        record.findings.find((finding) => finding.id === 'package.assets')
          ?.detail,
      ).toMatch(/not a complete SVG document/);
    });

    it('an SVG with a malformed tag or mismatched elements', async () => {
      await blocked(
        withLogo(
          'logo.svg',
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><g></svg>',
        ),
        'package.assets',
      );
      await blocked(
        withLogo(
          'logo.svg',
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width=64/></svg>',
        ),
        'package.assets',
      );
    });

    it('an SVG whose text uses an entity the XML grammar does not define', async () => {
      const svg = (content: string): string =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${content}</svg>`;
      const { record } = await blocked(
        withLogo('logo.svg', svg('<text>&undefined;</text>')),
        'package.assets',
      );
      expect(
        record.findings.find((finding) => finding.id === 'package.assets')
          ?.detail,
      ).toMatch(
        /logo\.svg is not a complete SVG document: it is not well-formed XML \(.*entity/,
      );
      // HTML-only entities, an unbound namespace prefix, a repeated attribute, an unescaped ampersand and a bad name are XML errors as well.
      for (const damaged of [
        svg('<text>&nbsp;</text>'),
        svg('<a:b/>'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" width="64"/>',
        svg('<text>fish & chips</text>'),
        svg('<1bad/>'),
        svg('<text>a</text>') + '<svg/>',
      ]) {
        await blocked(withLogo('logo.svg', damaged), 'package.assets');
      }
    });

    it('an SVG that is XML but not an SVG document, or that declares entities', async () => {
      await blocked(
        withLogo('logo.svg', '<svg width="64" height="64"></svg>'),
        'package.assets',
      );
      await blocked(
        withLogo(
          'logo.svg',
          '<html xmlns="http://www.w3.org/1999/xhtml" width="64" height="64"/>',
        ),
        'package.assets',
      );
      await blocked(
        withLogo(
          'logo.svg',
          '<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text>&a;</text></svg>',
        ),
        'package.assets',
      );
    });

    it('a complete SVG with entity references the grammar defines, comments, a prolog and nested elements is accepted', async () => {
      const app = copyFixture();
      withLogo(
        'logo.svg',
        '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g><rect width="64" height="64" fill="#2357C6"/><text>fish &amp; chips &#169; &lt;3</text></g></svg>\n',
      )(app);
      const run = await check(app);
      expect(run.code, run.out).toBe(0);
    });
  });

  it('a symbolic link as a view', async () => {
    await blocked((app) => {
      fs.rmSync(path.join(app, 'build', 'view.html'));
      fs.symlinkSync(
        path.join(FIXTURE, 'build', 'view.html'),
        path.join(app, 'build', 'view.html'),
      );
    }, 'build.views');
  });

  it('a tool whose annotations are not explicit', async () => {
    const stripped = wire(async (method, response) => {
      if (method !== 'tools/list') return response;
      const body = JSON.parse(await response.text()) as {
        result: { tools: { annotations?: unknown }[] };
      };
      delete body.result.tools[0]?.annotations;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await blocked(() => undefined, 'endpoint.tools', { wire: stripped });
  });
});

describe('what cannot be concluded is never a pass', () => {
  it('an unavailable validator leaves the manifests unknown and the verdict incomplete', async () => {
    const run = await check(copyFixture(), {
      validators: { ok: false, problem: 'the schema copy is missing' },
    });

    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish check (chatgpt): incomplete');
    expect(run.out).toMatch(/unknown\s+package\.manifest/);
    expect(run.out).toMatch(/unknown\s+package\.mcp-config/);
  });

  it("the official schemas reject what OpenAI's guide shows but the 1.0.0 mcp.json schema forbids: server-level extensions", async () => {
    const { loadOfficialValidators, MCP_SCHEMA_ID } =
      await import('./chatgpt.js');
    const loaded = loadOfficialValidators();
    if (!loaded.ok) throw new Error(loaded.problem);
    const server = { type: 'streamable-http', url: PUBLISHED };
    expect(
      loaded.validators.validateMcp({
        $schema: MCP_SCHEMA_ID,
        mcpServers: { notes: server },
      }),
    ).toBeNull();
    expect(
      loaded.validators.validateMcp({
        $schema: MCP_SCHEMA_ID,
        mcpServers: {
          notes: {
            ...server,
            extensions: { 'com.openai': { auth: { type: 'none' } } },
          },
        },
      }),
    ).not.toBeNull();
  });

  it('a schema copy that differs from the pinned official one is unavailable, not used', async () => {
    const { loadOfficialValidators } = await import('./chatgpt.js');
    const copy = fs.mkdtempSync(path.join(root, 'schemas-'));
    fs.cpSync(path.join(here, 'schemas', 'agent-plugins-1.0.0'), copy, {
      recursive: true,
    });
    expect(loadOfficialValidators(copy).ok).toBe(true);
    fs.writeFileSync(
      path.join(copy, 'plugin.schema.json'),
      '{"type":"object"}',
    );
    const altered = loadOfficialValidators(copy);
    expect(altered.ok).toBe(false);
    fs.rmSync(path.join(copy, 'mcp.schema.json'));
    expect(loadOfficialValidators(copy)).toMatchObject({ ok: false });
  });

  it('an endpoint that cannot be reached leaves its tools and views unchecked', async () => {
    const down: Wire = {
      methods: [],
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    };
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, wire: down });

    expect(run.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(status(record, 'endpoint.discovery')).toBe('unknown');
    expect(record.endpoint.reached).toBe(false);
    expect(record.endpoint.deploymentIdentity.status).toBe('unknown');
  });

  it('an endpoint that asks for authentication says so and names the way to read it', async () => {
    const refusing: Wire = {
      methods: [],
      fetch: async () =>
        new Response('unauthorized', {
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="x"' },
        }),
    };
    const run = await check(copyFixture(), { wire: refusing });

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/requires authentication/);
    expect(run.out).toMatch(/--bearer-env/);
  });

  it('sends the discovery credential and never writes it', async () => {
    const token = 'discovery-credential-0123456789';
    const authorizations: (string | null)[] = [];
    const seen = wire();
    const inner = seen.fetch;
    const capturing: Wire = {
      methods: seen.methods,
      fetch: (url, init) => (
        authorizations.push(new Headers(init?.headers).get('authorization')),
        inner(url, init)
      ),
    };
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(
      app,
      'publication',
      { cwd, wire: capturing, environment: { NOTES_TOKEN: token } },
      ['--bearer-env', 'NOTES_TOKEN'],
    );

    expect(run.code, run.out).toBe(0);
    expect(authorizations).toContain(`Bearer ${token}`);
    for (const file of [ARCHIVE_FILE, RECORD_FILE])
      expect(
        fs.readFileSync(path.join(cwd, 'publication', file)).includes(token),
        file,
      ).toBe(false);
    expect(run.out).not.toContain(token);
  });

  it('does not send a credential to an endpoint that is not HTTPS', async () => {
    const authorizations: (string | null)[] = [];
    const seen = wire();
    const inner = seen.fetch;
    const capturing: Wire = {
      methods: seen.methods,
      fetch: (url, init) => (
        authorizations.push(new Headers(init?.headers).get('authorization')),
        inner(url, init)
      ),
    };
    const app = copyFixture();
    editInput(
      app,
      (input) => (input.endpoint.url = 'http://notes.example.com/status/mcp'),
    );
    const run = await check(
      app,
      {
        wire: capturing,
        environment: { NOTES_TOKEN: 'discovery-credential-0123456789' },
      },
      ['--bearer-env', 'NOTES_TOKEN'],
    );

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/credential was not sent/);
    expect(authorizations.filter((value) => value !== null)).toEqual([]);
  });

  it('refuses a --bearer-env that names an unset variable', async () => {
    const run = await check(copyFixture(), {}, ['--bearer-env', 'NOT_SET']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/NOT_SET/);
  });

  it('a missing or malformed release input prepares nothing', async () => {
    const cwd = workspace();
    const missing = await saga(
      [
        'publish',
        'prepare',
        '--target',
        'chatgpt',
        '--release',
        'nope.json',
        '--out',
        'publication',
      ],
      { cwd },
    );
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/cannot be read/);
    fs.writeFileSync(path.join(cwd, 'bad.json'), '{ not json');
    const malformed = await saga(
      [
        'publish',
        'prepare',
        '--target',
        'chatgpt',
        '--release',
        'bad.json',
        '--out',
        'publication',
      ],
      { cwd },
    );
    expect(malformed.code).toBe(1);
    expect(malformed.err).toMatch(/not valid JSON/);
    expect(listing(cwd)).toEqual(['bad.json']);
  });
});

describe('tool calls', () => {
  it('discovery calls no tool even when the release input declares fixture calls', async () => {
    const seen = wire();
    expect((await check(copyFixture(), { wire: seen })).code).toBe(0);
    expect(seen.methods.filter((method) => method === 'tools/call')).toEqual(
      [],
    );
  });

  it('--invoke-fixture calls exactly the declared read-only tool, records only a digest of its result, and labels it fixture evidence', async () => {
    const seen = wire();
    const cwd = workspace();
    const run = await prepare(
      copyFixture(),
      'publication',
      { cwd, wire: seen },
      ['--invoke-fixture'],
    );

    expect(run.code, run.out).toBe(0);
    expect(
      seen.methods.filter((method) => method === 'tools/call'),
    ).toHaveLength(1);
    expect(run.out).toMatch(/fixture evidence, not a real-host observation/);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.fixture.invoked).toBe(true);
    expect(record.fixture.invocations).toEqual([
      {
        tool: 'get_status',
        outcome: 'ok',
        resultSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    // Discovery itself still made no call.
    expect(record.endpoint.toolCallsDuringDiscovery).toBe(0);
  });

  it('refuses to call a declared tool the endpoint does not advertise', async () => {
    const seen = wire();
    const app = copyFixture();
    editInput(
      app,
      (input) =>
        (input.fixture.calls = [{ tool: 'delete_everything', arguments: {} }]),
    );
    const run = await check(app, { wire: seen }, ['--invoke-fixture']);

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/delete_everything: refused/);
    expect(seen.methods).not.toContain('tools/call');
  });

  it('--invoke-fixture without declared calls fails instead of silently doing nothing', async () => {
    const app = copyFixture();
    editInput(app, (input) => delete input.fixture);
    const run = await check(app, {}, ['--invoke-fixture']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/declares no fixture\.calls/);
  });
});

describe('stale evidence', () => {
  it('--against passes when nothing changed and names what changed otherwise', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);

    const same = await check(app, { cwd }, ['--against', 'publication']);
    expect(same.code, same.out).toBe(0);

    editInput(
      app,
      (input) =>
        (input.listing.longDescription += ' It now also reports the version.'),
    );
    const changed = await check(app, { cwd }, ['--against', 'publication']);
    expect(changed.code).toBe(1);
    expect(changed.out).toMatch(
      /Changed since then: the release input changed; the package content changed/,
    );
  });

  it('--against detects a package altered after it was prepared', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    fs.appendFileSync(path.join(cwd, 'publication', ARCHIVE_FILE), 'x');

    const run = await check(app, { cwd }, ['--against', 'publication']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+record\.integrity/);
  });

  it('--against reports a changed tool definition', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const renamed = wire(async (method, response) => {
      if (method !== 'tools/list') return response;
      const body = JSON.parse(await response.text()) as {
        result: { tools: { description: string }[] };
      };
      body.result.tools[0]!.description += ' (changed)';
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const run = await check(app, { cwd, wire: renamed }, [
      '--against',
      'publication',
    ]);
    expect(run.out).toMatch(/the tool definitions changed/);
    expect(run.code).toBe(1);
  });
});

describe('a damaged earlier record', () => {
  it('is reported, not trusted', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const file = path.join(cwd, 'publication', RECORD_FILE);
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    delete record.inputs;
    fs.writeFileSync(file, JSON.stringify(record));

    const run = await check(app, { cwd }, ['--against', 'publication']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+record\.previous/);
  });
});

describe('the output directory', () => {
  it('refuses a directory that is not one this command generated, changing nothing', async () => {
    const app = copyFixture();
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'mine'));
    fs.writeFileSync(path.join(cwd, 'mine', 'notes.txt'), 'keep');
    const run = await prepare(app, 'mine', { cwd });

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/not a directory this command generated/);
    expect(listing(path.join(cwd, 'mine'))).toEqual(['notes.txt']);
  });

  it('replaces its own earlier output, and a failed rerun leaves no earlier package beside the new record', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    expect(listing(path.join(cwd, 'publication'))).toEqual([
      ARCHIVE_FILE,
      RECORD_FILE,
    ]);

    fs.rmSync(path.join(app, 'assets', 'icon.svg'));
    expect((await prepare(app, 'publication', { cwd })).code).toBe(1);
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
    expect(listing(cwd)).toEqual(['publication']);
  });

  it('does not create missing parent directories', async () => {
    const run = await prepare(copyFixture(), 'missing/parent/publication');
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/parent directory .* does not exist/);
  });

  it('an interrupt before anything is written leaves nothing behind', async () => {
    const controller = new AbortController();
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', {
      cwd,
      signal: controller.signal,
      onOutput: () => controller.abort(),
    });

    expect(run.code).toBe(130);
    expect(listing(cwd)).toEqual([]);
  });

  it('an interrupt while replacing keeps the earlier output exactly as it was and removes the partial one', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const before = Object.fromEntries(
      listing(path.join(cwd, 'publication')).map((file) => [
        file,
        fs.readFileSync(path.join(cwd, 'publication', file)).toString('base64'),
      ]),
    );

    const controller = new AbortController();
    const run = await prepare(app, 'publication', {
      cwd,
      signal: controller.signal,
      onOutput: (text) =>
        text.startsWith('saga publish prepare') && controller.abort(),
    });

    expect(run.code).toBe(130);
    expect(listing(cwd)).toEqual(['publication']);
    expect(
      Object.fromEntries(
        listing(path.join(cwd, 'publication')).map((file) => [
          file,
          fs
            .readFileSync(path.join(cwd, 'publication', file))
            .toString('base64'),
        ]),
      ),
    ).toEqual(before);
  });
});

// One complete, built application: the qualified `lit-node` starter, exported as a developer receives
// it, installed from the packed candidate tarballs and built with its own configuration
// (scripts/build-starter.ts, the same preparation the starter qualification uses). Its built page is
// served by its own built server entry, and the release input points at its real build directory.
// This is a bounded integration case: one preparation, one prepare run. It does not repeat the
// starter's headless or browser qualification and creates no harness of its own.
describe('a complete built application (the qualified lit-node starter)', () => {
  const work = createWorkDirectory('saga-publish-built-');
  let built: BuiltStarter;
  let running: Listener;
  let html: string;
  afterAll(async () => {
    await running?.close();
    fs.rmSync(work, { recursive: true, force: true });
  });

  beforeAll(async () => {
    built = await buildStarter(prepareStarter(work, 'lit-node'));
    html = fs.readFileSync(built.view, 'utf8');
    const entry = (await import(
      pathToFileURL(built.qualificationServer).href
    )) as { startListener(options: ListenerOptions): Promise<Listener> };
    running = await entry.startListener({
      html,
      verifier: {
        verifyAccessToken: () =>
          Promise.reject(
            new Error('this application is read without an account'),
          ),
      },
      authorize: async () => true,
      port: 0,
    });
  }, 300_000);

  it('is read from its own build, with the installed @saga-a2ui versions observed and kept apart from the declared ones', async () => {
    // The release input sits in the installed application, so its node_modules is the application's own.
    const application = built.consumer;
    fs.cpSync(path.join(FIXTURE, 'assets'), path.join(application, 'assets'), {
      recursive: true,
    });
    const input = JSON.parse(
      fs.readFileSync(path.join(FIXTURE, 'saga-publication.json'), 'utf8'),
    ) as Record<string, any>;
    input.build = { directory: 'dist', views: ['index.html'] };
    fs.writeFileSync(
      path.join(application, 'saga-publication.json'),
      JSON.stringify(input, null, 2),
    );

    const methods: string[] = [];
    const seen: Wire = {
      methods,
      fetch: async (_url, init) => {
        if (typeof init?.body === 'string')
          methods.push(
            (JSON.parse(init.body) as { method?: string }).method ?? '',
          );
        return fetch(running.statusUrl, init);
      },
    };
    const cwd = workspace();
    const run = await prepare(application, 'publication', { cwd, wire: seen });

    expect(run.code, run.out + run.err).toBe(0);
    expect(methods).not.toContain('tools/call');
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('ready');
    expect(record.inputs.views).toEqual([
      {
        file: 'index.html',
        uri: expect.stringMatching(/^ui:\/\/views\/index\.[0-9a-f]{32}\.html$/),
        sha256: sha256(html),
        bytes: Buffer.byteLength(html),
      },
    ]);
    expect(record.endpoint.resources.map((one) => one.sha256)).toEqual([
      sha256(html),
    ]);
    expect(record.endpoint.deploymentIdentity.status).toBe('established');

    // What the application declares, from its own package.json; and what is actually installed, from its node_modules.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(application, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const declared = Object.fromEntries(
      Object.entries(manifest.dependencies).filter(([name]) =>
        name.startsWith('@saga-a2ui/'),
      ),
    );
    const installed = Object.fromEntries(
      Object.keys(declared).map((name) => [
        name,
        (
          JSON.parse(
            fs.readFileSync(
              path.join(application, 'node_modules', name, 'package.json'),
              'utf8',
            ),
          ) as { version: string }
        ).version,
      ]),
    );
    expect(Object.keys(declared).length).toBeGreaterThan(0);
    expect(record.application.sagaPackages).toEqual({ declared, installed });
    for (const version of Object.values(
      record.application.sagaPackages.installed,
    ))
      expect(version).toBe(built.sdk.version);
  }, 120_000);
});

describe('a credential an endpoint echoes', () => {
  const bearer = 'Bearer synthetic0123456789abcdefghij';
  const supplied = 'discovery-credential-0123456789';

  it.each([
    [
      'a failing connection that quotes the Authorization header',
      {
        methods: [],
        fetch: () =>
          Promise.reject(
            new Error(`upstream rejected "Authorization: ${bearer}"`),
          ),
      } as Wire,
    ],
    [
      'a refusal whose message quotes the credential that was supplied',
      {
        methods: [],
        fetch: () =>
          Promise.reject(new Error(`unexpected token ${supplied} in request`)),
      } as Wire,
    ],
    [
      'an error answer whose body quotes the header',
      {
        methods: [],
        fetch: async () =>
          new Response(`bad request: Authorization: ${bearer} / ${supplied}`, {
            status: 400,
          }),
      } as Wire,
    ],
  ])(
    'never reaches the console report or the record: %s',
    async (_name, failing) => {
      const app = copyFixture();
      const cwd = workspace();
      const run = await prepare(
        app,
        'publication',
        { cwd, wire: failing, environment: { NOTES_TOKEN: supplied } },
        ['--bearer-env', 'NOTES_TOKEN'],
      );

      expect(run.code).toBe(1);
      expect(run.out).toMatch(/unknown\s+endpoint\.discovery/);
      for (const text of [run.out, run.err]) {
        expect(text).not.toContain('synthetic0123456789abcdefghij');
        expect(text).not.toContain(supplied);
      }
      const written = fs.readFileSync(
        path.join(cwd, 'publication', RECORD_FILE),
        'utf8',
      );
      expect(written).not.toContain('synthetic0123456789abcdefghij');
      expect(written).not.toContain(supplied);
      // Only a safe diagnostic kind is kept.
      expect(
        recordOf(path.join(cwd, 'publication')).findings.find(
          (finding) => finding.id === 'endpoint.discovery',
        )?.detail,
      ).toMatch(/^The (endpoint|request)/);
    },
  );

  it('never reaches the console when a thrown error carries it: an asset name with a backslash that cannot be placed in the archive', async () => {
    const app = copyFixture();
    const name = `logo-${supplied}\\icon.svg`;
    fs.copyFileSync(
      path.join(app, 'assets', 'logo.svg'),
      path.join(app, 'assets', name),
    );
    editInput(app, (input) => (input.assets.logo = `assets/${name}`));
    const cwd = workspace();
    for (const run of [
      await prepare(
        app,
        'publication',
        { cwd, environment: { NOTES_TOKEN: supplied } },
        ['--bearer-env', 'NOTES_TOKEN'],
      ),
      await check(app, { cwd, environment: { NOTES_TOKEN: supplied } }, [
        '--bearer-env',
        'NOTES_TOKEN',
      ]),
    ]) {
      // The failure is reported, not hidden, and the exit code says nothing was prepared.
      expect(run.code).toBe(1);
      expect(run.err).toMatch(/^saga publish: /);
      expect(`${run.out}${run.err}`).not.toContain(supplied);
    }
    expect(fs.existsSync(path.join(cwd, 'publication'))).toBe(false);
  });

  it('never reaches the console through an unexpected error from any stage, expected or not', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(
      app,
      'publication',
      {
        cwd,
        environment: { NOTES_TOKEN: supplied },
        validators: {
          get ok(): boolean {
            throw new Error(
              `validators exploded with ${supplied} and ${bearer}`,
            );
          },
        } as unknown as ValidatorLoad,
      },
      ['--bearer-env', 'NOTES_TOKEN'],
    );
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/validators exploded/);
    for (const text of [run.out, run.err]) {
      expect(text).not.toContain(supplied);
      expect(text).not.toContain('synthetic0123456789abcdefghij');
    }
  });

  it('is redacted from the report even when the input itself carries it, while the secret check still refuses to write', async () => {
    const app = copyFixture();
    editInput(app, (input) => (input.listing.longDescription += ` ${bearer}`));
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    expect(run.out).not.toContain('synthetic0123456789abcdefghij');
    expect(run.err).not.toContain('synthetic0123456789abcdefghij');
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
    expect(
      fs.readFileSync(path.join(cwd, 'publication', RECORD_FILE), 'utf8'),
    ).not.toContain('synthetic0123456789abcdefghij');
  });
});

describe('an endpoint that is only partly read', () => {
  const methodCount = (seen: Wire, method: string): number =>
    seen.methods.filter((one) => one === method).length;

  it('a tools/list that always offers another page is unknown, not ready', async () => {
    const seen = editing(
      'tools/list',
      (result) => (result.nextCursor = 'more'),
      { ignoreCursors: true },
    );
    const cwd = workspace();
    const run = await prepare(copyFixture(), 'publication', {
      cwd,
      wire: seen,
    });

    expect(methodCount(seen, 'tools/list')).toBe(20);
    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish prepare (chatgpt): incomplete');
    expect(run.out).toMatch(/unknown\s+endpoint\.discovery/);
    expect(run.out).toMatch(
      /tools\/list still offered another page after 20 pages/,
    );
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(record.endpoint.complete).toBe(false);
    expect(status(record, 'endpoint.tools')).toBe('unknown');
    expect(status(record, 'endpoint.views')).toBe('unknown');
  });

  it('a resources/list that always offers another page is unknown, not ready', async () => {
    const seen = editing(
      'resources/list',
      (result) => (result.nextCursor = 'more'),
      { ignoreCursors: true },
    );
    const run = await check(copyFixture(), { wire: seen });

    expect(methodCount(seen, 'resources/list')).toBe(20);
    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish check (chatgpt): incomplete');
    expect(run.out).toMatch(/resources\/list still offered another page/);
  });

  it('more view resources than are read is unknown, not ready', async () => {
    const seen = editing(
      'resources/list',
      (result) =>
        (result.resources = Array.from(
          { length: 51 },
          () => result.resources[0],
        )),
    );
    const run = await check(copyFixture(), { wire: seen });

    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish check (chatgpt): incomplete');
    expect(run.out).toMatch(
      /lists 51 ui:\/\/ resources; only the first 50 were read/,
    );
    expect(methodCount(seen, 'resources/read')).toBe(50);
  });

  it('does not hide a definite failure among what was read', async () => {
    const seen = wire(
      async (method, response) => {
        if (method !== 'tools/list') return response;
        const body = JSON.parse(await response.text()) as {
          result: Record<string, any>;
        };
        delete body.result.tools[0].annotations;
        body.result.nextCursor = 'more';
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      { ignoreCursors: true },
    );
    const run = await check(copyFixture(), { wire: seen });
    expect(run.out).toContain('saga publish check (chatgpt): blocked');
    expect(run.out).toMatch(/FAIL\s+endpoint\.tools/);
  });
});

describe('the contract a deployment serves', () => {
  it('--against reports changed served resource metadata (the content security policy) although every digest of the bytes is the same', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);

    const widened = editing('resources/read', (result) => {
      const content = result.contents[0];
      content._meta = {
        ...content._meta,
        ui: {
          ...content._meta?.ui,
          csp: {
            ...content._meta?.ui?.csp,
            connectDomains: ['https://elsewhere.example.com'],
          },
        },
      };
    });
    const run = await check(app, { cwd, wire: widened }, [
      '--against',
      'publication',
    ]);

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+record\.fresh/);
    expect(run.out).toMatch(
      /a served resource's metadata \(its content security policy and permissions\) changed/,
    );
    expect(run.out).not.toMatch(
      /a served resource changed|the package content changed/,
    );
  });

  it('--against reports changed server instructions', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);

    const reworded = editing(
      'initialize',
      (result) =>
        (result.instructions = 'Use these tools for anything at all.'),
    );
    const run = await check(app, { cwd, wire: reworded }, [
      '--against',
      'publication',
    ]);

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/the server instructions changed/);
  });

  it('--against reports changed validator identity or documentation date', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const recordFile = path.join(cwd, 'publication', RECORD_FILE);
    const record = JSON.parse(
      fs.readFileSync(recordFile, 'utf8'),
    ) as PublicationRecord;
    fs.writeFileSync(
      recordFile,
      JSON.stringify({
        ...record,
        validators: record.validators.map((one) => ({
          ...one,
          documentationDate: '2020-01-01',
        })),
      }),
    );

    const run = await check(app, { cwd }, ['--against', 'publication']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(
      /the validator or the documentation it was checked against changed/,
    );
  });
});

describe('the output path while it is replaced', () => {
  /** Runs `act` once the staging directory beside the output exists, from the event loop that is writing it. */
  function whenStaging(
    cwd: string,
    act: () => void,
  ): { done(): Promise<boolean> } {
    let acted = false;
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        if (
          !acted &&
          fs.readdirSync(cwd).some((name) => name.includes('.staging-'))
        ) {
          acted = true;
          act();
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    return {
      done: async () => {
        stop = true;
        await loop;
        return acted;
      },
    };
  }

  it('does not remove or overwrite a directory that took the path after the earlier output was verified', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const output = path.join(cwd, 'publication');
    const watcher = whenStaging(cwd, () => {
      fs.renameSync(output, path.join(cwd, 'moved-away'));
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output, 'precious.txt'), "the user's data");
    });
    const run = await prepare(app, 'publication', { cwd });

    expect(await watcher.done()).toBe(true);
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/was replaced while the output was being written/);
    expect(listing(output)).toEqual(['precious.txt']);
    expect(fs.readFileSync(path.join(output, 'precious.txt'), 'utf8')).toBe(
      "the user's data",
    );
    // The directory that was moved away is untouched, and neither staging nor previous output is left behind.
    expect(listing(path.join(cwd, 'moved-away'))).toEqual([
      ARCHIVE_FILE,
      RECORD_FILE,
    ]);
    expect(listing(cwd)).toEqual(['moved-away', 'publication']);
  });

  it('does not touch a directory that replaced the path with a file or a link either', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const output = path.join(cwd, 'publication');
    const elsewhere = fs.mkdtempSync(path.join(root, 'elsewhere-'));
    fs.writeFileSync(path.join(elsewhere, 'precious.txt'), 'kept');
    const watcher = whenStaging(cwd, () => {
      fs.renameSync(output, path.join(cwd, 'moved-away'));
      fs.symlinkSync(elsewhere, output);
    });
    const run = await prepare(app, 'publication', { cwd });

    expect(await watcher.done()).toBe(true);
    expect(run.code).toBe(1);
    expect(fs.lstatSync(output).isSymbolicLink()).toBe(true);
    expect(listing(elsewhere)).toEqual(['precious.txt']);
    expect(listing(cwd)).toEqual(['moved-away', 'publication']);
  });

  it('an interrupt once staging has begun leaves the earlier output as it was and no staging directory', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const output = path.join(cwd, 'publication');
    const before = Object.fromEntries(
      listing(output).map((file) => [
        file,
        fs.readFileSync(path.join(output, file)).toString('base64'),
      ]),
    );
    const controller = new AbortController();
    const watcher = whenStaging(cwd, () => controller.abort());
    const run = await prepare(app, 'publication', {
      cwd,
      signal: controller.signal,
    });

    expect(await watcher.done()).toBe(true);
    expect(run.code).toBe(130);
    expect(listing(cwd)).toEqual(['publication']);
    expect(
      Object.fromEntries(
        listing(output).map((file) => [
          file,
          fs.readFileSync(path.join(output, file)).toString('base64'),
        ]),
      ),
    ).toEqual(before);
  });

  it("an interrupt once staging has begun, with the path replaced meanwhile, removes nothing that is not this run's", async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const output = path.join(cwd, 'publication');
    const controller = new AbortController();
    const watcher = whenStaging(cwd, () => {
      fs.renameSync(output, path.join(cwd, 'moved-away'));
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output, 'precious.txt'), 'kept');
      controller.abort();
    });
    const run = await prepare(app, 'publication', {
      cwd,
      signal: controller.signal,
    });

    expect(await watcher.done()).toBe(true);
    expect(run.code).toBe(130);
    expect(listing(output)).toEqual(['precious.txt']);
    expect(listing(path.join(cwd, 'moved-away'))).toEqual([
      ARCHIVE_FILE,
      RECORD_FILE,
    ]);
  });
});

describe('the command line', () => {
  it('needs the publication tooling, and says nothing was checked without it', async () => {
    let err = '';
    const code = await runCli(
      ['publish', 'check', '--target', 'chatgpt', '--release', 'x.json'],
      {
        cwd: workspace(),
        sdkVersion: () => '',
        stageDemo: () => Promise.reject(new Error('no')),
        stdout: () => undefined,
        stderr: (text) => (err += text),
      },
    );
    expect(code).toBe(1);
    expect(err).toMatch(/not available here, so nothing was checked/);
  });

  it('reports tooling that fails to load as unavailable', async () => {
    let err = '';
    const code = await runCli(
      ['publish', 'check', '--target', 'chatgpt', '--release', 'x.json'],
      {
        cwd: workspace(),
        sdkVersion: () => '',
        stageDemo: () => Promise.reject(new Error('no')),
        publication: {
          load: () => Promise.reject(new Error('Cannot find module')),
          environment: {},
        },
        stdout: () => undefined,
        stderr: (text) => (err += text),
      },
    );
    expect(code).toBe(1);
    expect(err).toMatch(
      /could not be loaded \(Cannot find module\), so nothing was checked/,
    );
  });

  it.each([
    [['publish'], /Say what to publish/],
    [['publish', 'check', '--release', 'x.json'], /--target is required/],
    [['publish', 'check', '--target', 'chatgpt'], /--release is required/],
    [
      ['publish', 'prepare', '--target', 'chatgpt', '--release', 'x.json'],
      /prepare needs --out/,
    ],
    [
      [
        'publish',
        'check',
        '--target',
        'chatgpt',
        '--release',
        'x.json',
        '--out',
        'd',
      ],
      /check writes nothing/,
    ],
    [
      [
        'init',
        '--a2ui-stack',
        'lit-mcp',
        '--server',
        'node',
        'd',
        '--release',
        'x.json',
      ],
      /--release belongs to saga publish/,
    ],
  ])('does not understand %j', async (args, message) => {
    const run = await saga(args);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(message);
  });

  it('refuses a target that does not exist without checking anything', async () => {
    const seen = wire();
    const run = await saga(
      [
        'publish',
        'check',
        '--target',
        'gemini',
        '--release',
        release(copyFixture()),
      ],
      { wire: seen },
    );
    expect(run.code).toBe(2);
    expect(run.err).toMatch(
      /gemini target is not supported; the supported targets are chatgpt and claude/,
    );
    expect(seen.methods).toEqual([]);
  });
});
