---
feature_name: request_view_lifetimes
status: approved
module_blueprints: [action_binding]
dependencies: [authorized_playback]
date_added: 2026-10-16
---

# Request and view lifetimes

A user can leave a view while its server request is still running. A Play action can finish while the player it started keeps playing. A server can stop waiting while an application callback continues doing work. These endings are different events, and each needs an owner that can clean up without waiting for the others to notice.

SAGA gives an action invocation its own work and hook budgets, gives a server request an independent deadline, and makes view retirement end local delivery. The application owns meaning across those boundaries: the selected item, the sign-in label, whether a result permits a retry and any player or other resource retained after the action settles.

## Status

The ordinary lifetime mechanisms are implemented in current source and included in the `0.7.7-rc.1` SDK release. The human-approved [design at `7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md) and [server-budget amendment at `c674060310406b20cf5a985bc23040379bd48812`](https://github.com/MachineWisdomAI/saga-a2ui/blob/c674060310406b20cf5a985bc23040379bd48812/blueprints/features/request_view_lifetimes.blueprint.md) remain approved. The action module separately owns its [approved defaults](../modules/action_binding.blueprint.md#status). These changes did not revive the rejected generic account-switching, retained-state expiry or focus/resume proposal.

| Scope | Landed code | Independent review and acceptance |
| --- | --- | --- |
| View teardown and late-player cleanup | `b84276d6efa90379436cf92ee9f3311327be8ebd` ([PR #84](https://github.com/MachineWisdomAI/saga-a2ui/pull/84)) | Initial STATE1 slice; later label-loss delivery and bounded host observations remain distinct |
| Final action-view label loss | `dc968ab54a9f3793bb3841c1c3242b4e1ffe3182` ([PR #106](https://github.com/MachineWisdomAI/saga-a2ui/pull/106)) | Human decision on 19 October 2026; scoped STATE1 evidence recorded by [PR #108](https://github.com/MachineWisdomAI/saga-a2ui/pull/108) |
| Server budgets and pre-migration controller bound | `ce52c3bcd2aa81d84d8a8ae7b3790044d8523631` ([PR #115](https://github.com/MachineWisdomAI/saga-a2ui/pull/115)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/115#pullrequestreview-5575081741) of `cb663aeccf20dea9de4a715e1997f7c7da196c5e`; listener/socket and controller evidence |
| Unknown-outcome recovery repair | `5df6a2328fdd5cf6055b179233b69eaa5a8d0b5a` ([PR #124](https://github.com/MachineWisdomAI/saga-a2ui/pull/124)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/124#pullrequestreview-5575509089) of `ef8ffc02a5bec9a3d4212e559a06a4e56d8f38ca`; [affected Claude follow-up](https://github.com/MachineWisdomAI/saga-a2ui/issues/13#issuecomment-6273771247) |
| One Play invocation and player leases | `8eb46792205fd0866067cd3aeaf29d8b47ed8257` ([PR #133](https://github.com/MachineWisdomAI/saga-a2ui/pull/133)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/133#pullrequestreview-5576383648) of `98f836811f95833c02f68aa163fb66ad94c8c8d5`; [bounded Claude/ChatGPT receipt](https://github.com/MachineWisdomAI/saga-a2ui/issues/15#issuecomment-6275325996) |
| Complete consumer request/failure qualification | `aa1abfb951aa8c811c634acd8ba471f413022bf6` ([PR #140](https://github.com/MachineWisdomAI/saga-a2ui/pull/140)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/140#pullrequestreview-5577263195) of `8c0eb0777611d9df98a7490d5ccb320811c52bbc`; JSON/SSE and stateless cancellation limits below |
| React protected-player attachment | `4d40761d14c563cb3b48648266594b1d70d8e918` ([PR #172](https://github.com/MachineWisdomAI/saga-a2ui/pull/172)) | [Action Status](../modules/action_binding.blueprint.md#status) identifies source review `58199872cb25c3b8378fb679b6f33198e6f8d7b6` and integration review `2bab6b8884af2ab42e4a40f5e782709079de1db2`; no second lifetime runtime |

The [preserved Status record](https://github.com/MachineWisdomAI/saga-a2ui/blob/cdad54747dfbba756464676ac3b1b8c90148a566/blueprints/features/request_view_lifetimes.blueprint.md#status) retains the full design, review and implementation identities and scoped results. It also preserves the ACT7 local two-live-view case; that fixture proves independent local frames, not how a named host reuses its own frames. The later [view-composition lifecycle](view_composition.blueprint.md#status) replaces the old bridge with `runToolResultView` and owns its startup/teardown revisions.

Bounded Claude and ChatGPT observations established private grants, refusal and fresh-view recovery. ChatGPT pending-view reload showed removal and a fresh acquisition; it did not expose the removed view's internal cleanup. Some containers needed an explicit host rendering retry. Loopback media failed, so these are not audible-audio observations. A host cancellation notification in one Claude run did not abort the server's entitlement signal. Invisible account switches, universal view-reuse behavior, forwarded cancellation, remote rollback and physical-device behavior remain unqualified. The [React host record](https://github.com/MachineWisdomAI/saga-a2ui/blob/24194b60cb63dcd7762b6b198cea6a3a75dea803/docs/2026-10-21_react_play_acceptance_v1.md) preserves its exact resource identities and observations. This prose update does not repeat those runs or broaden acceptance.

## One lifetime per owner

An **action definition** is reusable application code. A **binding** attaches it to one event of one rendered instance. An **invocation** is one activation that the binding admits. A **semantic subject** identifies the application item the instance currently shows, which can change even when the renderer keeps the same instance. The [action module](../modules/action_binding.blueprint.md#lifetimes-and-owners) owns these definitions and their execution rules.

For the Play control the owners are:

| Lifetime | Play example | Ends when | Ending it does not imply |
| --- | --- | --- | --- |
| Rendered instance and binding | One mounted Play control and its attached definition | The adapter retires the instance, or application setup disposes the binding | That a request already sent has stopped |
| Invocation | One admitted Play, from activation through required work and cleanup | An outcome is decided, then the bounded hooks/releases finish | That a transferred player lease ended |
| Semantic subject | The current selection presentation | A new opener changes the selection token | That server work was rolled back |
| Acquired resource | The player's acquisition-scoped lease | Token-specific release, owner teardown or the media ending | That the invocation which created it is still running |
| Server request | The Play POST or a later media GET | Its completion, deadline or disconnect | That the view noticed or that an earlier capability expired |
| Capability | A grant for one episode and recipient key | Its service expiry or revocation on an acquisition check | That already delivered bytes disappeared |

The subscription read begins from host tool input, so its controller owns the read generation and tighter read timer. It is not an instance-bound action merely because it later changes a screen. Content consent likewise has its own owner: replacing an answer revokes image consent, and ending a view retires it permanently. No action timer replaces those responsibilities.

## A non-playback flow: archiving a note

A notes list renders an Archive control for Alpha and another for Beta. Setup attaches the same action definition to each instance and supplies a `subject` reader that reads that instance's current note ID. Two rows may share the layout component ID, but never the same instance or pending state.

When Alpha's control is pressed, `input` copies Alpha's ID before anything awaits. The work deadline then covers the prerequisites and handler together. A session check, a confirmation and a durable audit prerequisite can run in sequence; any refusal stops the archive handler. The handler's `call` sends the request with the remaining work budget and abort signal. The server authenticates, authorizes and bounds that request independently.

The important branches follow the ownership, not the name Archive:

- If the row changes to Beta while confirmation is pending, the runtime detects the changed subject at a checkpoint or adapter wake-up. It cancels the undecided invocation and retains the binding. No archive handler started; prerequisite work may already have happened.
- If the server returns a known archived result and the required success hook times out, that result remains attached to the failure. The application can report that the archive completed and the client update failed. The old hook's `current()` stays false; the subsequent failure hook has its own eligibility.
- If the row unmounts while the request is in flight, the adapter disposes the binding and the local outcome is canceled. The archive may still occur on the server. The application must reconcile authoritative state before inviting a repeat write.

A signal asks work to stop; `scope.active` says whether the invocation's outcome is still undecided; a callback's own `current()` says whether that callback may still present on its instance. After an `await`, application code checks `current()` immediately before a synchronous presentation write. None of these checks can undo an external effect the callback already performed.

![An action's work, required success and cleanup have separate bounds; view retirement releases local ownership.](../../diagrams/request-view-lifetimes.svg)

[Editable Mermaid](../../diagrams/request-view-lifetimes.mmd) · [Editable Excalidraw](../../diagrams/request-view-lifetimes.excalidraw) · [PNG](../../diagrams/request-view-lifetimes.png)

The work deadline starts after the synchronous activation prefix. Required success work and each cleanup step have their own hook budgets. A resource transferred to the application owner survives invocation settlement until that owner releases it; ending a binding is not a whole-owner stop.

## The server request as its own lifetime

The application listener admits each protected POST or media GET with an independent request lifetime. It starts the deadline before authentication or body processing and passes the lifetime into the per-request server factory. The operation layer combines its remaining budget with the MCP request signal. A canceled client invocation therefore does not need to be observed for the server deadline to work, and the client does not depend on a server cancellation reply to stop waiting.

### Configurable server budgets

The SDK supplies an **operation limit of 3,000 ms** and an **end-to-end request limit of 10,000 ms**. These are overridable product defaults, not latency guarantees. They are independent of the action module's client-side work and hook defaults. A server SDK instance may override either field, and an operation/route definition may override either independently. Each field resolves as **per-operation/route override → SDK-instance setting → SDK default**; omitting one field inherits it without changing the other. Resolve and validate configuration before admitting work: reject non-numeric, non-finite, zero or negative values at configuration/registration, never after starting authentication or a handler. No implicit unlimited sentinel is introduced.

An operation is an explicitly owned unit of server work: admission and asynchronous header validation, credential verification, body ingestion/parsing, the complete tool handler including projection, authorization lookup, protected-storage read, or resource acquisition preparation. Synchronous JavaScript cannot be preempted; the gate is checked before and after it. The registered handler has an aggregate operation budget spanning all its nested callbacks. Nested authorization and storage operations may have narrower limits but cannot extend their parent. Authentication and body admission have SDK-instance or adapter operation settings because untrusted request arguments cannot choose their budgets; an operation-specific override takes effect only once the operation is safely identified. Route request settings are chosen from trusted registration before authentication.

**One request lifetime starts before authentication.** At HTTP request admission, before the first credential, admission or body wait, the listener establishes one monotonic absolute deadline. The effective wait for any operation is the minimum of its resolved operation limit, the remaining parent-operation budget (when nested), and the remaining request budget. A sibling may begin its own operation budget only if the original request budget remains. Advancing a stage, receiving progress, retrying a dependency, invoking another callback or revisiting a stage never resets either an enclosing operation deadline or the request deadline. An internal retry remains inside its original operation budget. A separately admitted HTTP request has its own budget; it does not renew an earlier request or imply that repeating an unknown write is safe.

For example, a handler entered with 800 ms remaining gets at most 800 ms even when its configured operation limit is 3,000 ms. Two sequential storage attempts inside that handler share its remaining aggregate budget. Raising an operation limit above the request limit cannot extend the request. The request's budget is independent of client cancellation, action deadlines, capability expiry and proof age.

**Finite JSON and resource responses finish within the request budget.** The terminal owner races disconnect and deadline throughout authentication, body processing, handler/projection, serialization and delivery until the transport reports response `finish` or its documented equivalent. Calling `end` or producing a result does not finish the request. Preparing a response selects it once; it cannot be replaced after commitment. A slow reader cannot hold finite-response delivery beyond the remaining request budget: the adapter closes/destroys that response on expiry, clears its listeners/timers and never writes another status. `finish` means the transport accepted the response, not that the peer consumed every byte. Already buffered bytes cannot be recalled. An adapter may configure a narrower finite-response drain limit, but it cannot extend the enclosing request deadline. This bounds delivery without adding another SDK-wide timeout default.

**Streaming has a different endpoint.** The request budget bounds admission, authentication and setup through establishment of a streaming response; it is not a blanket ten-second lifetime for a legitimate long-lived stream. Each subsequent finite operation still has its operation bound. The adapter exposes and documents a configurable finite idle/backpressure policy for ongoing streaming and closes stalled streams through transport-supported cleanup. Its policy must be supplied or selected by the adapter before streaming is enabled; absence of a safe finite policy is a configuration failure, not an unlimited fallback. Idle resets require actual transport activity, not an application retry or a progress callback that delivered nothing. The CORE3 qualification covers SSE/progress and delayed completion. The stateless reference listener supplies its finite stream policy and has no cross-POST cancellation registry; this does not qualify every production proxy or transport.

### Safe terminal outcomes

The owner retains a structured internal cause distinguishing operation timeout, whole-request timeout, caller cancellation/disconnect, authorization refusal and dependency failure, with the failing stage and known/unknown effect where available. Public errors use the applicable HTTP, JSON-RPC or MCP tool envelope; no raw exception, token, private metadata or internal cause string is copied into caller-visible text. An adapter may configure safe mappings without changing those semantic distinctions.

| Expiry before response commitment | Safe reference mapping |
| --- | --- |
| Verifier/admission dependency wait | 500 `server_error`; never 401 merely because the wait expired |
| Body ingestion | 408 `request_timeout`, then close the incomplete request |
| Tool handler, authorization or storage | The tool's existing fixed unavailable `isError` result, or the applicable safe protocol error if no valid tool invocation exists; never claim denied access |
| Protected resource lookup/storage | Existing 503 `unavailable` with its safe headers |

Real invalid credentials and authorization refusals preserve their existing challenges/statuses. A malformed or unclassified request does not receive an invented tool result. Disconnect produces no response. Expiry on a usable uncommitted channel selects at most one safe answer and attempts immediate completion without renewing the exhausted deadline; if delivery cannot complete, close the transport. After commitment, close/end according to the protocol and write no replacement status. Never imply that a timed-out or canceled write was rolled back: preserve a known returned result, otherwise report an unknown effect without automatic retry or a retry invitation. Reference-application UI wording, narrower limits and protocol-safe adapter mappings are implementation choices delegated within these constraints, not new human approval gates.

**No stage begins after the terminal outcome.** Once the gate has decided, a late result is dropped without effect. This applies to every stage the application owns: a late verifier result reaches neither `req.auth` nor a server build; no body is classified; no capability is issued; no storage read starts; and no second response is written. The application checks the gate before each later stage. It does not rely on the callback stopping.

**Racing is the guarantee. Passing a signal asks for cooperation.** The listener stops waiting for each step. A callback that is given the signal is asked to stop its own work, but one that ignores it still cannot hold the request open. The verifier takes only the token string, so the listener can stop waiting for it and cannot stop its work. The application passes the signal to authorization lookup, storage read and acquisition work.

**Each request has its own clock, and no clock is inherited.** The protected server action and each resource acquisition are separate requests with separate lifetimes. Each acquisition starts a new deadline that does not inherit what remains of the action's. The capability keeps its own expiry. The media service checks that expiry and the proof's age only when an acquisition begins, so it is the request deadline that ends a wait on the lookup or the storage read, not the capability. The protected acquisition deadline is therefore separate from the capability and proof lifetime, and neither stands in for the other.

**Cancellation is cooperative and local.** The implementation adds no cross-request cancellation registry, session state or shared table. The listener builds a fresh server and transport for each POST, so a `notifications/cancelled` posted as a separate request is not guaranteed to reach the handler it names. MCP cancellation is optional, and the deadline is the server's own maximum, not a client cancellation. Cancellation never undoes remote effects. It stops waiting and prevents later stages.

![A server request has one admission deadline through finite delivery; each acquisition starts a separate lifetime.](../../diagrams/request-view-lifetimes-server-request.svg)

[Editable Mermaid](../../diagrams/request-view-lifetimes-server-request.mmd) · [Editable Excalidraw](../../diagrams/request-view-lifetimes-server-request.excalidraw) · [PNG](../../diagrams/request-view-lifetimes-server-request.png)

The figure distinguishes selecting a response from finishing its transport. A capability issued by an earlier request remains subject to the media service's clock; a new acquisition does not inherit the earlier POST's remaining budget.

**A server request, step by step.** The example is a protected server action whose authorization lookup stalls, followed by the acquisition it would have led to. The client side of this flow is the invocation described above and is only referred to here.

1. The listener accepts a POST to the protected endpoint. The request lifetime begins before authentication, and the verifier answers within the deadline. The authorization is frozen and the body is read and classified.
2. The handler waits on the authorization lookup. The caller retires its invocation, and in this example nothing forwards a cancellation to the server (whether a host forwards one is unknown). The request is still waiting.
3. The deadline expires. Nothing is committed and the connection is open, so the gate records the expiry. The handler stops waiting and returns the tool's fixed unavailable failure, and the SDK transport writes it. No capability is issued. The expired budget is not renewed to deliver this error; if immediate delivery cannot finish, the transport is closed. Owned timer/listeners are removed at terminal cleanup.
4. The lookup answers later, permitted or denied. The answer is ignored and starts no further stage, so no capability is issued and no grant changes.
5. Separately, if a capability had already been issued by an earlier request, it is not retracted. It expires on its own clock. An acquisition made with it is a new request with a new deadline, new checks and a fresh proof.

If the caller closes the connection at step 2 instead, the gate records a disconnect, the handler stops waiting, nothing is written and the same cleanup runs.

## Playback through one action invocation

The maintained [playback controller](../../apps/lit-host/src/playback/playback-view.ts) implements the design's mapping A: one `Action.server` invocation covers recipient-key creation through media acquisition and player start. This is no longer an unresolved mapping choice. The earlier split alternative would have ended the action at the grant and left a controller responsible for subsequent acquisition, busy state, cancellation and a separate maximum. Keeping the complete sequence in one work interval avoids those competing owners.

The user selects `ep-1` and presses Play. The synchronous activation prefix checks the selected item, ends the previous player's lease and prepares audio inside the user's event. It gives the new lease to the invocation scope. Prerequisites check whether the host can proxy server tools and create a recipient key. The handler sends episode-only business arguments with the public key in request `_meta`, validates the returned grant, signs a fresh proof, fetches and reads the protected bytes, and starts the player for that lease. No await separates confirmed startup from the synchronous transfer to the application owner.

| Stage | Owner and bound |
| --- | --- |
| Selection and gesture-sensitive preparation | Synchronous activation prefix; timers cannot preempt it |
| Host-capability check and key creation | Prerequisites under the shared work deadline |
| Host call, grant validation, proof signing, media request/body, decode and start | Handler under the same remaining work deadline; the transport call may impose a narrower limit |
| Presenting playing, ended or gesture-needed | Required success hook under its own `hookMs` |
| Outcome hook, each token release, final hook | Separate `hookMs` for each step |
| Continuing playback after transfer | Application player owner and resource clocks; the completed invocation no longer owns the lease |

The action defaults are 30,000 ms work and 5,000 ms per bounded hook/cleanup step, with independent per-action, instance and SDK-default resolution. They do not promise a 35-second whole-invocation maximum. Progress cannot extend the work deadline, and a longer action limit cannot extend the host, server, capability or player-step limit.

The [player owner](../../apps/lit-host/src/playback/player-owner.ts) makes release acquisition-specific. `end(oldLease)` becomes a no-op once a newer lease owns the player. `teardown()` is a separate application operation that ends whichever lease the owner holds. A late start for an old lease cannot stop a newer player's audio. The owner also remembers audio that ends before startup is confirmed, so the success presentation says ended rather than briefly claiming playback continues.

If the browser blocks startup, no lease transfers and the view presents gesture-needed. If the request outcome is unknown, the view presents an unconfirmed outcome without an in-card retry invitation. A valid grant followed by a media failure establishes a different fact: authorization succeeded and client media work failed, so the application can offer its permitted fresh recovery. A retry never reuses saved authorization. The [authorized playback design](authorized_playback.blueprint.md) explains the capability and proof checks.

Pause and Resume are local actions on the current lease. Their activation phase starts the gesture-sensitive player call synchronously; the handler awaits that already-started work. They cannot grant or extend entitlement. Selection replacement, label loss and view teardown end the retained player through the owner's own teardown, in addition to retiring undecided actions.

## Read recovery and sign-in labels

The application's opaque `viewSession` label answers whether a result belongs to the sign-in the view pinned. It is not a credential. Every server request still derives identity from verified request context rather than from the label or tool arguments.

The subscription view accepts the host's initial opening result as bootstrap. After losing its label it ignores unsolicited positive results, and only a correlated read started after that loss can recover it. Its generation and read timer remain controller-owned. Teardown retires reads and drops private state; a late answer or timer cannot present, and retained retry/select controls do nothing.

The playback view receives uncorrelated opener notifications and has no equivalent read that safely restores the opened item. The human-selected rule is final label loss for that view instance. A different label from either an opener or a grant clears selection, disposes bindings, stops the player and leaves session-changed visible. Every later opener is ignored, even one carrying the old label. A new view can pin a fresh label; a host that reuses the retired view cannot reactivate it. Saved-chat reload can replay an old opener, so reload alone is not evidence of fresh authentication.

A same-label delayed opener remains a limit. Without a request ID the view cannot tell that it is an older copy, and the last delivered opener can replace the selection. The subject reader cannot repair that, because the opener sets the subject. A subsequent Play still names the visible item, the server authorizes it independently, and a mismatched grant is refused. This limitation is not an authorization bypass and does not establish an invisible host account-switch event.

## Teardown and renderer ownership

`runToolResultView` is the current view lifecycle owner. It installs handlers before connection, holds early input/results until readiness, and retires delivery on disposal, host teardown, `pagehide` or startup failure. It calls application teardown once, removes listeners and closes the connection despite a throwing callback. For host teardown it answers first, then closes. The earlier bridge's separate disposed/closed protocol is preserved in history, not a recipe for current consumers.

Application teardown disposes its action bindings, retires the controller, ends retained player leases and retires content consent. Disposing an `ActionBinding` alone ends that binding and an undecided invocation; it does not release a lease deliberately transferred after a completed action. Stopping discovery likewise does not dispose bindings already created. Each owner cleans up what it created, and repeated cleanup cannot retire a newly mounted successor.

Lit and React supply different instance lifecycles to the shared runtime. Lit action-aware catalog elements expose current data scope and retire on element/surface ending. React attaches only to a committed host/node pair in a layout effect; a discarded render installs nothing. Replacing that pair retires the previous instance. The [action module](../modules/action_binding.blueprint.md#renderer-integration) owns the adapter detail. There is no production Lynx adapter or claimed native-removal timing.

## Responsibilities and interfaces

| Owner | Owns |
| --- | --- |
| Application definition | Parameter extraction, prerequisites, domain work, result interpretation, safe recovery and any action overrides |
| Renderer adapter | Exact mounted instance, liveness, event delivery and binding retirement |
| Shared action runtime | Busy policy, ordering, one outcome, callback eligibility, work/hook budgets and untransferred token release |
| Application resource owner | Player lease, current selection, label policy and teardown of retained resources |
| Read controller | Correlated reads, generation, read timeout and recovery after label loss |
| View lifetime runner | Readiness, delivery retirement, one application teardown and connection cleanup |
| Application listener | Request admission, authentication, response mapping and transport-finish observation |
| MCP request lifetime and operation layer | Remaining request/operation budgets, safe callback execution, progress retirement and typed causes |
| Application backend and media service | Current entitlement, capability/proof checks, storage and cooperative cleanup of their own work |

These responsibilities explain the tradeoff in independent clocks. A slow verifier consumes time the handler could otherwise use; it cannot renew the request by advancing a stage. A slow client prerequisite consumes time later handler work could use; a successful transfer ends that action's responsibility for the resource. No single timer can stand in for all three owners.

## Failure and recovery

A failed wait proves that waiting ended. It does not prove that a remote effect was reversed. A callback that ignores its signal can continue, and synchronous JavaScript can delay every timer until the event loop runs again. The terminal gates suppress late results and later owned stages; application effects already begun need their own cleanup or reconciliation.

| Trigger | Observable result and cleanup |
| --- | --- |
| Body stalls | 408 `request_timeout` before commitment, then connection closure; no handler starts |
| Credential verifier stalls or fails as a dependency | 500 `server_error`, not a false 401; late identity is dropped |
| Operation/request deadline or disconnect | Waiting ends and later stages are refused; a committed response is closed rather than replaced with another status |
| Finite response cannot drain before deadline | Transport is closed/destroyed; calling `end` alone was not successful completion |
| An already-aborted MCP callback arrives | The lifetime prevents identity/handler entry; no handler effect begins |
| Label loss or view teardown | Local bindings and delivery retire, private state and retained media clear; late callbacks cannot restore them through the owned paths |
| Required success work fails after a known handler result | The result remains known; the application reports client-step failure without replaying the operation |
| Host request rejects or returns an unclassified failure | The effect remains unknown; the view offers no blind repeat-write recovery |
| A late acquisition returns to an ended invocation scope | The scope releases the token; old cleanup cannot stop a newer lease |

The server preserves three residual effects. An already-issued capability is not retracted when its response is lost; it expires on its own clock. A proof identifier already recorded remains spent. A late denied entitlement answer after retirement does not delete the grant, although a subsequent acquisition still checks current entitlement and refuses new bytes. Neither request retirement nor stopping the player retracts bytes already delivered.

## Verification outcomes

The [server lifetime tests](../../packages/mcp/src/server/lifetime.test.ts), [deadline tests](../../packages/mcp/src/server/lifetime-deadline.test.ts), [request-lifecycle tests](../../packages/mcp/src/server/request-lifecycle.test.ts), [playback budget tests](../../apps/lit-host/src/playback/playback-budgets.test.ts) and [player-owner tests](../../apps/lit-host/src/playback/player-owner.test.ts) own the corresponding behavior. The reviews in Status distinguish checks independently run from broader worker reports and reused evidence.

| Boundary | Meaningful verification |
| --- | --- |
| Budget configuration | Defaults and independent overrides; invalid values rejected before work; two instances do not share mutation |
| Nested request stages | Delayed authentication consumes the original budget; handler/storage work cannot renew its parent; progress cannot extend it |
| Response ownership | Real listener/socket observations of finish, timeout and disconnect; no second status or late response write |
| Callback retirement | Ignored signals cannot keep waiting alive; late results start no later capability or storage effect |
| Read and action view ending | Teardown during pending work prevents presentation/new work and closes once; another live view remains independent |
| Player leases | A retired start, token release or Pause/Resume cannot alter a newer acquisition; early media end remains ended |
| Action outcomes | Known handler success survives hook failure; uncertain server effects stay uncertain; no automatic retry |
| Renderer integration | Committed setup, discarded React renders, instance replacement, stale handles and cleanup preserve the same contract |
| Host observations | Each named host's actual rendering, error mapping, private grant and fresh recovery are recorded separately from local tests |

The connector qualification covers local JSON/SSE progress and delayed completion. Separately posted cancellation cannot reach a different stateless request, and GET/DELETE resume is refused. Those transport limits remain explicit. Broader host cancellation, production proxy behavior, audible media and unobservable account changes require their own evidence; local fixtures cannot supply it.

## Implementation sequence

STATE1 delivered teardown cleanup and final label-loss retirement. STATE2 added the server/request budgets and bounded the pre-migration playback controller, then repaired generic resolved errors that incorrectly invited retry. CORE2 replaced that controller's action timer/generation machinery with one bound Play invocation and player leases. CORE3 qualified the full callback and transport matrix. React later attached its committed control to the same controller and server. View composition subsequently centralized readiness and teardown in `runToolResultView`.

The [preserved design history](https://github.com/MachineWisdomAI/saga-a2ui/blob/cdad54747dfbba756464676ac3b1b8c90148a566/blueprints/features/request_view_lifetimes.blueprint.md) keeps the original source-inspection candidates, alternatives and exact receipts. Those candidates were not all reproduced defects, and they are not a current repair queue. Current source now supplies the interfaces that history called unresolved: request-lifetime context, per-call metadata, player leases and gesture-bound Resume.

## Open decisions

Application-specific wording, idempotency, tighter limits and whether to retain a successfully started resource after a presentation failure remain application choices. They do not require another generic runtime. New correlation for same-label openers, resumable sessions or a broader host cancellation promise would need a separately reviewed design and evidence.

No current design promises immediate clearing after an invisible account change. The rejected retention and focus/resume machinery remains rejected. The current contract covers observed label changes, selection replacement, view retirement and independent finite waits.
