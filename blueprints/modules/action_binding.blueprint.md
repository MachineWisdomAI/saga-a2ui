---
name: action_binding
type: module
description: Binds a user-initiated action in a view to its handler with one attempt lifetime, ordered middleware for concerns that may change the outcome, and an observer stream for concerns that may not.
status: draft
---

# Action binding

Draft awaiting human design review.

## Purpose and boundaries

A view offers the user a small number of actions: read a list, ask the server to authorize something, pause a resource the view holds, open a link through the host. Each action today is hand-written inside its controller together with the concerns that surround it: a generation number that retires late answers, an abort controller, a deadline, the host-capability check, and the rule that a repeated press while pending does nothing. The example application's playback controller ([`apps/lit-host/src/playback/playback-view.ts`](../../apps/lit-host/src/playback/playback-view.ts)) and subscriptions controller ([`apps/lit-host/src/mcp/subscriptions-view.ts`](../../apps/lit-host/src/mcp/subscriptions-view.ts)), inspected at main [`6d3916d`](https://github.com/MachineWisdomAI/saga-a2ui/tree/6d3916da15a6207a5a546f06a86f772fd31b9ce3), each reimplement that discipline, and neither has a place for logging, metrics, tracing or analytics that does not sit inside the business logic.

This module owns the binding between an action and its handler: the attempt lifetime, cancellation, the activation prefix, the ordered middleware around the handler, and the lifecycle events that observers consume. It does not own what the handler does. Authorization stays with the application server, rendering with the renderer adapter, transport with the MCP view export, and telemetry sinks with the application. The contract is renderer-independent and belongs in `@saga-a2ui/core`; the renderer adapters bind controls to it, and `@saga-a2ui/mcp` supplies the server-action handler. No package exists yet, and this document creates none; it describes the boundary that STATE1 and STATE2 ([#12](https://github.com/MachineWisdomAI/saga-a2ui/issues/12), [#13](https://github.com/MachineWisdomAI/saga-a2ui/issues/13)) would otherwise harden twice, once per controller, and that CORE2 ([#15](https://github.com/MachineWisdomAI/saga-a2ui/issues/15)) and VIEW1 ([#17](https://github.com/MachineWisdomAI/saga-a2ui/issues/17)) would otherwise invent separately.

### Terms

The feature Blueprints' [action vocabulary](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c223/blueprints/README.md#action-vocabulary) applies. A **server action** is sent to the application server through the host and awaited; in A2UI it is the `event` form of a component's `action`, and in MCP Apps it is a server tool call. A **local action** is handled by code in the view; in A2UI it is the `functionCall` form, and it may call host APIs such as opening a link. An **attempt** is one dispatch of an action, from the user's activation to a terminal outcome, including any **client continuation** the result starts. A **middleware** is a function around the handler that may refuse, bound or decorate the attempt. An **observer** receives the attempt's lifecycle events and cannot change its outcome. The **activation prefix** is the synchronous part of an action that must run inside the user's transient activation before the first `await`.

## Interfaces and behavior

The module is organized around one question for every concern: may it change the attempt's outcome? Concerns that may (authorization gating, deadlines, host-capability requirements, idempotency, retry policy) are middleware, which is ordered and composes. Concerns that must not (logging, metrics, tracing, analytics, audit) are observers of a lifecycle event stream, which the runtime produces and the application consumes. Three fixed before, success and failure hooks were considered and rejected because they bind ordering to state passing: the before hook has to return a context that the after hooks receive, which is how TanStack Query's `onMutate` result reaches its `onError`. Two mechanisms with one rule each are simpler, and the rule gives an invariant worth testing: a failing logger cannot fail the action.

### Action definition

An action is a typed value the application constructs and passes explicitly; there is no registry or string-keyed table, per the [coding standards](../../CODING_STANDARDS.md). It declares:

- **Kind**: `server` or `local`. A server action requires the host capability for server tools, is authorized by the server on every dispatch, and has a correlated response. A local action needs no authorization and has none; it is the handler's business whether it touches the host.
- **Name**: a stable identifier used in lifecycle events and, for local actions reached from A2UI, matched to the `functionCall` name at the renderer's catalog seam. That finite, checked mapping is protocol decoding, not a SAGA-wide registry.
- **Input contract**: a runtime schema validated once, when the attempt is created. Middleware and handlers receive the validated value and never re-parse it.
- **Result shape**: none, one or many. None is a notification with no awaited result. One is a `Promise`. Many is an `AsyncIterable` that keeps the attempt pending until it completes or is retired. Progress is not a result shape: for a server action it arrives as MCP progress notifications on the side, and it is surfaced to observers as `progressed` events, never merged into the result.
- **Activation prefix**: an optional synchronous function the adapter must call inside the user's activation before any `await`. It may throw to refuse the attempt, which settles as `unsupported`. The example's `player.prepare()` is this prefix for Play; today it is a player detail rather than a declared part of the action.
- **Concurrency rule** while an attempt of this action is pending: `ignore` the new dispatch (the example's repeated Play press) or `retire` the pending one and start the new (a changed filter in the read view).
- **Telemetry projection**: an optional function from validated input, and from the outcome, to the fields an observer may see. By default observers see no input and no result, only names, timing, outcome class and identifiers. Capabilities, credentials, private backend fields and user content never enter an event, consistent with the ordinary-log rule the playback tests already enforce.

### Dispatch and the attempt

`dispatch(action, input)` runs synchronously up to the end of the activation prefix and returns the attempt. The attempt carries an id (the generation the controllers keep today), an `AbortSignal`, a deadline from application policy, and a status that moves from `pending` to exactly one of `ok`, `failed` or `cancelled`. Every pending attempt can be retired by its owner for an external reason (a new selection, loss of the sign-in label, host teardown, disposal), which aborts the signal and settles the attempt as `cancelled`. A settled attempt ignores every later completion from its handler or continuation; that is the rule the controllers express with `current()` checks. The deadline is the whole-attempt maximum the [request and view lifetimes](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c223/blueprints/features/request_view_lifetimes.blueprint.md) design proposes, independent of the server's own deadline and of the MCP SDK's progress-reset request timeout.

### Handler

A handler is `(input, context) => void | Promise<R> | AsyncIterable<R>`, where the context carries the attempt id, the signal and the deadline. For a server action the handler is supplied by `@saga-a2ui/mcp`'s view export: it calls the server tool with the attempt's signal and timeout options, validates the view projection of the result, and classifies the response. For a local action the application supplies it. A handler that ignores the signal cannot hold the attempt open; the attempt settles on retirement or deadline and the handler's late result is dropped. A client continuation is part of the same attempt and runs under the same signal; the resource request the continuation makes carries that signal, as the example's acquisition already does.

### Middleware

Middleware is an ordered list of `(context, next) => Promise<Outcome>`. A middleware may refuse before calling `next` (settling the attempt with a typed failure such as `unsupported` when a required host capability is absent), may add a deadline or an idempotency key to the context, and may map the outcome. It may not change the validated input, so that the input seen by the handler is the input the schema accepted. The host-capability check that the playback controller performs inline is the first middleware. Deadline enforcement is the second, racing `next` against the attempt's deadline the way the server's `readWithinBound` races a read against its bound. Middleware is composed once per action at construction, not discovered.

### Observers and lifecycle events

The runtime emits `started`, `progressed`, `settled` and `retired` events for every attempt, each carrying the action name, attempt id, timestamps and, for `settled`, the outcome class and failure class. Observers subscribe at construction. The runtime delivers events after the telemetry projection has run, so the redaction boundary is at emission, not at the sink. An observer that throws is caught and counted; it cannot delay dispatch, change the outcome or stop other observers. Events are delivered in order per attempt and never after `settled` or `retired`. An OpenTelemetry span maps onto this directly: `started` opens it, `settled` closes it with status, `progressed` adds events, and the attempt id is the correlation key.

### Outcome and failure classes

An outcome is `ok` with the result, `failed` with a failure class, or `cancelled` with a reason. Failure classes are the finite set callers present: `invalid-input`, `unsupported` (missing host capability, prefix refused), `refused` (a middleware declined), `denied` (the server authorized nothing), `unavailable` (the server's fixed unavailable failure or a transport fault), `timeout` (the attempt deadline) and `media-failed` for a continuation whose client-held resource failed. The example's view states are presentations of these classes plus the view's own selection and label state; the mapping is the renderer's, not this module's.

### Renderer adapters

The adapter owns the moment of activation. In Lit, a control's event handler calls `dispatch` synchronously; in React, the handler or a form action does; in Lynx, the activation prefix is main-thread script and the rest of the dispatch crosses to the background thread. The adapter exposes the attempt's status to the template and nothing else. Lit's `@lit/task` has the same shape as an attempt (pending, complete and error status, a signal passed to the task, and a rerun that aborts the previous run), and an adapter may build on it; this contract does not require it.

### Prior art

| Mechanism | What it establishes | What this module takes from it |
| --- | --- | --- |
| [A2UI actions](https://a2ui.org/specification/v0.9-a2ui/) | `event` to the agent, `functionCall` in the renderer, functions referenced by name so no code travels | The server/local split and the catalog-seam name mapping |
| [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress) and experimental tasks | Progress as side notifications with a token; call-now, fetch-later as a separate primitive | Progress stays beside the result; many-result and tasks are out of scope until a consumer needs them |
| [TanStack Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) | `onMutate`, `onSuccess`, `onError`, `onSettled`; `onMutate`'s return threads to the others | The hooks' state-passing problem; retry as policy, not business logic |
| [Lit Task](https://lit.dev/docs/data/task/) | Status, abort signal per run, rerun aborts the previous run | The attempt shape |
| React 19 Server Functions and `useActionState` | Pending state around an async server call | Pending as a first-class status |
| [Lynx main-thread script](https://lynxjs.org/react/main-thread-script) | Synchronous main-thread handlers beside background-thread work | The activation prefix as a declared boundary |
| Koa and tRPC middleware | `(ctx, next)` composition that may short-circuit | The middleware shape and its one rule |
| [OpenTelemetry browser instrumentation](https://opentelemetry.io/docs/languages/js/getting-started/browser/) | Fetch and user-interaction spans from outside application code | Observers consume events; they do not wrap handlers |

None of these supplies the whole contract, and the coding standards rule out adopting a framework for it. The module reuses platform `AbortSignal`, promises and async iterables, and a runtime schema library already pinned.

## Representative flow

The user presses the example's Play control while the read view shows a selected item. The Lit control's click handler calls `dispatch(play, { itemId })` inside the activation. The runtime validates the input, calls the activation prefix (the player unlocks audio), creates attempt 7 with its signal and the application's deadline, emits `started`, and runs the middleware: the host-capability middleware finds server tools available and calls `next`; the deadline middleware races `next` against the bound. The server-action handler calls the server tool with the signal, the server authorizes and issues a capability, the handler validates the view projection and returns it. The continuation acquires the resource with the same signal and starts the player. The attempt settles `ok`; `settled` is emitted with the outcome class, the elapsed time and the projected fields, and the tracing observer closes its span. The user then selects another item. The controller retires attempt 7: the signal aborts, `retired` is emitted, and when the player's late `start` resolves it finds a settled attempt and is ignored. Pause is a local action: its dispatch runs the prefix, has no middleware beyond a precondition on the current state, calls the player, and settles when the player confirms.

![Flowchart of one attempt. Dispatch validates input and runs the activation prefix synchronously, then runs the ordered middleware around the handler and its continuation under one signal and deadline; the attempt settles once as ok, failed or cancelled, or is retired by its owner. Lifecycle events flow to observers through a telemetry projection and cannot feed back into the attempt.](../../diagrams/action-binding.svg)

Editable source: [Mermaid](../../diagrams/action-binding.mmd). Rendered copies: [SVG](../../diagrams/action-binding.svg) and [PNG](../../diagrams/action-binding.png).

## Failure and recovery

| Trigger | Result through the interface | Cleanup and residual limit |
| --- | --- | --- |
| Input fails its schema | The attempt is not created; `dispatch` returns a `failed` outcome with `invalid-input` and emits no `started` | Nothing to clean up; the control shows the failure |
| The activation prefix throws | `failed` with `unsupported`; no middleware or handler runs | Nothing protected was requested |
| A middleware refuses | `failed` with its class; the handler never runs | The deadline timer is cleared |
| The handler rejects, or the server answers with a fixed failure | `failed` with the class the handler assigns; a transport fault is `unavailable` | The signal is aborted so a continuation that already started stops |
| The deadline passes while pending | `failed` with `timeout`; the signal aborts; a later handler result is dropped | The server may still be working; see the lifetimes design |
| The owner retires a pending attempt | `cancelled`; the signal aborts; `retired` is emitted once | A continuation's completed effects are not undone |
| An observer throws or is slow | Counted and reported through the runtime's own diagnostics; the attempt is unaffected | A broken sink loses its own events only |
| A dispatch arrives while an attempt is pending | Per the action's concurrency rule: ignored, or the pending attempt is retired first | Both paths are observable through events |
| A completion arrives after settlement | Ignored | None; idempotent cleanup by a later disposal is permitted |

Cancellation is cooperative: a handler that ignores the signal keeps running, and effects already made or bytes already received are not recalled. The module bounds the waiting and guarantees one terminal outcome; it does not promise that remote or platform work stopped.

## Verification outcomes

These are planned checks through the module's interface with fake handlers, observers and timers; none has run.

| Condition | Expected result |
| --- | --- |
| Valid input; the handler resolves | One `started`, one `settled` with `ok`; the result is the handler's value; the prefix ran before the handler and synchronously with `dispatch` |
| Invalid input | `failed` with `invalid-input`; no `started`; no prefix, middleware or handler call |
| A middleware refuses | The handler is not called; `settled` carries the middleware's class |
| The handler resolves after retirement, or after the deadline | The outcome stays `cancelled` or `timeout`; no second `settled`; the late value is not exposed |
| A `many` handler yields three values then the owner retires | The three values reach the consumer in order; the iterable is closed; one `retired` |
| An observer throws on `started` | The attempt proceeds and settles normally; other observers receive every event; the failure is counted |
| The telemetry projection is absent | Events carry names, ids, timing and classes only; a canary value in the input and in the result appears in no event |
| Dispatch while pending under `ignore` and under `retire` | `ignore`: no new attempt and no event; `retire`: the first attempt is `cancelled` before the second `started` |
| Two actions dispatched on two bindings | Events and outcomes do not cross; retiring one leaves the other pending |
| A Lit control dispatches from a click | The prefix runs within the same task as the event; a browser check confirms that an audio context created in the prefix is unlocked |

Browser and host checks remain separate: that the prefix runs inside transient activation in a built page, that a Lynx adapter's main-thread prefix and background dispatch agree, and whether an MCP `_meta` correlation value survives the host's proxy. The example's controllers, rewritten on this contract, must keep every existing playback and subscriptions regression test green.

## Open decisions

1. **Correlation across the host.** The view cannot set HTTP headers on a proxied server tool call, so the attempt id would travel in `_meta`, the same channel the recipient key already uses. Whether the named hosts preserve it is unmeasured, and the connector design records that the `_meta` mapping is not yet a portable contract. Until that run exists, server spans correlate only by time and tool name.
2. **Telemetry egress from the view.** The view runs in a sandboxed iframe under the content policy's restricted CSP. Events can leave through the host's logging capability or through a declared origin; the second widens the resource policy, which the content-safety design keeps minimal. The application chooses; the module only guarantees redaction before emission.
3. **Package placement of the server-action handler.** Keeping the attempt in core and the handler in `@saga-a2ui/mcp` matches the dependency direction. Whether the deadline middleware belongs to core or to the application's policy is a design choice for CORE2.
4. **Many-result delivery.** `AsyncIterable` is the platform choice; an Observable-style push interface was not chosen because no consumer needs it. Revisit if a renderer adapter or an A2A integration needs push semantics.
5. **Middleware input immutability.** The draft forbids middleware from changing validated input. A consumer that needs input rewriting (for example, injecting a tenant) should do it in the handler's dependencies instead. Confirm this holds for the Ansari migration's public operation.

## Related contracts and implementations

- Feature Blueprints: [request and view lifetimes](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c223/blueprints/features/request_view_lifetimes.blueprint.md) (the attempt bound and retirement this module centralizes), [reusable MCP connector](../features/reusable_mcp_connector.blueprint.md) (the server-action handler and projection validation), [reusable Lit adapter](../features/reusable_lit_adapter.blueprint.md) (control binding and the catalog seam), [authorized playback](../features/authorized_playback.blueprint.md) (the example's protected server action) and [content safety levels](../features/content_safety_levels.blueprint.md) (CSP constraints on telemetry egress).
- Implementation today: [`playback-view.ts`](../../apps/lit-host/src/playback/playback-view.ts), [`subscriptions-view.ts`](../../apps/lit-host/src/mcp/subscriptions-view.ts), [`play-control.ts`](../../apps/lit-host/src/lit/play-control.ts) and [`subscriptions-server.ts`](../../apps/lit-host/src/mcp/subscriptions-server.ts) (`readWithinBound`), at `6d3916d`. No codebase Blueprint exists for `apps/lit-host` yet.
- Issues: STATE1 [#12](https://github.com/MachineWisdomAI/saga-a2ui/issues/12), STATE2 [#13](https://github.com/MachineWisdomAI/saga-a2ui/issues/13), CORE2 [#15](https://github.com/MachineWisdomAI/saga-a2ui/issues/15), CORE3 [#16](https://github.com/MachineWisdomAI/saga-a2ui/issues/16), VIEW1 [#17](https://github.com/MachineWisdomAI/saga-a2ui/issues/17).
- [Coding standards](../../CODING_STANDARDS.md) and [package layout](../../packages/README.md).
