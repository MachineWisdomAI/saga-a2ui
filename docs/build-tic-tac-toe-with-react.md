# Build tic-tac-toe with React

Build a React game that you play inside Claude or ChatGPT. You click a square to place X; the assistant plays O. A local server checks every move and keeps the board up to date.

You’ll create an app in your own directory, install SAGA from npm, and open its first card in the host you choose. Then you’ll add the game and a list of moves. The linked steps provide complete files, including the build configuration and server.

![A tic-tac-toe game in progress, with X in the centre and bottom-right squares, O in both top corners, and a New game button below the board.](images/tic-tac-toe-board.png)

## Before you start

Install Node.js 22.23.3 or newer and `cloudflared`. You also need a text editor, a terminal, and access to custom MCP connections in Claude or ChatGPT on the web. Check that your account offers **Add custom connector** in Claude or **Add custom MCP server** in ChatGPT before creating the app. A managed workspace may require an administrator to enable this.

| Prerequisite | What it does | Learn more |
| --- | --- | --- |
| Node.js | Runs the game server and the build tools on your computer. | [Install Node.js](https://nodejs.org/en/download) |
| npm | Installs JavaScript packages and runs the scripts in `package.json`; it comes with Node.js. | [npm getting started](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) |
| Terminal | Runs the commands in this guide from your app directory. | [macOS Terminal](https://support.apple.com/guide/terminal/welcome/mac) or [Windows Terminal](https://learn.microsoft.com/en-us/windows/terminal/) |
| Text editor | Creates the source and configuration files; VS Code is one option. | [VS Code introduction](https://code.visualstudio.com/docs/introvideos/basics) |
| TypeScript | Adds types to the JavaScript you write for the game and server. | [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) |
| React | Draws the board and its controls from your components. | [React quick start](https://react.dev/learn) |
| Vite | Bundles the React view and the Node server into files the app can run. | [Vite guide](https://vite.dev/guide/) |
| Hono | Routes HTTP requests to your game’s MCP endpoint. | [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs) |
| Zod | Checks that tool inputs and results have the shapes the game expects. | [Zod basics](https://zod.dev/basics) |
| MCP and MCP Apps | Let the assistant call your server’s tools and display an interactive card in the conversation. | [MCP introduction](https://modelcontextprotocol.io/docs/getting-started/intro) and [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) |
| A2UI | Describes the board’s components and data bindings so a renderer can display them. | [A2UI concepts](https://a2ui.org/concepts/overview/) |
| SAGA React MCP stack | Connects your React components, server operations, and conversation actions to the host. | [SAGA React integration](react-consumers.md) |
| Claude or ChatGPT | Hosts the card and supplies the assistant that plays O. | [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) or [ChatGPT custom MCP servers](https://developers.openai.com/plugins/deploy/connect-chatgpt) |
| Cloudflare Quick Tunnel | Gives the local server a temporary HTTPS address that the host can reach, without a Cloudflare account or domain. | [Install cloudflared](https://developers.cloudflare.com/tunnel/downloads/) and [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) |

You only install Node.js and `cloudflared` separately. The app’s `package.json` installs the JavaScript libraries and build tools. Familiarity with JavaScript and basic React is enough to start; the links explain unfamiliar terms.

Check the tools in your terminal:

```sh
node --version
npm --version
cloudflared --version
```

The game has no sign-in. Anyone with the tunnel address can create a game, and anyone who has a game’s identifier can play either side. Use it for disposable games. Games expire 30 minutes after the last move, and restarting the server clears them.

## 1. Create the app

From the directory where you keep your projects, run:

```sh
mkdir my-tic-tac-toe
cd my-tic-tac-toe
mkdir src server
```

If you already created an empty directory, open your terminal there and run only `mkdir src server`. All remaining app commands run from `my-tic-tac-toe`, the directory containing `package.json`.

Create the files in [Create the app files](tic-tac-toe/1-first-card.md). The package file pins `@saga-a2ui/react-mcp-stack` to `0.8.1-rc.1`, along with exact versions of React and the other dependencies. Use those versions for this walkthrough; the npm `next` tag can move to a later release.

Install, check, build, and start the app:

```sh
npm install --strict-peer-deps
npm run typecheck
npm run build
npm start
```

With these versions, npm reports advisories inherited through A2UI’s Zod 3 and DOMPurify dependencies. The game’s tool schemas use Zod 4.6.7; its own React catalog does not bundle DOMPurify or render HTML from the model. The installed dependencies still carry those advisories. See the [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and [DOMPurify advisory](https://github.com/advisories/GHSA-cg2g-xh64-v4q7). Do not force Zod 4 into A2UI’s Zod 3 dependency: their APIs differ.

Keep the generated `package-lock.json` in your project. Use `npm ci` for later installs from that lockfile.

The server prints:

```text
Tic-tac-toe MCP endpoint: http://127.0.0.1:3000/mcp
```

Leave this terminal running. The first version offers a welcome card; the board comes in step 3.

## 2. Open the card in Claude or ChatGPT

The host connects from its own servers, so it cannot use your computer’s `127.0.0.1` address. Open a second terminal and start the tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:3000 --http-host-header localhost --no-autoupdate
```

Copy the HTTPS address ending in `trycloudflare.com` from the output and append `/mcp`. For example, `https://your-assigned-name.trycloudflare.com/mcp`. Use the address printed in your terminal, not this example.

`--http-host-header localhost` gives the local server the Host header it accepts. Keep this terminal running too. Quick Tunnel chooses a new address when you restart it; restarting only the game server keeps the tunnel address. Cloudflare provides Quick Tunnels for development and testing, without an uptime guarantee. See its [current limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

### Claude

1. Open **Customize → Connectors → Add custom connector**.
2. Name it **My tic-tac-toe**, enter the tunnel’s `/mcp` URL, and choose **No sign-in** when offered.
3. Connect it, then open a new chat and enable **My tic-tac-toe** from the connectors menu beside the composer.
4. Send: **Open My tic-tac-toe.** Approve the tool call if Claude asks.

The card should say: **Your React app is connected. Next, build the board.** If your menu differs, follow [Claude’s custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) to reach the same connection settings.

### ChatGPT

1. Open **Plugins → + → Add custom MCP server**.
2. Name it **My tic-tac-toe**, enter the tunnel’s `/mcp` URL, and choose **No authentication**.
3. Add and connect it. In a new chat, select **My tic-tac-toe** from the composer’s tools menu or by typing `@` and choosing it.
4. Send: **Open My tic-tac-toe.** Approve the tool call if ChatGPT asks.

The card should show the same welcome message. OpenAI’s [connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt) cover account access and changes to these menus.

Both hosts can occasionally show a display error on the first load. Use the card’s **Retry** or **Try again** button once if that happens. This recovers a failed initial display; turns should update the board automatically once the game is open.

## 3. Build and play the game

Stop the game server with **Ctrl-C** in its terminal. Leave the tunnel running. Add or replace the files in [Build the playable game](tic-tac-toe/2-playable-game.md), then run:

```sh
npm run typecheck
npm run build
npm start
```

The server now offers four tools:

| Tool | Purpose | Opens a card |
| --- | --- | --- |
| `new_game` | Creates an empty game. | Yes |
| `show_game` | Opens an existing game. | Yes |
| `get_game` | Reads the current board. | No |
| `play_move` | Checks and applies one move. | No |

Update the connection so the host discovers the added tools and the rebuilt card:

- **Claude:** open **Customize → Connectors → My tic-tac-toe**, open its **…** menu, and choose **Refresh tools list**.
- **ChatGPT:** open **Plugins → My tic-tac-toe → Manage**, then choose **Refresh tools**.

Start a new chat with **My tic-tac-toe** enabled. Send:

> Let’s play tic-tac-toe. I’ll play X by clicking the board; you play O.

Click the centre square of the empty board. It shows X and disables the squares while O has the turn.

In Claude, the board puts a turn message in the composer. Click **Send** to confirm it; you do not need to write or edit the message. In ChatGPT, the board sends that message automatically. Accept any tool confirmation the host presents. The assistant plays O, the existing board shows the move, and the empty squares become available again.

Keep playing until someone wins or the board is full. The status announces the result, and a winning line is highlighted. **New game** starts again. Keyboard users can Tab to an available square and press Enter or Space.

### How a turn reaches the board

Your click calls `play_move` through the host. The server checks the player, square, and move number before applying it, then returns the updated game. The board shows X and adds a message asking the assistant to play O. It also supplies the current game as model context; the assistant can use `get_game` if it needs to read the state again.

The assistant calls the same `play_move` tool. That call returns to the conversation, so the board checks `get_game` while it waits. It reads every 1.5 seconds for the first minute, then every 5 seconds until O plays or the game expires. Waiting for a host confirmation does not require a refresh. Leaving the view or starting another game ends the old wait.

![A board click and the assistant’s tool call both reach play_move; the board sends a conversation message after X and reads the game while waiting for O.](../diagrams/tic-tac-toe-turn-loop.svg)

The app owns the game rules, storage, React components, and action definitions. SAGA validates the operation inputs and results, connects the view to the host, and supplies the action and conversation APIs. `src/surface.ts` describes the layout; `src/catalog.tsx` implements its components in React; `src/actions.ts` gives the buttons their behavior.

## 4. Add a move list

The game already returns its move history. Add a visible list by replacing `src/catalog.tsx` and `src/surface.ts` with the complete files in [Add a move list](tic-tac-toe/3-move-list.md).

Stop the game server, rebuild, and start it again:

```sh
npm run typecheck
npm run build
npm start
```

Use the host’s **Refresh tools** action as in step 3, then open a new chat and start a game. After you click the centre square, the list shows **1. You: row 2, column 2**. When O plays, its move appears below yours. Each turn adds a line without changing the server or the actions.

Try changing the board’s colours in `index.html`, or the status messages in `src/text.ts`. Rebuild and start a new game to see your changes.

## When something goes wrong

| Symptom | Check |
| --- | --- |
| npm reports `ETARGET` | Confirm that you copied the exact package versions from step 1 and are using the public npm registry; this guide does not use commit-derived candidate versions. |
| A dependency or audit warning appears | Read the package named in the warning and run `npm audit`; avoid `npm audit fix --force`, which can replace the versions used here. |
| Port 3000 is already in use | Stop the earlier game server before running `npm start` again. |
| The host cannot connect | Keep both terminals running, check that the URL ends in `/mcp`, and copy the new address if you restarted the tunnel. |
| The server rejects the host | Keep `--http-host-header localhost` in the tunnel command. |
| The first card fails to display | Use the host’s **Retry** or **Try again** button once; if it still fails, check the server and tunnel output. |
| Claude waits after your click | Send the turn message that the board placed in the composer and approve any pending tool call. |
| The board reports that the game is gone | Start a new game; the server restarted or the game expired. |

If a turn only proceeds after you type a new prompt or refresh the board, it has failed this walkthrough’s expected behavior. Check the pending host confirmation and connection before continuing.

When finished, press **Ctrl-C** in both terminals and remove the temporary connection from the host. [Other ways to structure the game](tic-tac-toe-architecture-options.md) discusses a separate backend, other renderers, and proposed delivery options. To build a different React app, keep the connection and build files and replace the game’s rules, components, and actions.
