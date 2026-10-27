# Host compatibility

SAGA applications run in ChatGPT, Claude and Alexa+. You build one view, serve it from your MCP server, and every host displays it. Your application contains no host-specific code.

| Your application | ChatGPT | Claude | Alexa+ |
| --- | --- | --- | --- |
| Shows a SAGA view with your server's data | Yes | Yes | Yes |
| Shows a FaithfulCard answer with source attribution | Yes | Yes | Yes |
| Reads well on the reader's screen | Desktop | Desktop | Device, including Echo Show |
| Signs the user in and applies your authorization | Yes | Yes | Not yet tested |
| Runs a protected action from a button in the card | Yes | Yes | Through the assistant (see below) |
| Recovers from slow calls, reloads and closed cards | Yes | Yes | Not yet tested |

## ChatGPT and Claude

SAGA's full feature set works in ChatGPT web and Claude web.

- **Views with live data.** Lit and React views display your server's data, and a button's server call updates the same card in place.
- **Protected actions.** A control bound with `Action.server` calls your protected tool. The signed-in user's verified identity reaches your server (ChatGPT signs in through OAuth), your authorization decides, and the card shows the allowed or refused outcome.
- **Private data stays out of the conversation.** Data meant only for the view, such as a playback grant, reaches the card and never appears in what the model sees. Tool arguments carry what the user chose, never an account.
- **Recovery.** A slow call ends with a clear message when its time budget runs out, a late result never overwrites a retired card, and opening the item again starts a fresh card that works.
- **Faithful answers.** FaithfulCard renders the supplied answer in light and dark with its attribution, artwork, readable links and image annotations, and lays out mixed English and Arabic lists in the right direction. IASER's Ansari runs its answer card in both hosts.

In ChatGPT, a newly opened app card occasionally appears blank the first time; the host's **Try again** displays it.

## Alexa+

SAGA views and FaithfulCard answers display in Alexa+, including on the Echo Show screen. SAGA recognizes Alexa+ and Echo Show as device hosts and gives your renderer a device reading profile, so text and layout scale for reading at arm's length. Ansari's answer card runs in the Alexa+ simulator.

Build Alexa+ interactions around the assistant's own tool calls: the user asks, Alexa+ calls your tool, and the card shows the result. A button inside the card that calls your server directly does not update the card in Alexa+ today. The simulator receives your server's answer but does not pass it on to the card, so the call times out. Plain MCP Apps code shows the same behavior with both React and Lit, so it comes from the host, not from SAGA. Offer those actions through the conversation in Alexa+ and keep in-card buttons for ChatGPT and Claude.

## Evidence

Every claim above comes from runs in the named host using synthetic accounts and data. The status sections of the [MCP connector](../blueprints/features/reusable_mcp_connector.blueprint.md#status), [request and view lifetimes](../blueprints/features/request_view_lifetimes.blueprint.md#status), [Lit adapter](../blueprints/features/reusable_lit_adapter.blueprint.md#status) and [content safety](../blueprints/features/content_safety_levels.lifecycle.md#status) designs link each run. The [action binding](../blueprints/modules/action_binding.blueprint.md#status) status covers the React protected-player control.
