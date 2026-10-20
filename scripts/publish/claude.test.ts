import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeUiDomain, type ConnectorDossier } from './claude.js';
import type { PluginValidation, PluginValidator } from './claude-plugin.js';
import { PUBLISHED, copyFixture, editInput, editing, listing, png, recordOf, saga, status, wire, workspace, type Options, type Run } from './harness.js';
import { ARCHIVE_FILES, RECORD_FILE, sha256, type PublicationRecord } from './record.js';
import { readZip } from './zip.js';

// `saga publish check|prepare --target claude` as a maintainer runs it, on the fixture application of
// harness.ts and the same release input that prepares the ChatGPT package. The Claude materials are
// a connector dossier for the directory's MCP connector submission; local Desktop or Code packaging
// is never a substitute for it.

const DOSSIER = ARCHIVE_FILES.claude;
const release = (app: string): string => path.join(app, 'saga-publication.json');
const check = (app: string, options?: Options, extra: string[] = []): Promise<Run> => saga(['publish', 'check', '--target', 'claude', '--release', release(app), ...extra], options);
const prepare = (app: string, out: string, options?: Options, extra: string[] = []): Promise<Run> => saga(['publish', 'prepare', '--target', 'claude', '--release', release(app), '--out', out, ...extra], options);
const prepareChatgpt = (app: string, out: string, options?: Options): Promise<Run> => saga(['publish', 'prepare', '--target', 'chatgpt', '--release', release(app), '--out', out], options);

/** The release input's Claude connector section: everything the portal asks for, as the application owner would supply it. */
const connector = (): Record<string, any> => ({
  name: 'Notes Fixture',
  oneLiner: 'Shows whether the Notes Fixture service is running.',
  description: 'Shows whether the Notes Fixture service is running, in a card inside the conversation. It only reports status and reads nothing from your account.',
  categories: ['Developer Tools'],
  slug: 'notes-fixture',
  documentationURL: 'https://notes.example.com/docs',
  privacyPolicyURL: 'https://notes.example.com/privacy',
  support: { email: 'support@notes.example.com', url: 'https://notes.example.com/support' },
  icon: 'assets/icon.svg',
  screenshots: [1, 2, 3].map((n) => ({ file: `screenshots/${n}.png`, prompt: `Is the notes service running? (${n})` })),
  useCases: { primary: ['Check whether the notes service is running'], prerequisites: 'Nothing: the connector needs no account.', access: 'read' },
  authentication: { mode: 'none' },
  dataHandling: { apiOwnership: 'first-party', personalHealthData: false, sponsoredContent: false },
  allowedLinkUris: ['https://notes.example.com'],
  reviewContact: { name: 'Fixture Reviewer', email: 'review@notes.example.com' },
});

/** A copy of the fixture application with its Claude section and the three carousel screenshots the section names. */
function claudeApp(change: (connector: Record<string, any>, input: Record<string, any>) => void = () => undefined): string {
  const app = copyFixture();
  fs.mkdirSync(path.join(app, 'screenshots'));
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(app, 'screenshots', `${n}.png`), png(600, 600, 1000));
  editInput(app, (input) => {
    input.claude = { connector: connector() };
    change(input.claude.connector, input);
  });
  return app;
}

const dossierOf = (directory: string): ConnectorDossier => {
  const entries = readZip(fs.readFileSync(path.join(directory, DOSSIER)));
  return JSON.parse(Buffer.from(entries.find((entry) => entry.path === 'connector-dossier.json')!.data).toString('utf8')) as ConnectorDossier;
};

describe('the ui.domain Claude computes', () => {
  it('is the value Claude\'s documentation gives for its own example URL, and depends on the exact URL', () => {
    expect(claudeUiDomain('https://example.com/mcp')).toBe('c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com');
    expect(claudeUiDomain('https://example.com/mcp/')).not.toBe(claudeUiDomain('https://example.com/mcp'));
  });
});

describe('a ready connector', () => {
  it('check passes every check, calls no tool, writes nothing, and says what only the owner and Anthropic can do', async () => {
    const app = claudeApp();
    const cwd = workspace();
    const seen = wire();
    const run = await check(app, { cwd, wire: seen });

    expect(run.err).toBe('');
    expect(run.out).toContain('saga publish check (claude): ready');
    expect(run.code).toBe(0);
    expect(run.out).not.toMatch(/FAIL|unknown/);
    expect(seen.methods).toContain('tools/list');
    expect(seen.methods).not.toContain('tools/call');
    expect(listing(cwd)).toEqual([]);
    expect(run.out).toContain('Nothing was deployed, uploaded, submitted or published.');
    expect(run.out).toMatch(/Pending handoff/);
    expect(run.out).toMatch(/Submit new, then MCP connector/);
    expect(run.out).toMatch(/fully populated test account/);
    expect(run.out).toMatch(/Claude publishes no offline validator for a connector submission/);
    expect(run.out).toMatch(/actual Claude web runs are observed separately/);
  });

  it('prepare writes a dossier whose endpoint, tool, resource and evidence identity is the record\'s, and which claims no web distribution', async () => {
    const app = claudeApp();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code, run.out + run.err).toBe(0);
    const out = path.join(cwd, 'publication');
    expect(listing(out)).toEqual([DOSSIER, RECORD_FILE]);
    const record = recordOf(out);
    const archive = fs.readFileSync(path.join(out, DOSSIER));
    expect(record.target).toBe('claude');
    expect(record.verdict).toBe('ready');
    expect(record.artifact?.file).toBe(DOSSIER);
    expect(record.artifact?.sha256).toBe(sha256(archive));
    expect(record.artifact?.files.map((file) => file.path)).toEqual(['SUBMISSION.md', 'assets/icon.svg', 'connector-dossier.json', 'screenshots/01.png', 'screenshots/02.png', 'screenshots/03.png']);
    expect(record.submission.state).toBe('not-submitted');
    expect(record.submission.note).toMatch(/local Desktop or Code packaging would not be web distribution/);
    expect(record.endpoint.toolCallsDuringDiscovery).toBe(0);

    const dossier = dossierOf(out);
    expect(dossier.connection.url).toBe(PUBLISHED);
    expect(dossier.connection.uiDomain.expected).toBe(claudeUiDomain(PUBLISHED));
    expect(dossier.tools.map((tool) => ({ name: tool.name, sha256: tool.sha256 }))).toEqual(record.endpoint.tools);
    expect(dossier.tools[0]).toMatchObject({ name: 'get_status', access: 'read-only' });
    expect(dossier.evidence.resources).toEqual(record.endpoint.resources);
    expect(dossier.evidence.views).toEqual(record.inputs.views);
    expect(dossier.evidence.releaseInputSha256).toBe(record.inputs.releaseInput.sha256);
    expect(dossier.evidence.contractSha256).toBe(record.endpoint.contractSha256);
    expect(dossier.evidence.deploymentIdentity.status).toBe('established');
    expect(dossier.evidence.sagaPackages).toEqual(record.application.sagaPackages);
    expect(dossier.company).toMatchObject({ name: 'Notes Fixture Publisher', website: 'https://notes.example.com' });
    expect(dossier.company.contributors.map((one) => one.name)).toEqual(['Fixture Contributor']);

    // A connector is submitted by its URL, and nothing here is local packaging or a claim of web distribution.
    expect(dossier.distribution.webDistribution).toBe('not-established');
    expect(dossier.distribution.notProduced).toEqual(['Claude Desktop extension (.mcpb)', 'Claude Code local or marketplace installation']);
    expect(dossier.pluginBundle).toMatchObject({ included: false, directory: null });
    expect(record.artifact?.files.some((file) => file.path.startsWith('plugin/'))).toBe(false);
    expect(record.validators[0]).toMatchObject({ name: 'claude-connector-requirements', documentationDate: '2026-10-20' });
    expect(record.validators[0]?.identity).toMatch(/No offline validator exists/);
    expect(record.handoff.map((item) => item.id)).toEqual(expect.arrayContaining(['publisher-authority', 'submission', 'authentication', 'reviewer-account', 'portal-validation', 'compliance', 'host-observation']));
  });

  it('is prepared from the same release input, endpoint reading and evidence as the ChatGPT package', async () => {
    const app = claudeApp();
    const cwd = workspace();
    expect((await prepareChatgpt(app, 'chatgpt', { cwd })).code).toBe(0);
    expect((await prepare(app, 'claude', { cwd })).code).toBe(0);

    const chatgpt = recordOf(path.join(cwd, 'chatgpt'));
    const claude = recordOf(path.join(cwd, 'claude'));
    const evidence = (record: PublicationRecord): unknown => ({ inputs: record.inputs, endpoint: record.endpoint, application: record.application, source: record.source, fixture: record.fixture });
    expect(evidence(claude)).toEqual(evidence(chatgpt));
    expect(claude.target).toBe('claude');
    expect(chatgpt.target).toBe('chatgpt');
  });

  it('reproduces the dossier and record bytes from unchanged inputs', async () => {
    const app = claudeApp();
    const cwd = workspace();
    expect((await prepare(app, 'first', { cwd })).code).toBe(0);
    expect((await prepare(app, 'second', { cwd })).code).toBe(0);
    for (const file of [DOSSIER, RECORD_FILE]) expect(fs.readFileSync(path.join(cwd, 'second', file)).equals(fs.readFileSync(path.join(cwd, 'first', file))), file).toBe(true);
  });

  it('needs none of the ChatGPT listing: a release input for Claude alone is enough, while the ChatGPT target says what it lacks', async () => {
    const app = claudeApp((_connector, input) => {
      delete input.listing;
      delete input.assets;
    });
    const cwd = workspace();
    const ready = await check(app, { cwd });
    expect(ready.code, ready.out).toBe(0);

    const chatgpt = await saga(['publish', 'check', '--target', 'chatgpt', '--release', release(app)], { cwd });
    expect(chatgpt.code).toBe(1);
    expect(chatgpt.err).toMatch(/no listing and assets, which the chatgpt target needs/);
    expect(chatgpt.out).toBe('');
  });

  it('replaces an output the ChatGPT target generated, leaving only the Claude files', async () => {
    const app = claudeApp();
    const cwd = workspace();
    expect((await prepareChatgpt(app, 'publication', { cwd })).code).toBe(0);
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    expect(listing(path.join(cwd, 'publication'))).toEqual([DOSSIER, RECORD_FILE]);
  });
});

describe('materials that are missing are findings, not a ready claim', () => {
  const blocked = async (change: (connector: Record<string, any>, input: Record<string, any>) => void, finding: string, detail: RegExp, options: Options = {}): Promise<PublicationRecord> => {
    const app = claudeApp(change);
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, ...options });
    expect(run.code, run.out).toBe(1);
    const out = path.join(cwd, 'publication');
    const record = recordOf(out);
    expect(record.verdict).toBe('blocked');
    expect(status(record, finding), run.out).toBe('fail');
    expect(run.out).toMatch(detail);
    // A failed check leaves a record and no dossier that could be mistaken for a complete one.
    expect(listing(out)).toEqual([RECORD_FILE]);
    expect(record.artifact).toBeNull();
    return record;
  };

  it('no Claude section at all', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });
    expect(run.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(status(record, 'claude.materials')).toBe('fail');
    expect(status(record, 'claude.listing')).toBe('fail');
    expect(status(record, 'claude.company')).toBe('fail');
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
  });

  it('a missing privacy policy and support contact', async () => {
    await blocked(
      (c) => {
        delete c.privacyPolicyURL;
        delete c.support;
      },
      'claude.listing',
      /listing\.privacyPolicyURL is required[\s\S]*listing\.support needs an email address or an HTTPS URL/,
    );
  });

  it('listing text beyond the portal limits, and a slug that cannot be permanent', async () => {
    await blocked(
      (c) => {
        c.name = 'N'.repeat(101);
        c.oneLiner = 'O'.repeat(201);
        c.description = 'D'.repeat(2001);
        c.slug = 'Not A Slug';
        c.categories = [];
      },
      'claude.listing',
      /listing\.name is 101 characters; the limit is 100[\s\S]*listing\.oneLiner is 201 characters; the limit is 200[\s\S]*listing\.description is 2001 characters; the limit is 2000[\s\S]*lowercase letters, digits and single hyphens[\s\S]*one to five non-empty categories/,
    );
  });

  it('a non-HTTPS documentation link', async () => {
    await blocked((c) => (c.documentationURL = 'http://notes.example.com/docs'), 'claude.listing', /listing\.documentationURL must use HTTPS/);
  });

  it('no publisher website and no contact for review updates', async () => {
    await blocked(
      (_c, input) => delete input.publisher.url,
      'claude.company',
      /needs a website \(publisher\.url\)/,
    );
    await blocked((c) => delete c.reviewContact, 'claude.company', /primary contact for review updates/);
  });

  it('missing or inconsistent declarations', async () => {
    await blocked(
      (c) => {
        delete c.useCases;
        delete c.authentication;
        delete c.dataHandling;
      },
      'claude.declarations',
      /useCases\.primary[\s\S]*useCases\.prerequisites[\s\S]*useCases\.access[\s\S]*authentication\.mode is required[\s\S]*dataHandling\.apiOwnership is required/,
    );
    await blocked((c) => (c.dataHandling.apiOwnership = 'third-party'), 'claude.declarations', /accepts a server that calls its own first-party APIs/);
  });

  it('a declared read-only connector whose advertised tool is not annotated read-only', async () => {
    const writes = editing('tools/list', (result) => {
      result.tools[0].annotations = { ...result.tools[0].annotations, readOnlyHint: false, destructiveHint: false };
    });
    await blocked(() => undefined, 'claude.declarations', /useCases\.access says the connector only reads, but get_status is not annotated readOnlyHint: true/, { wire: writes });
  });

  it('allowed link URIs that are broader than an origin or a custom scheme', async () => {
    await blocked((c) => (c.allowedLinkUris = ['https://notes.example.com/path', 'javascript:', 'notes.example.com']), 'claude.links', /neither an HTTPS origin[\s\S]*javascript: is not a custom URI scheme/);
  });

  it('fewer than three screenshots, or one that is too narrow, not a PNG, or without its prompt', async () => {
    await blocked((c) => (c.screenshots = c.screenshots.slice(0, 2)), 'package.images', /needs 3 to 5 carousel screenshots; the dossier has 2/);
    const narrow = claudeApp();
    fs.writeFileSync(path.join(narrow, 'screenshots', '2.png'), png(600, 600, 999));
    const cwd = workspace();
    const run = await prepare(narrow, 'publication', { cwd });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/screenshots\/02\.png is 999 pixels wide; screenshots must be at least 1000/);

    await blocked(
      (c) => {
        c.screenshots[0].file = 'screenshots/1.gif';
      },
      'package.asset-files',
      /A screenshot must be a PNG file; video and GIF are not accepted/,
    );
    await blocked((c) => (c.screenshots[1].prompt = ' '), 'package.images', /screenshots\/02\.png has no prompt/);
  });

  it('a screenshot that only has a PNG name, and a missing icon file', async () => {
    const app = claudeApp();
    fs.writeFileSync(path.join(app, 'screenshots', '1.png'), Buffer.from('GIF89a not a png'));
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/screenshots\/01\.png is not a valid PNG: it does not start with the PNG signature/);

    await blocked((c) => (c.icon = 'assets/missing.svg'), 'package.asset-files', /assets\/missing\.svg: It does not exist/);
  });

  it('a local endpoint address, named as a Claude submission problem', async () => {
    await blocked((_c, input) => (input.endpoint.url = 'https://localhost/mcp'), 'endpoint.url', /Claude submission needs a stable public HTTPS endpoint/);
  });

  it('a secret in the listing text, without echoing the secret', async () => {
    const token = 'sk-synthetic0123456789abcdefghij';
    const app = claudeApp((c) => (c.description = `Shows the status. ${token}`));
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    expect(run.out + run.err).not.toContain(token);
    expect(run.out).toMatch(/FAIL\s+package\.secrets/);
    // The record names the kind of secret and the file, never the value, and no dossier is written.
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
    expect(fs.readFileSync(path.join(cwd, 'publication', RECORD_FILE), 'utf8')).not.toContain(token);
  });

  it('a view or a screenshot that leads outside the application', async () => {
    const app = claudeApp((c) => (c.icon = '../outside.svg'));
    fs.writeFileSync(path.join(app, '..', 'outside.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>');
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/outside the directory of the release input/);
  });
});

describe('what the endpoint advertises', () => {
  const tools = (edit: (tool: Record<string, any>) => void) =>
    editing('tools/list', (result) => {
      edit(result.tools[0]);
    });

  it.each([
    ['no title', (tool: Record<string, any>) => delete tool.title, /get_status has no title/],
    ['no read-only or destructive annotation', (tool: Record<string, any>) => delete tool.annotations, /sets neither readOnlyHint: true nor an explicit destructiveHint/],
    ['a name longer than 64 characters', (tool: Record<string, any>) => (tool.name = 'n'.repeat(65)), /longer than 64 characters/],
    ['no description', (tool: Record<string, any>) => delete tool.description, /has no description/],
    ['contradictory annotations', (tool: Record<string, any>) => (tool.annotations = { readOnlyHint: true, destructiveHint: true }), /both read-only and destructive/],
  ])('a tool with %s is a failure', async (_name, edit, message) => {
    const app = claudeApp();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, wire: tools(edit as (tool: Record<string, any>) => void) });
    expect(run.code).toBe(1);
    expect(status(recordOf(path.join(cwd, 'publication')), 'endpoint.tools')).toBe('fail');
    expect(run.out).toMatch(message);
  });

  it('a tool the ChatGPT rules reject for a missing open-world hint is accepted by Claude, which does not ask for it', async () => {
    const app = claudeApp();
    const cwd = workspace();
    const run = await check(app, { cwd, wire: tools((tool) => delete tool.annotations.openWorldHint) });
    expect(run.code, run.out).toBe(0);
  });

  it('a served view that declares the ui.domain Claude computes passes, and one that declares another is a failure', async () => {
    const declared = (domain: string) =>
      editing('resources/read', (result) => {
        const content = result.contents[0];
        content._meta = { ...content._meta, ui: { ...content._meta?.ui, domain } };
      });
    const app = claudeApp();
    const right = await check(app, { wire: declared(claudeUiDomain(PUBLISHED)) });
    expect(right.code, right.out).toBe(0);
    expect(right.out).toMatch(/claude\.ui-domain: 1 served view declares the ui\.domain Claude computes for this URL/);

    const wrong = await check(app, { wire: declared(claudeUiDomain(`${PUBLISHED}/`)) });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toMatch(/FAIL\s+claude\.ui-domain/);
    expect(wrong.out).toContain(`Claude requires ${claudeUiDomain(PUBLISHED)} for ${PUBLISHED}`);

    // No declaration is fine: the field is optional.
    const none = await check(app);
    expect(none.out).toMatch(/claude\.ui-domain: No served view declares ui\.domain, which is optional/);
  });

  it('a deployment that serves another build than the release input names is a failure, as for ChatGPT', async () => {
    const stale = editing('resources/read', (result) => {
      result.contents[0].text = `${result.contents[0].text}<!-- other build -->`;
    });
    const run = await check(claudeApp(), { wire: stale });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+endpoint\.views/);
  });
});

describe('what cannot be concluded is never a pass', () => {
  it('an endpoint that cannot be reached leaves its tools unchecked: incomplete, with a dossier that names no tools', async () => {
    const down = { methods: [], fetch: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    const app = claudeApp();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, wire: down });

    expect(run.code).toBe(1);
    const out = path.join(cwd, 'publication');
    const record = recordOf(out);
    expect(record.verdict).toBe('incomplete');
    expect(status(record, 'endpoint.discovery')).toBe('unknown');
    expect(record.endpoint.deploymentIdentity.status).toBe('unknown');
    expect(dossierOf(out).tools).toEqual([]);
  });

  it('an undeclared deployment identity stays unknown', async () => {
    const app = claudeApp((_c, input) => delete input.endpoint.expectedServer);
    const run = await check(app);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/unknown\s+endpoint\.identity/);
  });

  it('--against names what changed, and refuses to compare with the other target\'s output', async () => {
    const app = claudeApp();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    expect((await check(app, { cwd }, ['--against', 'publication'])).code).toBe(0);

    editInput(app, (input) => (input.claude.connector.slug = 'notes-fixture-2'));
    const changed = await check(app, { cwd }, ['--against', 'publication']);
    expect(changed.code).toBe(1);
    expect(changed.out).toMatch(/the release input changed/);

    expect((await prepareChatgpt(app, 'chatgpt', { cwd })).code).toBe(0);
    const crossed = await check(app, { cwd }, ['--against', 'chatgpt']);
    expect(crossed.code).toBe(1);
    expect(crossed.out).toMatch(/the earlier output was prepared for chatgpt, not claude/);
  });

  it('--invoke-fixture still calls only the declared read-only tool, and discovery alone never calls one', async () => {
    const app = claudeApp();
    const seen = wire();
    expect((await check(app, { wire: seen })).code).toBe(0);
    expect(seen.methods).not.toContain('tools/call');

    const invoked = wire();
    const run = await check(app, { wire: invoked }, ['--invoke-fixture']);
    expect(run.code, run.out).toBe(0);
    expect(invoked.methods.filter((method) => method === 'tools/call')).toHaveLength(1);
    expect(run.out).toMatch(/fixture evidence, not a real-host observation/);
  });

  it('a credential given for discovery reaches neither the dossier nor the record nor the console', async () => {
    const credential = 'discovery-credential-0123456789';
    const app = claudeApp();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, environment: { SAGA_TOKEN: credential } }, ['--bearer-env', 'SAGA_TOKEN']);
    expect(run.code, run.out).toBe(0);
    expect(run.out + run.err).not.toContain(credential);
    for (const file of [DOSSIER, RECORD_FILE]) expect(fs.readFileSync(path.join(cwd, 'publication', file)).includes(credential), file).toBe(false);
  });
});

describe('the optional plugin bundle', () => {
  /** The files an application supplies as onboarding or skills scope: one skill, a README and a license. */
  function withBundle(app: string, extra: (skill: string) => void = () => undefined): string {
    const skill = path.join(app, 'skills', 'notes-status');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: notes-status\ndescription: Use when asked whether the notes service is running.\n---\n\nCall the status tool and report the result.\n');
    fs.writeFileSync(path.join(app, 'BUNDLE_README.md'), '# Notes Fixture plugin\n\nOne skill for the Notes Fixture connector.\n');
    fs.writeFileSync(path.join(app, 'BUNDLE_LICENSE'), 'Apache License 2.0 (fixture text)\n');
    extra(skill);
    editInput(app, (input) => {
      input.claude.pluginBundle = { repository: 'https://github.com/example/notes-fixture-plugin', skills: ['skills/notes-status'], readme: 'BUNDLE_README.md', license: 'BUNDLE_LICENSE' };
    });
    return app;
  }

  const validator = (result: PluginValidation, seen: string[][] = []): PluginValidator => async (files) => {
    seen.push(files.map((file) => file.path).sort());
    return result;
  };
  const accepted: PluginValidation = { kind: 'checked', identity: 'claude plugin validate, from a test validator', passed: true, report: '' };

  it('is not produced when the release input supplies no scope, and is produced from exactly the supplied scope when it does', async () => {
    const plain = await prepare(claudeApp(), 'plain', { cwd: workspace() });
    expect(plain.code).toBe(0);
    expect(plain.out).toMatch(/package\.plugin-bundle: No plugin bundle was requested, so none was produced/);

    const seen: string[][] = [];
    const cwd = workspace();
    const run = await prepare(withBundle(claudeApp()), 'publication', { cwd, pluginValidator: validator(accepted, seen) });
    expect(run.code, run.out).toBe(0);
    const out = path.join(cwd, 'publication');
    const record = recordOf(out);
    const paths = record.artifact!.files.map((file) => file.path).filter((one) => one.startsWith('plugin/'));
    expect(paths).toEqual(['plugin/.claude-plugin/plugin.json', 'plugin/.mcp.json', 'plugin/LICENSE', 'plugin/README.md', 'plugin/skills/notes-status/SKILL.md']);
    expect(seen).toEqual([paths]);
    expect(record.validators.map((one) => one.name)).toEqual(['claude-connector-requirements', 'claude-plugin-validate']);
    expect(record.handoff.map((item) => item.id)).toContain('plugin-bundle-submission');

    // The bundle points at the connector's own endpoint, so people who have both see one set of tools; no sidebar, hook, agent or command is invented.
    const entries = readZip(fs.readFileSync(path.join(out, DOSSIER)));
    const text = (name: string): string => Buffer.from(entries.find((entry) => entry.path === name)!.data).toString('utf8');
    expect(JSON.parse(text('plugin/.mcp.json'))).toEqual({ mcpServers: { 'notes-fixture': { type: 'http', url: PUBLISHED } } });
    expect(JSON.parse(text('plugin/.claude-plugin/plugin.json'))).toMatchObject({ name: 'notes-fixture', version: '1.0.0', author: { name: 'Notes Fixture Publisher' }, repository: 'https://github.com/example/notes-fixture-plugin', license: 'Apache-2.0' });
    expect(entries.some((entry) => /(^|\/)(hooks|agents|commands|bin)\//.test(entry.path))).toBe(false);
    expect(dossierOf(out).pluginBundle).toMatchObject({ included: true, directory: 'plugin', repository: 'https://github.com/example/notes-fixture-plugin' });
  });

  it('a validator that rejects the bundle blocks it, and one that is unavailable leaves it unknown', async () => {
    const rejected = await prepare(withBundle(claudeApp()), 'rejected', { cwd: workspace(), pluginValidator: validator({ kind: 'checked', identity: 'test', passed: false, report: 'plugin.json: name is not kebab-case' }) });
    expect(rejected.code).toBe(1);
    expect(rejected.out).toMatch(/FAIL\s+package\.plugin-bundle[\s\S]*plugin\.json: name is not kebab-case/);

    const cwd = workspace();
    const unavailable = await prepare(withBundle(claudeApp()), 'publication', { cwd, pluginValidator: validator({ kind: 'unavailable', problem: 'the claude command is not installed' }) });
    expect(unavailable.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(status(record, 'package.plugin-bundle')).toBe('unknown');
    expect(record.validators.find((one) => one.name === 'claude-plugin-validate')?.identity).toMatch(/^unavailable: the claude command is not installed/);
    // The connector's own checks are unaffected: the dossier is still written.
    expect(listing(path.join(cwd, 'publication'))).toEqual([DOSSIER, RECORD_FILE]);
  });

  it('scope that cannot be used is a finding: a skill without SKILL.md, a missing README, two skills with one name', async () => {
    const noSkillFile = withBundle(claudeApp(), (skill) => fs.rmSync(path.join(skill, 'SKILL.md')));
    const a = await prepare(noSkillFile, 'a', { cwd: workspace(), pluginValidator: validator(accepted) });
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/The skill skills\/notes-status has no SKILL\.md/);

    const noReadme = withBundle(claudeApp());
    fs.rmSync(path.join(noReadme, 'BUNDLE_README.md'));
    const b = await prepare(noReadme, 'b', { cwd: workspace(), pluginValidator: validator(accepted) });
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/The README BUNDLE_README\.md: It does not exist/);

    const twice = withBundle(claudeApp());
    fs.mkdirSync(path.join(twice, 'other', 'notes-status'), { recursive: true });
    fs.writeFileSync(path.join(twice, 'other', 'notes-status', 'SKILL.md'), '---\nname: notes-status\ndescription: Another.\n---\n');
    editInput(twice, (input) => input.claude.pluginBundle.skills.push('other/notes-status'));
    const c = await prepare(twice, 'c', { cwd: workspace(), pluginValidator: validator(accepted) });
    expect(c.code).toBe(1);
    expect(c.out).toMatch(/same directory name as skills\/notes-status/);
  });

  it('local Desktop or Code packaging carried in a skill cannot pass as web distribution', async () => {
    const cwd = workspace();
    const app = withBundle(claudeApp(), (skill) => {
      fs.writeFileSync(path.join(skill, 'notes.mcpb'), 'not a real bundle');
      fs.writeFileSync(path.join(skill, 'manifest.json'), '{"manifest_version":"0.2","name":"notes"}');
    });
    const run = await prepare(app, 'publication', { cwd, pluginValidator: validator(accepted) });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+package\.distribution[\s\S]*not claude\.ai web distribution/);
    expect(run.out).toMatch(/notes\.mcpb/);
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
  });

  it('an unexpected failure of the validator is reported redacted and prepares nothing', async () => {
    const token = 'sk-synthetic0123456789abcdefghij';
    const cwd = workspace();
    const failing: PluginValidator = async () => {
      throw new Error(`validator crashed near ${token}`);
    };
    const run = await prepare(withBundle(claudeApp()), 'publication', { cwd, pluginValidator: failing });
    expect(run.code).toBe(1);
    expect(run.out + run.err).not.toContain(token);
    expect(run.err).toContain('[redacted API key (sk-)]');
    expect(listing(cwd)).toEqual([]);
  });

  it('a link inside a skill is refused', async () => {
    const app = withBundle(claudeApp(), (skill) => fs.symlinkSync('/etc/hostname', path.join(skill, 'leak.txt')));
    const run = await prepare(app, 'publication', { cwd: workspace(), pluginValidator: validator(accepted) });
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/leak\.txt is a link/);
  });

  // The default validator is Claude Code's own; it runs where Claude Code is installed.
  const claudeInstalled = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
  it.skipIf(!claudeInstalled)('is accepted by the real `claude plugin validate`', async () => {
    const cwd = workspace();
    const run = await prepare(withBundle(claudeApp()), 'publication', { cwd });
    expect(run.code, run.out + run.err).toBe(0);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(status(record, 'package.plugin-bundle')).toBe('pass');
    expect(record.validators.find((one) => one.name === 'claude-plugin-validate')?.identity).toMatch(/^claude plugin validate, from Claude Code /);
  });
});

describe('the command line', () => {
  it('names the Claude target in its usage', async () => {
    const run = await saga(['--help']);
    expect(run.out).toMatch(/--target <chatgpt\|claude>/);
    expect(run.out).toMatch(/Claude connector dossier/);
  });

  it('asks for the target when it is missing', async () => {
    const run = await saga(['publish', 'check', '--release', 'saga-publication.json']);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/--target is required \(chatgpt or claude\)/);
  });
});
