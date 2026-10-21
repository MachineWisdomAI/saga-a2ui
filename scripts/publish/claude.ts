import path from 'node:path';
import { readApplicationFile } from './application-files.js';
import {
  assembleBundle,
  bundlePathProblems,
  BUNDLE_DIRECTORY,
  claudePluginValidate,
  type PluginValidator,
} from './claude-plugin.js';
import type { AdvertisedTool, EndpointSnapshot } from './endpoint.js';
import { iconProblem, pngSize, screenshotProblem } from './images.js';
import {
  ARCHIVE_FILES,
  fail,
  pass,
  sha256,
  unknown,
  type Finding,
  type HandoffItem,
} from './record.js';
import type {
  ClaudeConnectorInput,
  LoadedReleaseInput,
} from './release-input.js';
import { secretFinding } from './secrets.js';
import type {
  Evidence,
  PublicationTarget,
  TargetContext,
  ValidatorIdentity,
} from './target.js';
import { endpointUrlProblem, publishedUrlProblem } from './urls.js';
import { readZip, writeZip, ZipError, type ZipEntry } from './zip.js';

// The Claude target of publication (CLI4 #67): the materials for submitting the application's remote
// MCP server, with its MCP App, to Claude's directory as an MCP connector, prepared against the same
// release input, endpoint reading and evidence record as the ChatGPT target.
//
// What is produced is a dossier: `connector-dossier.json` (the portal's submission fields in the
// portal's order, with the exact endpoint, tool and resource identities the record holds),
// `SUBMISSION.md` (the same, as steps to follow), the icon and the carousel screenshots. The
// directory takes a connector by its server URL, so there is no connector package to build. A plugin
// bundle is added only when the release input supplies its scope (`claude-plugin.ts`).
//
// What this does not claim. The connector is submitted in the developer portal by its owner, and
// Anthropic reviews and lists it; a dossier is none of that. Local packaging is a different path:
// Claude Desktop extensions (.mcpb) are no longer accepted by the directory and Claude Code
// installation is not claude.ai web distribution, so neither is produced and neither is accepted
// inside the dossier. There is no offline validator for a connector submission: the portal's Tools
// step and its automated policy scan are the check of record, and the record says so.
//
// Rules were checked against Anthropic's documentation on DOCUMENTATION_DATE:
//   https://claude.com/docs/directory/publish
//   https://claude.com/docs/connectors/building/submission
//   https://claude.com/docs/connectors/building/review-criteria
//   https://claude.com/docs/connectors/building/authentication
//   https://claude.com/docs/connectors/building/mcp-apps/getting-started   (ui.domain)
//   https://claude.com/docs/plugins/platform-support
//   https://claude.com/docs/plugins/submit

export const DOCUMENTATION_DATE = '2026-10-20';
export const DOSSIER_FILE = 'connector-dossier.json';
export const GUIDE_FILE = 'SUBMISSION.md';
export const DOSSIER_FORMAT = 'saga-claude-connector-dossier/1';

const DISTRIBUTION_BASIS =
  'This dossier prepares a remote MCP connector for submission to the Claude directory. Nothing was submitted, and a listing exists only after Anthropic reviews and publishes it. ' +
  'Local packaging is a different path and does not establish claude.ai web distribution: Claude Desktop extensions (.mcpb) are no longer accepted by the directory, and Claude Code installation is not the web directory. None is produced.';

const COMPLIANCE_TOPICS = [
  'the directory guidelines',
  'first-party API usage',
  'financial transactions',
  'AI media generation',
  'prompt injection',
  'conversation data collection',
  'public documentation',
] as const;

const AUTH_MODES_NEEDING_ANTHROPIC = new Set([
  'oauth_anthropic_creds',
  'custom_connection',
]);

const MAX_NAME = 100;
const MAX_ONE_LINER = 200;
const MAX_DESCRIPTION = 2000;
const MAX_TOOL_NAME = 64;
const MIN_SCREENSHOTS = 3;
const MAX_SCREENSHOTS = 5;

/** The sandbox origin Claude expects in `_meta.ui.domain`: the first 32 hex characters of the SHA-256 of the exact connector URL. */
export function claudeUiDomain(connectorUrl: string): string {
  return `${sha256(connectorUrl).slice(0, 32)}.claudemcpcontent.com`;
}

// ---------------------------------------------------------------------------------------------
// The dossier
// ---------------------------------------------------------------------------------------------

interface DossierTool {
  readonly name: string;
  readonly title: string | null;
  readonly access: 'read-only' | 'write';
  readonly sha256: string;
}

interface DossierFile {
  readonly file: string;
  readonly sha256: string;
}

export interface ConnectorDossier {
  readonly format: typeof DOSSIER_FORMAT;
  readonly distribution: {
    readonly surface: 'claude-directory-mcp-connector';
    readonly webDistribution: 'not-established';
    readonly basis: string;
    readonly notProduced: readonly string[];
  };
  readonly connection: {
    readonly url: string;
    readonly urlScope: 'universal';
    readonly uiDomain: { readonly expected: string; readonly note: string };
  };
  readonly tools: readonly DossierTool[];
  readonly listing: {
    readonly name?: string;
    readonly oneLiner?: string;
    readonly description?: string;
    readonly categories?: readonly string[];
    readonly slug?: string;
    readonly documentationURL?: string;
    readonly privacyPolicyURL?: string;
    readonly support?: { readonly email?: string; readonly url?: string };
    readonly icon?: DossierFile;
    readonly screenshots: readonly (DossierFile & {
      readonly prompt: string;
      readonly width: number | null;
      readonly height: number | null;
    })[];
  };
  readonly useCases: NonNullable<ClaudeConnectorInput['useCases']> | null;
  readonly company: {
    readonly name: string;
    readonly website: string | null;
    readonly contact: NonNullable<ClaudeConnectorInput['reviewContact']> | null;
    readonly contributors: readonly {
      readonly name: string;
      readonly url: string | null;
    }[];
  };
  readonly authentication: NonNullable<
    ClaudeConnectorInput['authentication']
  > | null;
  readonly dataHandling: NonNullable<
    ClaudeConnectorInput['dataHandling']
  > | null;
  readonly allowedLinkUris: readonly string[] | null;
  readonly testAndLaunch: {
    readonly reviewerAccount: string;
    readonly toolRun: string;
  };
  readonly compliance: {
    readonly acknowledgedBy: string;
    readonly topics: readonly string[];
  };
  readonly pluginBundle: {
    readonly included: boolean;
    readonly directory: string | null;
    readonly repository: string | null;
    readonly note: string;
  };
  readonly evidence: {
    readonly source: Evidence['source'];
    readonly releaseInputSha256: string;
    readonly sagaPackages: Evidence['sagaPackages'];
    readonly views: Evidence['views'];
    readonly server: Evidence['endpoint']['server'];
    readonly deploymentIdentity: Evidence['endpoint']['deploymentIdentity'];
    readonly contractSha256: string | null;
    readonly instructionsSha256: string | null;
    readonly resources: Evidence['endpoint']['resources'];
  };
}

const titleOf = (tool: AdvertisedTool): string | null => {
  const annotations = isRecord(tool.annotations) ? tool.annotations : {};
  const title =
    typeof tool.title === 'string' && tool.title.trim() !== ''
      ? tool.title
      : annotations.title;
  return typeof title === 'string' && title.trim() !== '' ? title : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const accessOf = (tool: AdvertisedTool): 'read-only' | 'write' =>
  isRecord(tool.annotations) && tool.annotations.readOnlyHint === true
    ? 'read-only'
    : 'write';

interface Assembled {
  readonly entries: ZipEntry[];
  /** Files named in the release input that cannot be added, with the reason. */
  readonly unreadable: readonly {
    readonly source: string;
    readonly reason: string;
  }[];
  readonly bundleProblems: readonly string[];
}

function assemble(context: TargetContext): Assembled {
  const { loaded, evidence } = context;
  const { input } = loaded;
  const connector: ClaudeConnectorInput = input.claude?.connector ?? {};
  const entries: ZipEntry[] = [];
  const unreadable: { source: string; reason: string }[] = [];

  let icon: DossierFile | undefined;
  if (connector.icon !== undefined) {
    const read = readApplicationFile(loaded.directory, connector.icon);
    if (read.ok) {
      const file = `assets/icon${path.extname(connector.icon).toLowerCase()}`;
      entries.push({ path: file, data: read.data });
      icon = { file, sha256: sha256(read.data) };
    } else unreadable.push({ source: connector.icon, reason: read.reason });
  }

  const screenshots: ConnectorDossier['listing']['screenshots'][number][] = [];
  (connector.screenshots ?? []).forEach((shot, index) => {
    if (path.extname(shot.file).toLowerCase() !== '.png') {
      unreadable.push({
        source: shot.file,
        reason:
          'A screenshot must be a PNG file; video and GIF are not accepted.',
      });
      return;
    }
    const read = readApplicationFile(loaded.directory, shot.file);
    if (!read.ok) {
      unreadable.push({ source: shot.file, reason: read.reason });
      return;
    }
    const file = `screenshots/${String(index + 1).padStart(2, '0')}.png`;
    entries.push({ path: file, data: read.data });
    const size = pngSize(read.data);
    screenshots.push({
      file,
      sha256: sha256(read.data),
      prompt: shot.prompt,
      width: size?.width ?? null,
      height: size?.height ?? null,
    });
  });

  const snapshot = evidence.snapshot;
  const tools: DossierTool[] = (snapshot?.tools ?? [])
    .map((tool) => ({
      name: tool.name,
      title: titleOf(tool),
      access: accessOf(tool),
      sha256:
        evidence.endpoint.tools.find((one) => one.name === tool.name)?.sha256 ??
        '',
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  const bundleInput = input.claude?.pluginBundle;
  const bundle =
    bundleInput === undefined
      ? undefined
      : assembleBundle(input, bundleInput, loaded.directory);
  if (bundle !== undefined) entries.push(...bundle.entries);

  const { publisher } = input;
  const dossier: ConnectorDossier = {
    format: DOSSIER_FORMAT,
    distribution: {
      surface: 'claude-directory-mcp-connector',
      webDistribution: 'not-established',
      basis: DISTRIBUTION_BASIS,
      notProduced: [
        'Claude Desktop extension (.mcpb)',
        'Claude Code local or marketplace installation',
      ],
    },
    connection: {
      url: input.endpoint.url,
      urlScope: 'universal',
      uiDomain: {
        expected: claudeUiDomain(input.endpoint.url),
        note: 'Declaring _meta.ui.domain is optional; when a served view declares it, Claude requires exactly this value for this exact URL.',
      },
    },
    tools,
    listing: {
      ...(connector.name === undefined ? {} : { name: connector.name }),
      ...(connector.oneLiner === undefined
        ? {}
        : { oneLiner: connector.oneLiner }),
      ...(connector.description === undefined
        ? {}
        : { description: connector.description }),
      ...(connector.categories === undefined
        ? {}
        : { categories: connector.categories }),
      ...(connector.slug === undefined ? {} : { slug: connector.slug }),
      ...(connector.documentationURL === undefined
        ? {}
        : { documentationURL: connector.documentationURL }),
      ...(connector.privacyPolicyURL === undefined
        ? {}
        : { privacyPolicyURL: connector.privacyPolicyURL }),
      ...(connector.support === undefined
        ? {}
        : { support: connector.support }),
      ...(icon === undefined ? {} : { icon }),
      screenshots,
    },
    useCases: connector.useCases ?? null,
    company: {
      name: publisher.name,
      website: publisher.url ?? null,
      contact: connector.reviewContact ?? null,
      contributors: (input.contributors ?? []).map((one) => ({
        name: one.name,
        url: one.url ?? null,
      })),
    },
    authentication: connector.authentication ?? null,
    dataHandling: connector.dataHandling ?? null,
    allowedLinkUris: connector.allowedLinkUris ?? null,
    testAndLaunch: {
      reviewerAccount:
        'Credentials for a fully populated test account are entered in the developer portal only. They never belong in this dossier.',
      toolRun:
        'The owner runs every tool through the MCP Inspector and as a custom connector in Claude, and confirms that in the portal.',
    },
    compliance: {
      acknowledgedBy: 'the submitting organization, in the developer portal',
      topics: COMPLIANCE_TOPICS,
    },
    pluginBundle:
      bundleInput === undefined
        ? {
            included: false,
            directory: null,
            repository: null,
            note: 'No plugin bundle was requested: the release input supplies no claude.pluginBundle, so none was produced.',
          }
        : {
            included: true,
            directory: BUNDLE_DIRECTORY,
            repository: bundleInput.repository,
            note: "A separate submission from a GitHub repository, paired with the connector afterwards. The bundle points at the connector's own endpoint.",
          },
    evidence: {
      source: evidence.source,
      releaseInputSha256: evidence.releaseInputSha256,
      sagaPackages: evidence.sagaPackages,
      views: evidence.views,
      server: evidence.endpoint.server,
      deploymentIdentity: evidence.endpoint.deploymentIdentity,
      contractSha256: evidence.endpoint.contractSha256,
      instructionsSha256: evidence.endpoint.instructionsSha256,
      resources: evidence.endpoint.resources,
    },
  };
  entries.push({
    path: DOSSIER_FILE,
    data: Buffer.from(`${JSON.stringify(dossier, null, 2)}\n`, 'utf8'),
  });
  entries.push({
    path: GUIDE_FILE,
    data: Buffer.from(renderGuide(dossier), 'utf8'),
  });
  return { entries, unreadable, bundleProblems: bundle?.problems ?? [] };
}

/** The dossier as steps to follow in the portal, in the portal's order. Every value comes from the dossier. */
function renderGuide(dossier: ConnectorDossier): string {
  const value = (text: string | number | boolean | undefined | null): string =>
    text === undefined || text === null || text === ''
      ? '(missing)'
      : String(text);
  const { listing } = dossier;
  const lines = [
    '# Claude connector submission',
    '',
    dossier.distribution.basis,
    '',
    'Submit in the developer portal at https://claude.ai/directory/manage: **Submit new**, then **MCP connector**.',
    '',
    '## 1. Connection',
    `- Server URL: ${dossier.connection.url} (every user connects to this one URL)`,
    `- If a served view declares _meta.ui.domain, it must be ${dossier.connection.uiDomain.expected}`,
    '',
    '## 2. Tools',
    'The portal reads these from the connected server. Each needs a title and a read-only or destructive annotation.',
    ...(dossier.tools.length === 0
      ? ['- (none were read)']
      : dossier.tools.map(
          (tool) =>
            `- ${tool.name} (${tool.access}), definition sha256 ${tool.sha256}`,
        )),
    '',
    '## 3. Listing',
    `- Name: ${value(listing.name)}`,
    `- One-liner: ${value(listing.oneLiner)}`,
    `- Description: ${value(listing.description)}`,
    `- Categories: ${listing.categories === undefined ? '(missing)' : listing.categories.join(', ')}`,
    `- URL slug (permanent once published): ${value(listing.slug)}`,
    `- Documentation: ${value(listing.documentationURL)}`,
    `- Privacy policy: ${value(listing.privacyPolicyURL)}`,
    `- Support: ${listing.support === undefined ? '(missing)' : [listing.support.email, listing.support.url].filter((one) => one !== undefined).join(', ')}`,
    `- Icon: ${value(listing.icon?.file)}`,
    ...listing.screenshots.map(
      (shot, index) =>
        `- Carousel screenshot ${index + 1}: ${shot.file}, prompt: ${shot.prompt}`,
    ),
    '',
    '## 4. Use cases',
    ...(dossier.useCases === null
      ? ['- (missing)']
      : [
          `- Primary: ${dossier.useCases.primary?.join('; ') ?? '(missing)'}`,
          `- Before connecting: ${value(dossier.useCases.prerequisites)}`,
          `- Data access: ${value(dossier.useCases.access)}`,
        ]),
    '',
    '## 5. Company',
    `- Company: ${dossier.company.name}`,
    `- Website: ${value(dossier.company.website)}`,
    `- Primary contact for review updates: ${dossier.company.contact === null ? '(missing)' : `${value(dossier.company.contact.name)} <${value(dossier.company.contact.email)}>`}`,
    '',
    '## 6. Authentication',
    `- ${dossier.authentication === null ? '(missing)' : value(dossier.authentication.mode)}`,
    '',
    '## 7. Data handling',
    ...(dossier.dataHandling === null
      ? ['- (missing)']
      : [
          `- API: ${value(dossier.dataHandling.apiOwnership)}`,
          `- Personal health data: ${value(dossier.dataHandling.personalHealthData)}`,
          `- Sponsored content: ${value(dossier.dataHandling.sponsoredContent)}`,
        ]),
    ...(dossier.allowedLinkUris === null
      ? []
      : [
          '- Allowed link URIs (each must be owned by the submitting organization):',
          ...dossier.allowedLinkUris.map((uri) => `  - ${uri}`),
        ]),
    '',
    '## 8. Test & launch',
    `- ${dossier.testAndLaunch.reviewerAccount}`,
    `- ${dossier.testAndLaunch.toolRun}`,
    '',
    '## 9. Compliance',
    `The seven policy acknowledgments are given by ${dossier.compliance.acknowledgedBy}: ${dossier.compliance.topics.join(', ')}.`,
    '',
    '## 10. Review and submit',
    `Record this dossier's release: input sha256 ${dossier.evidence.releaseInputSha256}, served contract sha256 ${value(dossier.evidence.contractSha256)}, deployment identity ${dossier.evidence.deploymentIdentity.status}.`,
    '',
    '## Plugin bundle',
    dossier.pluginBundle.note,
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UNSAFE_SCHEMES = new Set([
  'http:',
  'https:',
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'vbscript:',
]);

function textProblem(
  label: string,
  value: unknown,
  max: number,
): string | null {
  if (typeof value !== 'string' || value.trim() === '')
    return `${label} is required.`;
  return value.length > max
    ? `${label} is ${value.length} characters; the limit is ${max}.`
    : null;
}

/** The submission's listing step: https://claude.com/docs/connectors/building/submission (step 3). */
export function listingProblems(
  listing: ConnectorDossier['listing'],
): string[] {
  const problems: (string | null)[] = [
    textProblem('listing.name', listing.name, MAX_NAME),
    textProblem('listing.oneLiner', listing.oneLiner, MAX_ONE_LINER),
    textProblem('listing.description', listing.description, MAX_DESCRIPTION),
    listing.slug === undefined
      ? 'listing.slug is required.'
      : SLUG.test(listing.slug) && listing.slug.length <= MAX_NAME
        ? null
        : 'listing.slug must be lowercase letters, digits and single hyphens (it is permanent once published).',
    publishedUrlProblem(
      'listing.documentationURL',
      listing.documentationURL,
      2048,
    ),
    publishedUrlProblem(
      'listing.privacyPolicyURL',
      listing.privacyPolicyURL,
      2048,
    ),
  ];
  const categories = listing.categories;
  if (
    categories === undefined ||
    categories.length < 1 ||
    categories.length > 5 ||
    categories.some((one) => typeof one !== 'string' || one.trim() === '')
  )
    problems.push('listing.categories needs one to five non-empty categories.');
  const support = listing.support;
  const email = support?.email;
  const supportUrl = support?.url;
  if (email === undefined && supportUrl === undefined)
    problems.push('listing.support needs an email address or an HTTPS URL.');
  if (email !== undefined && !EMAIL.test(email))
    problems.push('listing.support.email is not an email address.');
  if (supportUrl !== undefined)
    problems.push(publishedUrlProblem('listing.support.url', supportUrl, 2048));
  return problems.filter((problem): problem is string => problem !== null);
}

/** The company step: the application publisher (never the operator running this tool) and a contact for review updates. */
export function companyProblems(
  company: ConnectorDossier['company'],
): string[] {
  const problems: (string | null)[] = [
    textProblem('The publisher name', company.name, 200),
    company.website === null
      ? 'The publisher needs a website (publisher.url): the portal asks for the company website.'
      : publishedUrlProblem('The publisher website', company.website, 2048),
  ];
  const contact = company.contact;
  if (
    contact === null ||
    typeof contact.name !== 'string' ||
    contact.name.trim() === '' ||
    typeof contact.email !== 'string' ||
    !EMAIL.test(contact.email)
  )
    problems.push(
      'A primary contact for review updates (claude.connector.reviewContact with a name and an email address) is required.',
    );
  return problems.filter((problem): problem is string => problem !== null);
}

/** The use-case, authentication and data-handling steps, and that the declared access agrees with the tools the endpoint advertised. */
export function declarationProblems(dossier: ConnectorDossier): string[] {
  const problems: string[] = [];
  const cases = dossier.useCases;
  if (
    cases === null ||
    !Array.isArray(cases.primary) ||
    cases.primary.length === 0 ||
    cases.primary.some((one) => typeof one !== 'string' || one.trim() === '')
  )
    problems.push('useCases.primary needs at least one primary use case.');
  if (
    cases === null ||
    typeof cases.prerequisites !== 'string' ||
    cases.prerequisites.trim() === ''
  )
    problems.push(
      'useCases.prerequisites is required: say what users need before they can connect (accounts, plans, other setup), or that they need nothing.',
    );
  if (cases === null || cases.access === undefined)
    problems.push('useCases.access is required: read, write or read-write.');
  else {
    const writes = dossier.tools
      .filter((tool) => tool.access === 'write')
      .map((tool) => tool.name);
    if (cases.access === 'read' && writes.length > 0)
      problems.push(
        `useCases.access says the connector only reads, but ${writes.join(', ')} ${writes.length === 1 ? 'is' : 'are'} not annotated readOnlyHint: true.`,
      );
    if (
      cases.access === 'write' &&
      dossier.tools.length > 0 &&
      writes.length === 0
    )
      problems.push(
        'useCases.access says the connector writes, but every tool is annotated read-only.',
      );
  }
  if (
    dossier.authentication === null ||
    dossier.authentication.mode === undefined
  )
    problems.push('authentication.mode is required.');
  const data = dossier.dataHandling;
  if (data === null || data.apiOwnership === undefined)
    problems.push(
      'dataHandling.apiOwnership is required: first-party, proxied-with-permission or third-party.',
    );
  else if (data.apiOwnership === 'third-party')
    problems.push(
      'dataHandling.apiOwnership is third-party; the directory accepts a server that calls its own first-party APIs or APIs it legitimately proxies.',
    );
  if (
    data === null ||
    data.personalHealthData === undefined ||
    data.sponsoredContent === undefined
  )
    problems.push(
      'dataHandling.personalHealthData and dataHandling.sponsoredContent are required (true or false).',
    );
  return problems;
}

/** `ui/open-link` allowlist entries: an HTTPS origin or a custom URI scheme, nothing broader. */
export function linkProblems(uris: readonly string[] | null): string[] {
  if (uris === null) return [];
  const problems: string[] = [];
  for (const uri of uris) {
    if (/^[a-z][a-z0-9+.-]*:$/.test(uri)) {
      if (UNSAFE_SCHEMES.has(uri))
        problems.push(`${uri} is not a custom URI scheme for a native app.`);
      continue;
    }
    let url: URL | undefined;
    try {
      url = new URL(uri);
    } catch {
      // reported below
    }
    if (url === undefined || url.protocol !== 'https:' || url.origin !== uri)
      problems.push(
        `${JSON.stringify(uri.slice(0, 80))} is neither an HTTPS origin such as https://example.com (no path, port, query or credentials) nor a custom scheme such as myapp:.`,
      );
  }
  return problems;
}

/** What Claude's review criteria require of every advertised tool and that an endpoint's own answer shows. */
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
    if (tool.name.length > MAX_TOOL_NAME)
      problems.push(
        `${tool.name.slice(0, 40)}… has a name longer than ${MAX_TOOL_NAME} characters.`,
      );
    if (typeof tool.description !== 'string' || tool.description.trim() === '')
      problems.push(`${tool.name} has no description.`);
    if (titleOf(tool) === null) problems.push(`${tool.name} has no title.`);
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    if (
      annotations.readOnlyHint !== true &&
      typeof annotations.destructiveHint !== 'boolean'
    )
      problems.push(
        `${tool.name} sets neither readOnlyHint: true nor an explicit destructiveHint.`,
      );
    if (
      annotations.readOnlyHint === true &&
      annotations.destructiveHint === true
    )
      problems.push(
        `${tool.name} is annotated both read-only and destructive.`,
      );
  }
  return [
    problems.length === 0 && snapshot.truncated.length > 0
      ? unknown(
          'endpoint.tools',
          'Only part of the endpoint was read, so its tool definitions were not fully checked.',
          "Reduce the endpoint's paging so every tool fits the bounds this tool reads, then rerun.",
          'The tools that were read are titled, described and annotated; the ones that were not read cannot be certified.',
        )
      : problems.length === 0
        ? pass(
            'endpoint.tools',
            `${snapshot.tools.length} tool${snapshot.tools.length === 1 ? '' : 's'} advertised, each with a title, a description, a name of at most ${MAX_TOOL_NAME} characters and a read-only or destructive annotation.`,
          )
        : fail(
            'endpoint.tools',
            'A tool definition breaks the connector requirements.',
            'Give every tool a title, a description, a short name and readOnlyHint: true (or an explicit destructiveHint).',
            problems.join(' '),
          ),
  ];
}

/** Whether any served view declares a `ui.domain`, and whether it is the one Claude computes for this URL. */
function uiDomainFinding(
  snapshot: EndpointSnapshot | undefined,
  connectorUrl: string,
): Finding | undefined {
  if (snapshot === undefined) return undefined;
  const expected = claudeUiDomain(connectorUrl);
  const problems: string[] = [];
  let declared = 0;
  for (const resource of snapshot.resources) {
    const ui =
      isRecord(resource.meta) && isRecord(resource.meta.ui)
        ? resource.meta.ui
        : undefined;
    if (ui === undefined || ui.domain === undefined) continue;
    declared += 1;
    if (ui.domain !== expected)
      problems.push(
        `${resource.uri} declares ui.domain ${typeof ui.domain === 'string' ? JSON.stringify(ui.domain.slice(0, 80)) : '(not a string)'}; Claude requires ${expected} for ${connectorUrl}.`,
      );
  }
  if (problems.length > 0)
    return fail(
      'claude.ui-domain',
      'A served view declares a ui.domain that Claude would reject.',
      'Set _meta.ui.domain to the value computed from the exact connector URL, or remove it.',
      problems.join(' '),
    );
  return pass(
    'claude.ui-domain',
    declared === 0
      ? `No served view declares ui.domain, which is optional. If one does, Claude requires ${expected}.`
      : `${declared} served view${declared === 1 ? '' : 's'} declare${declared === 1 ? 's' : ''} the ui.domain Claude computes for this URL.`,
  );
}

// ---------------------------------------------------------------------------------------------
// Checking the built archive
// ---------------------------------------------------------------------------------------------

/** Names that mark local packaging, which is never web distribution and never belongs in the dossier. */
function localPackagingEntries(entries: readonly ZipEntry[]): string[] {
  return entries
    .filter((entry) => {
      const name = path.posix.basename(entry.path).toLowerCase();
      if (['.mcpb', '.dxt'].includes(path.posix.extname(name))) return true;
      if (name === 'claude_desktop_config.json') return true;
      return (
        name === 'manifest.json' &&
        Buffer.from(entry.data).toString('utf8').includes('"manifest_version"')
      );
    })
    .map((entry) => entry.path);
}

interface DossierCheck {
  readonly findings: Finding[];
  readonly entries: ZipEntry[];
}

function parseDossier(entries: readonly ZipEntry[]): {
  dossier?: ConnectorDossier;
  problem?: string;
} {
  const entry = entries.find((one) => one.path === DOSSIER_FILE);
  if (entry === undefined)
    return { problem: `${DOSSIER_FILE} is missing from the archive.` };
  try {
    const value: unknown = JSON.parse(Buffer.from(entry.data).toString('utf8'));
    if (!isRecord(value) || value.format !== DOSSIER_FORMAT)
      return {
        problem: `${DOSSIER_FILE} is not a ${DOSSIER_FORMAT} document.`,
      };
    return { dossier: value as unknown as ConnectorDossier };
  } catch {
    return { problem: `${DOSSIER_FILE} is not valid JSON.` };
  }
}

/** Checks the bytes that would be handed over, not the files they were assembled from. */
function checkArchive(
  archive: Uint8Array,
  options: {
    readonly endpointUrl: string;
    readonly forbiddenLiterals: readonly string[];
  },
): DossierCheck {
  let entries: ZipEntry[];
  try {
    entries = readZip(archive);
  } catch (error) {
    if (!(error instanceof ZipError)) throw error;
    return {
      findings: [
        fail(
          'package.archive',
          'The dossier is not a usable ZIP archive.',
          'Regenerate the dossier.',
          error.message,
        ),
      ],
      entries: [],
    };
  }
  const findings: Finding[] = [
    pass(
      'package.archive',
      `The dossier is a well-formed ZIP archive of ${entries.length} files.`,
    ),
  ];
  const parsed = parseDossier(entries);
  const dossier = parsed.dossier;
  if (dossier === undefined) {
    findings.push(
      fail(
        'package.dossier',
        'The connector dossier cannot be read back.',
        'Regenerate the dossier.',
        parsed.problem,
      ),
    );
    return { findings, entries };
  }

  // The connection the portal is given is the endpoint of the release input, and one the portal can reach.
  const connection = dossier.connection;
  const connectionProblem =
    connection.url !== options.endpointUrl
      ? 'The dossier names a different connector URL than the endpoint in the release input.'
      : endpointUrlProblem(connection.url, 'Claude');
  findings.push(
    connectionProblem === null
      ? pass(
          'package.dossier',
          'The dossier names the endpoint of the release input as its one connector URL.',
        )
      : fail(
          'package.dossier',
          'The connection step cannot be submitted.',
          'Set endpoint.url to the stable public HTTPS endpoint of the deployed application.',
          connectionProblem,
        ),
  );

  const listing = listingProblems(dossier.listing);
  findings.push(
    listing.length === 0
      ? pass(
          'claude.listing',
          'The listing text, links and support contact meet the portal limits.',
        )
      : fail(
          'claude.listing',
          `The listing has ${listing.length} problem${listing.length === 1 ? '' : 's'}.`,
          'Correct the listed fields in claude.connector of the release input.',
          listing.join(' '),
        ),
  );

  const company = companyProblems(dossier.company);
  findings.push(
    company.length === 0
      ? pass(
          'claude.company',
          `The listing belongs to ${dossier.company.name}, the application publisher, with a contact for review updates.`,
        )
      : fail(
          'claude.company',
          'The company step is incomplete.',
          'Set publisher.name and publisher.url, and claude.connector.reviewContact, in the release input.',
          company.join(' '),
        ),
  );

  const declarations = declarationProblems(dossier);
  findings.push(
    declarations.length === 0
      ? pass(
          'claude.declarations',
          'The use cases, authentication, data handling and declared access are complete and agree with the advertised tools.',
        )
      : fail(
          'claude.declarations',
          `The declarations have ${declarations.length} problem${declarations.length === 1 ? '' : 's'}.`,
          'Correct claude.connector in the release input.',
          declarations.join(' '),
        ),
  );

  const links = linkProblems(dossier.allowedLinkUris);
  findings.push(
    links.length === 0
      ? pass(
          'claude.links',
          dossier.allowedLinkUris === null
            ? 'No allowed link URIs are declared; users are asked to confirm each external link.'
            : 'The allowed link URIs are HTTPS origins or custom schemes.',
        )
      : fail(
          'claude.links',
          'An allowed link URI is not an HTTPS origin or a custom scheme.',
          'List origins such as https://example.com and schemes such as myapp:.',
          links.join(' '),
        ),
  );

  // The icon and the carousel, read as images and not merely recognized by name.
  const imageProblems: string[] = [];
  const imageUnverified: string[] = [];
  const icon = dossier.listing.icon;
  if (icon === undefined) imageProblems.push('The listing has no icon.');
  else {
    const entry = entries.find((one) => one.path === icon.file);
    if (entry === undefined)
      imageProblems.push(`The icon ${icon.file} is not in the dossier.`);
    else {
      const problem = iconProblem(entry.path, entry.data);
      if (typeof problem === 'string') imageProblems.push(problem);
      else if (problem !== null) imageUnverified.push(problem.unverified);
    }
  }
  const shots = dossier.listing.screenshots;
  if (shots.length < MIN_SCREENSHOTS || shots.length > MAX_SCREENSHOTS)
    imageProblems.push(
      `An MCP App needs ${MIN_SCREENSHOTS} to ${MAX_SCREENSHOTS} carousel screenshots; the dossier has ${shots.length}.`,
    );
  for (const shot of shots) {
    if (typeof shot.prompt !== 'string' || shot.prompt.trim() === '')
      imageProblems.push(
        `${shot.file} has no prompt; each screenshot is paired with the prompt that produced it.`,
      );
    const entry = entries.find((one) => one.path === shot.file);
    if (entry === undefined)
      imageProblems.push(`The screenshot ${shot.file} is not in the dossier.`);
    else {
      const problem = screenshotProblem(entry.path, entry.data);
      if (problem !== null) imageProblems.push(problem);
    }
  }
  findings.push(
    imageProblems.length === 0 && imageUnverified.length > 0
      ? unknown(
          'package.images',
          'The icon could not be verified as a valid image.',
          "Run this command where the repository's development dependencies are installed (npm ci), then rerun.",
          imageUnverified.join(' '),
        )
      : imageProblems.length === 0
        ? pass(
            'package.images',
            `The icon is a valid image and the ${shots.length} carousel screenshots are valid PNG files at least 1000 pixels wide, each with its prompt.`,
          )
        : fail(
            'package.images',
            `The icon and screenshots have ${imageProblems.length} problem${imageProblems.length === 1 ? '' : 's'}.`,
            'Add or correct the files named in claude.connector of the release input.',
            imageProblems.join(' '),
          ),
  );

  // Local packaging is not web distribution, so it is refused rather than carried along.
  const local = localPackagingEntries(entries);
  findings.push(
    local.length === 0
      ? pass(
          'package.distribution',
          'The dossier carries no local Desktop or Code packaging; it prepares a web directory connector submission only.',
        )
      : fail(
          'package.distribution',
          'The dossier contains local Desktop or Code packaging, which is not claude.ai web distribution.',
          'Remove it from the skills in claude.pluginBundle; the directory no longer accepts desktop extensions and a local install does not publish a connector.',
          local.join(', '),
        ),
  );

  findings.push(secretFinding(entries, options.forbiddenLiterals));
  return { findings, entries };
}

// ---------------------------------------------------------------------------------------------
// The plugin bundle
// ---------------------------------------------------------------------------------------------

async function bundleFindings(
  context: TargetContext,
  entries: readonly ZipEntry[],
  assembled: Assembled,
  validator: PluginValidator,
): Promise<{ findings: Finding[]; validators: ValidatorIdentity[] }> {
  const requested = context.loaded.input.claude?.pluginBundle;
  if (requested === undefined)
    return {
      findings: [
        pass(
          'package.plugin-bundle',
          'No plugin bundle was requested, so none was produced. The release input supplies no onboarding or skills scope (claude.pluginBundle).',
        ),
      ],
      validators: [],
    };
  const problems = [
    ...assembled.bundleProblems,
    ...bundlePathProblems(entries),
  ];
  const inside = entries.filter((entry) =>
    entry.path.startsWith(`${BUNDLE_DIRECTORY}/`),
  );
  const mcp = inside.find(
    (entry) => entry.path === `${BUNDLE_DIRECTORY}/.mcp.json`,
  );
  try {
    const servers =
      mcp === undefined
        ? undefined
        : (
            JSON.parse(Buffer.from(mcp.data).toString('utf8')) as {
              mcpServers?: Record<string, { url?: string }>;
            }
          ).mcpServers;
    const urls = Object.values(servers ?? {}).map((one) => one.url);
    if (
      mcp !== undefined &&
      (urls.length !== 1 || urls[0] !== context.loaded.input.endpoint.url)
    )
      problems.push(
        "The bundle's MCP server is not the connector's endpoint; people who have both would see two sets of tools.",
      );
  } catch {
    problems.push("The bundle's .mcp.json is not valid JSON.");
  }
  if (problems.length > 0)
    return {
      findings: [
        fail(
          'package.plugin-bundle',
          `The plugin bundle has ${problems.length} problem${problems.length === 1 ? '' : 's'}.`,
          'Correct claude.pluginBundle in the release input.',
          problems.join(' '),
        ),
      ],
      validators: [],
    };

  const validation = await validator(inside, context.signal);
  const date = DOCUMENTATION_DATE;
  if (validation.kind === 'unavailable') {
    return {
      findings: [
        unknown(
          'package.plugin-bundle',
          "The plugin bundle was not validated: Claude Code's validator is unavailable.",
          'Install Claude Code where this command runs so that `claude plugin validate` can check the bundle, then rerun.',
          validation.problem,
        ),
      ],
      validators: [
        {
          name: 'claude-plugin-validate',
          identity: `unavailable: ${validation.problem}`,
          documentationDate: date,
        },
      ],
    };
  }
  return {
    findings: [
      validation.passed
        ? pass(
            'package.plugin-bundle',
            `The plugin bundle of ${inside.length} files passes claude plugin validate and points at the connector's endpoint. It is submitted separately from a GitHub repository.`,
            validation.report === '' ? undefined : validation.report,
          )
        : fail(
            'package.plugin-bundle',
            'The plugin bundle does not pass claude plugin validate.',
            'Correct the skills or the release input fields the report names.',
            validation.report,
          ),
    ],
    validators: [
      {
        name: 'claude-plugin-validate',
        identity: validation.identity,
        documentationDate: date,
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// What only the owner or the host can do
// ---------------------------------------------------------------------------------------------

function handoff(loaded: LoadedReleaseInput): HandoffItem[] {
  const claude = loaded.input.claude;
  const mode = claude?.connector?.authentication?.mode;
  const items: HandoffItem[] = [
    {
      id: 'publisher-authority',
      summary: `Confirm that ${loaded.input.publisher.name} is the intended listing owner and that the Claude organization submitting (a paid plan, with the Owner role or the Directory permission) is the one that should hold the listing long term. The listing's URL slug is permanent once published.`,
    },
    {
      id: 'submission',
      summary:
        "In the developer portal (https://claude.ai/directory/manage), choose Submit new, then MCP connector, and follow the dossier's steps. Anthropic scans the submission automatically and lists it as a Community connector by default; it may escalate to a person's review. Nothing is live until Anthropic lists it.",
    },
    {
      id: 'authentication',
      summary:
        mode !== undefined && AUTH_MODES_NEEDING_ANTHROPIC.has(mode)
          ? `Authentication mode ${mode} needs coordination with Anthropic (mcp-review@anthropic.com) before it works; the OAuth client for Claude and its credentials are never part of the dossier.`
          : "Configure authentication in the portal's Authentication step. OAuth must accept the redirect URI https://claude.ai/api/mcp/auth_callback and support S256 PKCE; the credentials stay in the authorization server and the portal, never in the dossier.",
    },
    {
      id: 'reviewer-account',
      summary:
        "Enter credentials for a fully populated test account, with access instructions a reviewer can follow, in the portal's Test & launch step. They never belong in the dossier.",
    },
    {
      id: 'portal-validation',
      summary:
        'Claude publishes no offline validator for a connector submission. Run every tool through the MCP Inspector and as a custom connector in Claude, and confirm that in the portal; its Tools step flags a missing title or annotation and its automated scan checks policy compliance.',
    },
    {
      id: 'review-criteria',
      summary:
        'Reviewers also judge what a check cannot: that each tool description is accurate and free of prompt-injection patterns, that read and write operations are separate tools, that the server calls first-party APIs on a domain matching the service, and that the use case is one the directory accepts. Public documentation is required by the publish date.',
    },
    {
      id: 'compliance',
      summary: `The submitting organization gives the seven policy acknowledgments in the portal (${COMPLIANCE_TOPICS.join(', ')}); this tool acknowledges none of them.`,
    },
    {
      id: 'screenshots',
      summary:
        'Confirm each carousel screenshot is cropped to the app response alone, without the prompt in the image; a check can see its size and format, not its content.',
    },
    {
      id: 'host-observation',
      summary:
        "Installation, card rendering and interactions in actual Claude web runs are observed separately, against the recorded release; this tool's checks, fixture invocations, local Desktop or Code runs and directory approval do not replace them.",
    },
  ];
  if ((claude?.connector?.allowedLinkUris?.length ?? 0) > 0)
    items.push({
      id: 'link-ownership',
      summary:
        'Every allowed link origin and scheme must be owned by the submitting organization; entries it does not own are removed in review.',
    });
  if (claude?.pluginBundle !== undefined)
    items.push({
      id: 'plugin-bundle-submission',
      summary: `The plugin bundle is a separate submission of ${claude.pluginBundle.repository}: the repository must be public before the listing goes live, the submitting GitHub account must be connected on claude.ai with push access, and the first organization to submit a folder holds its listing. Submit the connector first, then pair the two from the same organization.`,
    });
  return items;
}

/** The Claude target. `pluginValidator` checks the optional bundle; the default is Claude Code's own `claude plugin validate`, and a test supplies another. */
export function claudeTarget(
  pluginValidator: PluginValidator | undefined,
): PublicationTarget {
  return {
    name: 'claude',
    archiveFile: ARCHIVE_FILES.claude,
    submissionNote:
      "Preparing a dossier submits nothing. Submission in the developer portal, Anthropic's review and the listing are separate acts that only the publisher and Anthropic can perform; local Desktop or Code packaging would not be web distribution.",
    inputProblem: () => null,
    endpointProblem: (url) => endpointUrlProblem(url, 'Claude'),
    toolFindings,
    async prepare(context) {
      const assembled = assemble(context);
      const findings: Finding[] = [];
      if (context.loaded.input.claude?.connector === undefined) {
        findings.push(
          fail(
            'claude.materials',
            'The release input has no claude.connector section, so there is nothing to submit.',
            "Add claude.connector (the portal's listing, use-case, authentication and data-handling fields) to the release input.",
          ),
        );
      }
      const supplied =
        context.loaded.input.claude?.connector?.screenshots?.length ?? 0;
      if (supplied > MAX_SCREENSHOTS)
        findings.push(
          fail(
            'claude.screenshot-count',
            `The release input supplies ${supplied} carousel screenshots; at most ${MAX_SCREENSHOTS} are accepted.`,
            `Remove ${supplied - MAX_SCREENSHOTS} screenshot${supplied - MAX_SCREENSHOTS === 1 ? '' : 's'} from claude.connector.screenshots in the release input; the publisher chooses which to keep.`,
          ),
        );
      if (assembled.unreadable.length > 0)
        findings.push(
          fail(
            'package.asset-files',
            'A file cannot be added to the dossier.',
            'Add or correct the files named in claude.connector in the release input.',
            assembled.unreadable
              .map((one) => `${one.source}: ${one.reason}`)
              .join(' '),
          ),
        );
      const archive = writeZip(assembled.entries);
      const check = checkArchive(archive, {
        endpointUrl: context.loaded.input.endpoint.url,
        forbiddenLiterals: context.forbiddenLiterals,
      });
      findings.push(...check.findings);
      const domain = uiDomainFinding(
        context.evidence.snapshot,
        context.loaded.input.endpoint.url,
      );
      if (domain !== undefined) findings.push(domain);
      const bundle = await bundleFindings(
        context,
        check.entries,
        assembled,
        pluginValidator ?? claudePluginValidate,
      );
      findings.push(...bundle.findings);
      return {
        archive,
        entries: check.entries,
        findings,
        validators: [
          {
            name: 'claude-connector-requirements',
            identity:
              "No offline validator exists for a Claude connector submission: this tool applies the published requirements itself, and the developer portal's Tools step and automated policy scan are the check of record (a pending handoff).",
            documentationDate: DOCUMENTATION_DATE,
          },
          ...bundle.validators,
        ],
      };
    },
    handoff,
  };
}
