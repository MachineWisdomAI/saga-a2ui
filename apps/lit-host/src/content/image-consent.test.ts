import { describe, expect, it } from 'vitest';
import { createImageConsentScope } from './image-consent.js';

// Reader consent to load images is revocable state owned by one view. These tests use only the
// scope's own interface: granting, revoking and observing revocation.

describe('a consent grant', () => {
  it('is live when granted and stays dead once revoked', () => {
    const scope = createImageConsentScope();
    const grant = scope.grant();
    expect(grant.live).toBe(true);
    grant.revoke();
    expect(grant.live).toBe(false);
    grant.revoke(); // revoking again changes nothing
    expect(grant.live).toBe(false);
  });

  it('cannot be restored: a later grant is a different one', () => {
    const scope = createImageConsentScope();
    const first = scope.grant();
    first.revoke();
    const second = scope.grant();
    expect(second.live).toBe(true);
    expect(first.live).toBe(false);
    expect(second).not.toBe(first);
  });

  it('is independent of other grants in the same scope', () => {
    const scope = createImageConsentScope();
    const a = scope.grant();
    const b = scope.grant();
    a.revoke();
    expect(b.live).toBe(true);
  });
});

describe('revoking a whole view', () => {
  it('retires every live grant, and a grant made afterwards is fresh', () => {
    const scope = createImageConsentScope();
    const a = scope.grant();
    const b = scope.grant();
    scope.revokeAll();
    expect([a.live, b.live]).toEqual([false, false]);
    const fresh = scope.grant();
    expect(fresh.live).toBe(true);
    expect(a.live).toBe(false);
  });

  it('tells subscribers once per revocation, and not after they unsubscribe', () => {
    const scope = createImageConsentScope();
    const calls: string[] = [];
    const first = scope.subscribe(() => calls.push('first'));
    scope.subscribe(() => calls.push('second'));
    scope.revokeAll();
    expect(calls).toEqual(['first', 'second']);
    first.unsubscribe();
    scope.revokeAll();
    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('does not reach another view: scopes share no consent', () => {
    const viewA = createImageConsentScope();
    const viewB = createImageConsentScope();
    const inA = viewA.grant();
    const inB = viewB.grant();
    viewA.revokeAll();
    expect(inA.live).toBe(false);
    expect(inB.live).toBe(true);
    viewB.revokeAll();
    expect(inB.live).toBe(false);
  });

  it('leaves a grant revoked by its holder dead when the view is revoked later', () => {
    const scope = createImageConsentScope();
    const grant = scope.grant();
    grant.revoke();
    scope.revokeAll();
    expect(grant.live).toBe(false);
  });
});
