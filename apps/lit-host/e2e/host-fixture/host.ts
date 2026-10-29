import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/client';
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

/**
 * How the host treats one kind of conversation request (`ui/update-model-context`, `ui/message`):
 * `accept` answers it, `refuse` and `fail` reject or flag it, `withhold` does not advertise the
 * capability at all (so a correct view never sends it), and `hold` records the request and leaves
 * it unanswered until `releaseConversation`. The context update's result is empty in the bridge, so
 * `refuse` and `fail` both reject it; a message that is refused is answered with `isError`.
 */
export type ConversationBehavior =
  'accept' | 'refuse' | 'fail' | 'withhold' | 'hold';

/** One conversation request the view made, in the order the host received it. */
export interface ConversationRequest {
  readonly kind: 'context' | 'message';
  readonly params: unknown;
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
      options?: {
        resultDuringInitialization?: Parameters<AppBridge['sendToolResult']>[0];
        slot?: string;
        /** The host context in the initialize response, e.g. the theme the host negotiated. */
        hostContext?: McpUiHostContext;
        /**
         * Offers the conversation capabilities. Each kind is advertised unless its behaviour is
         * `withhold`; absent, the host offers neither.
         */
        conversation?: {
          context?: ConversationBehavior;
          message?: ConversationBehavior;
        };
      },
    ) => Promise<void>;
    /** Sends the view in `slot` a partial host-context change (`ui/notifications/host-context-changed`). */
    changeHostContext?: (
      change: McpUiHostContext,
      slot?: string,
    ) => Promise<void>;
    /** Asks the view in `slot` (default: the default slot) to tear down (`ui/resource-teardown`); its iframe stays in place. */
    teardownView?: (slot?: string) => Promise<void>;
    /** Delivers a tool result to the view in `slot`. */
    deliverToolResult?: (
      result: Parameters<AppBridge['sendToolResult']>[0],
      slot?: string,
    ) => Promise<void>;
    /** Reports that a tool call is starting, as a host does before the result arrives. */
    deliverToolInput?: (
      params: Parameters<AppBridge['sendToolInput']>[0],
      slot?: string,
    ) => Promise<void>;
    /**
     * Forwards a view's `tools/call` (from `App.callServerTool`) to the test. The subscriptions
     * view uses that correlated response, not the next tool-result notification, to establish or
     * recover a session. Absent, a proxied call fails closed. Every slot shares this callback.
     */
    handleToolCall?: (
      params: CallToolRequest['params'],
    ) => Promise<CallToolResult>;
    /**
     * Receives a view's `ui/open-link` request. The host advertises the `openLinks` capability only
     * when this is set before `mountView`; absent, the host offers no link opening at all. The
     * fixture never navigates anywhere itself: the test decides what the host does.
     */
    handleOpenLink?: (params: {
      url: string;
    }) => Promise<{ isError?: boolean }>;
    /** Every conversation request the view in `slot` made, in order, whatever the host answered. */
    conversationRequests?: (slot?: string) => ConversationRequest[];
    /** Answers the requests the view in `slot` has left outstanding (behaviour `hold`). */
    releaseConversation?: (slot?: string) => void;
    /** The sizes the view in `slot` has told the host (`ui/notifications/size-changed`), in order. */
    sizeChanges?: (slot?: string) => Array<{ width?: number; height?: number }>;
    /** How many times the view in `slot` has completed its handshake (`ui/notifications/initialized`). */
    handshakes?: (slot?: string) => number;
  }
}

const DEFAULT_SLOT = 'main';
const bridges = new Map<string, AppBridge>();
const sizes = new Map<string, Array<{ width?: number; height?: number }>>();
const handshakeCounts = new Map<string, number>();
const conversations = new Map<string, ConversationRequest[]>();
const heldAnswers = new Map<string, Array<() => void>>();

/** The default slot keeps the title every single-view specification locates its frame by. */
const titleFor = (slot: string) =>
  slot === DEFAULT_SLOT ? 'MCP App view' : `MCP App view (${slot})`;

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
  const behaviours = options?.conversation;
  const behaviourOf = (kind: 'context' | 'message'): ConversationBehavior =>
    behaviours === undefined ? 'withhold' : (behaviours[kind] ?? 'accept');
  const bridge = new AppBridge(
    null,
    { name: 'local-host-fixture', version: '0.0.0' },
    {
      serverTools: {},
      ...(openLink ? { openLinks: {} } : {}),
      ...(behaviourOf('context') === 'withhold'
        ? {}
        : { updateModelContext: {} }),
      ...(behaviourOf('message') === 'withhold' ? {} : { message: {} }),
    },
    options?.hostContext ? { hostContext: options.hostContext } : undefined,
  );
  bridges.set(slot, bridge);
  sizes.set(slot, []);
  handshakeCounts.set(slot, 0);
  conversations.set(slot, []);
  heldAnswers.set(slot, []);
  const answerConversation = async (
    kind: 'context' | 'message',
    params: unknown,
  ): Promise<{ isError?: boolean }> => {
    conversations.get(slot)?.push({ kind, params });
    const behaviour = behaviourOf(kind);
    if (behaviour === 'hold')
      await new Promise<void>((resolve) =>
        heldAnswers.get(slot)?.push(resolve),
      );
    if (behaviour === 'fail') throw new Error('the host failed the request');
    if (behaviour === 'refuse') {
      // A context update cannot be answered with `isError`; the host rejects it.
      if (kind === 'context') throw new Error('the host refused the context');
      return { isError: true };
    }
    return {};
  };
  bridge.onupdatemodelcontext = async (params) => {
    await answerConversation('context', params);
    return {};
  };
  bridge.onmessage = (params) => answerConversation('message', params);
  bridge.onsizechange = (size) => void sizes.get(slot)?.push(size);
  if (openLink) bridge.onopenlink = ({ url }) => openLink({ url });
  bridge.oncalltool = (params) => {
    if (!window.handleToolCall)
      throw new Error('The host fixture has no tool caller.');
    return window.handleToolCall(params);
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => {
      handshakeCounts.set(slot, (handshakeCounts.get(slot) ?? 0) + 1);
      if (options?.resultDuringInitialization)
        void bridge.sendToolResult(options.resultDuringInitialization);
      resolve();
    };
  });
  // A remount replaces the view in this slot and leaves the views in other slots alone.
  [...document.querySelectorAll('iframe')]
    .find((existing) => existing.dataset.slot === slot)
    ?.remove();
  // A page that hosts views among other content (the demonstration host) names where they go.
  (document.querySelector('[data-view-area]') ?? document.body).append(frame);
  if (!frame.contentWindow) throw new Error('iframe has no window');
  await bridge.connect(
    new PostMessageTransport(frame.contentWindow, frame.contentWindow),
  );
  await initialized;
};

window.sizeChanges = (slot = DEFAULT_SLOT) => [...(sizes.get(slot) ?? [])];
window.handshakes = (slot = DEFAULT_SLOT) => handshakeCounts.get(slot) ?? 0;
window.conversationRequests = (slot = DEFAULT_SLOT) => [
  ...(conversations.get(slot) ?? []),
];
window.releaseConversation = (slot = DEFAULT_SLOT) => {
  for (const release of heldAnswers.get(slot)?.splice(0) ?? []) release();
};

window.deliverToolResult = async (result, slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).sendToolResult(result);
};

window.changeHostContext = async (change, slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).sendHostContextChange(change);
};

window.deliverToolInput = async (params, slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).sendToolInput(params);
};

window.teardownView = async (slot = DEFAULT_SLOT) => {
  await bridgeIn(slot).teardownResource({});
};
