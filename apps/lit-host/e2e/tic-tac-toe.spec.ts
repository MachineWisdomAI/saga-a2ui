import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import type {
  GameStore,
  MemoryGameStoreOptions,
} from '../../../examples/tic-tac-toe/server/game-store.js';
import type { LocalMcpServer as Listener } from '@saga-a2ui/react-mcp-stack/server/node';
import type { ListenerOptions } from '../../../examples/tic-tac-toe/server/listener.js';
import type {
  ConversationBehavior,
  HostedResource,
} from './host-fixture/host.js';

// The tic-tac-toe example (examples/tic-tac-toe), built from packed SDK tarballs
// (scripts/build-tic-tac-toe.ts) and served by its own MCP server, in a real browser. The page is
// mounted in the sandboxed iframe of the local host fixture under the CSP the server declared;
// the view's server calls are forwarded to that server, the assistant's turns are made by calling
// its tools directly, and the fixture records what the view appends to the conversation. The local
// host fixture is not evidence of any actual assistant host, and no test here asserts which
// square an assistant would choose: every O move is made by the test.

interface Entry {
  startListener(options: ListenerOptions): Promise<Listener>;
  createMemoryGameStore(options?: MemoryGameStoreOptions): GameStore;
}

interface Game {
  gameId: string;
  board: (string | null)[];
  turn: 'X' | 'O';
  moveNumber: number;
  status: 'playing' | 'won' | 'draw';
}

const dist = new URL('../dist/tic-tac-toe/', import.meta.url);

const TEXT = {
  yourTurn: 'Your move. You are X.',
  assistantTurn: 'Waiting for the assistant to play O…',
  assistantSlow: 'Could not read the game. Check the connection.',
  unavailable: 'This host does not support messages from this card.',
  denied: 'The host declined the message. Check its confirmation controls.',
  stale: 'The board had moved on, so that move was not played.',
  won: 'You won!',
  draw: 'It is a draw.',
  gone: 'That game is not available any more. Start a new game.',
  problem: 'This could not be shown.',
} as const;

let entry: Entry;
let listener: Listener;
let client: Client;

test.beforeAll(async () => {
  entry = (await import(
    pathToFileURL(new URL('qualification-server.mjs', dist).pathname).href
  )) as Entry;
  listener = await entry.startListener({
    html: await readFile(new URL('index.html', dist), 'utf8'),
    port: 0,
  });
  client = await connect(listener);
});

test.afterAll(async () => {
  await client.close();
  await listener.close();
});

async function connect(from: Listener): Promise<Client> {
  const connected = new Client({ name: 'tic-tac-toe-spec', version: '0.0.0' });
  await connected.connect(new StreamableHTTPClientTransport(new URL(from.url)));
  return connected;
}

// --- What the assistant does: it calls the same tools the board calls ---------------------------

const structured = <T>(result: unknown): T =>
  (result as CallToolResult).structuredContent as T;

async function newGame(): Promise<{ game: Game; result: CallToolResult }> {
  const result = (await client.callTool({
    name: 'new_game',
    arguments: {},
  })) as CallToolResult;
  return { game: structured<{ game: Game }>(result).game, result };
}

/** The result `show_game` gives for a game: what a host delivers to a board opened on it. */
async function show(gameId: string): Promise<CallToolResult> {
  return (await client.callTool({
    name: 'show_game',
    arguments: { gameId },
  })) as CallToolResult;
}

async function read(gameId: string): Promise<Game> {
  return structured<{ game: Game }>(
    await client.callTool({ name: 'get_game', arguments: { gameId } }),
  ).game;
}

async function play(
  gameId: string,
  player: 'X' | 'O',
  square: number,
  expectedMoveNumber: number,
) {
  return structured<{
    game: Game;
    outcome: 'played' | 'refused';
    reason?: string;
  }>(
    await client.callTool({
      name: 'play_move',
      arguments: { gameId, player, square, expectedMoveNumber },
    }),
  );
}

/** Plays `squares` from the first move, X first, alternating, calling play_move for both sides. */
async function playMoves(
  gameId: string,
  squares: readonly number[],
): Promise<void> {
  for (const [number, square] of squares.entries()) {
    const result = await play(
      gameId,
      number % 2 === 0 ? 'X' : 'O',
      square,
      number,
    );
    expect(result.outcome).toBe('played');
  }
}

// --- The board in the host fixture -------------------------------------------------------------

interface Call {
  readonly name: string;
  readonly arguments: Record<string, unknown> | undefined;
}

interface Heard {
  readonly kind: string;
  readonly params: Record<string, unknown>;
}

interface Board {
  readonly view: FrameLocator;
  /** Every tool call the view made through the host, in order. */
  readonly calls: Call[];
  /** Holds the reply to the next call of `name` until the returned function is called. */
  hold(name: string): () => void;
  /** Delivers a tool result to the view, as the host does for the call that opened it. */
  deliver(result: CallToolResult): Promise<void>;
  /** The conversation requests the host heard, in order. */
  heard(): Promise<Heard[]>;
  /** A square by its position and what is in it. */
  square(
    row: number,
    column: number,
    mark?: string,
  ): ReturnType<FrameLocator['getByRole']>;
  button(name: string): ReturnType<FrameLocator['getByRole']>;
  status(): ReturnType<FrameLocator['getByRole']>;
  /** How many times the view read a game. */
  reads(): number;
  /** The game the view's first call named. */
  gameId(): string;
}

interface OpenOptions {
  conversation?: {
    context?: ConversationBehavior;
    message?: ConversationBehavior;
  };
  /** Opens the board on this result; by default a new game's. */
  result?: CallToolResult;
  /** Fakes the page's timers, so a test can move time. */
  clock?: boolean;
  /** The assistant the view talks to; by default the shared one. */
  server?: Client;
  /** Mounts this page in place of the one the server serves. */
  html?: string;
}

async function open(page: Page, options: OpenOptions = {}): Promise<Board> {
  const server = options.server ?? client;
  const calls: Call[] = [];
  const holds = new Map<string, Promise<void>>();
  if (options.clock) await page.clock.install();
  await page.exposeFunction(
    'handleToolCall',
    async (params: { name: string; arguments?: Record<string, unknown> }) => {
      calls.push({ name: params.name, arguments: params.arguments });
      const held = holds.get(params.name);
      if (held !== undefined) {
        holds.delete(params.name);
        await held;
      }
      return server.callTool(params);
    },
  );
  const result =
    options.result ??
    ((await server.callTool({
      name: 'new_game',
      arguments: {},
    })) as CallToolResult);
  const uri = (result._meta as { ui: { resourceUri: string } }).ui.resourceUri;
  const { contents } = await server.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content))
    throw new Error('resources/read returned no text');
  const hosted: HostedResource = {
    html: options.html ?? content.text,
    csp: (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp,
  };
  await page.goto('/host-fixture/index.html');
  await page.evaluate(
    ([resource, conversation]) =>
      window.mountView?.(resource, { conversation: conversation ?? {} }),
    [hosted, options.conversation] as const,
  );
  const view = page.frameLocator('iframe[title="MCP App view"]');
  const board: Board = {
    view,
    calls,
    hold(name) {
      let release!: () => void;
      holds.set(name, new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
    deliver: (delivered) =>
      page.evaluate(
        (payload) => window.deliverToolResult?.(payload as never),
        delivered,
      ),
    heard: async () =>
      (await page.evaluate(() => window.conversationRequests?.())) as Heard[],
    square: (row, column, mark = 'empty') =>
      view.getByRole('button', {
        name: `Row ${row}, column ${column}, ${mark}`,
        exact: true,
      }),
    button: (name) => view.getByRole('button', { name, exact: true }),
    status: () => view.getByRole('status'),
    reads: () => calls.filter((call) => call.name === 'get_game').length,
    gameId: () => (calls[0]?.arguments as { gameId: string }).gameId,
  };
  await board.deliver(result);
  await expect(board.status()).not.toHaveText(
    /Waiting for a game|Checking the current game/,
  );
  return board;
}

/** The text of the message request the fixture recorded. */
const messageText = (request: Heard | undefined): string =>
  (request?.params.content as Array<{ text: string }>)[0]!.text;

test.describe('the example server', () => {
  test('declares four operations: the board for new_game and show_game, nothing for get_game and play_move', async () => {
    const { tools } = await client.listTools();
    const views = Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
          ?.resourceUri,
      ]),
    );
    expect(Object.keys(views).sort()).toEqual([
      'get_game',
      'new_game',
      'play_move',
      'show_game',
    ]);
    expect(views.new_game).toMatch(/^ui:\/\/views\/new-game\./);
    expect(views.show_game).toMatch(/^ui:\/\/views\/show-game\./);
    expect(views.get_game).toBeUndefined();
    expect(views.play_move).toBeUndefined();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual(
      [views.new_game, views.show_game].sort(),
    );
    const move = tools.find((tool) => tool.name === 'play_move');
    expect(move?.description).toContain('You play O');
    expect(move?.description).toContain('get_game');
    expect(move?.description).toContain('show_game');
  });

  test('refuses a repeated request for the same move number, whichever way it arrives', async () => {
    const { game } = await newGame();
    const first = await play(game.gameId, 'X', 0, 0);
    const again = await play(game.gameId, 'X', 0, 0);
    const elsewhere = await play(game.gameId, 'X', 5, 0);
    expect(first.outcome).toBe('played');
    expect(again).toMatchObject({ outcome: 'refused', reason: 'stale_move' });
    expect(elsewhere).toMatchObject({
      outcome: 'refused',
      reason: 'stale_move',
    });
    expect(again.game).toEqual(first.game);
    expect(elsewhere.game).toEqual(first.game);
  });

  test('refuses an illegal move with no effect and returns the current game, and offers no board for a game it does not have', async () => {
    const { game } = await newGame();
    const afterX = (await play(game.gameId, 'X', 4, 0)).game;
    for (const [player, square, reason] of [
      ['X', 0, 'not_your_turn'],
      ['O', 4, 'occupied'],
    ] as const) {
      const refused = await play(game.gameId, player, square, 1);
      expect(refused).toMatchObject({ outcome: 'refused', reason });
      expect(refused.game).toEqual(afterX);
    }
    const won = await newGame();
    await playMoves(won.game.gameId, [0, 3, 1, 4, 2]);
    const after = await read(won.game.gameId);
    expect(after.status).toBe('won');
    expect(await play(won.game.gameId, 'O', 8, 5)).toMatchObject({
      outcome: 'refused',
      reason: 'game_over',
      game: after,
    });

    const missing = await client.callTool({
      name: 'play_move',
      arguments: {
        gameId: 'a-game-that-never-was',
        player: 'X',
        square: 0,
        expectedMoveNumber: 0,
      },
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toBeUndefined();
    expect(missing._meta).toBeUndefined();
  });
});

test.describe('the board', () => {
  test('asks for one fresh card when New game is activated twice while host confirmation is pending', async ({
    page,
  }) => {
    const board = await open(page, { conversation: { message: 'hold' } });
    await board.button('New game').click();
    await board.button('New game').click();
    await expect.poll(async () => (await board.heard()).length).toBe(1);
    expect(messageText((await board.heard())[0])).toContain('new_game');
    expect(board.calls.filter((call) => call.name === 'new_game')).toHaveLength(
      0,
    );
    await expect(board.square(2, 2)).toBeEnabled();
    await page.evaluate(() => window.releaseConversation?.());
  });

  test('reads the current game when a remounted card receives its saved empty result', async ({
    page,
  }) => {
    const { game, result } = await newGame();
    await playMoves(game.gameId, [4, 0]);
    const board = await open(page, { result });
    await expect(board.square(2, 2, 'X')).toBeVisible();
    await expect(board.square(1, 1, 'O')).toBeVisible();
    await expect(board.square(3, 3)).toBeEnabled();
    expect(
      board.calls.filter((call) => call.name === 'play_move'),
    ).toHaveLength(0);
    expect(await board.heard()).toEqual([]);
  });

  test('opens with nine named squares, and the person plays by click and by keyboard', async ({
    page,
  }) => {
    const board = await open(page);
    await expect(board.status()).toHaveText(TEXT.yourTurn);
    await expect(board.view.getByRole('button')).toHaveCount(10); // nine squares and New game
    for (let at = 0; at < 9; at += 1)
      await expect(
        board.square(Math.floor(at / 3) + 1, (at % 3) + 1),
      ).toBeEnabled();

    // A click.
    await board.square(2, 2).click();
    await expect(board.square(2, 2, 'X')).toBeDisabled();
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    // It is not the person's turn any more.
    await expect(board.square(1, 1)).toBeDisabled();
    await expect(board.square(3, 3)).toBeDisabled();

    // The assistant plays O; the wait picks it up and the person has the turn back.
    const gameId = board.gameId();
    await play(gameId, 'O', 0, 1);
    await expect(board.square(1, 1, 'O')).toBeVisible({ timeout: 10_000 });
    await expect(board.status()).toHaveText(TEXT.yourTurn);

    // The keyboard: a square takes focus, and Enter or Space plays it.
    await board.square(3, 3).focus();
    await page.keyboard.press('Enter');
    await expect(board.square(3, 3, 'X')).toBeVisible();
    await play(gameId, 'O', 1, 3);
    await expect(board.square(1, 2, 'O')).toBeVisible({ timeout: 10_000 });
    await board.square(3, 1).focus();
    await page.keyboard.press('Space');
    await expect(board.square(3, 1, 'X')).toBeVisible();
    expect(
      board.calls.filter((call) => call.name === 'play_move'),
    ).toHaveLength(3);
  });

  test('appends the context update with the game, then the move message, which names the game and shows no board', async ({
    page,
  }) => {
    const board = await open(page);
    await board.square(1, 3).click();
    await expect(board.square(1, 3, 'X')).toBeVisible();
    await expect.poll(async () => (await board.heard()).length).toBe(2);
    const [context, message] = await board.heard();
    const gameId = board.gameId();

    expect(context?.kind).toBe('context');
    const data = context?.params.structuredContent as { game: Game };
    expect(data.game).toMatchObject({
      gameId,
      moveNumber: 1,
      turn: 'O',
      status: 'playing',
    });
    expect(data.game.board[2]).toBe('X');
    expect(message?.kind).toBe('message');
    expect(message?.params.role).toBe('user');
    expect(messageText(message)).toBe(
      `Your move in tic-tac-toe game ${gameId}. The board is in your context; if it isn't, read it with get_game. Then play O with play_move.`,
    );
    expect(messageText(message)).not.toMatch(/[-XO]{3}\//);
  });

  test('still sends the move message when the host cannot take the context', async ({
    page,
  }) => {
    const board = await open(page, { conversation: { context: 'withhold' } });
    await board.square(2, 1).click();
    await expect(board.square(2, 1, 'X')).toBeVisible();
    await expect.poll(async () => (await board.heard()).length).toBe(1);
    const [only] = await board.heard();
    expect(only?.kind).toBe('message');
    expect(messageText(only)).toContain('get_game');
    // The assistant was told, so nothing needs saying; the wait runs.
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
  });

  test('reports unavailable messaging and still observes a move made through the server', async ({
    page,
  }) => {
    const board = await open(page, { conversation: { message: 'withhold' } });
    await board.square(1, 1).click();
    await expect(board.status()).toHaveText(
      `${TEXT.assistantTurn} ${TEXT.unavailable} Game: ${board.gameId()}.`,
    );
    expect(await board.heard()).toEqual([
      expect.objectContaining({ kind: 'context' }),
    ]);
    await play(board.gameId(), 'O', 4, 1);
    await expect(board.square(2, 2, 'O')).toBeVisible({ timeout: 10_000 });
    await expect(board.status()).toHaveText(TEXT.yourTurn);
  });

  test('says the same when the host offers neither request', async ({
    page,
  }) => {
    const board = await open(page, {
      conversation: { context: 'withhold', message: 'withhold' },
    });
    await board.square(3, 2).click();
    await expect(board.status()).toHaveText(
      `${TEXT.assistantTurn} ${TEXT.unavailable} Game: ${board.gameId()}.`,
    );
    expect(await board.heard()).toEqual([]);
  });

  test('a winning X move appends one result message, no context, and starts no wait', async ({
    page,
  }) => {
    const { game } = await newGame();
    await playMoves(game.gameId, [0, 3, 1, 4]); // X holds 0 and 1; O holds 3 and 4
    const board = await open(page, {
      result: await show(game.gameId),
      clock: true,
    });
    await expect(board.status()).toHaveText(TEXT.yourTurn);
    await board.square(1, 3).click();
    await expect(board.status()).toHaveText(TEXT.won);
    await expect.poll(async () => (await board.heard()).length).toBe(1);
    const [only] = await board.heard();
    expect(only?.kind).toBe('message');
    expect(messageText(only)).toBe('I won our tic-tac-toe game.');
    // No wait: not now, and not after a minute.
    await page.clock.fastForward(70_000);
    await page.waitForTimeout(300);
    expect(board.reads()).toBe(1);
    expect(await board.heard()).toHaveLength(1);
    await expect(board.button("Check for the assistant's move")).toHaveCount(0);
    await expect(board.square(2, 3)).toBeDisabled(); // a finished game offers no square
  });

  test('a drawing X move appends one result message, no context, and starts no wait', async ({
    page,
  }) => {
    const { game } = await newGame();
    // X O X / X O O / O X _ : X's ninth move fills the board and makes no line.
    await playMoves(game.gameId, [0, 1, 2, 4, 3, 5, 7, 6]);
    const board = await open(page, {
      result: await show(game.gameId),
      clock: true,
    });
    await board.square(3, 3).click();
    await expect(board.status()).toHaveText(TEXT.draw);
    await expect.poll(async () => (await board.heard()).length).toBe(1);
    const [only] = await board.heard();
    expect(only?.kind).toBe('message');
    expect(messageText(only)).toBe('Our tic-tac-toe game ended in a draw.');
    await page.clock.fastForward(70_000);
    await page.waitForTimeout(300);
    expect(board.reads()).toBe(1);
    expect(await board.heard()).toHaveLength(1);
  });

  test('picks up an O move the assistant made through the server, not through the board', async ({
    page,
  }) => {
    const board = await open(page);
    await board.square(2, 2).click();
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    // This test chooses a square only to make the move; the board shows whichever one it is.
    const moved = await play(board.gameId(), 'O', 8, 1);
    expect(moved.outcome).toBe('played');
    await expect(board.square(3, 3, 'O')).toBeVisible({ timeout: 10_000 });
    await expect(board.status()).toHaveText(TEXT.yourTurn);
    expect(board.reads()).toBeGreaterThan(0);
    // The wait has ended: nothing more is read.
    const settled = board.reads();
    await page.waitForTimeout(2_000);
    expect(board.reads()).toBe(settled);
  });

  test('a board opened by show_game while the assistant is to move waits for it', async ({
    page,
  }) => {
    const { game } = await newGame();
    await play(game.gameId, 'X', 4, 0);
    const board = await open(page, { result: await show(game.gameId) });
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    await play(game.gameId, 'O', 0, 1);
    await expect(board.square(1, 1, 'O')).toBeVisible({ timeout: 10_000 });
    await expect(board.status()).toHaveText(TEXT.yourTurn);
    expect(await board.heard()).toEqual([]); // opening a game says nothing to the conversation
  });

  test('refuses a stale move with no effect, shows the current game and waits if the assistant is to move', async ({
    page,
  }) => {
    const { game, result } = await newGame();
    const board = await open(page, { result });
    // Another card moved first: this board still shows move 0.
    await play(game.gameId, 'X', 0, 0);
    await board.square(2, 2).click();
    await expect(board.status()).toHaveText(
      `${TEXT.assistantTurn} ${TEXT.stale}`,
    );
    await expect(board.square(1, 1, 'X')).toBeVisible();
    await expect(board.square(2, 2)).toBeVisible(); // not played
    expect(await board.heard()).toEqual([]);
    const current = await read(game.gameId);
    expect(current.moveNumber).toBe(1);
    expect(current.board[4]).toBeNull();
    // The board follows the current game, so the assistant's move reaches it.
    await play(game.gameId, 'O', 8, 1);
    await expect(board.square(3, 3, 'O')).toBeVisible({ timeout: 10_000 });
  });

  test('says so when a refused append settles on the game it was made for', async ({
    page,
  }) => {
    const board = await open(page, {
      conversation: { message: 'hold-then-refuse' },
    });
    await board.square(3, 3).click();
    await expect.poll(async () => (await board.heard()).length).toBe(2);
    await page.evaluate(() => window.releaseConversation?.());
    await expect(board.status()).toHaveText(
      `${TEXT.assistantTurn} ${TEXT.denied} Game: ${board.gameId()}.`,
    );
  });

  test('keeps the existing board current after a delayed host confirmation', async ({
    page,
  }) => {
    const board = await open(page, { clock: true });
    await board.square(2, 2).click();
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    for (let reads = 1; reads <= 40; reads += 1) {
      await page.clock.runFor(1_500);
      await expect.poll(() => board.reads()).toBe(reads + 1);
      await page.waitForTimeout(20); // let the network reply schedule its next timer before advancing the clock
    }
    await page.clock.runFor(120_000);
    await expect.poll(() => board.reads()).toBeGreaterThan(40);
    await page.waitForTimeout(20);
    await expect(board.button("Check for the assistant's move")).toHaveCount(0);
    await play(board.gameId(), 'O', 0, 1);
    await page.clock.runFor(5_000);
    await expect(board.square(1, 1, 'O')).toBeVisible();
    await expect(board.status()).toHaveText(TEXT.yourTurn);
  });

  test('offers New game when the game is gone', async ({ page }) => {
    const clock = { at: 1_000 };
    const short = await entry.startListener({
      html: await readFile(new URL('index.html', dist), 'utf8'),
      port: 0,
      store: entry.createMemoryGameStore({ ttlMs: 100, now: () => clock.at }),
    });
    const other = await connect(short);
    try {
      const board = await open(page, { server: other });
      await expect(board.status()).toHaveText(TEXT.yourTurn);
      clock.at += 1_000; // the game expires
      await board.square(1, 1).click();
      await expect(board.status()).toHaveText(TEXT.gone);
      await expect(board.square(1, 1)).toBeDisabled();
      await board.button('New game').click();
      await expect.poll(async () => (await board.heard()).length).toBe(1);
      expect(messageText((await board.heard())[0])).toContain('new_game');
      await expect(board.status()).toHaveText(TEXT.gone);
    } finally {
      await other.close();
      await short.close();
    }
  });

  test('hands over a confirmed move after its reply is lost, without playing it twice', async ({
    page,
  }) => {
    const board = await open(page);
    // The request reaches the server and is applied, but its answer never reaches the view.
    await page.evaluate(() => {
      const original = window.handleToolCall;
      let first = true;
      window.handleToolCall = async (params) => {
        const reply = await original?.(params);
        if (params.name === 'play_move' && first) {
          first = false;
          throw new Error('the connection was lost');
        }
        return reply as never;
      };
    });
    await board.square(1, 1).click();
    // The recovery read confirms this square and move number. The board sends the missing handoff.
    await expect(board.square(1, 1, 'X')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await board.heard()).filter((request) => request.kind === 'message')
            .length,
      )
      .toBe(1);
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    expect(
      board.calls.filter((call) => call.name === 'play_move'),
    ).toHaveLength(1);
    expect(board.reads()).toBeGreaterThan(0);
  });

  test('ending the view stops the wait', async ({ page }) => {
    const board = await open(page);
    await board.square(1, 2).click();
    await expect(board.status()).toHaveText(TEXT.assistantTurn);
    await expect
      .poll(() => board.reads(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.evaluate(() => window.teardownView?.());
    await page.waitForTimeout(200);
    const settled = board.reads();
    await page.waitForTimeout(2_500);
    expect(board.reads()).toBe(settled);
  });

  test('does not ask for O when a failed request did not apply the clicked move', async ({
    page,
  }) => {
    const board = await open(page);
    await page.evaluate(() => {
      const original = window.handleToolCall;
      window.handleToolCall = async (params) => {
        if (params.name === 'play_move') throw new Error('request never sent');
        return (await original?.(params)) as never;
      };
    });
    await board.square(1, 1).click();
    await expect.poll(() => board.reads()).toBe(2); // opening read, then recovery
    await expect(board.square(1, 1)).toBeEnabled();
    expect(await board.heard()).toEqual([]);
  });

  test('shows none of a result from another build, and recovers on the next valid one', async ({
    page,
  }) => {
    const board = await open(page);
    await board.deliver({
      content: [{ type: 'text', text: 'shown?' }],
      structuredContent: { game: { gameId: 'x' }, schemaVersion: 2 },
    });
    await expect(board.status()).toContainText(TEXT.problem);
    const { result } = await newGame();
    await board.deliver(result);
    await expect(board.status()).toHaveText(TEXT.yourTurn);
  });
});

test.describe('the guided change', () => {
  // The page built after applying examples/tic-tac-toe/guided-change/move-list.patch: the layout and
  // the catalog gain a list bound to the game's history, and nothing else changes.
  test('adds a move list that follows the game, from the person’s click to the assistant’s move', async ({
    page,
  }) => {
    const board = await open(page, {
      html: await readFile(
        new URL('../dist/tic-tac-toe-guided/index.html', import.meta.url),
        'utf8',
      ),
    });
    const moves = board.view.getByRole('list', { name: 'Moves so far' });
    await expect(moves.getByRole('listitem')).toHaveCount(0);
    await board.square(2, 3).click();
    await expect(moves.getByRole('listitem')).toHaveText([
      '1. You: row 2, column 3',
    ]);
    await play(board.gameId(), 'O', 0, 1);
    await expect(moves.getByRole('listitem')).toHaveText(
      ['1. You: row 2, column 3', '2. Assistant: row 1, column 1'],
      { timeout: 10_000 },
    );
    // The board itself behaves as it did.
    await expect(board.status()).toHaveText(TEXT.yourTurn);
    await expect(board.square(1, 1, 'O')).toBeVisible();
  });
});
