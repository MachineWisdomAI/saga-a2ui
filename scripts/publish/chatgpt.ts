import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { readApplicationFile } from './application-files.js';
import { iconProblem } from './images.js';
import type {
  ChatgptReleaseInput,
  LoadedReleaseInput,
  ReleaseInput,
} from './release-input.js';
import {
  ARCHIVE_FILES,
  sha256,
  fail,
  pass,
  unknown,
  type Finding,
  type HandoffItem,
} from './record.js';
import { secretFinding, textEntries } from './secrets.js';
import type { EndpointSnapshot } from './endpoint.js';
import type { PublicationTarget } from './target.js';
import { endpointUrlProblem, publishedUrlProblem } from './urls.js';
import { readZip, writeZip, ZipError, type ZipEntry } from './zip.js';

// The ChatGPT target of publication (CLI3 #66): what goes into the plugin ZIP and the rules the ZIP
// is checked against. The format is the Agent Plugins 1.0.0 portable package that OpenAI documents
// for the plugin directory: root `plugin.json` and `mcp.json` (official schemas, validated here
// with the MCP SDK's JSON Schema validator), assets, and OpenAI's listing, review and publication
// fields under `extensions["com.openai"]`. Rules were checked against OpenAI's documentation on
// DOCUMENTATION_DATE:
//   https://developers.openai.com/plugins/build/plugins
//   https://developers.openai.com/plugins/deploy/submission
//   https://developers.openai.com/plugins/deploy/app-review
//   https://developers.openai.com/plugins/plugin-guidelines
//
// Recorded decisions:
// - OpenAI's guide shows an `extensions["com.openai"].auth` object inside an `mcp.json` server, but
//   the official 1.0.0 schema (closed server variants, "defines no OAuth configuration") rejects
//   it. The package follows the schema and declares no authentication; the publisher configures
//   authentication in the submission portal's connection form.
// - Only a skills-free, hook-free, `.app.json`-free package is produced: the portal cannot accept
//   app references or lifecycle hooks.

export const DOCUMENTATION_DATE = '2026-10-20';
export const PLUGIN_SCHEMA_ID =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA_ID =
  'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

const SCHEMA_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'schemas',
  'agent-plugins-1.0.0',
);
/** The official files as copied; a changed or missing copy makes the validator unavailable (scripts/publish/schemas/agent-plugins-1.0.0/README.md). */
const PINNED_SCHEMAS = {
  'plugin.schema.json':
    '0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883',
  'mcp.schema.json':
    '6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb',
} as const;

/** A validator of the two manifests. It reports the first problems it finds, or `null` when the value conforms. */
export interface ManifestValidators {
  readonly identity: string;
  validatePlugin(value: unknown): string | null;
  validateMcp(value: unknown): string | null;
}

export type ValidatorLoad =
  | { readonly ok: true; readonly validators: ManifestValidators }
  | { readonly ok: false; readonly problem: string };

function validatorLibraryVersion(): string {
  try {
    let directory = path.dirname(
      fileURLToPath(import.meta.resolve('@modelcontextprotocol/client')),
    );
    for (
      let depth = 0;
      depth < 4;
      depth += 1, directory = path.dirname(directory)
    ) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest))
        return (
          (
            JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
              version?: string;
            }
          ).version ?? 'unknown version'
        );
    }
  } catch {
    // fall through
  }
  return 'unknown version';
}

/** The official Agent Plugins 1.0.0 schemas, verified against their pinned digests, behind the MCP SDK's Ajv validator. */
export function loadOfficialValidators(
  directory: string = SCHEMA_DIRECTORY,
): ValidatorLoad {
  const schemas: Record<string, object> = {};
  for (const [file, expected] of Object.entries(PINNED_SCHEMAS)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(directory, file), 'utf8');
    } catch {
      return {
        ok: false,
        problem: `The official schema ${file} is missing from ${directory}.`,
      };
    }
    if (sha256(text) !== expected)
      return {
        ok: false,
        problem: `${file} differs from the pinned Agent Plugins 1.0.0 schema (sha256 ${expected}); it was not used.`,
      };
    schemas[file] = JSON.parse(text) as object;
  }
  try {
    const ajv = new AjvJsonSchemaValidator();
    const plugin = ajv.getValidator(schemas['plugin.schema.json'] as object);
    const mcp = ajv.getValidator(schemas['mcp.schema.json'] as object);
    const check =
      (validate: typeof plugin) =>
      (value: unknown): string | null => {
        const result = validate(value);
        return result.valid ? null : result.errorMessage;
      };
    return {
      ok: true,
      validators: {
        identity: `Agent Plugins 1.0.0 plugin.schema.json sha256:${PINNED_SCHEMAS['plugin.schema.json']} and mcp.schema.json sha256:${PINNED_SCHEMAS['mcp.schema.json']}, validated by @modelcontextprotocol/client ${validatorLibraryVersion()} (Ajv)`,
        validatePlugin: check(plugin),
        validateMcp: check(mcp),
      },
    };
  } catch (error) {
    return {
      ok: false,
      problem: `The JSON Schema validator could not be set up: ${(error as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Building the package
// ---------------------------------------------------------------------------------------------

const json = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

/** The package-relative path an asset is stored at: `assets/<file name>`. */
const assetEntryPath = (source: string): string =>
  `assets/${path.basename(source)}`;

export interface AssembledPackage {
  readonly entries: readonly ZipEntry[];
  /** Assets named in the input that could not be read, with the reason. */
  readonly unreadableAssets: readonly {
    readonly source: string;
    readonly reason: string;
  }[];
}

/** The files of the ChatGPT plugin ZIP for a release input. Nothing is validated here; `checkArchive` checks what was built. */
export function assemblePackage(
  input: ChatgptReleaseInput,
  directory: string,
): AssembledPackage {
  const { listing } = input;
  const assetFields = {
    logo: input.assets.logo,
    composerIcon: input.assets.composerIcon,
    logoDark: input.assets.logoDark,
    composerIconDark: input.assets.composerIconDark,
  };
  const entries: ZipEntry[] = [];
  const unreadableAssets: { source: string; reason: string }[] = [];
  const stored = new Map<string, string>();
  for (const source of new Set(
    Object.values(assetFields).filter(
      (value): value is string => value !== undefined,
    ),
  )) {
    const entryPath = assetEntryPath(source);
    const earlier = stored.get(entryPath);
    if (earlier !== undefined) {
      unreadableAssets.push({
        source,
        reason: `It has the same file name as ${earlier}; asset file names must be distinct.`,
      });
      continue;
    }
    stored.set(entryPath, source);
    // An asset is copied into a package that is published, so it must come from the application's own directory.
    const read = readApplicationFile(directory, source);
    if (read.ok) entries.push({ path: entryPath, data: read.data });
    else unreadableAssets.push({ source, reason: read.reason });
  }
  const reference = (source: string | undefined): string | undefined =>
    source === undefined ? undefined : `./${assetEntryPath(source)}`;
  const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
    Object.fromEntries(
      Object.entries(value).filter(([, inner]) => inner !== undefined),
    ) as T;

  const plugin = withoutUndefined({
    $schema: PLUGIN_SCHEMA_ID,
    name: input.name,
    version: input.version,
    description: input.description,
    author: withoutUndefined({
      name: input.publisher.name,
      email: input.publisher.email,
      url: input.publisher.url,
    }),
    homepage: input.homepage,
    repository: input.repository,
    license: input.license,
    keywords: input.keywords,
    extensions: {
      'com.openai': withoutUndefined({
        interface: withoutUndefined({
          displayName: listing.displayName,
          shortDescription: listing.shortDescription,
          longDescription: listing.longDescription,
          developerName: input.publisher.name,
          category: listing.category,
          capabilities: listing.capabilities,
          websiteURL: listing.websiteURL,
          supportURL: listing.supportURL,
          privacyPolicyURL: listing.privacyPolicyURL,
          termsOfServiceURL: listing.termsOfServiceURL,
          defaultPrompt: listing.defaultPrompt,
          brandColor: listing.brandColor,
          brandColorDark: listing.brandColorDark,
          composerIcon: reference(assetFields.composerIcon),
          composerIconDark: reference(assetFields.composerIconDark),
          logo: reference(assetFields.logo),
          logoDark: reference(assetFields.logoDark),
        }),
        review: input.review,
        publication: input.publication,
      }),
    },
  });
  const mcp = {
    $schema: MCP_SCHEMA_ID,
    mcpServers: {
      [input.name]: { type: 'streamable-http', url: input.endpoint.url },
    },
  };
  entries.push(
    { path: 'plugin.json', data: json(plugin) },
    { path: 'mcp.json', data: json(mcp) },
  );
  return { entries, unreadableAssets };
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function relativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

function textProblem(
  label: string,
  value: unknown,
  max: number,
  required = true,
): string | null {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || value.trim() === '')
    return `${label} is required.`;
  return value.length > max
    ? `${label} is ${value.length} characters; the limit is ${max}.`
    : null;
}

/** The listing and manifest rules of OpenAI's submission documentation, applied to the generated `plugin.json`. */
export function listingProblems(plugin: Record<string, unknown>): string[] {
  const problems: (string | null)[] = [];
  const name = plugin.name;
  if (typeof name !== 'string' || name.length > 64 || !PACKAGE_NAME.test(name))
    problems.push(
      'name must be at most 64 characters of lowercase letters, digits and single hyphens.',
    );
  problems.push(
    typeof plugin.version === 'string' && SEMVER.test(plugin.version)
      ? null
      : 'version must be an explicit semantic version such as 1.0.0.',
  );
  problems.push(textProblem('description', plugin.description, 4000));
  const author = plugin.author;
  if (!isRecord(author)) problems.push('author is required.');
  else {
    problems.push(textProblem('author.name', author.name, 120));
    problems.push(textProblem('author.email', author.email, 320, false));
    if (author.url !== undefined)
      problems.push(publishedUrlProblem('author.url', author.url, 2048));
  }
  if (plugin.homepage !== undefined)
    problems.push(publishedUrlProblem('homepage', plugin.homepage, 2048));

  const openai = isRecord(plugin.extensions)
    ? plugin.extensions['com.openai']
    : undefined;
  const listing = isRecord(openai) ? openai.interface : undefined;
  if (!isRecord(listing)) {
    problems.push('extensions["com.openai"].interface is required.');
    return problems.filter((problem): problem is string => problem !== null);
  }
  problems.push(textProblem('interface.displayName', listing.displayName, 30));
  problems.push(
    textProblem('interface.shortDescription', listing.shortDescription, 30),
  );
  problems.push(
    textProblem('interface.longDescription', listing.longDescription, 4000),
  );
  problems.push(
    textProblem('interface.developerName', listing.developerName, 80),
  );
  problems.push(textProblem('interface.category', listing.category, 200));
  for (const field of [
    'websiteURL',
    'supportURL',
    'privacyPolicyURL',
    'termsOfServiceURL',
  ])
    problems.push(
      publishedUrlProblem(`interface.${field}`, listing[field], 1024),
    );
  if (listing.capabilities !== undefined) {
    const capabilities = listing.capabilities;
    if (
      !Array.isArray(capabilities) ||
      capabilities.length > 20 ||
      capabilities.some((one) => typeof one !== 'string' || one.length > 120)
    )
      problems.push(
        'interface.capabilities must be at most 20 labels of at most 120 characters.',
      );
  }
  if (listing.defaultPrompt !== undefined) {
    const prompts = listing.defaultPrompt;
    if (
      !Array.isArray(prompts) ||
      prompts.length > 3 ||
      prompts.some(
        (one) =>
          typeof one !== 'string' || one.length > 128 || one.trim() === '',
      )
    )
      problems.push(
        'interface.defaultPrompt must be at most 3 prompts of at most 128 characters.',
      );
    else {
      if (new Set(prompts).size !== prompts.length)
        problems.push('interface.defaultPrompt entries must be unique.');
      if (prompts.some((one) => /(^|\s)@\w/.test(one as string)))
        problems.push('interface.defaultPrompt must not contain an @mention.');
    }
  }
  if (listing.brandColor !== undefined) {
    if (
      typeof listing.brandColor !== 'string' ||
      !COLOR.test(listing.brandColor)
    )
      problems.push('interface.brandColor must be #RRGGBB.');
    else if (contrast(listing.brandColor, '#FFFFFF') < 2)
      problems.push(
        'interface.brandColor needs at least 2:1 contrast against white.',
      );
  }
  if (listing.brandColorDark !== undefined) {
    if (
      typeof listing.brandColorDark !== 'string' ||
      !COLOR.test(listing.brandColorDark)
    )
      problems.push('interface.brandColorDark must be #RRGGBB.');
    else if (contrast(listing.brandColorDark, '#212121') < 2)
      problems.push(
        'interface.brandColorDark needs at least 2:1 contrast against #212121.',
      );
  }
  return problems.filter((problem): problem is string => problem !== null);
}

// ---------------------------------------------------------------------------------------------
// Checking the built archive
// ---------------------------------------------------------------------------------------------

export interface ArchiveCheck {
  readonly findings: readonly Finding[];
  readonly entries: readonly ZipEntry[];
  /** The generated `plugin.json`, read back out of the archive, when it could be parsed. */
  readonly plugin: Record<string, unknown> | undefined;
}

export interface ArchiveCheckOptions {
  readonly validators: ValidatorLoad;
  /** The endpoint URL the package must declare. */
  readonly endpointUrl: string;
  /** Literal values that must not appear anywhere in the archive, such as a credential used for discovery. */
  readonly forbiddenLiterals: readonly string[];
}

function parseJsonEntry(
  entries: readonly ZipEntry[],
  name: string,
): { value?: unknown; problem?: string } {
  const entry = entries.find((one) => one.path === name);
  if (entry === undefined)
    return { problem: `${name} is missing from the archive.` };
  try {
    return { value: JSON.parse(Buffer.from(entry.data).toString('utf8')) };
  } catch {
    return { problem: `${name} is not valid JSON.` };
  }
}

/** Checks the bytes that would be uploaded, not the files they were assembled from. */
export function checkArchive(
  archive: Uint8Array,
  options: ArchiveCheckOptions,
): ArchiveCheck {
  let entries: ZipEntry[];
  try {
    entries = readZip(archive);
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    return {
      findings: [
        fail(
          'package.archive',
          'The package is not a usable ZIP archive.',
          'Regenerate the package.',
          error.message,
        ),
      ],
      entries: [],
      plugin: undefined,
    };
  }
  const findings: Finding[] = [
    pass(
      'package.archive',
      `The package is a well-formed ZIP archive of ${entries.length} files.`,
    ),
  ];

  const pluginJson = parseJsonEntry(entries, 'plugin.json');
  const mcpJson = parseJsonEntry(entries, 'mcp.json');
  const plugin =
    pluginJson.problem === undefined && isRecord(pluginJson.value)
      ? pluginJson.value
      : undefined;

  // Official schemas. An unavailable validator is unknown, never a pass.
  if (!options.validators.ok) {
    const repair =
      'Restore scripts/publish/schemas/agent-plugins-1.0.0 from the repository and rerun.';
    findings.push(
      unknown(
        'package.manifest',
        'plugin.json was not validated: the official validator is unavailable.',
        repair,
        options.validators.problem,
      ),
    );
    findings.push(
      unknown(
        'package.mcp-config',
        'mcp.json was not validated: the official validator is unavailable.',
        repair,
        options.validators.problem,
      ),
    );
  } else {
    const { validators } = options.validators;
    const manifestProblem =
      pluginJson.problem ?? validators.validatePlugin(pluginJson.value);
    findings.push(
      manifestProblem === null
        ? pass(
            'package.manifest',
            'plugin.json conforms to the Agent Plugins 1.0.0 schema.',
          )
        : fail(
            'package.manifest',
            'plugin.json does not conform to the Agent Plugins 1.0.0 schema.',
            'Correct the release input fields it names.',
            manifestProblem,
          ),
    );
    const mcpProblem = mcpJson.problem ?? validators.validateMcp(mcpJson.value);
    findings.push(
      mcpProblem === null
        ? pass(
            'package.mcp-config',
            'mcp.json conforms to the Agent Plugins 1.0.0 schema.',
          )
        : fail(
            'package.mcp-config',
            'mcp.json does not conform to the Agent Plugins 1.0.0 schema.',
            'Correct the endpoint in the release input.',
            mcpProblem,
          ),
    );
  }

  // ChatGPT's own rules for the MCP server entry.
  const servers =
    isRecord(mcpJson.value) && isRecord(mcpJson.value.mcpServers)
      ? Object.values(mcpJson.value.mcpServers)
      : [];
  const mcpRuleProblems: string[] = [];
  if (servers.length !== 1)
    mcpRuleProblems.push(
      `The package must declare exactly one MCP server; it declares ${servers.length}.`,
    );
  for (const server of servers) {
    if (!isRecord(server)) continue;
    if (server.type !== 'streamable-http')
      mcpRuleProblems.push(
        'The server must use the streamable-http transport.',
      );
    if (server.url !== options.endpointUrl)
      mcpRuleProblems.push(
        'The server URL differs from the endpoint in the release input.',
      );
    if (isRecord(server.headers) && Object.keys(server.headers).length > 0)
      mcpRuleProblems.push(
        'Public submission rejects server headers; they would also publish whatever they carry.',
      );
  }
  findings.push(
    mcpRuleProblems.length === 0
      ? pass(
          'package.mcp-server',
          'The package declares one streamable-http server at the release input endpoint, with no headers.',
        )
      : fail(
          'package.mcp-server',
          'The MCP server entry breaks a ChatGPT submission rule.',
          'Correct endpoint.url in the release input.',
          mcpRuleProblems.join(' '),
        ),
  );

  // Listing text and limits.
  const listing =
    plugin === undefined
      ? ['plugin.json could not be read.']
      : listingProblems(plugin);
  findings.push(
    listing.length === 0
      ? pass(
          'package.listing',
          'The listing text, links and branding meet the submission limits.',
        )
      : fail(
          'package.listing',
          `The listing has ${listing.length} problem${listing.length === 1 ? '' : 's'}.`,
          'Correct the listed fields in the release input.',
          listing.join(' '),
        ),
  );

  // Assets referenced by the manifest.
  const openai =
    plugin !== undefined && isRecord(plugin.extensions)
      ? plugin.extensions['com.openai']
      : undefined;
  const face =
    isRecord(openai) && isRecord(openai.interface) ? openai.interface : {};
  const referenced = [
    'logo',
    'composerIcon',
    'logoDark',
    'composerIconDark',
  ].flatMap((field) =>
    face[field] === undefined ? [] : [{ field, value: face[field] }],
  );
  const assetProblems: string[] = [];
  const assetUnverified: string[] = [];
  for (const required of ['logo', 'composerIcon'])
    if (face[required] === undefined)
      assetProblems.push(`interface.${required} is required.`);
  for (const { field, value } of referenced) {
    if (typeof value !== 'string' || !/^\.\/assets\/[^/]+$/.test(value)) {
      assetProblems.push(`interface.${field} must be a ./assets/ path.`);
      continue;
    }
    const entry = entries.find((one) => one.path === value.slice(2));
    if (entry === undefined)
      assetProblems.push(
        `interface.${field} points to ${value}, which is not in the package.`,
      );
    else {
      const problem = iconProblem(entry.path, entry.data);
      if (typeof problem === 'string') assetProblems.push(problem);
      else if (problem !== null) assetUnverified.push(problem.unverified);
    }
  }
  findings.push(
    assetProblems.length === 0 && assetUnverified.length > 0
      ? unknown(
          'package.assets',
          'An icon could not be verified as a valid image.',
          "Run this command where the repository's development dependencies are installed (npm ci), then rerun.",
          assetUnverified.join(' '),
        )
      : assetProblems.length === 0
        ? pass(
            'package.assets',
            'The logo and composer icon are present, square, valid and within the size limits.',
          )
        : fail(
            'package.assets',
            `The assets have ${assetProblems.length} problem${assetProblems.length === 1 ? '' : 's'}.`,
            'Add or correct the asset files named in the release input.',
            assetProblems.join(' '),
          ),
  );

  // Components the portal cannot accept, and fields it rejects.
  const excluded: string[] = [];
  if (
    entries.some(
      (one) => one.path === '.app.json' || one.path.startsWith('hooks/'),
    )
  )
    excluded.push('The package contains an app reference or lifecycle hooks.');
  if (
    isRecord(openai) &&
    (openai.apps !== undefined || openai.hooks !== undefined)
  )
    excluded.push('extensions["com.openai"] declares apps or hooks.');
  for (const { path: file, text } of textEntries(entries))
    if (/"(?:test_credentials|reviewer_instructions)"/.test(text))
      excluded.push(
        `${file} carries reviewer credentials or instructions, which the portal rejects and which never belong in a package.`,
      );
  findings.push(
    excluded.length === 0
      ? pass(
          'package.components',
          'The package has no app references, hooks or reviewer credentials.',
        )
      : fail(
          'package.components',
          'The package contains something the portal rejects.',
          'Remove it from the release input.',
          excluded.join(' '),
        ),
  );

  // Secrets: patterns that look like credentials, and literal values this run was given.
  findings.push(secretFinding(entries, options.forbiddenLiterals));

  return { findings, entries, plugin };
}

// ---------------------------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------------------------

/** The release input as the ChatGPT target uses it, or `undefined` when it carries no listing or assets. */
function chatgptInput(input: ReleaseInput): ChatgptReleaseInput | undefined {
  return input.listing === undefined || input.assets === undefined
    ? undefined
    : { ...input, listing: input.listing, assets: input.assets };
}

function toolFindings(snapshot: EndpointSnapshot): Finding[] {
  if (snapshot.tools.length === 0 && snapshot.truncated.length === 0)
    return [
      fail(
        'endpoint.tools',
        'The endpoint advertises no tools.',
        'Deploy the application so its tools are listed.',
      ),
    ];
  const problems: string[] = [];
  for (const tool of snapshot.tools) {
    if (typeof tool.description !== 'string' || tool.description.trim() === '')
      problems.push(`${tool.name} has no description.`);
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    const missing = ['readOnlyHint', 'destructiveHint', 'openWorldHint'].filter(
      (hint) => typeof annotations[hint] !== 'boolean',
    );
    if (missing.length > 0)
      problems.push(
        `${tool.name} does not set ${missing.join(', ')} to true or false.`,
      );
  }
  return [
    problems.length === 0 && snapshot.truncated.length > 0
      ? unknown(
          'endpoint.tools',
          'Only part of the endpoint was read, so its tool definitions were not fully checked.',
          "Reduce the endpoint's paging so every tool fits the bounds this tool reads, then rerun.",
          'The tools that were read are described and annotated; the ones that were not read cannot be certified.',
        )
      : problems.length === 0
        ? pass(
            'endpoint.tools',
            `${snapshot.tools.length} tool${snapshot.tools.length === 1 ? '' : 's'} advertised, each with a description and explicit read-only, destructive and open-world annotations.`,
          )
        : fail(
            'endpoint.tools',
            'A tool definition breaks the plugin guidelines.',
            'Describe every tool and set its three annotation hints explicitly.',
            problems.join(' '),
          ),
  ];
}

function handoff(loaded: LoadedReleaseInput): HandoffItem[] {
  const items: HandoffItem[] = [
    {
      id: 'publisher-authority',
      summary: `Confirm that ${loaded.input.publisher.name} is the intended listing owner and that the submitting OpenAI organization has completed individual or business verification under that name.`,
    },
    {
      id: 'domain-verification',
      summary:
        'In the submission portal, host the challenge token at /.well-known/openai-apps-challenge on the endpoint host and connect the server.',
    },
    {
      id: 'authentication',
      summary:
        'If the endpoint needs sign-in, configure its authentication in the portal connection form and provide a reviewer test account there; credentials never belong in the package.',
    },
  ];
  const cases = loaded.input.review?.test_cases;
  const positive = cases?.positive?.length ?? 0;
  const negative = cases?.negative?.length ?? 0;
  if (positive !== 5 || negative !== 3)
    items.push({
      id: 'review-test-cases',
      summary: `Initial review needs exactly five positive and three negative test cases; the release input has ${positive} and ${negative}.`,
    });
  if (loaded.input.review?.demo_recording_url === undefined)
    items.push({
      id: 'review-demo-recording',
      summary:
        'Initial review needs a reviewer-accessible video walkthrough URL (review.demo_recording_url).',
    });
  items.push({
    id: 'host-observation',
    summary:
      "Installation, card rendering and interactions in actual ChatGPT web runs are observed separately; this tool's checks, fixture invocations and directory approval do not replace them.",
  });
  return items;
}

/** The ChatGPT target. `validators` is the manifest validator to use; the default is the pinned official one, and a test supplies an unavailable one. */
export function chatgptTarget(
  validators: ValidatorLoad | undefined,
): PublicationTarget {
  return {
    name: 'chatgpt',
    archiveFile: ARCHIVE_FILES.chatgpt,
    submissionNote:
      "Preparing a package submits nothing. Submission, the host's review and publication are separate acts that only the publisher and the host can perform.",
    inputProblem: (input) =>
      chatgptInput(input) === undefined
        ? 'The release input has no listing and assets, which the chatgpt target needs.'
        : null,
    endpointProblem: (url) => endpointUrlProblem(url, 'ChatGPT'),
    toolFindings,
    async prepare(context) {
      const input = chatgptInput(context.loaded.input);
      if (input === undefined)
        throw new Error(
          'The release input has no listing and assets, which the chatgpt target needs.',
        );
      const findings: Finding[] = [];
      const assembled = assemblePackage(input, context.loaded.directory);
      if (assembled.unreadableAssets.length > 0) {
        findings.push(
          fail(
            'package.asset-files',
            'An asset file cannot be added to the package.',
            'Add or correct the files named in assets in the release input.',
            assembled.unreadableAssets
              .map((one) => `${one.source}: ${one.reason}`)
              .join(' '),
          ),
        );
      }
      const archive = writeZip(assembled.entries);
      const loadedValidators = validators ?? loadOfficialValidators();
      const check = checkArchive(archive, {
        validators: loadedValidators,
        endpointUrl: input.endpoint.url,
        forbiddenLiterals: context.forbiddenLiterals,
      });
      return {
        archive,
        entries: check.entries,
        findings: [...findings, ...check.findings],
        validators: [
          {
            name: 'chatgpt-plugin-package',
            identity: loadedValidators.ok
              ? loadedValidators.validators.identity
              : `unavailable: ${loadedValidators.problem}`,
            documentationDate: DOCUMENTATION_DATE,
          },
        ],
      };
    },
    handoff,
  };
}
