import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/client';
import { contentSecurityPolicy, type ResourceCsp } from './csp.js';

// Test-only local host. It stands in for a chat host just enough to exercise the MCP Apps
// bridge: it mounts the server's resource HTML in a sandboxed iframe, applies a CSP built from
// the resource's own metadata, and delivers a tool result over the real AppBridge.
// It is not a claim of compatibility with any actual host.
//
// A view lives in a named slot (the default slot when none is given). Mounting into a slot that
// already holds a view replaces that view, which is what a remount proves. Views in different
// slots are alive at the same time, each with its own iframe and its own AppBridge, which is what
// a claim about isolation between simultaneously live views needs.

export interface HostedResource {
  readonly html: string;
  readonly csp: ResourceCsp;
}

declare global {
  interface Window {
    /**
     * Mounts the view and resolves once the view has completed its bridge handshake.
     * `resultDuringInitialization` is sent from the bridge's `oninitialized` callback, i.e.
     * while the view's `connect` is still completing, to control delivery order. `slot` names the
     * view; a second slot mounts a second, simultaneously live view beside the first.
     */
    mountView?: (
      resource: HostedResource,
      options?: { resultDuringInitialization?: Parameters<AppBridge['sendToolResult']>[0]; slot?: string },
    ) => Promise<void>;
    /** Asks the view in `slot` (default: the default slot) to tear down (`ui/resource-teardown`); its iframe stays in place. */
    teardownView?: (slot?: string) => Promise<void>;
    /** Delivers a tool result to the view in `slot`. */
    deliverToolResult?: (result: Parameters<AppBridge['sendToolResult']>[0], slot?: string) => Promise<void>;
    /** Reports that a tool call is starting, as a host does before the result arrives. */
    deliverToolInput?: (params: Parameters<AppBridge['sendToolInput']>[0], slot?: string) => Promise<void>;
    /**
     * Forwards a view's `tools/call` (from `App.callServerTool`) to the test. The subscriptions
     * view uses that correlated response, not the next tool-result notification, to establish or
     * recover a session. Absent, a proxied call fails closed. Every slot shares this callback.
     */
    handleToolCall?: (params: CallToolRequest['params']) => Promise<CallToolResult>;
    /**
     * Receives a view's `ui/open-link` request. The host advertises the `openLinks` capability only
     * when this is set before `mountView`; absent, the host offers no link opening at all. The
     * fixture never navigates anywhere itself: the test decides what the host does.
     */
    handleOpenLink?: (params: { url: string }) => Promise<{ isError?: boolean }>;
  }
}

const DEFAULT_SLOT = 'main';
const bridges = new Map<string, AppBridge>();

/** The default slot keeps the title every single-view specification locates its frame by. */
const titleFor = (slot: string) => (slot === DEFAULT_SLOT ? 'MCP App view' : `MCP App view (${slot})`);

const bridgeIn = (slot: string): AppBridge => {
  const bridge = bridges.get(slot);
  if (!bridge) throw new Error('mountView has not run');
  return bridge;
};

window.mountView = async (resource, options) => {
  const slot = options?.slot ?? DEFAULT_SLOT;
  const frame = document.createElement('iframe');
  // No allow-same-origin: the view runs in an opaque origin and cannot reach this page.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.title = titleFor(slot);
  frame.dataset.slot = slot;
  frame.srcdoc = resource.html.replace(
    '<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(resource.csp)}">`,
  );

  const openLink = window.handleOpenLink;
  const bridge = new AppBridge(
    null,
    { name: 'local-host-fixture', version: '0.0.0' },
    openLink ? { serverTools: {}, openLinks: {} } : { serverTools: {} },
  );
  bridges.set(slot, bridge);
  if (openLink) bridge.onopenlink = ({ url }) => openLink({ url });
  bridge.oncalltool = (params) => {
    if (!window.handleToolCall) throw new Error('The host fixture has no tool caller.');
    return window.handleToolCall(params);
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => {
      if (options?.resultDuringInitialization) void bridge.sendToolResult(options.resultDuringInitialization);
      resolve();
    };
  });
  // A remount replaces the view in this slot and leaves the views in other slots alone.
  [...document.querySelectorAll('iframe')].find((existing) => existing.dataset.slot === slot)?.remove();
  // A page that hosts views among other content (the demonstration host) names where they go.
  (document.querySelector('[data-view-area]') ?? document.body).append(frame);
  if (!frame.contentWindow) throw new Error('iframe has no window');
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  await initialized;
};

window.deliverToolResult = async (result, slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).sendToolResult(result);
};

window.deliverToolInput = async (params, slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).sendToolInput(params);
};

window.teardownView = async (slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).teardownResource({});
};
