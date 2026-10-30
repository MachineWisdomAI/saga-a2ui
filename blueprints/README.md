# Blueprints

SAGA uses the three document types from [A2UI's Blueprint model](https://github.com/a2ui-project/a2ui/tree/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints), described in its [spec-driven development proposal](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/docs/proposals/spec_driven_development.md). Blueprints keep the design readable alongside the code and give implementation issues a shared contract to reference.

| Type | Location and guidance | Describes | Template |
| --- | --- | --- | --- |
| Feature | [`features/`](features/README.md) | A capability or change, including its effects across modules. | [Feature](templates/feature.blueprint.md) |
| Module | [`modules/`](modules/README.md) | One architectural responsibility, its interfaces and required behavior across implementations. | [Module](templates/module.blueprint.md) |
| Codebase | [`codebases/`](codebases/README.md) | A concrete implementation's relationship to its module contract, including supported behavior and gaps. | [Codebase](templates/codebase.blueprint.md) |

```text
blueprints/
  features/<capability>.blueprint.md
  modules/<module>.blueprint.md
  codebases/<implementation-path>/codebase.blueprint.md
  templates/
```

Use stable `snake_case` capability and module names. Codebase paths mirror the implementation's repository-relative path. Blueprint filenames have no date or edition suffix; where other material belongs, follow [CONTRIBUTING.md#documentation](../CONTRIBUTING.md#documentation). Link related Blueprints and use stable headings so tickets can reference the relevant requirements.

## Find a design

| If you are working on… | Start here |
| --- | --- |
| FaithfulCard content policies | [Content safety](features/content_safety_levels.blueprint.md) |
| Server integration and request identity | [Reusable MCP connector](features/reusable_mcp_connector.blueprint.md) and [request/view lifetimes](features/request_view_lifetimes.blueprint.md) |
| Application-owned outcome feedback and labels | [Application-owned feedback](features/application_owned_feedback.blueprint.md) (draft) |
| Stack packages, typed surfaces and the card application | [View composition](features/view_composition.blueprint.md) (its Status lists every landed revision) |
| UI actions and rendering | [Action binding](modules/action_binding.blueprint.md) and [Lit adapter](features/reusable_lit_adapter.blueprint.md) |
| Protected media | [Authorized playback](features/authorized_playback.blueprint.md) |
| Project setup and host submission | [Application setup](features/application_setup.blueprint.md) and [host publication](features/host_publication.blueprint.md) |
| A React starter, the tic-tac-toe guide and messages from a view to the conversation | [Getting-started tracks](features/getting_started_tracks.blueprint.md) and [view conversation](features/view_conversation.blueprint.md) (both approved; their Status sections record implementation and acceptance) |

Each design's Status section separates its approved scope, implemented slices and outstanding acceptance. Host publication has working ChatGPT and Claude preparation commands; a fixture-verified local resumable-handoff record is also implemented, and none of these tools establishes publication. For working setup instructions, use [Getting started](../docs/getting-started.md).

## Authoring

Write for a human deciding whether the design makes sense. Lead with a short before/after example, then explain responsibilities, interfaces, rationale, material failures, verification outcomes and open decisions. Distinguish existing behavior from the proposal. Finish when the reader can explain the change and assess its tradeoffs; detailed worker instructions belong in private implementation tickets. Use `mw-writing-tech-specs`, followed by `mw-writing-for-human-readers`.

Use enough detail for a reader to follow the complete behavior, responsibilities, rationale and failure cases. Remove repetition only when the explanation remains complete; a word count is not a quality or acceptance target. The existing CI length warning is advisory and does not override these criteria.

Make verification outcomes concrete: state the input or condition, expected observable result and boundary being exercised. For example, an image-policy contract could require empty input to produce `img-src 'none'`, populated input to preserve permitted origins, and a mounted frame to load a permitted image while blocking an unlisted origin. The directive and browser behavior are separate claims requiring different evidence.

Use `diagram` when an illustration clarifies the architecture or flow. Store editable sources and rendered SVG/PNG outputs in the repository's `diagrams/` directory, embed the relevant output and inspect it before review. Follow [change hygiene](../docs/change-hygiene.md) for retained artifacts and Git LFS.

Blueprints, public PRs and their verification evidence must be usable without private planning context. Community reports may link to them; internal implementation tickets live in Backstage and link outward to public evidence. Do not require a public delivery ticket or a private link to understand a design or its implementation. Keep internal discussion and human approval provenance in the private planning records; publish the approved revision, scope and implementation evidence here. User documentation draws on these designs together with verified implementation and release behavior.

## Lifecycle and revision records

Feature and module front matter uses `status` for the design decision: `draft`, `approved`, `rejected` or `superseded`. A documentation merge or AI review does not change that decision. Keep a short **Status** section near the title; update it when human approval, implementation evidence or a successor changes what the reader can rely on.

| Record | What to write |
| --- | --- |
| Design | The human decision and a permalink to the reviewed repository, Blueprint path and full Git commit SHA, including the reviewed diagrams. Preserve approval conditions. |
| Implementation | `Not started`, `Partial`, `Implemented` or `Unverified`, independently of design status. For each completed scope, record **Blueprint `<design SHA>` implemented at `<code repository>@<landed code SHA>`**, with PR/review and verification links. Name missing scope; several PRs or repositories may need separate entries. |
| Acceptance | Required host, installation, release or human acceptance still open. Source implementation does not satisfy these automatically. |
| Successor | Its path and full revision, `draft` or `approved`, and the scope it proposes to replace. Preserve earlier design-to-code records. A draft leaves the prior approved design current; an approved replacement supersedes only its named scope, even before replacement code lands. |

For a revision at the same path, retain the earlier approved/implemented entry and add the new revision and its decision. Set `status: draft` while the changed design awaits approval and identify the earlier approved baseline explicitly. Use `superseded` for a wholly replaced design; a partial amendment keeps the unaffected contract approved. A rejected proposal remains rejected when a replacement is merely proposed. Editorial and status-only edits preserve the approved design revision; material contract changes need human approval.

Pin an existing reviewed commit, not the moving branch or the latest commit touching the file. A status edit must not try to contain its own future commit SHA. When a newly approved design has just been committed, record that revision in a subsequent status-only commit. After implementation merges, use the actual merge/squash SHA in a follow-up status update; before merge, identify the reviewed candidate and the pending landed SHA instead of claiming completion.

The author or delivery coordinator maintains this section. The reviewer who submits implementation PR approval checks it against the applicable approved design and the PR's evidence, following [contribution review](../CONTRIBUTING.md#review). An implementation PR completing only one slice records that slice, not the whole design. Codebase Blueprints use the same design-to-code records for each associated module/feature; their own prose documents inspected implementation rather than granting design approval.

When reconciling old records, recover the actual human decision and exact reviewed revision. Preserve an explicit approval-evidence gap if those cannot be established; neither merged code nor a favorable AI review supplies retroactive approval. Historical implementation evidence can still be recorded with that limitation. Keep private approval sources outside the SDK; the delivery coordinator supplies a public-safe attestation of decision, revision, scope and conditions in the SDK PR so contributors can review without private access.

## Action vocabulary

Blueprints describe user-initiated behavior with the vocabulary of the [action binding](modules/action_binding.blueprint.md) module, which is the authority for these definitions. This section orients a reader; the module's [Lifetimes and owners](modules/action_binding.blueprint.md#lifetimes-and-owners) table defines each lifetime and what ending it does not imply. The module's own Status records whether any package implements it.

- An **action** is a reusable definition that application code builds: how parameters are extracted from an event, the prerequisites, the handler, the hooks, the limits and the busy policy. A definition holds no pending flag, timer or resource, so it can serve any number of components.
- An action is either **local** or **server**. In both kinds the runtime runs the prerequisites before it runs the handler; the handler does not await them. A handler may return a value or a promise, so a local action's handler, which is application code that runs in the view, can perform its own asynchronous work and can hold resources. A server action's handler also receives a `call` that sends a request to the application server; the function that serves that request lives on the server and is never referenced from the browser.
- A **prerequisite** is reusable work, synchronous or asynchronous, that finishes before the handler runs and may refuse. Prerequisites and the handler keep their separate order and refusal semantics. A client-side prerequisite is never authorization; the server stays authoritative for every protected operation.
- A **rendered component instance** (or **instance**) is one component created and managed by a renderer; SAGA attaches through it or a renderer-owned handle representing it. A template can create many instances, each with its own data scope. The instance and the data item it displays have separate identities, as the module’s [component terminology](modules/action_binding.blueprint.md#component-terminology) explains. A **binding** attaches one definition to one event of one instance and applies the definition's busy policy. An **invocation** is one activation of a binding that was not ignored, from the user's event through prerequisites, handler, required hooks and cleanup.
- An **acquired resource** is something an invocation obtained that the application must release, such as a capability a server action issued or a player holding decoded media. It can outlive the invocation that acquired it; ending the invocation does not end every resource.
- The **server request** is a separate lifetime outside the module. The application listener, handlers and resource service own it, and its reusable callback and deadline contract is implemented by the [MCP connector](features/reusable_mcp_connector.blueprint.md).
- Each invocation ends once as `succeeded`, `failed` or `canceled`, and a failed or canceled outcome records the stage it was decided in. The stage says how far the handler got, which gives three states: the handler's request is known not to have been sent, the handler is known to have returned, or the effect is unknown. Aborting the client's wait does not show that the host forwarded cancellation or that the server stopped, and it does not undo a remote effect.
- Two bounds exist: a work deadline over prerequisites and the handler, and a separate hook budget for each step after the handler settles. The runtime has no timer that covers the whole invocation.

Use these terms in proposals, interface tables, failure tables and verification outcomes. Upstream protocol vocabulary describes how an action reaches the agent or the renderer. A2UI describes an `event` as dispatched to the agent and a `functionCall` as executed by the renderer, and in SAGA's MCP Apps delivery the server request travels as a call to the application's own server through `App.callServerTool`, which the host proxies. The server action is the locally callable definition and handler, not that transport request. These wire forms are not definitions of local and server actions, and no Blueprint infers where work executes from which form a message uses. Each renderer adapter states how an upstream wire form reaches a bound callable.

Name the example application's controls when they ground current behavior in inspected source or explain a proposed mapping, and map them to the generic terms once, in the Blueprint's terms section. The named controls are examples, never definitions of all actions. In the example, Play is the action whose handler issues a protected request that the server authenticates and authorizes on every use. Its client work (acquiring the bytes with a capability the result carried, starting the player) produces a client-held player, which is an acquired resource that outlives the Play invocation. The [authorized-playback design](features/authorized_playback.blueprint.md) explains the implemented mapping: acquisition settles the invocation, while the application retains and releases the player lease. Pause and Resume are local actions on that player and cannot grant, extend or change authorization. Show images and Hide images are local actions on the view's revocable image-consent state. The subscription read starts from the host's tool input rather than from a rendered instance, so it is not an instance-bound action unless its retry and select controls later adopt the module. An opener that selects an item is a host notification, not an action. Use *user* for the person, since the application's HTTP listener already uses the word *listener*.

## Upstream guidance and SAGA adaptations

The source links are pinned to A2UI revision `1657e70119eaa3b76c2a106ac60c7c4dcfe206e0` so the adopted conventions can be compared with upstream changes.

| A2UI skill | Use in SAGA |
| --- | --- |
| [Blueprint navigator](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-navigator/SKILL.md) | Navigate from a feature to its module contracts and their concrete implementations. |
| [Create feature Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-create-feature-blueprint/SKILL.md) | Use capability names and explicit module/dependency references. SAGA's template adds a human-readable design flow and review status. |
| [Implement from Blueprint](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-implement-feature-from-blueprint/SKILL.md) | Read the relevant design and implementation context. Delivery still follows the assigned issue and repository review/testing rules. |
| [Blueprint maintenance](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-maintenance/SKILL.md) | Consolidate durable behavior into module contracts when appropriate, preserving links from features and tickets. |

SAGA uses readable design sections and may name concrete TypeScript, Lit and MCP boundaries where they matter. Feature paths remain stable through delivery; consolidation must preserve their references. The upstream skills are references, not installed copies. This adoption covers document formats and authoring guidance; it does not install their validator, skill-linking script or [automated compliance workflow](https://github.com/a2ui-project/a2ui/blob/1657e70119eaa3b76c2a106ac60c7c4dcfe206e0/blueprints/skills/a2ui-blueprint-compliance/SKILL.md).
