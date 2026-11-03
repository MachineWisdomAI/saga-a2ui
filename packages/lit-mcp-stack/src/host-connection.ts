import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

/**
 * The two halves of a connection to the MCP Apps host: the bridge and the transport it will connect
 * over. Making them is the stack’s job so that no application imports the bridge package; a start
 * takes the pair as a value so a test can supply a bridge joined to an in-memory host.
 */
export interface HostConnection {
  readonly app: App;
  readonly transport: NonNullable<Parameters<App['connect']>[0]>;
}

/** What a server tool call answers: the reply type of the bridge’s own `callServerTool`. */
export type ServerReply = Awaited<ReturnType<App['callServerTool']>>;

export interface HostIdentity {
  readonly name: string;
  readonly version: string;
}

/**
 * The connection a view uses in a host’s iframe: a bridge named for the application and the
 * `postMessage` transport to the embedding window. With `own` sizing the view tells the host its
 * size itself (`startOwnSizing`), so the bridge’s automatic resizing is turned off and sizing has
 * exactly one owner.
 */
export function connectToHost(
  identity: HostIdentity,
  sizing: 'own' | 'host',
): HostConnection {
  return {
    app: new App(
      { name: identity.name, version: identity.version },
      {},
      sizing === 'own' ? { autoResize: false } : undefined,
    ),
    transport: new PostMessageTransport(window.parent, window.parent),
  };
}
