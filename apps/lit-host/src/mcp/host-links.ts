import type { App } from '@modelcontextprotocol/ext-apps';
import type { HostLinks } from '@saga-a2ui/components/faithful-card';

/**
 * Opens validated links through the upstream MCP Apps `ui/open-link` request, and only when the
 * host advertised the `openLinks` capability. The capability is read at call time, so the view can
 * be built before the bridge has connected. There is no fallback: without the capability nothing
 * is requested and nothing navigates.
 */
export function createAppHostLinks(app: App): HostLinks {
  return {
    async open(url) {
      if (app.getHostCapabilities()?.openLinks === undefined) return 'unavailable';
      try {
        const result = await app.openLink({ url });
        return result.isError === true ? 'denied' : 'opened';
      } catch {
        return 'failed';
      }
    },
  };
}
