# Build tic-tac-toe with React

You play tic-tac-toe against an AI assistant, inside the chat. You click a square on a board. The assistant answers by playing O. Both of you use the same game, so neither can cheat the other: the server checks every move.

This guide builds that game with saga a2ui and React. It is a weekend-sized project, and you can read it in about ten minutes.

> **Draft.** This is the opening of the guide: the finished game and the first click. The layout, the operations, a guided change and the host connections follow in later sections.

## The finished game

You ask the assistant for a game of tic-tac-toe. It starts one, and the chat shows this board:

![A tic-tac-toe board in a chat: the status line reads "Your move. You are X.", the squares hold O at the top left and top right and X in the middle and at the bottom right, and a New game button sits under the board.](images/tic-tac-toe-board.png)

You play X and move first. Each square is a button, so the keyboard works too. Squares you cannot play are switched off: one that is taken, any square while the assistant is thinking, and every square once the game is over.

Three things make it different from a page you would build on its own:

- **The board lives in the chat.** The assistant's host, such as Claude or ChatGPT, shows it next to the conversation. The host is the application that runs the assistant. Here it is called an MCP host, because it talks to your game over the Model Context Protocol (MCP). You do not need to know the protocol to follow this guide.
- **The assistant plays through the same door you do.** Your click and the assistant's turn both end in one server operation, `play_move`. An operation is a named action your server offers. The server alone decides whether a move is legal.
- **Your click wakes the assistant.** A page can call your server, but it cannot make the assistant speak. So after your move the board adds a short message to the conversation, as if you had typed it. That is what hands the turn to the assistant.

## Run it

The finished game is in this repository as [`examples/tic-tac-toe`](../examples/tic-tac-toe). It was generated with `saga init` and keeps the starter's structure. You need Node 22.23.3 or newer and npm.

```sh repository
npm ci
npm run build:tic-tac-toe
node apps/lit-host/dist/tic-tac-toe/server.mjs
```

The first command installs the repository's tools. The second packs the SDK, installs it into a clean copy of the example, and builds the board and the server. The third starts the server. It prints the address of its MCP endpoint, which looks like this:

```text
Tic-tac-toe MCP endpoint: http://127.0.0.1:3000/mcp
```

Add that address to an MCP host that can show an app, then ask the assistant for a game. The guide's last section covers Claude, ChatGPT and Alexa+. None of the three has been run against this game yet. The [host compatibility guide](host-compatibility.md) records what each host is known to support.

You can also try the board without any host. The browser tests mount it in a small local stand-in for a host, `apps/lit-host/e2e/host-fixture`, and play whole games there: clicks, keyboard moves, the assistant's replies and the messages the board sends. See the [development reference](development-reference.md#local-development) for the commands.

## Your first click

Say "Let's play tic-tac-toe." The assistant calls the game's `new_game` operation, and the host shows the board above.

Click the centre square. Three things happen, in this order:

1. **The board asks the server to play your move.** It calls `play_move` for X, and says which move number it has on screen. If something else has changed the game since, the server refuses the move and changes nothing.
2. **The server answers with the whole game.** The board shows your X and the status line changes to "Waiting for the assistant to play O…". The squares switch off, because it is not your turn.
3. **The board adds a message to the conversation,** as you:

   > Your move in tic-tac-toe game `zDfjqVwo1WmUlxN1BOqAhw`. The board is in your context; if it isn't, read it with get_game. Then play O with play_move.

   The message names the game and never draws the board. The server owns the state, so the message carries only the game's identifier. The board also hands the assistant a copy of the game as background it can see and the chat does not show. If the host cannot take that copy, the message is still sent, and the assistant reads the game with `get_game`.

The assistant now has its turn. It reads the game if it needs to and calls `play_move` for O. The board, meanwhile, checks the server every second and a half, for up to a minute. When O appears, the board shows it and gives the turn back to you.

If the host takes no message at all, the status line tells you what to do: "Tell the assistant it's their move." The board keeps checking either way.

When your move ends the game, the board sends a different message instead, "I won our tic-tac-toe game." or "Our tic-tac-toe game ended in a draw.", and waits for nothing.

Next: the layout of the example, and the four operations behind it.
