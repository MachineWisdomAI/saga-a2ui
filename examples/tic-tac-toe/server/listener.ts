import type { BudgetSettings } from '@saga-a2ui/react-mcp-stack/server';
import {
  startLocalMcpServer,
  type LocalMcpServer,
} from '@saga-a2ui/react-mcp-stack/server/node';
import { createMemoryGameStore, type GameStore } from './game-store.js';
import { createGameServer, prepareBoardViews } from './operations.js';

export interface ListenerOptions {
  readonly html: string;
  readonly port: number;
  readonly store?: GameStore;
  readonly budgets?: BudgetSettings;
}

export function startListener(
  options: ListenerOptions,
): Promise<LocalMcpServer> {
  const views = prepareBoardViews(options.html);
  const store = options.store ?? createMemoryGameStore();
  return startLocalMcpServer({
    port: options.port,
    budgets: options.budgets,
    createServer: (lifetime) => createGameServer({ views, store, lifetime }),
  });
}
