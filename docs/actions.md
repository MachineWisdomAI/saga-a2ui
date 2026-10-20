# Change a component and trace allowed and denied requests

This guide is for a developer who has the [setup guide](getting-started.md) working and now wants to change what a control does: edit a component, attach or change its action, and follow one press through every step until the server answers and the application cleans up. It was written on 2026-10-20 against the repository's current source. Each quoted block is copied from the file named above it, and `scripts/guide-actions-document.test.ts` checks that copy. `scripts/guide-actions.test.ts` runs every case the guide traces against the notes application installed from packed candidate tarballs.

**There is no release.** The packages are private and unpublished. Everything here runs from a checkout against a *candidate*, a matched set of locally packed tarballs ([install and update](candidate-update-and-rollback.md)). Names such as `Action.server`, `before`, `onSuccess` and `scope.own` are the exports of that candidate, not a promise about a later public API, and the numbers below are the candidate's defaults, not recommended timeouts.

The runnable tutorial is the notes application (`examples/pack1-consumer`) on the Lit renderer and the Node-style MCP delivery the [setup guide](getting-started.md) qualifies. Other renderers and servers are explained only as far as their own evidence goes ([evidence levels](#what-each-renderer-and-server-has-shown)).

## Run it first

From a checkout:

```sh repository
npm ci
npx vitest run scripts/guide-actions.test.ts
npx vitest run scripts/starter.test.ts
```

The first test file installs the notes application from packed candidate tarballs into a clean directory, connects a real MCP client to its server, and presses real controls on the real action runtime. It covers every allowed, denied and refused path below. The second qualifies the starter's HTTP authentication, which the notes application leaves to its own listener. Neither needs a browser. The browser checks for the same application run in `apps/lit-host/e2e/pack1-consumers.spec.ts`; the [development reference](development-reference.md#local-development) lists the build and browser commands.

## Who owns what

Five parties touch one press, and each owns one kind of decision. Keeping them apart is the point of the design: you can change a component's layout, an action, or the server's policy without the others changing.

| Party | Owns | Where it lives |
| --- | --- | --- |
| Application | Handlers, prerequisites, domain authorization, the resources a press takes, what is shown | `examples/pack1-consumer/src/notes-actions.ts`, `server/notes-server.ts`; the starter's `server/authorization.ts` |
| Action runtime | The order of one invocation, how it ends, what is cleaned up and when | `@saga-a2ui/core/actions` |
| Renderer adapter | One instance per rendered component, delivering that instance's own events | `@saga-a2ui/lit/actions` (and `@saga-a2ui/react/actions`, see [below](#what-each-renderer-and-server-has-shown)) |
| MCP delivery | Carrying a server request, verified identity and the request's clock | `@saga-a2ui/mcp/server`, the application's listener |
| A2UI core | The layout and data messages; they name IDs and structure and **no action** | `@saga-a2ui/core/protocols/a2ui/v0_9` |

The path of one Archive press, in order:

```text
layout (core A2UI message)        row-archive is an ActionButton; it names no action
  → renderer adapter              opens one instance per rendered row; delivers its click
  → binding (application setup)   bindAction('activate', archiveNote) attached that definition to this instance
  → action runtime                input → atActivation → before … → run → hooks → cleanup
  → transport (application)       callServerTool(...) with the invocation's signal and the time left
  → MCP delivery (connector)      authenticated request; verified identity handed to the tool
  → server tool (application)     identity, then the application's own authorization, then the backend
  → reply                         a result or an isError reply, back through the same path
```

Application meaning (what Archive *means*, who may do it) is written once, in application files. The runtime never learns what a note is. The A2UI messages never learn what Archive does. The renderer never learns an action name.

## Types check your code; the wire is checked at run time

Three kinds of value cross a boundary in this application, and TypeScript guarantees none of them at run time:

- A **press** carries an event. `event.read('id')` returns `unknown`, because the data scope is whatever the layout's data model holds. The application validates it in `input`:

```ts examples/pack1-consumer/src/notes-actions.ts
function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('this row shows no note');
  return value;
}
```

  A row that shows no note ends the press at its first stage (`input`), before anything is held or sent.

- A **request** carries tool arguments. The server declares a strict schema, so a caller cannot add an account, send a number for an ID, or send an empty one:

```ts examples/pack1-consumer/src/notes-contract.ts
export const ArchiveInputSchema = z.strictObject({ noteId: z.string().min(1).max(32) });
export const ArchiveOutputSchema = z.strictObject({ noteId: z.string().min(1).max(32), archivedAt: z.number().int().nonnegative() });
```

  The traced test sends `{ noteId: 'n-1', accountId: 'acct-bob' }`, `{ noteId: 42 }` and `{ noteId: '' }` to `archive_note`; every one is rejected and the backend is never asked.

- A **reply** carries `structuredContent`. The client's `CallToolResult` type says it may be anything. The handler parses it with `ArchiveOutputSchema` before using it, so a server of another build cannot put a wrong shape into the view.

The generic parameters on `Action.server<ActionButtonActivation, CallToolResult>` tell the compiler what you expect. They check nothing that arrives. Put a runtime check wherever a value comes from outside your code, and treat the type as documentation of that check.

## Change a component, and what changes with it

The layout is a list of component definitions with IDs. In the notes application the Archive control is two of them:

```ts examples/pack1-consumer/src/notes-surface.ts
{ id: 'note-actions', component: 'Row', children: ['row-read', 'row-archive'] },
{ id: 'row-read', component: 'ActionButton', child: 'row-read-label' },
{ id: 'row-read-label', component: 'Line', kind: 'body', text: 'Mark read' },
{ id: 'row-archive', component: 'ActionButton', child: 'row-archive-label' },
{ id: 'row-archive-label', component: 'Line', kind: 'body', text: 'Archive' },
```

The row is a *template*: `{ componentId: 'note-row', path: '/notes' }` repeats it per note, so the renderer creates one Archive button per note, all from the one `row-archive` definition. [The vocabulary is in the setup guide](getting-started.md#component-definition-template-and-instance).

Application code attaches behavior to those instances when the surface is presented:

```ts examples/pack1-consumer/src/notes-view.ts
attach: (view) => {
  view.watchById('row-archive', ActionButton, (handle) => void handle.bindAction('activate', actions.archiveNote, { subject: () => handle.read('id') }));
  view.watchById('row-read', ActionButton, (handle) => void handle.bindAction('activate', actions.markRead));
},
```

Three small changes show where each part of the design lives:

1. **Change the label** (`text: 'Archive'` to `'Archive note'`). Only the layout changes. The binding finds the control by its ID, so it is untouched.
2. **Change what Archive does.** Edit the action in `notes-actions.ts`. The layout and the renderer are untouched. [Add a prerequisite](#prerequisites-session-validity-confirmation-and-an-audit-entry) is the example below.
3. **Rename the ID** in the layout without renaming it in `watchById`. Setup finds no instance, so nothing is bound. The control still renders, a press does nothing, no error is raised and no request is sent. The traced test opens such an instance and gets `unbound` back from `activate`. Discovery runs at setup, once per presented surface, so this fails quietly: after renaming an ID, press the control.

An ID selects handles at setup. It never routes a press: only the instance's own event reaches the callable bound to that instance. No registry or handler-name table exists to look an action up by a string.

### A local action first

A local action has no server and no prerequisite. It is the smallest complete action:

```ts examples/pack1-consumer/src/notes-actions.ts
const markRead = Action.local<ActionButtonActivation>('mark-read')
  .input((event) => ({ noteId: requireNoteId(event.read('id')) }))
  .run(({ params }) => environment.recordRead(params.noteId))
  .build();
```

`input` copies what the handler needs out of the event, once, synchronously, while the event is being delivered. After that the handler uses `params`, never the event: `event.read` throws once the event turn is over, so a continuation cannot read whichever note the row shows later. The definition holds no state, so the same one is bound to every row.

### The same mechanisms in protected playback

Play is the protected, long-running case of the same shape, not a different mechanism. In `apps/lit-host/src/playback/playback-view.ts` it is an `Action.server` with an `input` that selects the item, an `atActivation` that takes the player's lease, two `before` prerequisites (the host can forward server tools; a recipient key is created), a handler that makes one `call`, and the four outcome hooks. Pause and Resume are local actions bound the same way. All three are bound with a `subject` reader on the current selection, so a new selection cancels an undecided Play.

What stays with playback is playback's own: the gesture the browser needs, the player's lease token and where the control is placed. The [authorized playback guide](authorized-playback.md) and the playback source own those decisions; this guide only shows that the mechanisms are the ones above. The notes application is the runnable example because it is small and needs no audio.

## Trace one press, allowed and denied

Here is the whole Archive definition, in the order the runtime runs it. Prerequisites run strictly in the order written; the handler only starts after every one proceeded.

```ts examples/pack1-consumer/src/notes-actions.ts
const archiveNote = Action.server<ActionButtonActivation, CallToolResult>('archive-note', environment.transport)
  .input((event) => ({ noteId: requireNoteId(event.read('id')), at: event.dataPath }))
  // Inside the event turn: the application's hold on this row, owned by the invocation. The
  // scope gives it back when the invocation ends unless the success hook hands it over.
  .atActivation(({ scope, event }) => scope.own(environment.holds.begin(requireNoteId(event.read('id'))), (token) => environment.holds.end(token)))
  .before(requireSession)
  .run(async ({ params, call }) => {
    const reply = await call(ARCHIVE_TOOL, { noteId: params.noteId });
    // A returned tool-level failure is a result, not an exception. Only a refusal the server marked
    // as having no effect is a known outcome; any other failure (a backend exception, an output the
    // server could not validate after writing) may follow an applied archive, so it stays unknown.
    if (declaresNoEffect(reply)) throw new ArchiveDeclined('The server declined to archive the note');
    if (reply.isError === true) throw new Error('The archive request failed');
    return ArchiveOutputSchema.parse(reply.structuredContent);
  })
```

1. **`input`** reads the note's ID and the row's data path from the *pressed instance*. This is instance-qualified input: two rows share the component ID `row-archive`, so the ID cannot say which note was pressed. The data scope can.
2. **`atActivation`** runs in the same turn and takes the application's hold on the row. It runs before anything is awaited, because some things (a browser audio unlock is the real example) must happen inside the user's gesture.
3. **`before(requireSession)`** asks the server whether the session is still valid, with a request of its own (`check_session`).
4. **`run`** sends the protected `archive_note` request through `call`, which uses the transport the application gave the action. The request carries the invocation's signal and the time left on the work deadline.
5. **The server** decides again. Here is its side of the same call:

```ts examples/pack1-consumer/server/notes-server.ts
async ({ noteId }, ctx: ServerContext): Promise<CallToolResult> => {
  // Authorization is decided here, for this request, from the verified context alone.
  const identity = identityOf(ctx.http?.authInfo);
  if (!identity) return refusal(TEXT.signInRequired);
  try {
    const archived = await bounded(ctx, (signal) => backend.archive(identity.accountId, noteId, signal));
    // One sentence for an absent note, someone else's note and an archived one: nothing is disclosed.
    if (archived === undefined) return refusal(TEXT.cannotArchive);
    const output = ArchiveOutputSchema.parse({ noteId, archivedAt: archived.archivedAt });
    return { content: [{ type: 'text', text: 'archived' }], structuredContent: output };
  } catch {
    // An exception, a wait that ran out of time, or an output that failed validation after the
    // write: the archive may have been applied (or may still be), so this failure does not claim otherwise.
    return failure(TEXT.unavailable);
  }
},
```

The identity comes from `ctx.http.authInfo`, which only the application's listener sets, after verifying the credential. No tool argument can name an account. The decision to archive is made here, for this request, by the application's backend. The reply has three shapes: a result, a refusal the server knows changed nothing (`refusal`, marked with `NO_EFFECT_META`), and any other failure (`failure`), which says nothing about whether the write happened.

### What each case returns

These are the cases `scripts/guide-actions.test.ts` runs, with what it observed. "Backend calls" counts calls that reached the application's backend; the session check is counted apart from the protected archive.

| Case | Who stops it | What the person sees | Backend calls (session check / archive) |
| --- | --- | --- | --- |
| Allowed: Alice archives her own `n-1` | Nobody | `Archived at 1001`; the hold is handed to its owner | 1 / 1, and `n-1` is archived |
| Denied: Alice archives Bob's `n-3`, or `n-404` | The server's backend | `The server declined; nothing changed`; one fixed sentence, `This note cannot be archived.`, whichever of absent, someone else's or archived it was | 1 / 1, nothing archived |
| Missing authentication: no credential | The server, before the backend, for both the session check and the archive | `Not archived: sign-in-required`; the archive request is never sent | 0 / 0 |
| Session invalid (the account is signed out) | The `before` prerequisite | `Not archived: sign-in-required` | 1 / 0 |
| Permission withdrawn after a valid session | The server, deciding again | `The server declined; nothing changed`; the session check still said yes | 1 / 1, nothing archived |
| Forged `accountId`, wrong type, empty ID | The strict input schema | An error; the handler never runs | 0 / 0 |

Two of those rows are the rule the whole design rests on. A prerequisite **authorizes nothing**: the session check says yes, the permission is withdrawn, and the server still refuses, because it decides for every protected request. And a request with no verified identity is refused by the server **before** the backend is asked.

The notes application answers a missing credential at the tool level, with a sentence. An application's own listener answers it at the HTTP level, which is where the starter does it, and its qualification traces each case:

| Request to the starter's protected endpoint | Answer | Notes |
| --- | --- | --- |
| No `Authorization` header | `401`, `WWW-Authenticate: Bearer realm="saga-starter"` | The verifier is not even asked. |
| A header that is not `Bearer …`, an unknown credential, an expired credential | `401`, `error="invalid_token"` | |
| A credential without the `account:read` scope | `403`, `error="insufficient_scope", scope="account:read"` | |
| A valid credential that names no account (a service credential) | `403`, `insufficient_scope` | The operation fails closed without running. |
| A verifier that fails or never answers | `503`, no challenge | Not the caller's fault; cut off by the request's clock. |
| A verified account the application's policy denies | A tool-level refusal, `This account may not see this.` | The policy was asked once, for this request's identity. |

Each answer carries the challenge a client needs to recover, and none names an account, a credential or a backend message. The starter's [identity handoff](attach-to-existing-backend.md#hand-the-verified-identity-to-the-transport) is where the listener turns the verified result into the per-request context the tool reads.

## Prerequisites: session validity, confirmation and an audit entry

A prerequisite is reusable asynchronous work that must finish before the handler and may stop it. It `proceed`s, optionally providing values to what follows, or it `refuse`s with a reason. A refusal ends the invocation as a failure at the `prerequisites` stage: the handler never starts, so the protected request is never sent. A prerequisite that makes a request of its own (the session check does) is counted as that request, not as the protected one.

The notes application's session check is one prerequisite, reusable by any action:

```ts examples/pack1-consumer/src/notes-actions.ts
export function createSessionPrerequisite(transport: ServerTransport<CallToolResult>) {
  return prerequisite('session', async ({ signal }) => {
    const reply = await transport.callServerTool({ name: SESSION_TOOL, arguments: {} }, { signal });
    return reply.isError === true ? refuse('sign-in-required') : proceed({ signedIn: true as const });
  });
}
```

To change what Archive requires, add prerequisites to the chain. Two more cross-cutting requirements, written as the application would write them (`scripts/guide-actions/guarded-archive.ts`, qualified by the test; they are not in the notes application and not SDK exports):

```ts scripts/guide-actions/guarded-archive.ts
/** Cross-cutting requirement: the person confirms. A refusal means the handler never starts. */
export const confirmArchive = (environment: GuardEnvironment): Prerequisite<NoValues, unknown, Pressed> =>
  prerequisite('confirm', async ({ params, signal }) => ((await environment.confirm(params.noteId, signal)) ? proceed() : refuse('not-confirmed')));
```

```ts scripts/guide-actions/guarded-archive.ts
/** Cross-cutting requirement: a durable audit entry exists before the protected request is sent. */
export const auditArchive = (environment: GuardEnvironment): Prerequisite<{ readonly auditId: string }, unknown, Pressed> =>
  prerequisite('audit', async ({ params, signal }) => {
    try {
      return proceed({ auditId: await environment.record(params, signal) });
    } catch {
      return refuse('audit-unavailable'); // no audit entry, no protected request
    }
  });
```

Composed after the session check, they read as a list of requirements:

```ts scripts/guide-actions/guarded-archive.ts
return Action.server<InstanceEvent<unknown>, Reply>('archive-note-guarded', transport)
  .input((event) => ({ noteId: String(event.read('id')), at: event.dataPath }))
  .before(requireSession) // 1. a valid session (its own request, counted apart)
  .before(confirmArchive(environment)) // 2. the person confirms
  .before(auditArchive(environment)) // 3. the audit entry exists
  .run(async ({ params, call }) => {
    const reply = await call('archive_note', { noteId: params.noteId });
    if (reply.isError === true) throw new Error('The archive request failed');
    return parseArchived(reply); // a reply is not an acknowledgement until the application has validated it
  })
```

`provided.auditId` reaches the handler and every later hook as a typed value, and the compiler rejects an ordering in which a prerequisite needs a value nothing provided yet. `parseArchived` is the application's own validation of the acknowledgement (the test passes the notes example's `ArchiveOutputSchema.parse`): a reply that is not an error is not yet proof that the archive happened, and a reply that fails validation fails the handler, so the audit entry settles as `unknown`, as for any other unreadable outcome, with no retry. The traced test runs this chain:

| Case | Observed |
| --- | --- |
| Session valid, person confirms, audit written | One audit entry, one protected request, entry settled as `archived` |
| The person declines | No audit entry, no protected request. Only the session check's own request was made. |
| The audit store is down | The press is refused as `audit-unavailable`; no protected request |
| The session is invalid | The person is not asked and nothing is audited: prerequisites stop at the first refusal |
| Every prerequisite proceeds, the archive is applied, but the reply carries no valid acknowledgement (`{ content: [] }`, or a wrong shape) | One protected request, never repeated; the audit entry stays `unknown`, not `archived` |
| Every prerequisite proceeds, the permission was withdrawn | The server still refuses; the audit entry stays `unknown`, because this handler treats every failed reply alike (the notes example separates the server's declared refusals with `declaresNoEffect`) |

A prerequisite is not the control's appearance. A spinner or a disabled button is the **presentation of binding state**: `binding.state.phase` is `idle`, `running`, `settling` or `disposed`, and `binding.subscribe` calls a listener after each change. What `before` means is only "must finish first, and may refuse". A disabled button does not stop a press that reaches the callable, and a prerequisite does not draw anything.

## Outcomes, hooks and cleanup

Every invocation ends in exactly one outcome, decided once and never edited: `succeeded`, `failed` at a stage (`input`, `prerequisites`, `running`), or `canceled` at a stage with a cause (`replaced`, `disposed`, `subject-changed`). Named hooks let the application say what each outcome establishes:

```ts examples/pack1-consumer/src/notes-actions.ts
.onSuccess(({ params, result, activation, current }) => {
  // The server confirmed: the hold now belongs to the application's owner for good.
  activation.transfer((token) => environment.holds.confirm(token));
  if (current()) environment.present(params.at, `Archived at ${result.archivedAt}`);
})
.onFailure((context) => {
  if (context.stage === 'input') return; // nothing was read from the event, so no row can be named
  if (!context.current()) return; // the row shows another note now, or is gone
  if (context.stage === 'prerequisites') {
    // The handler never started: no archive request was sent.
    const { failure } = context;
    environment.present(context.params.at, `Not archived: ${failure.kind === 'refused' ? failure.reason : failure.kind}`);
  } else if (context.failure.kind === 'handler-error' && context.failure.error instanceof ArchiveDeclined) {
    environment.present(context.params.at, 'The server declined; nothing changed');
  } else {
    // A timeout, a transport failure or an unreadable reply: the request may have been applied.
    environment.present(context.params.at, 'Archive status unknown');
  }
})
.onCanceled((context) => {
  if (!context.current()) return;
  environment.present(context.params.at, context.stage === 'prerequisites' ? 'Not archived: canceled' : 'Archive status unknown');
})
```

Three real outcomes, each run by the traced test:

- **Success.** The server confirmed. `onSuccess` hands the hold to its owner (`transfer`) and writes `Archived at 1001`.
- **Refusal.** Either a prerequisite refused (the handler never started, so the hook can say *nothing was sent*) or the server declared a refusal with no effect (the hook can say *nothing changed*). Both are known results, and both give the hold back.
- **Canceled or obsolete.** The binding was disposed, or the row now shows another note (`subject-changed`). The press is no longer wanted.

Then the rule that matters most for hooks: **an awaited callback that presents something checks `current()` immediately before its write.** `current()` is true only while the runtime is still waiting for *this* callback, the binding is neither disposed nor replaced, the adapter reports the instance live, and the subject still equals the one captured at activation. It is read fresh on each call. In `onSuccess` above, the hold is handed over unconditionally (the server did confirm), but the row's status line is written only `if (current())`, because after a recycle that line belongs to another note. A signal that has not aborted does not show the row is still the right one; `current()` does.

The traced recycled-row case shows both halves. A press on `n-1` is held open at the server; the row is then changed to show `n-2` (its component ID is unchanged); the press ends canceled with cause `subject-changed`. Observed: `n-1` **was** archived, because cancellation did not stop the server; nothing was written on the row that now shows `n-2`; and the hold was given back, not handed over.

### Four clocks, kept apart

| Clock | Default | What it bounds | Set with |
| --- | --- | --- | --- |
| Work deadline | 30 s | Prerequisites and the handler *together*, counted from the end of the synchronous prefix. A server request inside it waits for the time that is left, or less. | `limits({ deadlineMs })` on an action, or `limits` on `createInstanceHost` |
| Hook or cleanup step | 5 s | Each awaited hook and each resource release, on its own | `hookMs`, the same two places |
| Server operation | 3 s | One operation inside the server's request | `budgets` on the application's listener |
| Server request | 10 s | The whole request, starting before authentication | the same `budgets` |
| Resource lifetime | none | Application-owned. A hold lasts until the application ends it. | the resource's owner |

The rules that connect them:

- **No clock is a universal invocation timer.** The work deadline does not cover the hooks, and the hooks do not renew it. A new stage never resets its parent's bound, because every deadline is absolute from where its scope began.
- **An invalid explicit limit fails** (`TypeError`) where it is supplied, even if another layer would have shadowed it. It is never replaced with a default. The traced test passes `0`, `NaN` and `-1`.
- **There is no automatic retry**, and none is safe to assume. An uncertain write (a timeout, a lost connection, an unreadable reply) is reported as unknown.
- **Cancellation and timeout do not establish rollback, and do not stop the server.** Aborting the signal ends the *client's wait*. The traced deadline case sets a 150 ms work deadline and holds the server's archive open: the person sees `Archive status unknown`, the hold is given back, and then, when the server's backend is let go, `n-1` is archived anyway. The outcome was unknown, and it was applied.

The server side uses the same rule for its own waits: a stage that does not finish in time is dropped and its late answer discarded, but work that ignores its signal keeps running. The tool above answers such a case with `failure`, never `refusal`, because ending a wait undoes nothing.

## Two rows, one definition

One definition bound to two instances keeps each binding's own state:

```ts examples/pack1-consumer/src/notes-view.ts
view.watchById('row-archive', ActionButton, (handle) => void handle.bindAction('activate', actions.archiveNote, { subject: () => handle.read('id') }));
```

The traced test presses the first row, holds the server open, and presses the second. Observed: the first binding is `running` while the second is `idle`; both holds are pending at once (`n-1`, `n-2`); when the server is released, both archives apply and both holds are handed to their owner. A pending press on one row never disables or cancels the other.

The `subject` reader is what makes a *recycled row* safe. A list renderer may keep a row's component and show another item in it. The component ID is not the item's identity, so the binding takes a subject, here `handle.read('id')`, reads it at activation, and compares a fresh read with `Object.is` at its own decision points and on every `current()`. A reader that throws at activation ends the press as invalid input; one that throws later counts as a change. Without a `subject`, a press targets the instance alone, which is right for a fixed control and wrong for a row.

## Disposal, ownership and hand-off

**Disposal.** `binding.dispose()` is idempotent. It cancels an undecided press with cause `disposed`, detaches that binding's callable so later events do nothing, and ends its subscription after a final `disposed` state. It leaves other bindings of the same definition alone. The application ends its own bindings (and the discovery that created them) when its view ends; the starter's `retire()` does it for a host teardown and for the page going away alike. Ending a binding stops the control reacting. It does **not** prove that work a server action started has stopped.

**Ownership.** A resource is anything a press takes that someone must give back. The notes application's hold on a row is an application-owned resource, and it shows the whole contract:

```ts examples/pack1-consumer/src/row-holds.ts
begin(noteId: string): number {
  const token = (this.#next += 1);
  this.#tokens.set(token, { noteId, phase: 'pending' });
  this.#publish();
  return token;
}

/** Takes the token over for good: the invocation no longer releases it. */
confirm(token: number): void {
  const entry = this.#tokens.get(token);
  if (entry) entry.phase = 'confirmed';
  this.#publish();
}

/** Gives an unconfirmed token back. A confirmed token, or one already given back, is left alone. */
end(token: number): void {
  if (this.#tokens.get(token)?.phase === 'pending') this.#tokens.delete(token);
  this.#publish();
}
```

`atActivation` took the hold with `scope.own(token, release)`. From then the *scope* owns it and releases it when the invocation ends, one release step per token inside the 5 s hook budget. On success the application takes it over with `activation.transfer(...)`, which runs synchronously, and from then the scope never releases it. The three outcomes the traced test checks: success leaves `confirmed: ['n-1']`; refusal and cancellation leave nothing held.

**Why stale cleanup must not alter a newer acquisition.** A press that ends late runs its cleanup late. By then the application may have a newer acquisition for the same row. So the release is given a *token* that names exactly one acquisition, `end(token)` only affects an entry that is still `pending` and is a no-op for one already given back or confirmed, and the runtime never calls anything that means "release everything the owner holds". Stopping the whole owner is the owner's own teardown and never an invocation's shortcut. If your owner keys a hold by the row instead of by the acquisition, an old press's cleanup will release the new press's hold; key it by token.

## What each renderer and server has shown

Claim only what the evidence supports. The runnable tutorial stays on the qualified pair.

| | Shown | Not shown |
| --- | --- | --- |
| **Lit** | The full renderer. `ActionButton` and `createLitActions` from `@saga-a2ui/lit/actions`; the notes application and the starter run in it, installed from packed tarballs | A Windows run; an actual assistant host |
| **React** | Direct action attachment: `ActionButton`, `InstanceHostProvider` and `useActionSetup` from `@saga-a2ui/react/actions`, and surfaces from `@saga-a2ui/react/a2ui`. The notes application runs through a React consumer in a local fixture host | Installed parity: no React starter, template, CLI pair or authenticated recipe |
| **Lynx** | Nothing current. Lynx delivery was retired on 2026-10-19; `apps/lynx-fixture` and the Lynx proposals in the Blueprints are history | Any Lynx setup |

On React the binding is the same definition and the same `bindAction`; only how the setup runs differs. The notes React consumer's setup is the application's own function, given to `useActionSetup` under one provider, and unmounting that root disposes every instance and binding beneath it:

```ts examples/pack1-consumer/src/notes-react-view.tsx
const setup = (view: InstanceView): void => {
  view.watchById('row-archive', ActionButton, (handle) => void handle.bindAction('activate', actions.archiveNote, { subject: () => handle.read('id') }));
  view.watchById('row-read', ActionButton, (handle) => void handle.bindAction('activate', actions.markRead));
};
```

For React surfaces and catalogs use `@saga-a2ui/react/a2ui`, never `@a2ui/react` directly ([React consumer dependencies](react-consumers.md)). Any later React pair keeps its own renderer qualification.

Servers have the same limits. `node`, `express`, `fastify` and `hono` are qualified with `lit-mcp`, and `saga init` offers only `node`. Everything in [the trace above](#trace-one-press-allowed-and-denied) is the same for each qualified server, because the identity handoff and the protected operation are the same two snippets in each recipe ([which pairs have a recipe](attach-to-existing-backend.md#which-pairs-have-a-recipe)).

### Hapi

Hapi has no qualified recipe yet, so there is no Hapi identity handoff to trace. Route authentication does not yet reach the bridge callback; the Hapi bridge and its handoff are [#65](https://github.com/MachineWisdomAI/saga-a2ui/issues/65), which owns the recipe and its acceptance. When Hapi joins the qualified inventory the generated recipe regenerates (`npm run guide:recipes`), and `scripts/guide-actions-document.test.ts` fails until this section traces that handoff.

## What this guide does not show

- It traces a loopback run against synthetic data. It shows no real identity provider, OAuth or DCR flow, and no run in ChatGPT, Claude or Alexa+. Named-host receipts are in the [host compatibility observations](2026-10-19_host-compatibility-observations_v1.md).
- Cancellation forwarding, rollback and gesture behavior in an actual host stay unobserved.
- The prerequisites above are guide qualification code, not part of the notes application or an SDK export. The SDK has no promise-combinator, registry or tutorial dispatcher, and this guide adds none.
- Package publication, deployment and visibility are separate decisions this guide does not make.

## Where to go next

- The setup, install and attach recipes: [Getting started](getting-started.md) and [Attach SAGA to an existing backend](attach-to-existing-backend.md).
- The design behind the vocabulary: [action binding](../blueprints/modules/action_binding.blueprint.md#authoring) and [request and view lifetimes](../blueprints/features/request_view_lifetimes.blueprint.md). The Blueprints' illustrative names and numbers are not promises of public API or recommended timeouts.
- Updating or rolling back the candidate: [Candidates: contents, update, rollback](candidate-update-and-rollback.md).
