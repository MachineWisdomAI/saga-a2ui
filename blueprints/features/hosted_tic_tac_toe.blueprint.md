---
feature_name: hosted_tic_tac_toe
status: approved
module_blueprints: []
dependencies: [fetch_mcp_hosting, getting_started_tracks, host_publication]
date_added: 2026-10-30
---

# A permanent, branded Tic Tac Toe application

## Status

- Ownership amendment: the owner approved moving the complete game into the public examples repository on 30 October 2026. The amendment below changes source ownership and qualification only; gameplay, storage, endpoint, attribution and artwork contracts remain unchanged. The coordinator will pin this amendment's committed revision in the following status record. Earlier implementation receipts below describe the prior ownership arrangement.

- Design: approved by human review on 30 October 2026 at [revision `eb2f0c2cd3cf9216c5b3dbb17d09830283863c05`](https://github.com/MachineWisdomAI/saga-a2ui/blob/eb2f0c2cd3cf9216c5b3dbb17d09830283863c05/blueprints/features/hosted_tic_tac_toe.blueprint.md), including its referenced diagrams. Approval preserves the open upstream attribution/interface and canonical-artwork decisions below; it does not approve those designs or authorize deployment.
- Implementation: Partial. **Blueprint `eb2f0c2cd3cf9216c5b3dbb17d09830283863c05` implemented, for the canonical game source and its shared-credit adoption, at `MachineWisdomAI/saga-a2ui@cc67b817112c33540d51aab34040904323819cc8`** ([PR #354](https://github.com/MachineWisdomAI/saga-a2ui/pull/354), independently approved at its head `aceb33b`). It adopts the shared own-catalog credit that landed in [`9476d80`](https://github.com/MachineWisdomAI/saga-a2ui/commit/9476d8099c4aeff38ecfbe80b2fd6976cd5c1729) ([design](own_catalog_attribution.blueprint.md)), the catalog and layout identifier `https://saga-a2ui.dev/catalogs/tic-tac-toe/board/v1`, and an optional `icons` setting for the game server. **The tutorial game's host-context seam, which the hosted card uses to follow the host's theme, landed at `MachineWisdomAI/saga-a2ui@522d613c280565071497bfcbd221ce277a85b28b`** ([PR #356](https://github.com/MachineWisdomAI/saga-a2ui/pull/356), approved at its head `022f330`). **The hosted Worker application is implemented at `MachineWisdomAI/saga-a2ui-examples@0305d3445dfb5c814d99c4497fe0f37fe4cc2cc4`** ([PR #1](https://github.com/MachineWisdomAI/saga-a2ui-examples/pull/1), approved at its head `10ae573`), which pins SDK `522d613`: the Worker, one SQLite-backed Durable Object per game with its fixed 24-hour expiry, the dragon connector icons and the card page, with Workers-runtime and rendered-card tests. The existing local game and tutorial remain their own implemented scope. Landed prerequisites: the shared Fetch entry at [`f1fbac0`](https://github.com/MachineWisdomAI/saga-a2ui/commit/f1fbac0882302cbf024100b462e08abd06a5bdc1) and the selected SAGA dragon light/dark theme assets, bundled unchanged as the default ChatGPT plugin branding at [`1660855`](https://github.com/MachineWisdomAI/saga-a2ui/commit/1660855a2bd643a3161d86f49d090c6cb43682e5) ([provenance](../../assets/brand/plugin/README.md)). **The Claude marketplace entry, the Claude plugin, the setup for Claude and ChatGPT on the web, the data-handling document and the publication release input landed at `MachineWisdomAI/saga-a2ui-examples@f22c84592eb5f7a0f8eedfb591e63e122467de92`** ([PR #2](https://github.com/MachineWisdomAI/saga-a2ui-examples/pull/2), approved at its head `bf3f6af`), and **the hosted-game links in the SDK README and tutorial landed at `MachineWisdomAI/saga-a2ui@b991de04b7fcec81d6c7c37582d143b901737bca`** ([PR #358](https://github.com/MachineWisdomAI/saga-a2ui/pull/358), approved at its head `bcbdfe7`), with the npm and Vite tutorial steps unchanged. Not implemented: a named copyright holder for the examples licence files, and the SDK's registry publication.
- Publish preparation: at `f1fbac0`, the existing `saga publish check` and `prepare` commands, run on the fixture application through the test network seam with its ChatGPT `assets` removed, produced a `ready` ChatGPT package (`package.assets` pass; `plugin.json` references the four dragon files as `composerIcon`, `composerIconDark`, `logo` and `logoDark`, and their bytes are the valid PNG files of the recorded digests). With `claude.connector.icon` pointing at the dragon logo, the Claude connector dossier was also `ready` (`package.images` pass). Neither run needed a code change, so no reusable preparation gap is recorded. That run used a fixture endpoint. Preparation against the game's own deployed endpoint, with the examples repository's release input, then gave: ChatGPT `ready` (package ZIP SHA-256 `3811c42590c7f39e2cb12b3022d73ef034647c8e7ee988cf692e0d68c987ed9d`; the four dragon PNG files valid and unchanged from the recorded digests; the two staged and the two deployed view files agreeing by hash). The Claude directory dossier was `blocked` only on a review contact and carousel screenshots, which are directory-submission fields the repository does not hold and no external submission was made; the Claude plugin bundle and the endpoint checks passed, and `claude plugin validate` passed for the marketplace and the plugin. No reusable publish CLI gap was found. Preparation alone establishes no installation, web distribution or actual connector icon.
- Acceptance: the Worker is deployed at `https://examples.saga-ai.dev/tic-tac-toe/mcp` from `0305d34`, as an anonymous endpoint with four tools. Package consumption is still pending: the SDK packages at `0.11.0-rc.1` are not on the npm registry, so the examples repository builds from the pinned revision's packed packages. Actual-host observations so far: Claude on the web, with a custom connector, played a game to a draw and showed the final card with the dragon and credit in light and dark appearances, but its first card display needed the host's retry, one card failed after a turn, and the connector row showed a placeholder letter, not the dragon. ChatGPT on the web, with a custom plugin, showed the uploaded dragon in the card and in the plugin mention and tool row in both themes; a dark-theme card timed out once and one retry recovered it, then a click on the board sent the person's move automatically and the assistant's reply updated the card, but an older card did not load after a theme switch. Claude on the web, through the merged examples marketplace (Customize, Plugins, Add marketplace, Add from a repository, Sync, then adding the plugin), enabled the `saga-tic-tac-toe` `0.1.0` plugin; its Connectors tab showed SAGA Tic Tac Toe as connected and custom, reusing the existing connection for the same endpoint. Using the plugin's namespaced skill in a chat started a game with `new_game`; the first card failed and one Retry recovered an interactive board; a click on the centre square then Send put in X, Claude played O top-left, and the same card updated with the credit and the selected dragon. So web marketplace installation and a playable invocation through it are verified, with the retry limitation. ChatGPT completed a nine-move draw, and its `show_game` card for the finished game first failed and one Retry recovered it. First-load reliability and the Claude connector icon (the row still showed a placeholder letter) are not established. The checks were on the web only. The SDK packages remain unpublished to npm, so registry consumption is not claimed.
- Brand artwork: the operator selected a second edition of the dragon artwork, and the canonical files are replaced by it unchanged ([provenance](../../assets/brand/plugin/README.md)): head crops for the composer icons, which render at 32 px and below (the hosted card's 24 px mark follows the composer icon), and the full mark on a solid tile for the logos. The SHA-256 digests are `59b21877707e9f3ae59c47ea5a00bed4938a0c7a99903a555155f06b6ae61a2d` (`composer-icon-light.png`), `87f6878befdebe02ef954dbd2c92a47c0a84f803033ae0da279f031d93ea7013` (`composer-icon-dark.png`), `66f444d50e29b7317bbf0a0743fa08630239e7f2e17f022d25dc042e01c7e95c` (`logo-light.png`) and `3dab20a89fd8318abab9b83ab6490162ab5ccc4d0157a37d2af3afbd4e59c07c` (`logo-dark.png`). The first edition, bundled at `1660855` and used by the deployed Worker, the staged package and the host observations above, is superseded for branding. Nothing here claims that the new artwork is deployed, packaged for a host or shown by a host: that needs the examples repository to adopt it, a new package qualification and an actual-host check.

## Problem and current behavior

The React tutorial lets a person play X against the assistant's O through four MCP operations. Its Node server keeps up to 200 games in memory with a 30-minute sliding expiry. Its temporary tunnel and process memory do not provide a permanent public demonstration.

The hosted application demonstrates consuming the library and its tooling at one stable URL, with visible saga a2ui identity. The tutorial retains its npm/Vite steps.

## Proposed behavior

A developer adds **`https://examples.saga-ai.dev/tic-tac-toe/mcp`** to Claude or ChatGPT and starts a game without signing in. A click and the assistant's move both reach the same `play_move` operation. The game retains its four operations, stale-move checks, recovery controls and result shapes; each game's state moves into one SQLite-backed Durable Object.

![The existing tutorial turn flow, whose messages and action ownership the hosted game preserves.](../../diagrams/tic-tac-toe-turn-loop.svg)

The existing diagram labels the tutorial server as Node. The Worker and game object take that role while preserving the other exchanges. [Editable sequence](../../diagrams/tic-tac-toe-turn-loop.mmd) · [PNG](../../diagrams/tic-tac-toe-turn-loop.png).

The card displays the dragon/brand and **“Built with saga a2ui”**, linking to `https://saga-ai.dev/`. Both hosts must also display the dragon as their actual connector icon. Framework credit comes from a shared SDK capability that supports the React own-catalog application; the game must not copy an application-specific footer or add a FaithfulCard dependency merely for credit.

## Responsibilities and interfaces

| Owner | Responsibility |
| --- | --- |
| SDK | Public stack/operation APIs, [Fetch hosting](fetch_mcp_hosting.blueprint.md), reusable attribution and applicable publish preparation/validation. |
| Examples application | Worker composition, route, Durable Object store, trusted brand configuration, marketplace entry and deployment instructions. |
| Canonical game source | `MachineWisdomAI/saga-a2ui-examples` owns `apps/tic-tac-toe/game`: rules, contracts, views, Node/Vite development and application tests. The local entrypoint and hosted Worker import this one implementation. |
| Cloudflare | HTTPS execution, durable storage and scheduled alarm delivery. No separate database, scheduler or keep-alive service is introduced. |
| Host | Tool invocation, view display, connector presentation and supported installation. A package or metadata field cannot guarantee the icon it displays. |

The examples application installs exact SDK packages from npm and does not download SDK repository source. The SDK keeps the complete npm/Vite tutorial and qualifies its snippets, guided change and candidate packages against a digest-verified immutable examples archive in ignored test staging. Application tests move with the game; SDK package and transport qualification stays here. The previous SDK game directory is removed after the examples migration merges. Publication tooling may retain a separate SDK CLI revision, never a game-source dependency.

The game source adopts **`https://saga-a2ui.dev/catalogs/tic-tac-toe/board/v1`** as the constant used by layout and catalog. It is never downloaded during rendering. Provisioning the examples route requires no apex migration.

## Failure and recovery

Creating a game persists its state, one expiry timestamp and one cleanup alarm. **Expiry is fixed at 24 hours after creation.** Reads, moves, polling and cold starts do not extend it. The store preserves the atomic expected-move-number check: competing moves cannot both advance the board, and refusals return unchanged current state.

At or after expiry, reads/moves return the existing unavailable-game outcome. Cleanup removes all object storage and metadata without another visitor, is safe to retry and cannot recreate a game. Platform alarm delivery can be late; the timestamp check still prevents further play. Eviction/recreation before expiry reloads stored state. Only `new_game` creates a new identifier. Anyone holding a game's unguessable ID can play either side; no account identity or transcript is retained.

Target Workers Free allowances with SQLite-backed objects. Ordinary platform quota failures remain service failures, not permission to add paid infrastructure. Roll back a Worker version while preserving compatible bindings/storage; do not delete namespaces or restore expired games as routine rollback.

If supported connector configuration fails to produce the dragon icon, retain the specific host result and stop that acceptance claim. Do not introduce a general proxy to make the record appear complete.

## Verification outcomes

Through the existing MCP operation and game-store contracts, verify playable/reopenable games, unchanged refusals, one successful competing move, persistence across object recreation and unavailable results at the fixed deadline. Advance the Workers test clock and deliver its alarm to verify full cleanup without a client revisit and no resurrection.

In each target web host, verify a representative play/reopen/end flow, credit in active/completed/recoverable-error states and actual connector icons on light/dark surfaces. Check the account's current custom-MCP eligibility and record the tested surface. Block catalog-domain network access and verify the board still renders without a catalog fetch.

Reuse publish CLI preparation and canonical assets; verify installation from the examples marketplace in Claude chat. ChatGPT starts with direct URL setup. Keep desktop-only import, directory approval and custom web connection distinct. Add SDK links and a short optional CLI note while preserving npm/Vite steps. The web marketplace installation and play check has been executed (see Status); desktop-only import and directory approval have not.

## Implementation sequence

Establish the shared Fetch entry, compatible own-catalog attribution and approved theme assets. Qualify applicable existing publish CLI output without making a full directory dossier a prerequisite. Build the persistent game through these dependencies, then check the exact public URL and both hosts before finishing marketplace installation and documentation. Preparing packages does not deploy the service; published package availability must be verified before the hosted build claims registry consumption.

## Open decisions

The own-catalog credit interface is settled by [its design](own_catalog_attribution.blueprint.md): trusted props supplied by application code, with the link opened through the host. The hosted application consumes that output and does not settle it. The canonical geometry is selected: the founder's dragon mark, with the light/dark theme assets noted in Status. Actual connector icon behavior remains a host verification requirement, not an architecture decision already proven.

## References

[Existing tutorial](../../docs/build-tic-tac-toe-with-react.md), [game source](../../examples/tic-tac-toe/README.md), [getting-started tracks](getting_started_tracks.blueprint.md), [host publication](host_publication.blueprint.md) and [Cloudflare cleanup](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).
