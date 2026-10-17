import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/client';
import { contentSecurityPolicy, type ResourceCsp } from './csp.js';

// Test-only local host. It stands in for a chat host just enough to exercise the MCP Apps
// bridge: it mounts the server's resource HTML in a sandboxed iframe, applies a CSP built from
// the resource's own metadata, and delivers a tool result over the real AppBridge.
// It is not a claim of compatibility with any actual host.

export interface HostedResource {
  readonly html: string;
  readonly csp: ResourceCsp;
}

declare global {
  interface Window {
    /**
     * Mounts the view and resolves once the view has completed its bridge handshake.
     * `resultDuringInitialization` is sent from the bridge's `oninitialized` callback, i.e.
     * while the view's `connect` is still completing, to control delivery order.
     */
    mountView?: (
      resource: HostedResource,
      options?: { resultDuringInitialization?: Parameters<AppBridge['sendToolResult']>[0] },
    ) => Promise<void>;
    /** Asks the mounted view to tear down (`ui/resource-teardown`); the iframe stays in place. */
    teardownView?: () => Promise<void>;
    /** Delivers a tool result to the mounted view. */
    deliverToolResult?: (result: Parameters<AppBridge['sendToolResult']>[0]) => Promise<void>;
    /** Reports that a tool call is starting, as a host does before the result arrives. */
    deliverToolInput?: (params: Parameters<AppBridge['sendToolInput']>[0]) => Promise<void>;
    /**
     * Forwards a view's `tools/call` (from `App.callServerTool`) to the test. The subscriptions
     * view uses that correlated response, not the next tool-result notification, to establish or
     * recover a session. Absent, a proxied call fails closed.
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

let bridge: AppBridge | undefined;

window.mountView = async (resource, options) => {
  const frame = document.createElement('iframe');
  // No allow-same-origin: the view runs in an opaque origin and cannot reach this page.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.title = 'MCP App view';
  frame.srcdoc = resource.html.replace(
    '<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(resource.csp)}">`,
  );

  const openLink = window.handleOpenLink;
  bridge = new AppBridge(
    null,
    { name: 'local-host-fixture', version: '0.0.0' },
    openLink ? { serverTools: {}, openLinks: {} } : { serverTools: {} },
  );
  if (openLink) bridge.onopenlink = ({ url }) => openLink({ url });
  bridge.oncalltool = (params) => {
    if (!window.handleToolCall) throw new Error('The host fixture has no tool caller.');
    return window.handleToolCall(params);
  };
  const initialized = new Promise<void>((resolve) => {
    if (!bridge) throw new Error('bridge missing');
    bridge.oninitialized = () => {
      if (options?.resultDuringInitialization) void bridge?.sendToolResult(options.resultDuringInitialization);
      resolve();
    };
  });
  document.querySelector('iframe')?.remove(); // a remount replaces the previous view
  document.body.append(frame);
  if (!frame.contentWindow) throw new Error('iframe has no window');
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  await initialized;
};

window.deliverToolResult = async (result) => {
  if (!bridge) throw new Error('mountView has not run');
  await bridge.sendToolResult(result);
};

window.deliverToolInput = async (params) => {
  if (!bridge) throw new Error('mountView has not run');
  await bridge.sendToolInput(params);
};

window.teardownView = async () => {
  if (!bridge) throw new Error('mountView has not run');
  await bridge.teardownResource({});
};
