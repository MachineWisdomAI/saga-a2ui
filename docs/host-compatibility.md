# Host compatibility

SAGA uses MCP Apps to deliver a rendered view and its data through an assistant. The same application can serve several hosts, but the flows observed in ChatGPT web, Claude web and the Alexa+ simulator differ. Choose the interaction you need from the evidence below, then qualify it in your own deployment.

| Interaction | ChatGPT web and Claude web | Alexa+ simulator |
| --- | --- | --- |
| Display a SAGA view from a tool result | Observed in bounded Lit and React runs | Observed for supplied views and Ansari's answer card |
| Render a FaithfulCard answer with attribution | Observed for the recorded answer-card flows | Observed for the Ansari answer-card flow |
| Run a protected operation from an in-card control | Allowed and refused notes and playback-grant requests observed | Existing-frame server-call result delivery failed in the recorded probes |
| Authenticate a request and apply server authorization | Observed with synthetic accounts through the hosts' supported authentication paths | Not established by these records |
| Replace or reopen a view after a slow call | Specific delayed-result and reload cases observed; limits below | Not established by these records |
| Play audible protected media | Not established by the remote-host runs; loopback media could not be fetched | Not established |

These are observations of particular artifacts and flows, not a complete renderer, device or host-version matrix. The runnable starter and standalone demo have local qualification; that alone does not establish their operation in an assistant host.

## Renderer support and application evidence

React and Lit both provide an MCP stack for typed surfaces, actions and FaithfulCard applications. React is used by Ansari Faithful Answers; its [public destination candidate](https://github.com/iaser-ai/ansari/pull/323) records the application’s React stack recipe and local validation. The earlier [React integration record](https://github.com/MachineWisdomAI/saga-a2ui/pull/161) reports answer cards in ChatGPT web, Claude web and the Alexa+ development simulator. Keep those earlier host artifacts separate from the later application candidate and package versions.

Lit supplies the generated starters and standalone demo, and has its own bounded host observations. React has its own application and host evidence. Neither set establishes a complete host matrix or a universal maturity ranking. The missing React starter is a tooling gap; host limitations below must be evaluated for the actual flow and built resource, whichever renderer the application chooses.

## ChatGPT and Claude

The notes application has been exercised in both hosts with a React view and the shared action runtime. Local Mark read changed application state without a backend call. Archive used the authenticated server, displayed the successful result and refused before the archive request when its session prerequisite failed. A fresh list reflected the applied archives. The [action binding Status](../blueprints/modules/action_binding.blueprint.md#status) records the source revision, review and limits of that integration.

Protected playback runs established a narrower result: a control could request a grant, the server could allow or refuse it for the verified account, and a newly opened view could obtain a fresh grant. The observed public tool arguments carried the episode selection, while recipient metadata and grants used their separate delivery fields. The inspected model-visible result contained no capability or media URL. That observation supports the tested result projection; it is not a guarantee about every host's internal data handling or every application response.

The failure cases matter when designing feedback:

- In one Claude run, the host ended its wait at about 30 seconds while the synthetic grant was delayed for 35 seconds. A cancellation notification was observed, but the entitlement work's signal was not aborted. Client timeout therefore did not establish that server work stopped.
- A ChatGPT reload removed a pending view and a fresh view obtained a new grant. This did not expose the old iframe's internal cleanup or prove that the host forwarded cancellation.
- Some initial card loads required the host's **Try again** control. The successful retry is recorded alongside the first failure.
- The remote browser could not fetch the loopback media address. Grant delivery and the absence of a leak in the inspected result do not establish audible playback.

The [connector Status](../blueprints/features/reusable_mcp_connector.blueprint.md#status) and [request/view lifetime Status](../blueprints/features/request_view_lifetimes.blueprint.md#status) retain the exact evidence. Applications should show an uncertain outcome when a protected request may already have taken effect, and avoid automatically retrying a write merely because the view stopped waiting.

## Alexa+

The recorded Alexa+ simulator flows displayed supplied SAGA views and Ansari's FaithfulCard answer. Conversation-driven delivery is the demonstrated path: the person asks, the assistant calls the tool and the resulting card displays the answer.

Existing-frame in-card calls failed differently. The recorded probes reached a server response, but the waiting card did not receive a usable completion and timed out. Similar behavior appeared in plain MCP Apps probes with Lit and React. This narrows the suspected boundary to host/bridge delivery; it does not establish a specific host defect or resolve the cause. The [Lit adapter Status](../blueprints/features/reusable_lit_adapter.blueprint.md#status) preserves the affected scope. Until your target host is qualified, expose consequential Alexa+ operations through the conversation rather than assuming an in-card server call will update that frame.

SAGA also supplies a `readingProfile` helper. Alexa-like host names, an Echo Show device class or a mobile platform yield a device profile; the application maps that profile to its own font and layout tokens. This is implemented presentation behavior, not evidence of physical Echo Show testing. See [card styling](faithful-card-styling.md#custom-properties) for the application-owned mapping.

## Use the evidence for your application

Keep three boundaries separate when selecting a host:

1. **Displayed content:** verify that the expected result reaches the correct view, with its attribution and supported content policy. A visible card alone does not prove the origin or freshness of its data.
2. **Protected operations:** verify authentication, server authorization and the allowed/refused outcome for the actual operation. A successful local prerequisite does not authorize the server request.
3. **End-of-view behavior:** qualify late results, closing or replacing the view, and the resources your application owns. Cancellation ends a wait; it does not roll back a remote effect.

The [content safety Status](../blueprints/features/content_safety_levels.blueprint.md#status), [action binding Status](../blueprints/modules/action_binding.blueprint.md#status) and the other linked Blueprints identify the original observations. Package publication, a local browser test and a host observation each establish a different part of the integration.
