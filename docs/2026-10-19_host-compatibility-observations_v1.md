# Host compatibility observations

Edition: 2026-10-19 v1. Observations from 18–19 October 2026; this is a record of tested behavior, not a general renderer compatibility guarantee.

The tested self-contained React/A2UI resource displayed initial server data in ChatGPT web, Claude web and the Alexa+ web simulator. A button inside that card called a server tool and applied its returned data to the same mounted instance in ChatGPT and Claude. In Alexa+, the server returned a new value and the simulator logged it in an update directive, but the card retained its initial value and the app call timed out.

## Tested resource and coverage

The standalone probe used React/React DOM 19.3.1, `@a2ui/react` and `@a2ui/web_core` 0.14.0, and `@modelcontextprotocol/ext-apps` 2.0.3 directly. It did not use SAGA's React adapter or MCP adapter. Components, bridge code, CSS and an HTML template were authored separately; the build assembled one `ui://` HTML resource with inline runtime code and styles and no external runtime assets. Initial fields and updates used A2UI data-model bindings to server-generated values.

The original artifact was 1,138,112 bytes, SHA-256 `2e2f9a92ec63e2253b8f891fe2a734e2aa028eaa7ef11945c59885f41396a2db`, served as `text/html;profile=mcp-app`. Its bytes matched the resource retrieved from Alexa's rendered card URL. Checks used Microsoft Edge on macOS.

| Host | Initial server data | In-card tool call and same-instance update | Additional observation |
| --- | --- | --- | --- |
| ChatGPT web | Displayed | Returned value displayed; same instance, one mount | Native reload followed by another update passed |
| Claude web | Displayed | Returned value displayed; same instance, one mount | Native reload followed by another update passed |
| Alexa+ web simulator | Displayed | Call timed out; existing card retained initial data | Two fresh conversations reproduced the timeout with the same artifact; both logged server HTTP 200 and a simulator update directive containing the new value |

All three hosts reported a blocked `script-src eval` diagnostic. Its originating dependency and relationship to the Alexa timeout were not established; CSP was not relaxed.

## What the Lit comparison covers

The accepted Lit consumer flow used a conversation-level tool call followed by display of the answer delivered by the host. Its view registered a result callback through SAGA's `connectToolResultView` and did not invoke `callServerTool`.

Both that Lit flow and the React probe displayed host-delivered data in Alexa+. The accepted Lit flow did **not** test the in-card tool round trip that timed out in the React probe. These results do not establish a renderer-specific cause or a general Lit-versus-React compatibility ranking.

## Follow-up diagnostics and limits

A diagnostic React artifact added message and callback tracing. In its clean Alexa run, initial messages arrived and validated, but the raw iframe trace recorded no incoming message after the button call before its 60-second timeout. The server response and simulator update directive contained the new value; the mounted card retained its initial value. This diagnostic artifact was not retested in ChatGPT or Claude.

A local control at SAGA commit `78820dfce3d119d4c82d3d12020af65bef1e2fb1`, using real `App`, `AppBridge`, `InMemoryTransport` and `connectToolResultView`, passed both a tool response and a later tool-result notification. The existing view suite passed nine tests. An isolated test of retrieved host bridge code did not forward a simulated tool response or parse its simulated update envelope. Those local results do not establish the cause of the live timeout or which code needs a repair.

The root cause, required repair location and whether a supported SAGA-side change can resolve the timeout remain unestablished. No production fix was made or verified in this investigation. The observations do not complete installed SAGA React recipe qualification, full component parity, physical-device acceptance or certification. The related implementation work remains tracked in [REACT1](https://github.com/MachineWisdomAI/saga-a2ui/issues/28), [REACT2](https://github.com/MachineWisdomAI/saga-a2ui/issues/30), [REACT3](https://github.com/MachineWisdomAI/saga-a2ui/issues/31) and [REACT4](https://github.com/MachineWisdomAI/saga-a2ui/issues/33).
