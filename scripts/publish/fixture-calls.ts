import { z } from 'zod';
import { InputRefused, readBounded } from './bounded-read.js';

// The fixture calls `saga publish check|prepare --invoke-fixture FILE` may make (CLI3 #66).
//
// Authority to call an application tool is the maintainer's, and it comes from this file alone. The
// release input names the endpoint, and the endpoint advertises the tools; both are lower-trust than
// the maintainer who runs the command, so neither may choose which tool is called, with what
// arguments or against which definition. A call is therefore declared here, in a file the maintainer
// names on the command line and keeps outside the application's tree, with the exact tool, the
// `toolSha256` of the definition the maintainer reviewed (the digest an earlier record reported for
// that tool) and its arguments. The endpoint's `readOnlyHint` can only narrow this authority.

export const FIXTURE_CALLS_FORMAT = 'saga-fixture-calls/1';
export const MAX_FIXTURE_CALLS = 50;
const MAX_ARGUMENT_CHARS = 16 * 1024;
const MAX_FIXTURE_CALLS_BYTES = 1024 * 1024;

const FixtureCallsSchema = z.strictObject({
  format: z.literal(FIXTURE_CALLS_FORMAT),
  calls: z
    .array(
      z.strictObject({
        tool: z.string().min(1),
        /** The `sha256` the record reports for this tool. A call is made only when the endpoint still advertises that exact definition. */
        toolSha256: z.string().regex(/^[0-9a-f]{64}$/),
        arguments: z
          .record(z.string(), z.unknown())
          .refine(
            (value) => JSON.stringify(value).length <= MAX_ARGUMENT_CHARS,
            {
              message: `arguments are longer than ${MAX_ARGUMENT_CHARS} characters`,
            },
          )
          .optional(),
      }),
    )
    .min(1)
    .max(MAX_FIXTURE_CALLS),
});

/** One call the maintainer authorized: the tool, the digest of the definition it was reviewed against, and its arguments. */
export type FixtureCall = z.infer<typeof FixtureCallsSchema>['calls'][number];

export type FixtureCallsResult =
  | { readonly ok: true; readonly calls: readonly FixtureCall[] }
  | { readonly ok: false; readonly problem: string };

/** Reads the maintainer's fixture calls. The text of a problem is fixed wording and never the file's own content. */
export function loadFixtureCalls(file: string): FixtureCallsResult {
  let bytes: Buffer;
  try {
    bytes = readBounded(file, MAX_FIXTURE_CALLS_BYTES);
  } catch (error) {
    return {
      ok: false,
      problem:
        error instanceof InputRefused
          ? `The fixture calls file ${file} cannot be read: ${error.message}`
          : `The fixture calls file ${file} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'}).`,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return {
      ok: false,
      problem: `The fixture calls file ${file} is not valid JSON.`,
    };
  }
  const parsed = FixtureCallsSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) =>
        `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`,
    );
    return {
      ok: false,
      problem: `The fixture calls file ${file} does not match ${FIXTURE_CALLS_FORMAT}: ${issues.join('; ')}`,
    };
  }
  return { ok: true, calls: parsed.data.calls };
}
