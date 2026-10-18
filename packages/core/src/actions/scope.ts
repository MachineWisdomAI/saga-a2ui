import { discardOutcome, isThenable, type Synchronous } from './thenable.js';

// Resource ownership for one invocation. A resource is anything an invocation acquires that
// someone must give back. The scope owns whatever has been handed to it and releases it when the
// invocation ends; the application's resource owner stays responsible for what a token means: that
// `release(token)` affects only the acquisition the token names, that it is idempotent and a no-op
// for a token the owner has since superseded, and that stopping everything the owner holds is the
// owner's own teardown and never an invocation's shortcut. The runtime never calls such a
// whole-owner operation: it has no way to name one.

export interface ReleaseContext {
  /** Aborts when this release step's `hookMs` budget runs out. */
  readonly signal: AbortSignal;
}

/**
 * Must affect only the acquisition that `token` identifies, and must be a no-op when the owner has
 * since superseded that token. The scope calls it once per owned token that was not transferred.
 */
export type Release<Token> = (token: Token, context: ReleaseContext) => void | PromiseLike<void>;

/** A token the scope owns, and the one way to hand it to a longer-lived owner. */
export interface Held<Token> {
  readonly token: Token;
  /**
   * Moves responsibility for the token to `adopt`, which is called synchronously and must finish
   * synchronously. Returns true when `adopt` returned a non-thenable value and the invocation was
   * still active: the owner now holds the token and the scope will not release it. Returns false
   * and adopts nothing when the invocation had already ended (the scope has released or will
   * release the token) or when the scope no longer holds it (already transferred). If `adopt`
   * throws, the throw propagates and ownership stays with the scope. If it returns a thenable the
   * types could not see, `transfer` throws a `TypeError`, ownership stays with the scope, and a
   * later rejection reaches the observer as a `cleanup-error` with step `adopt`. Work the callback
   * already started is not recalled, so the owner's own `end(token)` must be idempotent.
   */
  transfer<Returned>(adopt: (token: Token) => Returned, ...synchronous: Synchronous<Returned>): boolean;
}

/** The part of the scope that may be used inside the event turn. */
export interface ActivationScope {
  /** True from the start of the invocation until its outcome is decided (work activity, not freshness). */
  readonly active: boolean;
  /**
   * Takes responsibility for a token the caller already holds, synchronously. Needs `limits`. If
   * the invocation has already ended, the token is released at once and the call throws
   * `InvocationEndedError`.
   */
  own<Token>(token: Token, release: Release<Token>): Held<Token>;
}

export interface InvocationScope extends ActivationScope {
  /**
   * Awaits an acquisition, then owns its token. A token that arrives after the invocation ended is
   * released at once and the acquisition rejects with `InvocationEndedError`; an invocation that has
   * already ended does not start the acquisition at all.
   */
  acquire<Token>(acquire: () => Token | PromiseLike<Token>, release: Release<Token>): Promise<Held<Token>>;
}

/** The invocation's outcome was already decided, so nothing may be added to its scope. */
export class InvocationEndedError extends Error {
  constructor(label: string) {
    super(`Action '${label}': the invocation has ended, so the token was released instead of owned.`);
    this.name = 'InvocationEndedError';
  }
}

/** What the scope needs to know about the invocation that owns it. */
export interface ScopeHost {
  readonly label: string;
  /** True until the outcome is decided. */
  isActive(): boolean;
  /** The required budget for every release; absent when the definition declared no limits. */
  hookMs(): number | undefined;
  /** Tells the observer that a step outside the invocation's own sequence failed or stalled. */
  report(step: 'release' | 'adopt'): void;
}

/** A token the scope holds, with the release that returns it. */
export interface Hold {
  readonly token: unknown;
  readonly release: Release<unknown>;
}

type EntryState = 'held' | 'adopting' | 'transferred' | 'taken';
interface Entry extends Hold {
  state: EntryState;
}

/** The tokens one invocation owns, in the order it came to own them. */
export class InvocationResources {
  private readonly entries: Entry[] = [];

  /** The scope an `atActivation` callback receives: synchronous ownership only, so no `acquire`. */
  readonly activation: ActivationScope;
  /** The scope prerequisites and the handler receive. */
  readonly invocation: InvocationScope;

  constructor(private readonly host: ScopeHost) {
    const active = (): boolean => host.isActive();
    const own = <Token>(token: Token, release: Release<Token>): Held<Token> => this.own(token, release);
    this.activation = Object.freeze({
      get active() {
        return active();
      },
      own,
    });
    this.invocation = Object.freeze({
      get active() {
        return active();
      },
      own,
      acquire: <Token>(acquire: () => Token | PromiseLike<Token>, release: Release<Token>): Promise<Held<Token>> =>
        this.acquire(acquire, release),
    });
  }

  /**
   * Removes and returns the token owned most recently that the scope still holds, or undefined.
   * The runtime releases what it takes one per step, so that each release has its own budget.
   */
  takeLast(): Hold | undefined {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry?.state !== 'held') continue;
      entry.state = 'taken';
      this.entries.splice(index, 1);
      return entry;
    }
    return undefined;
  }

  private own<Token>(token: Token, release: Release<Token>): Held<Token> {
    const { host } = this;
    if (typeof release !== 'function') throw new TypeError(`Action '${host.label}': scope.own needs a release function.`);
    const hookMs = host.hookMs();
    if (hookMs === undefined) {
      throw new Error(
        `Action '${host.label}': holding a resource through the scope needs limits({ hookMs }), which bounds each release.`,
      );
    }
    // Interop assertion: the entry keeps `token` and `release` together, so the scope only ever
    // calls this release with the token it was given.
    const erased = release as Release<unknown>;
    if (!host.isActive()) {
      this.releaseAtOnce(token, erased, hookMs);
      throw new InvocationEndedError(host.label);
    }
    const entry: Entry = { token, release: erased, state: 'held' };
    this.entries.push(entry);
    return Object.freeze({
      token,
      transfer: <Returned>(adopt: (token: Token) => Returned, ...synchronous: Synchronous<Returned>): boolean => {
        void synchronous;
        return this.transfer(entry, adopt);
      },
    });
  }

  private async acquire<Token>(acquire: () => Token | PromiseLike<Token>, release: Release<Token>): Promise<Held<Token>> {
    if (typeof acquire !== 'function') throw new TypeError(`Action '${this.host.label}': scope.acquire needs an acquire function.`);
    if (!this.host.isActive()) throw new InvocationEndedError(this.host.label);
    const token = await acquire();
    // Ownership begins when the token exists. If the invocation ended meanwhile, `own` releases it
    // at once and this acquisition rejects.
    return this.own(token, release);
  }

  private transfer<Token>(entry: Entry, adopt: (token: Token) => unknown): boolean {
    if (entry.state !== 'held' || !this.host.isActive()) return false;
    if (typeof adopt !== 'function') throw new TypeError(`Action '${this.host.label}': transfer needs an adopt function.`);
    // While the owner adopts, the entry is not the runtime's to release, whatever adoption does.
    entry.state = 'adopting';
    let returned: unknown;
    try {
      // Interop assertion: `entry.token` is the `Token` this `Held` was created with.
      returned = adopt(entry.token as Token);
    } catch (error) {
      this.adoptionRefused(entry);
      throw error;
    }
    if (isThenable(returned)) {
      this.reportLateRejection(returned);
      this.adoptionRefused(entry);
      throw new TypeError(
        `Action '${this.host.label}': the adopt callback returned a promise. Adoption is synchronous, ` +
          'so the scope still owns the token and will release it.',
      );
    }
    entry.state = 'transferred';
    this.remove(entry);
    return true;
  }

  /**
   * The owner did not take the token, so the scope still owns it. If the invocation ended while the
   * owner was adopting, the end-of-invocation release may already have passed over this entry:
   * release it now rather than leak it.
   */
  private adoptionRefused(entry: Entry): void {
    entry.state = 'held';
    if (this.host.isActive()) return;
    const hookMs = this.host.hookMs();
    if (hookMs === undefined) return;
    entry.state = 'taken';
    this.remove(entry);
    this.releaseAtOnce(entry.token, entry.release, hookMs);
  }

  private remove(entry: Entry): void {
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  private reportLateRejection(thenable: PromiseLike<unknown>): void {
    try {
      thenable.then(undefined, () => this.host.report('adopt'));
    } catch {
      // A hostile `then` that throws has nothing more to report.
      discardOutcome(thenable);
    }
  }

  /**
   * Releases a token the invocation can no longer own, with no hook involved and within `hookMs`. A
   * failure or overrun reaches only the observer: the outcome and the hooks are long past.
   */
  private releaseAtOnce(token: unknown, release: Release<unknown>, hookMs: number): void {
    const controller = new AbortController();
    let returned: unknown;
    try {
      returned = release(token, { signal: controller.signal });
    } catch {
      this.host.report('release');
      return;
    }
    if (!isThenable(returned)) return;
    let waiting = true;
    const timer = setTimeout(() => {
      if (!waiting) return;
      waiting = false;
      controller.abort();
      this.host.report('release');
    }, hookMs);
    const stop = (failed: boolean): void => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      if (failed) this.host.report('release');
    };
    try {
      returned.then(
        () => stop(false),
        () => stop(true),
      );
    } catch {
      stop(true);
    }
  }
}
