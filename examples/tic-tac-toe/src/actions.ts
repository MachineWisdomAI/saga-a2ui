import {
  Action,
  type ActionButtonActivation,
  type ViewHost,
} from '@saga-a2ui/react-mcp-stack';
import {
  GET_GAME_TOOL,
  MoveOutputSchema,
  PLAY_MOVE_TOOL,
  type Game,
  type MoveOutput,
} from './contract.js';
import {
  readGameReply,
  replyIsGone,
  type GameController,
} from './controller.js';
import {
  CONVERSATION,
  MESSAGE_FAILURE,
  REFUSAL_TEXT,
  VIEW_TEXT,
} from './text.js';

// The board's actions, each defined once. A definition is immutable and holds no pending state, so
// one definition can be attached to the nine squares; each attachment keeps its own state. The
// application attaches them (view.tsx); no markup names them.

type Reply = Awaited<ReturnType<ViewHost['server']['callServerTool']>>;

/** The server said the game is not there. Nothing was played. */
class GameGone extends Error {}

/** `play_move`'s reply, or why it is not one. Anything but "gone" leaves the move's fate unknown. */
function readMove(reply: Reply): MoveOutput {
  if (replyIsGone(reply)) throw new GameGone('the game is gone');
  const parsed = MoveOutputSchema.safeParse(reply.structuredContent);
  if (reply.isError === true || !parsed.success)
    throw new Error('the reply could not be read');
  return parsed.data;
}

export function createGameActions(host: ViewHost, game: GameController) {
  // #region saga-snippet:play-square-action
  /** The square action: one definition for all nine squares. Its subject is the game and move. */
  const playSquare = Action.server<ActionButtonActivation, Reply>(
    'play-square',
    host.server,
  )
    .input((event) => {
      const shown = game.current();
      if (shown === undefined) throw new Error('no game is on screen');
      return {
        gameId: shown.gameId,
        expectedMoveNumber: shown.moveNumber,
        square: Number(event.read('index')),
      };
    })
    // Inside the event turn: the squares go off until this request is settled.
    .atActivation(({ scope }) =>
      scope.own(game.lock(), (token) => game.unlock(token)),
    )
    .run(async ({ params, call }) =>
      readMove(await call(PLAY_MOVE_TOOL, { ...params, player: 'X' })),
    )
    .onSuccess(({ result, current }) => {
      if (!current()) return; // another game or move is on screen
      game.present(result.game);
      if (result.outcome === 'refused') {
        // Nothing changed on the server. The board shows the current game and says why.
        game.say(REFUSAL_TEXT[result.reason ?? 'stale_move']);
        // If the current game is waiting for the assistant, the board waits for it too.
        game.startWait();
        return;
      }
      handOver(result.game);
    })
    .onFailure((context) => {
      if (context.stage !== 'running' || !context.current()) return;
      const { failure } = context;
      if (failure.kind === 'handler-error' && failure.error instanceof GameGone)
        game.markGone();
      // A failed or timed-out request may or may not have been applied: read the game again
      // before offering a square.
      else
        void game.refresh().then((read) => {
          // Only a lost handler reply needs a handoff. A failed success hook may already have sent it.
          if (failure.kind !== 'handler-error' && failure.kind !== 'timeout')
            return;
          const { gameId, expectedMoveNumber, square } = context.params;
          const move = read?.history[expectedMoveNumber];
          if (
            read?.gameId === gameId &&
            read.moveNumber === expectedMoveNumber + 1 &&
            move?.player === 'X' &&
            move.square === square
          )
            handOver(read);
        });
    })
    .build();
  // #endregion saga-snippet:play-square-action

  /**
   * Gives the assistant its turn, or reports the end of the game. The append is started here and
   * not waited for: a host may wait for the person to confirm the message, and the action's
   * `current()` is already false when it settles. So the outcome is applied only while the board
   * still shows this game and move.
   */
  function handOver(played: Game): void {
    const shown = { gameId: played.gameId, moveNumber: played.moveNumber };
    const playing = played.status === 'playing';
    const appended = playing
      ? host.conversation.appendMessage(CONVERSATION.yourMove, {
          // The short message relies on this context to identify the right game.
          context: {
            text: CONVERSATION.boardForAssistant(played),
            data: { game: played },
          },
        })
      : host.conversation.appendMessage(CONVERSATION.result(played));
    if (playing) game.startWait();
    void appended.then((outcome) => {
      if (!game.isShowing(shown)) return; // a newer game or move is on screen
      if (outcome.outcome !== 'appended')
        game.say(
          outcome.stage === 'context'
            ? VIEW_TEXT.contextFailed
            : MESSAGE_FAILURE[outcome.outcome],
        );
    });
  }

  /** Let the assistant open a fresh card, so its saved result names the new game on remount. */
  const newGame = Action.local<ActionButtonActivation>('new-game')
    .run(() => host.conversation.appendMessage(CONVERSATION.newGame))
    .onSuccess(({ result, current }) => {
      if (!current()) return;
      if (result.outcome !== 'appended')
        game.say(MESSAGE_FAILURE[result.outcome]);
    })
    .onFailure((context) => {
      if (context.stage === 'running' && context.current())
        game.say(VIEW_TEXT.problem);
    })
    .build();

  /** "Check for the assistant's move": one read, shown if it is newer. It retries nothing. */
  const checkForMove = Action.server<ActionButtonActivation, Reply>(
    'check-move',
    host.server,
  )
    .input(() => {
      const shown = game.current();
      if (shown === undefined) throw new Error('no game is on screen');
      return { gameId: shown.gameId };
    })
    .run(({ params, call }) => call(GET_GAME_TOOL, params))
    .onSuccess(({ result, current }) => {
      if (!current()) return;
      const read = readGameReply(result);
      if (read.kind === 'gone') game.markGone();
      else if (read.kind === 'failed') game.say(VIEW_TEXT.unconfirmed);
      else {
        const before = game.current()?.moveNumber;
        game.present(read.game);
        if (read.game.moveNumber === before) game.say(VIEW_TEXT.stillWaiting);
      }
    })
    .onFailure((context) => {
      if (context.stage === 'running' && context.current())
        game.say(VIEW_TEXT.unconfirmed);
    })
    .build();

  return { playSquare, newGame, checkForMove };
}
