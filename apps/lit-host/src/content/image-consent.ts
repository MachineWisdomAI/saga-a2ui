// Reader consent to load images under the Strict level. It is revocable state that belongs to one
// view, separate from the immutable content policy: the policy decides which images could ever
// load, and a live grant is one input to that decision (`ImageContext.consent`). A grant cannot
// relax the policy, outlive the content it was given for, or pass from one view to another.
//
// Each grant is a one-way switch: live when made, dead once revoked, never restored. A new Show
// images press is a new grant, so an old callback or a late result holding a revoked grant cannot
// bring images back. A scope is created per view, so there is no module-wide consent and two
// views never see each other's.

export interface ImageConsent {
  /** True from the grant until it is revoked, by its holder or by the view. */
  readonly live: boolean;
  /** Idempotent. Used by Hide images, a content change and disposal. */
  revoke(): void;
}

export interface ConsentSubscription {
  unsubscribe(): void;
}

/** One view's consent: the grants made in it, and the one way to retire them all. */
export interface ImageConsentScope {
  /** Records the reader's consent now. The caller binds it to the content it was given for. */
  grant(): ImageConsent;
  /**
   * Retires every live grant in this view, for example when a new tool result replaces the
   * selection, the host tears the view down, or a retirement signal the view already observes
   * arrives. Subscribers are told after the grants are dead, so they re-render without images.
   */
  revokeAll(): void;
  /** Called after each `revokeAll`. */
  subscribe(onRevokeAll: () => void): ConsentSubscription;
}

export function createImageConsentScope(): ImageConsentScope {
  const liveGrants = new Set<{ live: boolean }>();
  const subscribers = new Set<() => void>();

  return {
    grant(): ImageConsent {
      const state = { live: true };
      liveGrants.add(state);
      return {
        get live() {
          return state.live;
        },
        revoke() {
          state.live = false;
          liveGrants.delete(state);
        },
      };
    },
    revokeAll() {
      for (const state of liveGrants) state.live = false;
      liveGrants.clear();
      for (const notify of [...subscribers]) notify();
    },
    subscribe(onRevokeAll) {
      subscribers.add(onRevokeAll);
      return { unsubscribe: () => void subscribers.delete(onRevokeAll) };
    },
  };
}
