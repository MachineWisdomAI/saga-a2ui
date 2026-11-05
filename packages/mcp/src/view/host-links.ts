import type { App } from '@modelcontextprotocol/ext-apps';
import type { HostLinks } from '@saga-a2ui/core/host-links';
import { untilEnded } from './until-ended.js';

/**
 * Opens validated links through the upstream MCP Apps `ui/open-link` request, and only when the
 * host advertised the `openLinks` capability. The capability is read at call time, so the links can
 * be built before the bridge has connected. There is no fallback: without the capability nothing is
 * requested and nothing navigates.
 *
 * Outcomes: `unavailable` without the capability or once `signal` has aborted (also when it aborts
 * while a request is outstanding, so a view that has ended hears of no late result), `denied` when
 * the host answers with `isError`, `failed` when the request rejects, `opened` otherwise. The
 * request is not cancelled on abort (the bridge offers no way to); its late answer is dropped.
 */
export function hostLinksFromApp(app: App, signal?: AbortSignal): HostLinks {
  // A function, not a local: the signal can abort while a request is awaited.
  const ended = (): boolean => signal?.aborted === true;
  return {
    async open(url) {
      if (ended() || app.getHostCapabilities()?.openLinks === undefined)
        return 'unavailable';
      try {
        // Raced against the view's lifetime: the bridge cannot cancel the request, so a host that
        // never answers must not leave this call (and the link control waiting on it) pending.
        const result = await untilEnded(app.openLink({ url }), signal);
        // `undefined` is the settlement of an ended view, never a host's answer.
        if (ended() || result === undefined) return 'unavailable';
        return result.isError === true ? 'denied' : 'opened';
      } catch {
        return ended() ? 'unavailable' : 'failed';
      }
    },
  };
}
