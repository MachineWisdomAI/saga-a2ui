import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sha256 } from './record.js';

// The one file a maintainer writes to prepare an application for a host directory (CLI3 #66):
// `saga-publication.json`, kept beside the application's source. It names the built application and
// its already deployed endpoint, who the listing belongs to and the listing text; it holds no
// credential and no host-specific syntax. Limits that a host sets on the text (lengths, URL forms)
// are checked as findings by the host's rules (chatgpt.ts), not here, so a too-long name is a
// repairable finding and not a parse error. This schema only fixes the shape.
//
// Every path is relative to the directory holding this file.

export const RELEASE_INPUT_FORMAT = 'saga-publication/1';

const person = z.strictObject({ name: z.string(), url: z.string().optional() });

const testCase = z.strictObject({
  description: z.string(),
  prompt: z.string(),
  tools_triggered: z.string().optional(),
  expected_behavior: z.string().optional(),
  file_attachment_urls: z.array(z.string()).optional(),
  expected_output_url: z.string().optional(),
});

// What Claude's connector submission asks for, in the order of the developer portal's steps
// (https://claude.com/docs/connectors/building/submission). Every field is optional here so that
// a missing one is a finding that names the repair; only a value of the wrong shape is a parse error.
const claudeConnector = z
  .strictObject({
    /** Server name (the portal allows 100 characters). */
    name: z.string(),
    oneLiner: z.string(),
    description: z.string(),
    categories: z.array(z.string()),
    /** The listing page's URL slug. The portal makes it permanent once published. */
    slug: z.string(),
    documentationURL: z.string(),
    privacyPolicyURL: z.string(),
    support: z.strictObject({ email: z.string().optional(), url: z.string().optional() }),
    /** The connector icon: PNG or SVG. */
    icon: z.string(),
    /** Carousel screenshots of the app response (MCP Apps), each with the prompt that produced it. */
    screenshots: z.array(z.strictObject({ file: z.string(), prompt: z.string() })),
    useCases: z.strictObject({ primary: z.array(z.string()), prerequisites: z.string(), access: z.enum(['read', 'write', 'read-write']) }),
    /** How users authenticate. The credentials themselves are entered in the portal and never belong here. */
    authentication: z.strictObject({ mode: z.enum(['oauth_dcr', 'oauth_cimd', 'oauth_anthropic_creds', 'custom_connection', 'none']) }),
    dataHandling: z.strictObject({ apiOwnership: z.enum(['first-party', 'proxied-with-permission', 'third-party']), personalHealthData: z.boolean(), sponsoredContent: z.boolean() }),
    /** Origins (`https://example.com`) and custom schemes (`myapp:`) the connector opens through `ui/open-link` without a prompt. */
    allowedLinkUris: z.array(z.string()),
    /** The primary contact for review updates. */
    reviewContact: z.strictObject({ name: z.string(), email: z.string() }),
  })
  .partial();

// The optional plugin bundle: only what the application supplies as onboarding or skills scope.
// Nothing is invented for it; without this section no bundle is produced.
const claudePluginBundle = z.strictObject({
  /** The public GitHub repository the bundle will live in. The directory reads plugins from GitHub. */
  repository: z.string(),
  /** Directories that each hold a SKILL.md and the files it uses. */
  skills: z.array(z.string()).min(1),
  readme: z.string(),
  /** The license text file. The directory requires a README and a license in the plugin folder. */
  license: z.string(),
});

export const ReleaseInputSchema = z.strictObject({
  format: z.literal(RELEASE_INPUT_FORMAT),
  /** The plugin's stable identifier: lowercase letters, digits and single hyphens. */
  name: z.string(),
  version: z.string(),
  description: z.string(),
  /** The application publisher: who the listing belongs to. The operator running the tool is not substituted for it. */
  publisher: z.strictObject({ name: z.string(), url: z.string().optional(), email: z.string().optional() }),
  /** Credited contributors. They are recorded and never become the publisher. */
  contributors: z.array(person).optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** The ChatGPT listing. Needed to prepare the `chatgpt` target and ignored by the `claude` target. */
  listing: z
    .strictObject({
      displayName: z.string(),
      shortDescription: z.string(),
      longDescription: z.string(),
      category: z.string(),
      capabilities: z.array(z.string()).optional(),
      websiteURL: z.string(),
      supportURL: z.string(),
      privacyPolicyURL: z.string(),
      termsOfServiceURL: z.string(),
      defaultPrompt: z.array(z.string()).optional(),
      brandColor: z.string().optional(),
      brandColorDark: z.string().optional(),
    })
    .optional(),
  /** The ChatGPT listing's PNG or SVG files, copied into the package under `assets/`. Needed with `listing`. */
  assets: z.strictObject({ logo: z.string(), composerIcon: z.string(), logoDark: z.string().optional(), composerIconDark: z.string().optional() }).optional(),
  /** The Claude connector submission. Needed to prepare the `claude` target; every field is a finding when it is missing, not a parse error. */
  claude: z.strictObject({ connector: claudeConnector.optional(), pluginBundle: claudePluginBundle.optional() }).optional(),
  build: z.strictObject({
    /** The built application. */
    directory: z.string(),
    /** The built view files (inside `directory`) the endpoint serves as MCP App resources. */
    views: z.array(z.string()).min(1),
  }),
  endpoint: z.strictObject({
    /** The deployed MCP endpoint people reach: stable, public and HTTPS. */
    url: z.string(),
    /** What the deployment reports about itself in `initialize`. When present and equal, the deployment identity is established. */
    expectedServer: z.strictObject({ name: z.string(), version: z.string() }).optional(),
  }),
  /** Review material the host asks for at submission. Reviewer credentials never belong here. */
  review: z
    .strictObject({
      test_cases: z.strictObject({ positive: z.array(testCase).optional(), negative: z.array(testCase).optional() }).optional(),
      demo_recording_url: z.string().optional(),
      commerce: z.boolean().optional(),
      commerce_description: z.string().optional(),
    })
    .optional(),
  publication: z
    .strictObject({
      countries: z.array(z.string()).optional(),
      release_notes: z.string().optional(),
      translations: z.record(z.string(), z.strictObject({ subtitle: z.string().nullable().optional(), description: z.string().nullable().optional() })).optional(),
    })
    .optional(),
  /** Tool calls `--invoke-fixture` may make against a test fixture. Declaring them calls nothing. */
  fixture: z.strictObject({ calls: z.array(z.strictObject({ tool: z.string(), arguments: z.record(z.string(), z.unknown()).optional() })) }).optional(),
});

export type ReleaseInput = z.infer<typeof ReleaseInputSchema>;
/** A release input that carries the ChatGPT listing and its assets, which the `chatgpt` target needs. */
export type ChatgptReleaseInput = ReleaseInput & { readonly listing: NonNullable<ReleaseInput['listing']>; readonly assets: NonNullable<ReleaseInput['assets']> };
export type ClaudeConnectorInput = z.infer<typeof claudeConnector>;
export type ClaudePluginBundleInput = z.infer<typeof claudePluginBundle>;

export interface LoadedReleaseInput {
  readonly input: ReleaseInput;
  /** The directory every path in the input is relative to. */
  readonly directory: string;
  /** Digest of the file's bytes: any edit makes earlier evidence stale. */
  readonly sha256: string;
}

export type ReleaseInputResult = { readonly ok: true; readonly loaded: LoadedReleaseInput } | { readonly ok: false; readonly problem: string };

export function loadReleaseInput(file: string): ReleaseInputResult {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    return { ok: false, problem: `The release input ${file} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'}).` };
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, problem: `The release input ${file} is not valid JSON.` };
  }
  const parsed = ReleaseInputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`);
    return { ok: false, problem: `The release input ${file} does not match ${RELEASE_INPUT_FORMAT}: ${issues.join('; ')}` };
  }
  return { ok: true, loaded: { input: parsed.data, directory: path.dirname(path.resolve(file)), sha256: sha256(bytes) } };
}
