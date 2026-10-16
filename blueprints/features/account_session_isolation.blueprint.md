---
feature_name: account_session_isolation
status: rejected
module_blueprints: []
dependencies:
  - authorized_playback
date_added: 2026-10-15
---

# Account and session isolation

Rejected on 2026-10-16. This proposal is not approved for implementation. No demonstrated real-host workflow or current consumer requires its proposed generic machinery for switching accounts within a live view. Whether a host retains the iframe across an account change remains unverified; the review did not establish content injection or an authorization bypass.

Existing authentication, authorization and request isolation remain required, as do ordinary selection, cancellation and cleanup obligations. No replacement design is approved.

## Rejected proposal retained for reference

The remaining text and diagram preserve the rejected design; their proposed requirements are not a current implementation contract.

## Problem and current behavior

A listener can change accounts or episodes while a subscription read, Play request or media acquisition is still pending. Play is the app-only operation for starting playback of a selected episode; the [authorized playback design](authorized_playback.blueprint.md) defines it. The old response must never bring back the previous account's rows or audio. When the view cannot establish a current sign-in, it must clear private state before presenting a recovery action.

The application already has two useful pieces. [`connectSubscriptionsView`](../../apps/lit-host/src/mcp/subscriptions-view.ts) pins an opaque sign-in label, correlates app-initiated reads and rejects late results after invalidation. [`connectPlaybackView`](../../apps/lit-host/src/playback/playback-view.ts) retires playback generations, aborts media acquisition and stops its player on replacement, failure and teardown.

What is missing is whole-request coverage. The subscription and playback entry points currently build separate resources; they do not yet establish a complete account-to-selection-to-player lifetime. The subscription read has a deadline, but that does not establish a single deadline across identity verification, authorization, handler and projection work.

Two lifetimes are involved, and an account change ends them at different moments. The view's lifetime on the client decides whether a result is still current, so it ends as soon as the view observes the change. The request's lifetime at the application's HTTP/MCP execution boundary bounds the work and suppresses late output, and server-side work may still be running when the view has moved on.

This design completes that lifetime in the application before reusable package extraction. It preserves the existing authentication and media checks. It does not add an account system or make a session label into a credential.

## Proposed behavior

Alice opens her subscriptions and selects an episode. A result accepted for the current view establishes an opaque **session label**. The server derives the label from the verified sign-in; the label contains no credential and only lets the view recognize a change. The server continues to authenticate and authorize each request independently.

Every asynchronous read or playback attempt also belongs to the current **generation**, a value that changes whenever the session, selection or active request is retired. Retiring a generation is a local, client-side step: the view discards the old work's result and releases the timers and listeners it owns. It does not by itself notify the server or stop a running callback. Cancellation reaches server-side work only through the supported path described under the whole-request deadline, and application callbacks clean up their own external effects. A completion may update the view only if its session, selection and request still match. An unsolicited tool notification cannot establish a new sign-in after the view has been invalidated; recovery requires a fresh correlated authenticated read.

If Bob replaces Alice while Alice's Play response is delayed, the first observed session change clears Alice's list and selection, stops and clears the player, and retires pending work before Bob's data can appear. Alice's eventual success is discarded. If the host exposes no account-change event, the view cannot detect that invisible change immediately. It instead expires retained private state after a finite application-configured interval and revalidates before restoring it on focus or resume. New server requests always receive fresh authentication, regardless of what remains visible.

Selecting another subscription or episode follows the same ordering: retire the old selection, clear dependent content and media, then begin work for the new selection. A failed or cancelled request leaves a readable state with an explicit retry. Retry performs fresh checks and never reuses a saved media capability as authorization.

![Account and selection changes retire pending work and clear private content before a fresh authenticated read can restore the view; late results are discarded.](../../diagrams/account-session-isolation.png)

[Mermaid source](../../diagrams/account-session-isolation.mmd) · [Editable Excalidraw](../../diagrams/account-session-isolation.excalidraw) · [SVG](../../diagrams/account-session-isolation.svg)

## Responsibilities and interfaces

| Owner | Responsibility and boundary |
| --- | --- |
| Application authentication and subscription/playback handlers | Supply immutable request identity and current authorization. Issue the opaque session label from the verified sign-in. Input arguments and view generations cannot select an account. |
| Application-local lifetime logic | Own session validity, retained-state expiry and the transition that retires dependent work. Expose typed operations for accepting a correlated result, changing selection, invalidating and disposing. These operations are proposed interface responsibilities, not existing exported API names. |
| Existing MCP view connection | Receive supported host events and correlate app-initiated calls. Translate events into lifetime operations without claiming an account-change signal that the host does not provide. |
| Subscription and playback controllers | Apply the same lifetime decisions to their own results. Keep business-specific state with its controller; the application explicitly supplies the shared lifetime where the integrated flow needs it. Separate views must not share mutable global state. |
| Lit presentation and player | Replace visible private content, announce recovery, stop audio and release media resources. Presentation cannot authorize an action. |
| Application HTTP/MCP execution boundary | Bound the complete asynchronous request, propagate supported cancellation and suppress late or duplicate responses. Application callbacks remain responsible for their own external cleanup. |

A small application-local module should own the common invalidation rules so the two controllers do not implement competing meanings of “current.” Existing typed result schemas and upstream MCP correlation remain authoritative. This is a focused extraction of repeated lifetime decisions, not a second session framework, registry or string-keyed action bus.

The composition must account for the current separate subscription and playback resources. A view can own its local generation; a transition between resources needs authenticated bootstrap and correlated replacement rather than a module-global “current user.” The implementation must make the chosen integration explicit and exercise it through the real bridge. Moving these contracts into SDK packages belongs to later extraction work.

One finite deadline covers the whole request: identity verification, authorization, handler and projection stages. It must not restart for each stage and thereby multiply the permitted wait. On timeout or cancellation, the response owner settles once, releases its timers/listeners and refuses all late completion. Cancellation can request that a callback stop, but cannot forcibly terminate arbitrary application JavaScript or retract an external effect it already performed.

## Failure and recovery

| Trigger | Visible result and cleanup |
| --- | --- |
| Changed or unknown session, authentication failure, or invalid current result | Clear private rows, selection and media immediately upon observation; invalidate earlier reads and playback. Offer supported sign-in or fresh-read recovery. |
| Selection changes while a read, authorization check or media request is pending | Clear the old dependent view and stop audio before starting new work. Discard every late completion from the retired selection. |
| Focus/resume with expired or unvalidated retained state | Keep protected content cleared until a fresh correlated read succeeds. If the host cannot perform that read, show the unsupported/recovery state without restoring cached private content. |
| An earlier request completes after timeout, cancellation, failure or a later request | Emit no stale result, acquire no new media through retired view work and do not write a second HTTP response. Server-side work already in progress remains subject to its own cancellation and authorization rules. |
| Disconnect, host teardown or repeated disposal | Retire the generation, clear state, stop the player and release owned timers, listeners and subscriptions. Repeated disposal must not clear a newly connected view. |
| Request or backend failure | Preserve HTTP authentication/challenge, JSON-RPC error and known-tool `isError` distinctions. Show safe recovery without raw exceptions or rejected success fields. |

Expiry and clearing limit retained application state. They do not erase historical host messages, retract buffered/downloaded audio or prove an immediate reaction to an account switch the host never reports. These limits remain explicit in actual-host evidence.

## Verification outcomes

The following checks extend the existing server, real `App`/`AppBridge`, controller and built-browser tests. Existing assertions remain useful where behavior is unchanged; tests added for this work must expose a missing outcome before the implementation changes.

| Condition | Required observable result and boundary |
| --- | --- |
| Alice and Bob have concurrent views | Each view shows only its own authenticated results; neither view borrows the other's session, selection, callbacks or player. Exercise the real listener and bridge. |
| Alice's delayed result arrives after Bob's correlated recovery | Alice's rows and audio stay absent. Bob's successful result is accepted only by the current generation. Exercise controlled completion order through the bridge and built view. |
| Session loss arrives while a correlated read is pending | Private content clears immediately; the pending read cannot reopen it. A later deliberate read may recover after fresh authentication. |
| A subscription or episode changes during Play, media acquisition or player startup | Old content and audio clear; reverse-order completions cannot replace the current selection or restart audio. Observe player effects and browser requests. |
| Focus/resume, retained-state expiry and disposal occur | Private state is hidden until revalidation; expiry and disposal remove owned timers/listeners. Reconnection has a fresh lifetime. Use controlled time and actual browser lifecycle events. |
| Identity, authorization, handler or projection never settles | The whole request reaches its configured bounded outcome; cancellation notification and cleanup follow the supported protocol path, and late resolution produces no output. |
| JSON or SSE delivery is cancelled, disconnected or resumed | The actual supported transport sends no duplicate operation or response and does not write headers after streaming starts. The current local listener uses JSON responses; an SSE test must exercise a real supported SSE configuration, not relabel the JSON fixture. |
| A keyboard user retries after clearing at 320px width or 200% zoom with long titles | Pending/recovery controls remain reachable, status changes are announced, and focus stays on a useful control or recovery target. |

Required authenticated ChatGPT web and Claude web runs still exercise integrated account/selection changes alongside playback and both content levels. Record exact source/resource identities, the observable host signals, the revalidation path and any unobservable switch. Automated fixture results and a different host do not substitute for these actual-host observations. Deferring the final signoff does not defer these runs or turn unavailable evidence into a pass; the acceptance record stays open until the required observations and the signoff are complete.

## Implementation sequence

1. [STATE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/12) completes session invalidation, retained-state expiry and focus/resume revalidation across the existing browse and playback view boundaries. It builds on the merged browsing behavior and on [PLAY1](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) (fresh entitlement and foreground playback), preserving request-scoped authorization.
2. [STATE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/13) extends that lifetime to selection races and the complete asynchronous deadline/cancellation path, using the media behavior of [PLAY2](https://github.com/MachineWisdomAI/saga-a2ui/issues/11) (protected-media delivery constraints). It covers JSON/SSE response ownership and accessible recovery.
3. Integrate these outcomes with the [content safety levels](content_safety_levels.blueprint.md) work and run the required host checks against the resulting build. Source implementation, actual-host evidence and final signoff remain distinct records.

The content-policy lane can proceed concurrently because it owns content interpretation and permitted effects. Shared composition-file edits must be integrated deliberately; neither lane should replace the other's policy or lifetime owner.

## Open decisions

The implementation must choose and document the finite private-state retention interval and whole-request deadline, with controlled-clock tests showing their effect. Existing request bounds are starting evidence, not a promise that every stage is already covered. The exact supported focus/resume and account-change signals are verification questions for each host; no nonexistent event should be designed into the contract. The Ansari adoption design requires progress and delayed JSON/SSE completion to work within that single finite whole-request deadline. What remains unresolved is the supported callback interface that carries a cancellation request to application callbacks and carries progress and delayed completion inside that bound; the [reusable MCP connector design](reusable_mcp_connector.blueprint.md) assigns that interface to CORE3.

## References

- [Authorized playback design](authorized_playback.blueprint.md)
- [Content safety levels](content_safety_levels.blueprint.md)
- [Subscription view and correlated reads](../../apps/lit-host/src/mcp/subscriptions-view.ts)
- [Playback view and player lifetime](../../apps/lit-host/src/playback/playback-view.ts)
- [Application listener and transport ownership](../../apps/lit-host/src/mcp/listener.ts)
- [Coding standards](../../CODING_STANDARDS.md)
