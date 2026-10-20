import fs from 'node:fs';
import path from 'node:path';
import { ARCHIVE_FILE, RECORD_FILE, RECORD_FORMAT, sha256, type PublicationRecord } from './record.js';

// A previously prepared output directory, read back so a new check can say what changed since
// (CLI3 #66). Evidence recorded earlier is stale when the release input, a built view, a tool
// definition, a served resource, the deployment identity or the package content differs now; the
// difference names which, so only the affected checks are rerun.

export type PreviousOutput =
  | { readonly kind: 'found'; readonly record: PublicationRecord; readonly intact: true }
  | { readonly kind: 'found'; readonly record: PublicationRecord; readonly intact: false; readonly problem: string }
  | { readonly kind: 'missing'; readonly problem: string };

export function readPreviousOutput(directory: string): PreviousOutput {
  let record: PublicationRecord;
  try {
    record = JSON.parse(fs.readFileSync(path.join(directory, RECORD_FILE), 'utf8')) as PublicationRecord;
  } catch {
    return { kind: 'missing', problem: `${path.join(directory, RECORD_FILE)} cannot be read as a findings record.` };
  }
  if (record?.format !== RECORD_FORMAT) return { kind: 'missing', problem: `${path.join(directory, RECORD_FILE)} is not a ${RECORD_FORMAT} record.` };
  if (record.artifact === null) return { kind: 'found', record, intact: true };
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(directory, ARCHIVE_FILE));
  } catch {
    return { kind: 'found', record, intact: false, problem: `The record names ${ARCHIVE_FILE}, which is missing.` };
  }
  return sha256(bytes) === record.artifact.sha256 ? { kind: 'found', record, intact: true } : { kind: 'found', record, intact: false, problem: `${ARCHIVE_FILE} no longer matches the digest in the record.` };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What differs between an earlier record and the one just computed, in words. Empty when nothing the evidence depends on changed. */
export function staleness(previous: PublicationRecord, current: PublicationRecord): string[] {
  const changes: string[] = [];
  if (previous.inputs.releaseInput.sha256 !== current.inputs.releaseInput.sha256) changes.push('the release input changed');
  if (!same(previous.inputs.views, current.inputs.views)) changes.push('a built view changed');
  if (!same(previous.endpoint.tools, current.endpoint.tools)) changes.push('the tool definitions changed');
  // Resources are compared with their metadata: a view's content security policy lives there, and a
  // change to the origins it may reach changes what the host permits without changing a byte of the view.
  const withoutMeta = (resources: PublicationRecord['endpoint']['resources']): unknown => resources.map(({ metaSha256: _meta, ...rest }) => rest);
  if (!same(withoutMeta(previous.endpoint.resources), withoutMeta(current.endpoint.resources))) changes.push('a served resource changed');
  if (!same(previous.endpoint.resources.map((one) => one.metaSha256), current.endpoint.resources.map((one) => one.metaSha256))) changes.push('a served resource\'s metadata (its content security policy and permissions) changed');
  if (previous.endpoint.instructionsSha256 !== current.endpoint.instructionsSha256) changes.push('the server instructions changed');
  if (previous.endpoint.contractSha256 !== current.endpoint.contractSha256 && changes.length === 0) changes.push('the served contract changed');
  if (!same(previous.endpoint.server, current.endpoint.server) || previous.endpoint.deploymentIdentity.status !== current.endpoint.deploymentIdentity.status) changes.push('the deployment identity changed');
  if (!same(previous.application.sagaPackages, current.application.sagaPackages)) changes.push('the declared or installed @saga-a2ui packages changed');
  // The evidence is only as good as the validators and the documentation it was judged by.
  if (!same(previous.validators, current.validators)) changes.push('the validator or the documentation it was checked against changed');
  if (previous.endpoint.complete !== current.endpoint.complete) changes.push('how much of the endpoint could be read changed');
  if (previous.artifact?.sha256 !== current.artifact?.sha256) changes.push('the package content changed');
  return changes;
}
