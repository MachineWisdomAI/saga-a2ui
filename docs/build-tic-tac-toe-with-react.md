# Build tic-tac-toe with React

Build a React game that you play inside Claude or ChatGPT. You click a square to place X; the assistant plays O. A local server checks every move and keeps the board up to date.

You’ll create an app in your own directory, install saga from npm, and open its first card in the host you choose. Then you’ll add the game and a list of moves. Vite generates the project configuration. Each lesson explains an application change, shows what to look for in the host, and provides complete files for comparison.

![A tic-tac-toe game in progress, with X in the centre and bottom-right squares, O in both top corners, and a New game button below the board.](images/tic-tac-toe-board.png)

A finished version of this game runs at `https://examples.saga-ai.dev/tic-tac-toe/mcp`, with no sign-in. To try it before you build, follow the [setup steps for Claude and ChatGPT](https://github.com/MachineWisdomAI/saga-a2ui-examples#use-the-hosted-game); its [source](https://github.com/MachineWisdomAI/saga-a2ui-examples/tree/6431e6a984c88eca6904b75b760a57d0e2edde16/apps/tic-tac-toe/game) is maintained in the examples repository, shared by local development and the hosted Worker. This guide is how you build it yourself, with npm and Vite, and does not depend on the hosted game.

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
| Zod | Checks that tool inputs and results have the shapes the game expects. | [Zod basics](https://zod.dev/basics) |
| MCP and MCP Apps | Let the assistant call your server’s tools and display an interactive card in the conversation. | [MCP introduction](https://modelcontextprotocol.io/docs/getting-started/intro) and [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) |
| A2UI | Describes the board’s components and data bindings so a renderer can display them. | [A2UI concepts](https://a2ui.org/concepts/overview/) |
| saga React MCP stack | Connects your React components, server operations, and conversation actions to the host. | [saga React integration](react-consumers.md) |
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

Follow [Connect a React component to a server result](tic-tac-toe/1-first-card.md). You will generate a React/TypeScript project with Vite, add an operation that returns a message, and display that result in a React component. The lesson includes the installation and build commands; run them in your own app directory.

The walkthrough pins `@saga-a2ui/react-mcp-stack` to `0.11.0-rc.1` and uses exact versions of its dependencies. Use those versions; the npm `next` tag can move. The stack includes the local HTTP/MCP listener, so your app only defines its operations, components and state.

The lesson's consumer-root overrides keep `@a2ui/markdown-it` at the compatible version and replace vulnerable DOMPurify and Hono dependencies with patched versions. Keep them when regenerating your lockfile; see the [complete override recipe](public-install.md#install-one-stack-plus-framework-peers).

A2UI's Zod 3 dependency still carries the [resource-consumption advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The game's tool schemas use Zod 4.6.7; its own React catalog does not bundle DOMPurify or render HTML from the model. Do not force Zod 4 into A2UI's Zod 3 dependency: their APIs differ.

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

Stop the game server with **Ctrl-C** in its terminal. Leave the tunnel running. Follow [Build the playable game](tic-tac-toe/2-playable-game.md) to add the rules, server operations, board and turn handoff. Each section traces a part of the game and includes the complete application files. Then run:

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

In Claude, the board puts **Your turn** in the chat box. It has not been sent yet: click **Send** to let the assistant play; you do not need to write or edit the message. In ChatGPT, the board sends that message automatically. Accept any tool confirmation the host presents. The assistant plays O, the existing board shows the move, and the empty squares become available again.

Keep playing until someone wins or the board is full. The status announces the result, and a winning line is highlighted. **New game** prepares a message asking the assistant to open a fresh card. Confirm it if asked, then play in the new card; the old card keeps its own game. Keyboard users can Tab to an available square and press Enter or Space.

### How a turn reaches the board

Your click calls `play_move` through the host. The server checks the player, square, and move number before applying it, then returns the updated game. The board shows X and adds **Your turn**. The game ID, board and move instructions travel separately in hidden model context; the assistant can use `get_game` if it needs to read the state again.

The assistant calls the same `play_move` tool. That call returns to the conversation, so the board checks `get_game` while it waits. It reads every 1.5 seconds for about a minute, then every 5 seconds until O plays or the game expires. Waiting for a host confirmation does not require a refresh. Closing the view ends its wait.

When the host reopens a card, the board reads its game before enabling any squares. If a move's reply is lost, the board also reads the game to check whether that move landed. A confirmed move gets its turn message without playing the square again. An unconfirmed message is not resent automatically: the host may already have received it.

![A board click and the assistant’s tool call both reach play_move; the board sends a conversation message after X and reads the game while waiting for O.](../diagrams/tic-tac-toe-turn-loop.svg)

The app owns the game rules, storage, React components, and action definitions. saga validates the operation inputs and results, connects the view to the host, and supplies the action and conversation APIs. `src/surface.ts` describes the layout; `src/catalog.tsx` implements its components in React; `src/actions.ts` gives the buttons their behavior.

## 4. Add a move list

The game already returns its move history. Follow [Add a move list](tic-tac-toe/3-move-list.md) to render it with a new React component and a layout binding. The lesson shows the small change first and includes both complete files for comparison.

Stop the game server, rebuild, and start it again:

```sh
npm run typecheck
npm run build
npm start
```

Use the host’s **Refresh tools** action as in step 3, then open a new chat and start a game. After you click the centre square, the list shows **1. You: row 2, column 2**. When O plays, its move appears below yours. Each turn adds a line without changing the server or the actions.

Try changing the board’s colours in `src/index.css`, or the status messages in `src/text.ts`. Rebuild and start a new game to see your changes.

## When something goes wrong

| Symptom | Check |
| --- | --- |
| npm reports `ETARGET` | Confirm that you copied the exact package versions from step 1 and are using the public npm registry. |
| A dependency or audit warning appears | Read the package named in the warning and run `npm audit`; avoid `npm audit fix --force`, which can replace the versions used here. |
| Port 3000 is already in use | Stop the earlier game server before running `npm start` again. |
| The host cannot connect | Keep both terminals running, check that the URL ends in `/mcp`, and copy the new address if you restarted the tunnel. |
| The server rejects the host | Keep `--http-host-header localhost` in the tunnel command. |
| The first card fails to display | Use the host’s **Retry** or **Try again** button once; if it still fails, check the server and tunnel output. |
| The card cannot share game context | The short turn message is not sent because the assistant cannot reliably identify the game. Check that the host supports context updates. |
| Claude waits after your click | Send the turn message that the board placed in the composer and approve any pending tool call. |
| A reopened board says “Checking the current game…” | The card is reading the live game instead of trusting its saved snapshot. If it reports a connection problem, check the server and tunnel; it keeps the squares disabled. |
| The card reports unavailable, declined or unconfirmed messaging | Check the host's confirmation controls. A failed response does not establish whether the message arrived. Keep the exact card message and use **Show game ID** on the card to find its identifier when reporting the problem; repeated turn prompts can ask the assistant twice. |
| The board reports that the game is gone | Start a new game; the server restarted or the game expired. |

The board should update after each confirmed turn. If it stalls, check for a pending host confirmation and make sure the server and tunnel are still running. You should not need to type another turn prompt or refresh the board.

When finished, press **Ctrl-C** in both terminals and remove the temporary connection from the host. [Other ways to structure the game](tic-tac-toe-architecture-options.md) discusses a separate backend, other renderers, and proposed delivery options. To build a different React app, keep the connection and build files and replace the game’s rules, components, and actions.
