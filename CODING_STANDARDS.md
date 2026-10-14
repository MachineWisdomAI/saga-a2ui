# Coding standards

SAGA must be understandable one small change at a time. A maintainer learning TypeScript and frontend development should be able to follow the flow and explain why each module exists. Optimize for explicit responsibilities, useful types, and local reasoning.

## Responsibility determines placement

Application meaning, presentation protocols, renderers, and host delivery change for different reasons. Keep their implementations separate. Renderer-independent code is not necessarily protocol-independent: an A2UI decoder belongs to an A2UI module even when it lives in core.

The following ownership is the target for SDK extraction. Packages are planned, not implemented; create them with working consumers, not empty scaffolding. [Package layout](packages/README.md) records the intended dependencies.

| Owner | Responsibility | Keep out |
| --- | --- | --- |
| Consumer application | Domain values, backend calls, verified identity, authorization, and authoritative effects; composition of SDK implementations | Host quirks and duplicated protocol parsing |
| `@saga-a2ui/core` | Renderer-independent value objects, processing interfaces, and shared behavior; protocol implementations in named protocol modules | Lit/React/Lynx, DOM access, MCP transport, application business rules |
| `@saga-a2ui/mcp` | MCP/MCP Apps delivery, resource identity, host capability negotiation and lifecycle; separate server, view, and policy exports | Visual-tree interpretation and renderer selection |
| `@saga-a2ui/lit`, `react`, `lynx` | Framework rendering, binding integration, events, accessibility, mounting, and disposal | Raw protocol parsing, backend authorization, and host-name branching |
| `@saga-a2ui/components` | Optional neutral component contracts and shared content interpretation, including fidelity rules | Renderer implementations, MCP delivery, and application-specific branding |

Core is not a miscellaneous utilities package. Put a reusable operation in its owning module; a function used by several files does not automatically belong in core. Application business meaning remains outside SAGA. A visual tree must not become the source of truth for entitlements, domain actions, or future voice interactions.

## Organize files around coherent modules

Within a package, group an interface with the value objects and implementation that give it meaning. Keep protocol/version knowledge in a named subtree. The following shows placement for A2UI ingestion when extracted; it is not a requirement to create every file now:

```text
packages/core/src/protocols/a2ui/v0_9/
  message.ts           # validated message cases and their visitor interface
  decoder.ts           # decoding interface and implementation using upstream schemas
  component-update.ts  # update value, invariants, and partial-update semantics
  errors.ts            # failures callers can handle

packages/lit/src/a2ui/
  surface.ts           # typed core/upstream values to Lit lifecycle and rendering

apps/lit-host/src/
  main.ts              # explicitly constructs and connects the implementations
```

Keep a small interface and its only implementation together when that is easier to read. Split a growing implementation by responsibility or a real alternative strategy. Avoid top-level bags named `utils`, `helpers`, `managers`, or `types`, and parallel directory trees that separate every interface from its implementation. A package entry point exports the supported interface; consumers do not reach into sibling-package internals.

## Deep modules with explicit interfaces

A **module** has an **interface** and an **implementation**. The interface includes the accepted values, invariants, ordering, failures, ownership, and lifecycle the caller must understand. A **seam** is where behavior can vary through that interface; an **adapter** supplies a concrete implementation there.

Seek **depth**: substantial useful behavior behind a small interface. A decoder can own validation, supported envelope normalization, and construction of message values. Its caller should not also inspect nested JSON or remember the decoder's internal sequence. The module earns its place when removing it would spread that knowledge across callers.

Prefer interfaces describing operations over bags of getters, flags, or callbacks whose ordering callers must reconstruct. Pass dependencies explicitly at construction or through a typed function parameter. Keep pure decisions separate from I/O and renderer effects. A module can be a function or class; inheritance hierarchies, dependency-injection containers, and pass-through wrappers are not required for depth.

## Protocol input becomes a value object

Treat unchecked input as `unknown`. The protocol decoder validates the supported version and envelope, then produces typed values or an explicit failure. Reuse public upstream schemas and validation where they meet the contract; add SAGA checks only for requirements they leave uncovered. Do not build a second general-purpose A2UI interpreter or generic binding engine.

A protocol value object represents a meaningful validated value, not a convenient cast of a wire dictionary. Its factory or constructor establishes its invariants. Reuse validated upstream value types when they already express the contract; a second class hierarchy is not a goal. Expose readonly state and protect nested values from external mutation when mutation would break those guarantees. Keep mutable surface/session state in a separate module. Introduce distinct identifier types where confusing them would be consequential; do not wrap every primitive mechanically.

Keep wire names, version literals, optional-field probing, and array normalization inside the protocol implementation. Downstream code works with the supported message cases. It must not cast a payload to a shape and then rediscover that shape inside each renderer.

Schema validity, reference integrity, component support, state-dependent update validity, and action authorization are different checks with different owners. Parsing a message does not authorize its action. Preserve supplied content and supported fields during conversion; successful parsing must not silently drop actions, state, or attribution. Preserve valid partial-update semantics rather than requiring every update to look like creation. Unsupported essential behavior needs an explicit failure or an agreed fallback.

## Strategy selects; Visitor handles cases

Use a typed **Strategy** interface for interchangeable behavior, such as decoding a supported protocol version or delivering through a host. Construct and pass the chosen implementation explicitly in the application composition code or the adapter responsible for negotiated capabilities. Choosing a renderer must not implicitly choose the host or authorization policy.

Use a typed **Visitor** when an operation must handle the cases of a structured value, such as the supported A2UI message family. Each case delegates to its corresponding visitor operation. A message visitor can expose `createSurface`, `updateComponents`, `updateDataModel`, and `deleteSurface`, each receiving its own validated value type. The caller invokes the message's visitor interface rather than switching on raw wire keys. Adding a case must make incomplete visitors fail typechecking; a catch-all no-op must not hide missing behavior.

Traversal and case handling are separate responsibilities. For a genuine tree or graph operation, give traversal one owner and define child ordering, reference resolution, and cycle handling. A flat message batch does not need a tree walker. Reuse upstream traversal when it already supplies the needed behavior. A Visitor over visual nodes cannot infer business meaning or make a GUI suitable for voice.

Do not route SAGA behavior through registries, service locators, string-keyed handler tables, reflection, or import-time self-registration. Use direct imports, typed dependencies, and named operations. A typed wrapper around `handlers[name]` is still the same routing design. Protocol decoding necessarily recognizes wire tags; confine that finite, checked selection to the codec and convert it into typed cases. Literal strings are valid data, not a substitute for behavioral interfaces.

An upstream renderer may require a catalog or custom-element registration. Keep that required mapping at the renderer integration seam with explicit setup. It does not authorize a SAGA-wide registry or an action bus. Keep neutral catalog definitions with their neutral owner and concrete renderer implementations in their adapter. Extending SAGA should mean adding a value case, implementing a focused interface, or composing another implementation explicitly.

## TypeScript should expose the design

Use descriptive names and ordinary control flow. Prefer named public library types to reconstructing equivalent types with nested utility types. Check authored fixtures using annotations or `satisfies`. Use inference when it remains clear; generics should preserve a meaningful relationship between inputs and outputs.

Type assertions do not validate data. Replace `as unknown as T` escapes with compatible types or parsing. Isolate a necessary interop assertion in the owning adapter and explain the invariant that makes it safe. Runtime checks such as `Array.isArray` belong where unchecked values enter; they remain appropriate there. Distinguish an unrelated message case from malformed input instead of silently skipping both.

Comments explain non-obvious constraints and decisions. PR descriptions explain unfamiliar mechanisms and why the chosen interface is useful. Brevity does not justify combining parsing, policy, state mutation, and rendering into one method. Equally, pattern names do not justify scattering a simple operation across many files.

## Verify through the interface

Test a module through the interface callers use. Protocol tests cover the supported forms and meaningful rejection cases, field preservation, and relevant update semantics. Strategy implementations share behavioral contract tests where their promises are the same; host limitations remain explicit. Visitor changes need typechecking and observable coverage of the affected cases.

Exercise renderer-independent processing without a DOM or renderer imports. Keep browser tests for rendering, bindings, events, accessibility, and lifecycle. Verify server/view separation through the actual package exports and built artifacts when those packages exist. Keep actual-host acceptance separate from protocol and browser checks.

Review each change for correct ownership, a traceable call path, useful invariants, and preserved failure behavior. Keep the change bounded to one observable outcome. Existing prototype code is not an architectural precedent: move misplaced logic as a focused, behavior-preserving change when working on that responsibility, without absorbing unrelated epics.
