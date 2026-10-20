import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { sameDirectory } from '../starter-template.js';
import { readPreviousOutput, staleness } from './previous.js';
import { ARCHIVE_FILES, HOST_DIRECTORIES, RECORD_FILE, TARGET_NAMES, canonicalDigest, sha256, type ReleaseEvidence, type TargetName } from './record.js';
import { secretKinds } from './secrets.js';

// `saga publish handoff` (CLI5 #68): the resumable record of one prepared release's trip through a
// host directory's own submission flow. Preparing a package (CLI3, CLI4) submits nothing; this
// module records, in a directory the maintainer keeps, what the maintainer then did by hand in the
// host's portal, so the work can be interrupted, resumed and handed to someone else without a
// second upload and without a prepared package ever being mistaken for a live listing.
//
// It calls no network and no host. There is no submission API here, no hosted service and no
// credential: the maintainer submits in the portal as the intended publisher, and this module
// writes down the attempt before and the portal's reference after.
//
// The record is a directory of numbered event files, appended and never rewritten:
//
//   000001.json  begin: host, exact release evidence, the intended publisher's authority references
//   000002.json  submission-attempt: the maintainer is about to submit by hand
//   000003.json  submission-confirmed (or attempt-voided): the portal's reference, observed
//   ...          review-observed, listing-observed
//
// Four states stay distinct, each from its own events: preparation (from `begin`), submission,
// the host's review and the live listing. The status is derived from the events, never stored, so
// there is nothing to get out of step. An event is created whole with a hard link, which fails when
// that number is already taken: of two commands that both read the same record, one is refused and
// no event is lost or doubled. Each event names the digest of the one before it.

export const HANDOFF_FORMAT = 'saga-publication-handoff/1';

export const HANDOFF_ACTIONS = ['begin', 'status', 'attempt', 'confirm-submission', 'void-attempt', 'record-review', 'record-listing'] as const;
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

export const REVIEW_STATES = ['in-review', 'changes-requested', 'approved', 'rejected'] as const;
export const LISTING_STATES = ['verified-live', 'not-listed'] as const;

/** What `saga.ts` hands over: the options as given. Which are needed depends on the action, and `runHandoff` says which are missing. */
export interface HandoffRequest {
  readonly action: HandoffAction;
  /** The handoff record directory. */
  readonly handoff: string | undefined;
  /** The output directory of a `prepare` run: the release `begin` pins, and the current one a later command is compared with. */
  readonly prepared: string | undefined;
  readonly authorityRefs: readonly string[];
  /** The host's own reference for what it holds: a submission identifier or a review link. */
  readonly reference: string | undefined;
  /** When the host showed the maintainer what is recorded; the time the command runs when absent. */
  readonly observedAt: string | undefined;
  /** What the maintainer looked at in the host before concluding that no submission exists. */
  readonly inspected: string | undefined;
  readonly state: string | undefined;
  /** The named host surface an installation or listing was observed on. */
  readonly host: string | undefined;
  /** The reference to that observation. */
  readonly evidence: string | undefined;
}

export interface HandoffIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly signal?: AbortSignal | undefined;
  readonly now: () => Date;
}

const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

const text = z.string().min(1).max(500);
const instant = z.string().min(1);
const envelope = { format: z.literal(HANDOFF_FORMAT), seq: z.number().int().positive(), previousSha256: z.string().nullable(), recordedAt: instant };

const isTarget = (value: unknown): value is TargetName => typeof value === 'string' && (TARGET_NAMES as readonly string[]).includes(value);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The pinned release is the record `prepare` wrote and `begin` checked; reading it back needs only to know it still has the sections that are compared. */
const isReleaseEvidence = (value: unknown): value is ReleaseEvidence =>
  isObject(value) && isTarget(value.target) && isObject(value.inputs) && isObject(value.endpoint) && isObject(value.application) && isObject(value.artifact) && Array.isArray(value.validators) && Array.isArray(value.handoff);

const EventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('begin'),
    /** Which record this is: the host, the application and publisher, and the exact package. */
    handoffId: z.string(),
    host: z.strictObject({ target: z.custom<TargetName>(isTarget), name: z.string(), guide: z.string(), portal: z.string().nullable() }),
    preparedRecordSha256: z.string(),
    release: z.custom<ReleaseEvidence>(isReleaseEvidence),
    /** References to the intended publisher's authority (a ticket, an agreement, an owner's confirmation). Pointers, never credentials; this tool verifies none. */
    authority: z.array(text).min(1),
  }),
  z.strictObject({ ...envelope, type: z.literal('submission-attempt') }),
  z.strictObject({ ...envelope, type: z.literal('attempt-voided'), attemptSeq: z.number().int().positive(), inspected: text, observedAt: instant }),
  z.strictObject({ ...envelope, type: z.literal('submission-confirmed'), attemptSeq: z.number().int().positive().nullable(), reference: text, observedAt: instant }),
  z.strictObject({ ...envelope, type: z.literal('review-observed'), state: z.enum(REVIEW_STATES), reference: text.nullable(), observedAt: instant }),
  z.strictObject({
    ...envelope,
    type: z.literal('listing-observed'),
    state: z.enum(LISTING_STATES),
    host: text,
    evidence: text,
    observedAt: instant,
    /** The release the observation was made for. */
    release: z.strictObject({ artifactSha256: z.string(), contractSha256: z.string().nullable() }),
  }),
]);

type HandoffEvent = z.infer<typeof EventSchema>;
type EventOf<T extends HandoffEvent['type']> = Extract<HandoffEvent, { type: T }>;
/** An event as a decision produces it: the position, the chain link and the time are added when it is appended. */
type EventBody = HandoffEvent extends infer E ? (E extends HandoffEvent ? Omit<E, 'format' | 'seq' | 'previousSha256' | 'recordedAt'> : never) : never;

const eventFile = (seq: number): string => `${String(seq).padStart(6, '0')}.json`;
const EVENT_FILE = /^(\d{6})\.json$/;

type ReadRecord = { readonly ok: true; readonly events: readonly HandoffEvent[]; readonly tipSha256: string; readonly identity: fs.BigIntStats } | { readonly ok: false; readonly problem: string };

/**
 * Reads a handoff directory back: a real directory holding only this tool's numbered events (a
 * temporary file from an interrupted write, named with a leading dot, is ignored), contiguous from
 * one, each in this format and naming the digest of the one before it. Anything else is refused,
 * not repaired: a damaged record is for a person to look at.
 */
function readRecord(directory: string): ReadRecord {
  let stat: fs.BigIntStats;
  try {
    stat = fs.lstatSync(directory, { bigint: true });
  } catch {
    return { ok: false, problem: `${directory} does not exist; \`handoff begin\` creates a record.` };
  }
  if (!stat.isDirectory()) return { ok: false, problem: `${directory} is not a directory this command created.` };
  const names = fs.readdirSync(directory).filter((name) => !name.startsWith('.')).sort();
  const events: HandoffEvent[] = [];
  let tip: string | null = null;
  for (const [index, name] of names.entries()) {
    if (EVENT_FILE.exec(name)?.[1] !== String(index + 1).padStart(6, '0')) return { ok: false, problem: `${directory} holds ${name}, which is not the next event of a handoff record; it is not one this command wrote, or an event is missing.` };
    const bytes = fs.readFileSync(path.join(directory, name));
    let parsed: ReturnType<typeof EventSchema.safeParse>;
    try {
      parsed = EventSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    } catch {
      return { ok: false, problem: `${name} is not readable as an event of a handoff record.` };
    }
    if (!parsed.success) return { ok: false, problem: `${name} is not a valid event of a handoff record.` };
    const event = parsed.data;
    if (event.seq !== index + 1 || event.previousSha256 !== tip) return { ok: false, problem: `${name} does not follow the event before it; the record was altered.` };
    if ((event.type === 'begin') !== (index === 0)) return { ok: false, problem: `${name}: a record begins once, with its first event.` };
    events.push(event);
    tip = sha256(bytes);
  }
  if (events.length === 0 || tip === null) return { ok: false, problem: `${directory} holds no handoff record; \`handoff begin\` creates one.` };
  // What was read is one directory's record only if the path still names that directory.
  if (!isDirectoryAt(directory, stat)) return { ok: false, problem: `${directory} was replaced while the record was being read; nothing was read from it that can be trusted.` };
  return { ok: true, events, tipSha256: tip, identity: stat };
}

class Raced extends Error {}
class Interrupted extends Error {}
class Replaced extends Error {}

/** Whether `directory` names, right now, the very directory `identity` describes (not a link to it and not another directory put at the same path). */
function isDirectoryAt(directory: string, identity: fs.BigIntStats): boolean {
  try {
    return sameDirectory(fs.lstatSync(directory, { bigint: true }), identity);
  } catch {
    return false;
  }
}

/** The directory held open by its identity: a rename or replacement of its path afterwards does not change which directory this is. */
const OPEN_DIRECTORY = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);

/**
 * Appends one event as the next file, to the directory that was read and no other. The content is
 * written beside it first and then linked into place: a link fails when the name exists, so the
 * event is created whole or not at all, and a command that read the record before another one
 * appended is refused instead of overwriting or duplicating. An interrupt seen before the link
 * leaves no event.
 *
 * The name of the file protects the position in the record; `bound` protects which record. The
 * directory is opened and compared with the identity the caller read (or made), and where the
 * system names an open directory (`/proc/self/fd`) staging, link and cleanup all go through that
 * handle, so a path replaced afterwards cannot receive the event. The path is compared again
 * before the staged event is linked, and a replacement is refused with nothing recorded. Without
 * such a name (macOS) the temporary file is removed only while its name still shows the file that
 * was written, so a replacement is never cleaned; at worst this command's own ignored temporary
 * file stays behind.
 */
function appendEvent(directory: string, bound: fs.BigIntStats, previous: { readonly seq: number; readonly tipSha256: string | null }, body: EventBody, now: Date, signal: AbortSignal | undefined): void {
  let handle: number;
  try {
    handle = fs.openSync(directory, OPEN_DIRECTORY);
  } catch {
    throw new Replaced();
  }
  try {
    if (!sameDirectory(fs.fstatSync(handle, { bigint: true }), bound) || !isDirectoryAt(directory, bound)) throw new Replaced();
    const through = fs.existsSync(`/proc/self/fd/${handle}`) ? `/proc/self/fd/${handle}` : directory;
    const seq = previous.seq + 1;
    const event = { format: HANDOFF_FORMAT, seq, previousSha256: previous.tipSha256, recordedAt: now.toISOString(), ...body };
    const staged = path.join(through, `.${eventFile(seq)}.tmp-${randomBytes(6).toString('hex')}`);
    const written = fs.openSync(staged, 'wx');
    let ours: fs.BigIntStats;
    try {
      fs.writeFileSync(written, `${JSON.stringify(event, null, 2)}\n`);
      ours = fs.fstatSync(written, { bigint: true });
    } finally {
      fs.closeSync(written);
    }
    try {
      if (signal?.aborted) throw new Interrupted();
      if (!isDirectoryAt(directory, bound)) throw new Replaced();
      try {
        fs.linkSync(staged, path.join(through, eventFile(seq)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Raced();
        throw error;
      }
    } finally {
      removeStaged(staged, ours, through !== directory);
    }
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Removes the temporary file this command staged, and only that file. Through the open directory
 * (`/proc/self/fd`) the name cannot lead anywhere else. Through the path, the directory may have been
 * renamed or replaced since the file was written, and the same name may now be somebody else's file:
 * it is removed only while the name still shows the very file that was written. Where that cannot be
 * shown the file is left behind; a leftover temporary file has a leading dot and is ignored.
 */
function removeStaged(staged: string, ours: fs.BigIntStats, throughHandle: boolean): void {
  if (throughHandle) {
    fs.rmSync(staged, { force: true });
    return;
  }
  let named: fs.BigIntStats;
  try {
    named = fs.lstatSync(staged, { bigint: true });
  } catch {
    return;
  }
  if (named.isFile() && named.dev === ours.dev && named.ino === ours.ino) fs.rmSync(staged, { force: true });
}

// ---------------------------------------------------------------------------------------------
// The status the events give
// ---------------------------------------------------------------------------------------------

type SubmissionState =
  | { readonly state: 'not-submitted' }
  | { readonly state: 'attempt-unresolved'; readonly attemptSeq: number; readonly startedAt: string }
  | { readonly state: 'submitted'; readonly reference: string; readonly observedAt: string; readonly attemptSeq: number | null };
type ReviewState = { readonly state: 'not-started' } | { readonly state: (typeof REVIEW_STATES)[number]; readonly reference: string | null; readonly observedAt: string };
type ListingState = { readonly state: 'not-verified' } | { readonly state: (typeof LISTING_STATES)[number]; readonly host: string; readonly evidence: string; readonly observedAt: string; readonly release: EventOf<'listing-observed'>['release'] };

interface HandoffStatus {
  readonly begin: EventOf<'begin'>;
  readonly submission: SubmissionState;
  readonly review: ReviewState;
  readonly listing: ListingState;
}

function deriveStatus(events: readonly HandoffEvent[]): HandoffStatus {
  const begin = events[0] as EventOf<'begin'>;
  let submission: SubmissionState = { state: 'not-submitted' };
  let review: ReviewState = { state: 'not-started' };
  let listing: ListingState = { state: 'not-verified' };
  for (const event of events.slice(1)) {
    switch (event.type) {
      case 'begin':
        break;
      case 'submission-attempt':
        submission = { state: 'attempt-unresolved', attemptSeq: event.seq, startedAt: event.recordedAt };
        break;
      case 'attempt-voided':
        submission = { state: 'not-submitted' };
        break;
      case 'submission-confirmed':
        submission = { state: 'submitted', reference: event.reference, observedAt: event.observedAt, attemptSeq: event.attemptSeq };
        break;
      case 'review-observed':
        review = { state: event.state, reference: event.reference, observedAt: event.observedAt };
        break;
      case 'listing-observed':
        listing = { state: event.state, host: event.host, evidence: event.evidence, observedAt: event.observedAt, release: event.release };
        break;
    }
  }
  return { begin, submission, review, listing };
}

/** Whether the release the record pins is still the one a fresh preparation gives. */
type Freshness =
  | { readonly kind: 'not-checked' }
  | { readonly kind: 'current' }
  | { readonly kind: 'stale'; readonly changes: readonly string[] }
  | { readonly kind: 'unusable'; readonly problem: string };

/**
 * Compares the pinned release with a newer `prepare` output. The evidence is stale when the release
 * input, a view, a tool definition, a served resource, the deployment identity, the packages or
 * the package content differ, and a preparation that is not `ready` can never be current: nothing
 * submitted from unknown or failed evidence is a submission of this release.
 */
function freshnessOf(begin: EventOf<'begin'>, prepared: string | undefined, cwd: string): Freshness {
  if (prepared === undefined) return { kind: 'not-checked' };
  const directory = path.resolve(cwd, prepared);
  const current = readPreviousOutput(directory);
  if (current.kind === 'missing') return { kind: 'unusable', problem: current.problem };
  if (!current.intact) return { kind: 'unusable', problem: current.problem };
  const changes = staleness(begin.release, current.record);
  if (current.record.verdict !== 'ready') changes.push(`the current preparation is ${current.record.verdict}, not ready`);
  return changes.length === 0 ? { kind: 'current' } : { kind: 'stale', changes };
}

// ---------------------------------------------------------------------------------------------
// What a maintainer types
// ---------------------------------------------------------------------------------------------

/** A free-text field of the record: present, one line, bounded and carrying no credential. The record is plain text a person keeps, so a secret must not enter it. */
function freeText(option: string, value: string | undefined): { readonly value: string } | { readonly problem: string } {
  if (value === undefined || value.trim() === '') return { problem: `--${option} is required.` };
  const trimmed = value.trim();
  // eslint-disable-next-line no-control-regex
  if (trimmed.length > 500 || /[\u0000-\u001f\u007f]/.test(trimmed)) return { problem: `--${option} must be one line of at most 500 characters.` };
  const kinds = secretKinds(trimmed);
  if (kinds.length > 0) return { problem: `--${option} looks like it holds a ${kinds.join(', ')}. A handoff record holds references, never credentials; name where the credential is kept instead.` };
  return { value: trimmed };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The time of an observation as an instant: the one given (ISO 8601 with an offset), else the time the command runs. It cannot lie in the future. */
function observation(option: string, value: string | undefined, now: Date): { readonly value: string } | { readonly problem: string } {
  if (value === undefined) return { value: now.toISOString() };
  const parsed = ISO_INSTANT.test(value) ? new Date(value) : undefined;
  if (parsed === undefined || Number.isNaN(parsed.getTime())) return { problem: `--${option} must be an ISO 8601 time with an offset, such as 2026-10-21T09:30:00Z.` };
  if (parsed.getTime() > now.getTime()) return { problem: `--${option} ${value} is in the future; an observation is something that has happened.` };
  return { value: parsed.toISOString() };
}

const before = (earlier: string, later: string): boolean => Date.parse(later) < Date.parse(earlier);

/** The latest of the instants given: an observation is ordered after the newest one already recorded. */
const latest = (first: string, ...rest: readonly (string | undefined)[]): string => rest.reduce<string>((newest, value) => (value !== undefined && Date.parse(value) > Date.parse(newest) ? value : newest), first);

// ---------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------

type Decision =
  | { readonly kind: 'append'; readonly body: EventBody; readonly report: (seq: number) => string }
  | { readonly kind: 'unchanged'; readonly message: string }
  | { readonly kind: 'refuse'; readonly message: string };

const refuse = (message: string): Decision => ({ kind: 'refuse', message });

/** What a shell needs to read a path back as one word. */
const shellWord = (value: string | undefined): string => (value !== undefined && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${(value ?? '').replaceAll("'", "'\\''")}'`);

interface Context {
  readonly request: HandoffRequest;
  readonly status: HandoffStatus;
  readonly events: readonly HandoffEvent[];
  readonly now: Date;
  readonly freshness: Freshness;
}

/** What the maintainer must do before any further submission can be recorded, when an earlier one is not settled. */
function unresolvedMessage(handoff: string | undefined, status: HandoffStatus, attempt: Extract<SubmissionState, { state: 'attempt-unresolved' }>): string {
  const where = status.begin.host.portal ?? status.begin.host.guide;
  return [
    `A submission attempt began at ${attempt.startedAt} (event ${eventFile(attempt.attemptSeq)}) and its outcome was never recorded. The host may or may not hold it.`,
    `Inspect the existing submission in ${status.begin.host.name} (${where}) before anything else. Nothing was recorded now, and no new attempt is allowed until this one is settled:`,
    `  - if the host shows the submission:  saga publish handoff confirm-submission --handoff ${shellWord(handoff)} --reference <the host's reference>`,
    `  - if the host shows none for this release:  saga publish handoff void-attempt --handoff ${shellWord(handoff)} --inspected "<what you looked at>"`,
  ].join('\n');
}

function staleMessage(freshness: Freshness, doing: string): string | null {
  switch (freshness.kind) {
    case 'current':
      return null;
    case 'not-checked':
      return `${doing} needs --prepared DIR, the output of a current \`saga publish prepare\`, to confirm the release has not changed since this record was begun.`;
    case 'unusable':
      return `The current preparation cannot be used: ${freshness.problem}`;
    case 'stale':
      return `The release this record pins is no longer the current one: ${freshness.changes.join('; ')}. ${doing} is refused. Rerun \`saga publish prepare\`, and begin a new handoff for the new release.`;
  }
}

function decide(context: Context): Decision {
  switch (context.request.action) {
    case 'attempt':
      return decideAttempt(context);
    case 'confirm-submission':
      return decideConfirmation(context);
    case 'void-attempt':
      return decideVoid(context);
    case 'record-review':
      return decideReview(context);
    case 'record-listing':
      return decideListing(context);
    default:
      return refuse('This action does not change a record.');
  }
}

function decideAttempt({ request, status, freshness }: Context): Decision {
  const { submission, begin } = status;
  if (submission.state === 'submitted') return refuse(`Already submitted: ${begin.host.name} holds reference ${submission.reference}, observed ${submission.observedAt}. Submitting again would duplicate it; nothing was recorded.`);
  if (submission.state === 'attempt-unresolved') return refuse(unresolvedMessage(request.handoff, status, submission));
  const problem = staleMessage(freshness, 'A new submission attempt');
  if (problem !== null) return refuse(problem);
  return {
    kind: 'append',
    body: { type: 'submission-attempt' },
    report: (seq) =>
      [
        `Recorded the start of a submission attempt (event ${eventFile(seq)}). This tool submits nothing: submit by hand, as the intended publisher, in the host's own flow.`,
        '',
        `Host: ${begin.host.name}`,
        `Guide: ${begin.host.guide}`,
        ...(begin.host.portal === null ? [] : [`Portal: ${begin.host.portal}`]),
        `Publisher: ${begin.release.application.publisher.name}. Authority recorded for it (not verified here): ${begin.authority.join('; ')}`,
        `Materials: ${begin.release.artifact?.file ?? ''} (sha256 ${begin.release.artifact?.sha256 ?? ''}), the one pinned by this record`,
        '',
        'Only the publisher and the host can do these (from the prepared record):',
        ...begin.release.handoff.map((item) => `  - ${item.summary}`),
        '',
        'When the host shows the submission, record it:',
        `  saga publish handoff confirm-submission --handoff ${shellWord(request.handoff)} --reference <the host's reference>`,
        'If you cannot tell whether the host accepted it, do not submit again. Inspect the host\'s existing submission first; a new attempt is refused until this one is confirmed or voided.',
      ].join('\n'),
  };
}

function decideConfirmation({ request, status, now }: Context): Decision {
  const reference = freeText('reference', request.reference);
  if ('problem' in reference) return refuse(reference.problem);
  const { submission, begin } = status;
  if (submission.state === 'submitted') {
    return submission.reference === reference.value
      ? { kind: 'unchanged', message: `Submission ${reference.value} was already recorded (observed ${submission.observedAt}); nothing changed.` }
      : refuse(`A submission is already recorded with reference ${submission.reference}; ${reference.value} would be a second upload of the same release. Inspect ${begin.host.name} for the existing submission instead. Nothing was recorded.`);
  }
  const observed = observation('observed-at', request.observedAt, now);
  if ('problem' in observed) return refuse(observed.problem);
  const floor = submission.state === 'attempt-unresolved' ? submission.startedAt : begin.recordedAt;
  if (before(floor, observed.value)) return refuse(`--observed-at ${observed.value} is before ${floor}, when ${submission.state === 'attempt-unresolved' ? 'the attempt began' : 'this record was begun'}; a submission of this release cannot predate it.`);
  return {
    kind: 'append',
    body: { type: 'submission-confirmed', attemptSeq: submission.state === 'attempt-unresolved' ? submission.attemptSeq : null, reference: reference.value, observedAt: observed.value },
    report: (seq) => `Recorded submission ${reference.value} (event ${eventFile(seq)}). It is submitted, not reviewed and not live: record the host's review with \`record-review\` as it reports one.`,
  };
}

function decideVoid({ request, status, now }: Context): Decision {
  const { submission } = status;
  if (submission.state === 'submitted') return refuse(`A submission is recorded (${submission.reference}); there is no unsettled attempt to void.`);
  if (submission.state === 'not-submitted') return refuse('There is no unsettled attempt to void.');
  const inspected = freeText('inspected', request.inspected);
  if ('problem' in inspected) return refuse(`${inspected.problem} Say what you looked at in the host before concluding that no submission exists.`);
  const observed = observation('observed-at', request.observedAt, now);
  if ('problem' in observed) return refuse(observed.problem);
  if (before(submission.startedAt, observed.value)) return refuse(`--observed-at ${observed.value} is before the attempt began (${submission.startedAt}).`);
  return {
    kind: 'append',
    body: { type: 'attempt-voided', attemptSeq: submission.attemptSeq, inspected: inspected.value, observedAt: observed.value },
    report: (seq) => `Voided the attempt of ${eventFile(submission.attemptSeq)} after inspection (event ${eventFile(seq)}). A new attempt is now allowed.`,
  };
}

function decideReview({ request, status, now }: Context): Decision {
  const state = (REVIEW_STATES as readonly (string | undefined)[]).includes(request.state) ? (request.state as (typeof REVIEW_STATES)[number]) : undefined;
  if (state === undefined) return refuse(`--state must be one of ${REVIEW_STATES.join(', ')}.`);
  const { submission, review } = status;
  if (submission.state !== 'submitted') return refuse(submission.state === 'attempt-unresolved' ? `The submission attempt is unsettled, so no review can be recorded. ${unresolvedMessage(request.handoff, status, submission)}` : 'Nothing is submitted yet, so there is no review to record.');
  if (review.state === state) return { kind: 'unchanged', message: `The review is already recorded as ${state}; nothing changed.` };
  if (review.state !== 'not-started' && review.state !== 'in-review') return refuse(`The review is already recorded as ${review.state}, which ends this record. A changed submission is a new release and needs a new handoff.`);
  const reference = request.reference === undefined ? null : freeText('reference', request.reference);
  if (reference !== null && 'problem' in reference) return refuse(reference.problem);
  const observed = observation('observed-at', request.observedAt, now);
  if ('problem' in observed) return refuse(observed.problem);
  if (before(submission.observedAt, observed.value)) return refuse(`--observed-at ${observed.value} is before the submission was observed (${submission.observedAt}).`);
  // A resumed or delayed observation does not supersede a newer one with an older one.
  if (review.state !== 'not-started' && before(review.observedAt, observed.value)) return refuse(`--observed-at ${observed.value} is before the review was last observed as ${review.state} (${review.observedAt}); an older observation does not replace a newer one.`);
  return {
    kind: 'append',
    body: { type: 'review-observed', state, reference: reference === null ? null : reference.value, observedAt: observed.value },
    report: (seq) => `Recorded the host's review as ${state} (event ${eventFile(seq)}).${state === 'approved' ? ' An approval is not a live listing: record the listing only when you have seen it on a named host.' : ''}`,
  };
}

function decideListing({ request, status, now, freshness }: Context): Decision {
  const state = (LISTING_STATES as readonly (string | undefined)[]).includes(request.state) ? (request.state as (typeof LISTING_STATES)[number]) : undefined;
  if (state === undefined) return refuse(`--state must be one of ${LISTING_STATES.join(', ')}.`);
  const { review, listing, begin } = status;
  if (review.state !== 'approved') return refuse(`The host's review is ${review.state}; a listing is observed only after an approval is recorded.`);
  // Readiness of the current release comes before any idempotent answer: a recorded live observation is history, and it does not excuse changed or unusable evidence.
  const problem = staleMessage(freshness, 'Recording the listing');
  if (problem !== null) return refuse(listing.state === 'verified-live' ? `${problem} The earlier observation (verified live on ${listing.host}, ${listing.evidence}, observed ${listing.observedAt}) stays in the record as made for the release this record pins; it is not evidence that the current release is live.` : problem);
  if (listing.state === 'verified-live') {
    return state === 'verified-live' ? { kind: 'unchanged', message: `The listing was already verified live on ${listing.host} (${listing.evidence}), observed ${listing.observedAt}, for the release this record pins, which is still the current one; nothing changed.` } : refuse(`The listing is recorded as verified live on ${listing.host}; a later withdrawal is a new observation of a new release.`);
  }
  const named = freeText('host', request.host);
  if ('problem' in named) return refuse(`${named.problem} A listing is verified on a named host: say which (for example the web client and workspace you looked at).`);
  const evidence = freeText('evidence', request.evidence);
  if ('problem' in evidence) return refuse(`${evidence.problem} Name the reference to what you observed (a link, a recording, a note).`);
  const observed = observation('observed-at', request.observedAt, now);
  if ('problem' in observed) return refuse(observed.problem);
  if (before(review.observedAt, observed.value)) return refuse(`--observed-at ${observed.value} is before the approval was observed (${review.observedAt}).`);
  if (listing.state !== 'not-verified' && before(latest(review.observedAt, listing.observedAt), observed.value)) return refuse(`--observed-at ${observed.value} is before the listing was last observed as ${listing.state} (${listing.observedAt}); an older observation does not replace a newer one.`);
  return {
    kind: 'append',
    body: {
      type: 'listing-observed',
      state,
      host: named.value,
      evidence: evidence.value,
      observedAt: observed.value,
      release: { artifactSha256: begin.release.artifact?.sha256 ?? '', contractSha256: begin.release.endpoint.contractSha256 },
    },
    report: (seq) => `Recorded the listing as ${state} on ${named.value} (event ${eventFile(seq)}).`,
  };
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

function statusReport(status: HandoffStatus, freshness: Freshness): { readonly text: string; readonly attention: boolean } {
  const { begin, submission, review, listing } = status;
  const stale = freshness.kind === 'stale' || freshness.kind === 'unusable';
  const lines = [
    `saga publish handoff status (${begin.host.target}): ${begin.handoffId}`,
    '',
    `Host: ${begin.host.name}`,
    `Application: ${begin.release.application.name} ${begin.release.application.version}; publisher ${begin.release.application.publisher.name}`,
    `Release: package ${begin.release.artifact?.file ?? ''} sha256 ${begin.release.artifact?.sha256 ?? ''}; source ${begin.release.source.revision ?? 'unknown'}${begin.release.source.dirty === true ? ' (modified)' : ''}; deployment identity ${begin.release.endpoint.deploymentIdentity.status}`,
    `Authority references (recorded, not verified): ${begin.authority.join('; ')}`,
    '',
  ];
  const row = (label: string, value: string): void => void lines.push(`  ${label.padEnd(13)} ${value}`);
  row('Preparation', stale ? `stale (was ready when recorded ${begin.recordedAt})` : `ready (recorded ${begin.recordedAt}; ${begin.release.artifact?.file ?? ''} bound to ${begin.preparedRecordSha256.slice(0, 12)})`);
  row('Submission', submission.state === 'submitted' ? `submitted, reference ${submission.reference} (observed ${submission.observedAt})` : submission.state === 'attempt-unresolved' ? `UNRESOLVED attempt since ${submission.startedAt}; the host may hold it` : 'not submitted');
  row('Review', review.state === 'not-started' ? 'not started' : `${review.state} (observed ${review.observedAt})`);
  row(
    'Live listing',
    listing.state === 'not-verified'
      ? 'not verified (neither a package, a submission nor an approval is a live listing)'
      : `${listing.state} on ${listing.host} (${listing.evidence}; observed ${listing.observedAt})${stale && listing.state === 'verified-live' ? '; observed for the earlier release, so recheck it on the named host' : ''}`,
  );
  lines.push('');
  switch (freshness.kind) {
    case 'not-checked':
      lines.push('Freshness: not checked. Pass --prepared DIR (a current `saga publish prepare` output) to compare the pinned release with it.');
      break;
    case 'current':
      lines.push('Freshness: current. Nothing the pinned evidence depends on has changed.');
      break;
    case 'stale':
      lines.push(`Freshness: STALE. Changed since this record was begun: ${freshness.changes.join('; ')}.`, 'Readiness is invalidated: no new attempt or listing is recorded against this release. Rerun prepare and begin a new handoff; what the host already holds for the old release stays as recorded.');
      break;
    case 'unusable':
      lines.push(`Freshness: unknown. ${freshness.problem}`);
      break;
  }
  const next =
    submission.state === 'attempt-unresolved'
      ? 'Next: inspect the host for the existing submission, then confirm-submission or void-attempt. Do not submit again until then.'
      : submission.state === 'not-submitted'
        ? 'Next: `attempt`, then submit by hand in the host\'s flow.'
        : review.state === 'not-started' || review.state === 'in-review'
          ? 'Next: record the host\'s review (`record-review`) as it reports one.'
          : review.state === 'approved' && listing.state === 'not-verified'
            ? 'Next: when the listing is installed on a named host and you have observed it, `record-listing`.'
            : null;
  if (next !== null) lines.push(next);
  lines.push('Nothing was deployed, uploaded, submitted or published.');
  return { text: `${lines.join('\n')}\n`, attention: stale || submission.state === 'attempt-unresolved' };
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

const requireOption = (io: HandoffIo, action: string, options: Readonly<Record<string, string | undefined>>): boolean => {
  const missing = Object.entries(options).filter(([, value]) => value === undefined).map(([name]) => `--${name}`);
  if (missing.length === 0) return true;
  io.stderr(`saga publish handoff ${action}: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required.\n`);
  return false;
};

const statDirectory = (directory: string): fs.BigIntStats | undefined => {
  try {
    return fs.lstatSync(directory, { bigint: true });
  } catch {
    return undefined;
  }
};

/** `begin`: pins one prepared, ready release to the host it was prepared for and to the authority references of its intended publisher. */
function begin(request: HandoffRequest, io: HandoffIo): number {
  if (!requireOption(io, 'begin', { handoff: request.handoff, prepared: request.prepared })) return EXIT_USAGE;
  if (request.authorityRefs.length === 0) {
    io.stderr('saga publish handoff begin: --authority-ref is required, at least once: where the intended publisher\'s authority to submit is recorded (a ticket, an agreement, the owner\'s confirmation). It is kept as a reference and not verified here.\n');
    return EXIT_USAGE;
  }
  const authority: string[] = [];
  for (const ref of request.authorityRefs) {
    const checked = freeText('authority-ref', ref);
    if ('problem' in checked) {
      io.stderr(`saga publish handoff begin: ${checked.problem}\n`);
      return EXIT_REFUSED;
    }
    authority.push(checked.value);
  }
  const prepared = readPreviousOutput(path.resolve(io.cwd, request.prepared as string));
  if (prepared.kind === 'missing') {
    io.stderr(`saga publish handoff begin: ${prepared.problem} Pass the directory a \`saga publish prepare\` run wrote.\n`);
    return EXIT_REFUSED;
  }
  if (!prepared.intact) {
    io.stderr(`saga publish handoff begin: the prepared output was altered or is incomplete: ${prepared.problem} Run prepare again.\n`);
    return EXIT_REFUSED;
  }
  const { record } = prepared;
  if (record.verdict !== 'ready' || record.artifact === null) {
    io.stderr(`saga publish handoff begin: the prepared release is ${record.verdict}, not ready, so there is nothing to hand off. Resolve the findings in ${RECORD_FILE} and prepare again.\n`);
    return EXIT_REFUSED;
  }
  if (record.artifact.file !== ARCHIVE_FILES[record.target]) {
    io.stderr('saga publish handoff begin: the prepared record names a package this tool does not write for its target.\n');
    return EXIT_REFUSED;
  }

  const directory = path.resolve(io.cwd, request.handoff as string);
  const parent = path.dirname(directory);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    io.stderr(`saga publish handoff begin: the parent directory ${parent} does not exist; create it first or choose a path inside an existing directory.\n`);
    return EXIT_REFUSED;
  }
  const existing = statDirectory(directory);
  if (existing !== undefined && (!existing.isDirectory() || fs.readdirSync(directory).some((name) => !name.startsWith('.')))) {
    io.stderr(`saga publish handoff begin: ${directory} ${existing.isDirectory() ? 'already holds files; resume a record there with `handoff status`, or choose a new directory' : 'is not a directory'}. Nothing was changed.\n`);
    return EXIT_REFUSED;
  }
  const created = existing === undefined;
  if (created) fs.mkdirSync(directory);
  const ours = statDirectory(directory);
  if (ours === undefined) {
    io.stderr(`saga publish handoff begin: ${directory} could not be read after it was made. Nothing was recorded.\n`);
    return EXIT_REFUSED;
  }
  // The directory this command made is removed again only while it is still that directory and empty.
  const abandon = (): void => {
    const now = statDirectory(directory);
    if (created && now !== undefined && sameDirectory(now, ours) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  };

  const host = HOST_DIRECTORIES[record.target];
  const body: EventBody = {
    type: 'begin',
    handoffId: canonicalDigest({ target: record.target, application: record.application.name, publisher: record.application.publisher.name, package: record.artifact.sha256 }).slice(0, 16),
    host: { target: record.target, name: host.name, guide: host.guide, portal: host.portal },
    preparedRecordSha256: prepared.recordSha256,
    release: pinned(record),
    authority,
  };
  try {
    appendEvent(directory, ours, { seq: 0, tipSha256: null }, body, io.now(), io.signal);
  } catch (error) {
    abandon();
    return failedAppend(error, io, 'begin');
  }
  io.stdout(
    [
      `Began a ${host.name} handoff ${(body as EventOf<'begin'>).handoffId} in ${request.handoff}.`,
      `Pinned release: ${record.artifact.file} sha256 ${record.artifact.sha256}; contract ${record.endpoint.contractSha256 ?? 'not read'}; deployment identity ${record.endpoint.deploymentIdentity.status}.`,
      `Publisher: ${record.application.publisher.name}; authority references recorded, not verified: ${authority.join('; ')}.`,
      'Preparation is recorded as ready. Nothing is submitted, in review or live.',
      'Next: `saga publish handoff attempt`, then submit by hand in the host\'s own flow.',
      'Nothing was deployed, uploaded, submitted or published.',
      '',
    ].join('\n'),
  );
  return 0;
}

/** The sections of the prepared record a handoff keeps: what is compared later, and nothing the findings echo from the release input. */
function pinned(record: ReleaseEvidence): ReleaseEvidence {
  const { target, verdict, source, application, inputs, endpoint, validators, artifact, handoff } = record;
  return { target, verdict, source, application, inputs, endpoint, validators, artifact, handoff };
}

function failedAppend(error: unknown, io: HandoffIo, action: string): number {
  if (error instanceof Interrupted) {
    io.stderr(`saga publish handoff ${action}: interrupted; nothing was recorded.\n`);
    return EXIT_INTERRUPTED;
  }
  if (error instanceof Replaced) {
    io.stderr(`saga publish handoff ${action}: the handoff directory was replaced while this command was running, so nothing was recorded and no file in the directory now at that path was changed or removed. Read the record with \`handoff status\` and decide again.\n`);
    return EXIT_REFUSED;
  }
  if (error instanceof Raced) {
    io.stderr(`saga publish handoff ${action}: the record changed while this command was running (another command recorded an event first), so nothing was recorded. Read it with \`handoff status\` and decide again.\n`);
    return EXIT_REFUSED;
  }
  throw error;
}

/** The options an action cannot go on without. */
function neededBy(request: HandoffRequest): Readonly<Record<string, string | undefined>> {
  switch (request.action) {
    case 'attempt':
      return { prepared: request.prepared };
    case 'confirm-submission':
      return { reference: request.reference };
    case 'void-attempt':
      return { inspected: request.inspected };
    case 'record-review':
      return { state: request.state };
    case 'record-listing':
      return { prepared: request.prepared, state: request.state, host: request.host, evidence: request.evidence };
    default:
      return {};
  }
}

export async function runHandoff(request: HandoffRequest, io: HandoffIo): Promise<number> {
  if (io.signal?.aborted) {
    io.stderr('saga publish handoff: interrupted before anything was read or written.\n');
    return EXIT_INTERRUPTED;
  }
  if (request.action === 'begin') return begin(request, io);
  if (!requireOption(io, request.action, { handoff: request.handoff })) return EXIT_USAGE;
  const read = readRecord(path.resolve(io.cwd, request.handoff as string));
  if (!read.ok) {
    io.stderr(`saga publish handoff ${request.action}: ${read.problem}\n`);
    return EXIT_REFUSED;
  }
  const status = deriveStatus(read.events);
  const freshness = freshnessOf(status.begin, request.prepared, io.cwd);
  if (request.action === 'status') {
    const report = statusReport(status, freshness);
    io.stdout(report.text);
    return report.attention ? EXIT_REFUSED : 0;
  }
  if (!requireOption(io, request.action, neededBy(request))) return EXIT_USAGE;
  const decision = decide({ request, status, events: read.events, now: io.now(), freshness });
  if (decision.kind === 'refuse') {
    io.stderr(`saga publish handoff ${request.action}: ${decision.message}\n`);
    return EXIT_REFUSED;
  }
  if (decision.kind === 'unchanged') {
    io.stdout(`${decision.message}\n`);
    return 0;
  }
  const last = read.events[read.events.length - 1] as HandoffEvent;
  try {
    appendEvent(path.resolve(io.cwd, request.handoff as string), read.identity, { seq: last.seq, tipSha256: read.tipSha256 }, decision.body, io.now(), io.signal);
  } catch (error) {
    return failedAppend(error, io, request.action);
  }
  io.stdout(`${decision.report(last.seq + 1)}\nNothing was deployed, uploaded, submitted or published.\n`);
  return 0;
}
