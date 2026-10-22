# Coding standards

SAGA code must be clear, maintainable, and explainable. Each module should have a clear purpose, and its behavior and design decisions should be easy to trace. Optimize for explicit responsibilities, useful types, and local reasoning. Keep each interface small and coherent enough for a human to understand its concepts and obligations together.

## Blueprint review

Apply the [authoring guidance](blueprints/README.md#authoring). Each section should contribute a decision, rationale or consequential behavior. Check that a cold reader can explain the change and distinguish existing behavior from proposed interfaces. Judge comprehension; word count is advisory.

## Keep interfaces manageable and remove obsolete contracts and code

Do not accumulate backward compatibility debt for internally written code that has never had a stable release. CORE1 and CORE3 are implementation slices, not releases. Change interfaces and migrate all owned callers and tests together. Do not add shims, legacy overloads, aliases, or a second implementation merely to preserve signatures from an earlier slice.

Delete obsolete code as part of replacing it. Remove superseded implementations, unused exports and configuration, and obsolete documentation and tests. The replacement must retain required functionality, security guarantees, and protocol support, with behavioral tests covering those requirements. Do not leave old and new paths in parallel indefinitely.

For published stable public contracts, use semantic versioning and proportionate migration guidance and release notes for intentional breaking changes, following the [version policy](docs/version-policy.md). Use that release path to retire obsolete contracts rather than keeping them permanently.

## Responsibility determines placement

Application meaning, presentation protocols, renderers, and host delivery change for different reasons. Keep their implementations separate. Renderer-independent code is not necessarily protocol-independent: an A2UI decoder belongs to an A2UI module even when it lives in core.

The following ownership is the target for SDK extraction. `@saga-a2ui/mcp`, `@saga-a2ui/core`, `@saga-a2ui/components`, `@saga-a2ui/react`, `@saga-a2ui/lit` and the two stack packages, `@saga-a2ui/lit-mcp-stack` and `@saga-a2ui/react-mcp-stack`, are extracted. Components holds the FaithfulCard slice, React holds the action seam, the card slices and the named composition capabilities (not full React parity), and a stack connects one renderer to one delivery so an application installs one stack; Lit and the Lit stack are private, the rest are in the release set. Their consumers are the templates, the installed examples and the `apps/lit-host` view modules; the rest are planned. Create each with working consumers, not empty scaffolding. [Package layout](packages/README.md) records the intended dependencies.

| Owner | Responsibility | Keep out |
| --- | --- | --- |
| Consumer application | Domain values, backend calls, verified identity, authorization, and authoritative effects; composition of SDK implementations | Host quirks and duplicated protocol parsing |
| `@saga-a2ui/core` | Renderer-independent value objects, processing interfaces, and shared behavior; protocol implementations in named protocol modules | Lit/React/Lynx, DOM access, MCP transport, application business rules |
| `@saga-a2ui/mcp` | MCP/MCP Apps delivery, resource identity, host capability negotiation and lifecycle; separate server, view, and policy exports | Visual-tree interpretation and renderer selection |
| `@saga-a2ui/lit`, `react`, `lynx` | Framework rendering, binding integration, events, accessibility, mounting, and disposal | Raw protocol parsing, backend authorization, and host-name branching |
| `@saga-a2ui/components` | Optional renderer-neutral contracts and shared component behavior | Renderer implementations, MCP delivery, and application-specific branding |

Consumer code holds application meaning only: domain values, its own catalog, what a result means, which action each control has and what ending the view takes with it. It does not write A2UI messages, import the MCP Apps bridge or `@saga-a2ui/mcp/view`, order a handshake, or build a session or decoder; the stack owns those, and `scripts/consumer-boundary.test.ts` enforces it. A lower-level use that a consumer legitimately needs (a catalog authored against upstream's component API) carries one reviewed `// saga-boundary: <rule> <reason>` on that line, never a file-wide disable. When a consumer needs something the SDK does not export, the fix is the export in `packages/`, added first and kept limited to what the qualifying consumers use. Package dependency directions are separate: each package's `exports.test.ts` asserts its own, and the freedom to evolve a package's API never overrides them.

Each component owns its specific contract and behavior. One component's requirements must not define the whole components package or become requirements for unrelated components.

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

A **module** has an **interface** and an **implementation**. The interface includes the concepts, accepted values, invariants, ordering, failures, required configuration, ownership, and lifecycle the caller must understand. A **seam** is where behavior can vary through that interface; an **adapter** supplies a concrete implementation there.

Seek **depth**: substantial useful behavior behind a small, coherent interface a human can manage. Judge its size by everything the caller must learn; method, line, and token counts do not measure that burden. Keep related obligations together so callers do not have to reconstruct one operation across scattered modules. A decoder can own validation, supported envelope normalization, and construction of message values. Its caller should not also inspect nested JSON or remember the decoder's internal sequence. The module earns its place when removing it would spread that knowledge across callers.

Prefer interfaces describing operations over bags of getters, flags, or callbacks whose ordering callers must reconstruct. Pass dependencies explicitly at construction or through a typed function parameter. Keep pure decisions separate from I/O and renderer effects. A module can be a function or class; inheritance hierarchies, dependency-injection containers, and pass-through wrappers are not required for depth.

## DRY and established libraries

**DRY: give each rule one authoritative implementation.** Reuse the module that owns a validation rule, protocol interpretation, or state transition instead of copying it into each adapter. Consolidate repeated knowledge at the correct package and module. Similar-looking code with different responsibilities need not share an abstraction; avoid a flag-driven universal helper that couples unrelated behavior merely to remove a few repeated lines.

Prefer standard platform APIs and official or widely used, maintained libraries to implementing established functionality ourselves. Check existing dependencies and supported upstream interfaces first. Choose for contract fit, TypeScript support, maintenance, licensing, and runtime/package compatibility. Keep required third-party registration inside its integration seam. When custom code is necessary, identify the concrete gap and implement only the missing behavior in its owning module. A wrapper should enforce a useful SAGA contract, not rename a library's methods.

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

## Red–green–refactor

Develop behavior changes in small, complete cycles:

1. **Red:** write one meaningful test of the required behavior through its interface. Run it and confirm that it fails because the behavior is missing or wrong, not because the test setup is broken. For a bug, reproduce the failure before fixing it.
2. **Green:** implement only what is needed to satisfy that behavior, and run the affected tests. Preserve the assertion rather than weakening it to match the implementation.
3. **Refactor:** while tests are green, improve names, remove duplicated knowledge, and simplify module responsibilities without changing observable behavior. Rerun the affected tests before starting the next cycle.

Work one behavior at a time rather than writing a large speculative test suite followed by all the implementation. For a pure refactor, start from passing behavioral tests and add missing characterization coverage first where needed. Documentation-only changes use documentation checks; the cycle does not require manufacturing runtime tests for them.

## Test functionality; prefer quality over quantity

Test a module through the interface callers use. Protocol tests cover the supported forms and meaningful rejection cases, field preservation, and relevant update semantics. Strategy implementations share behavioral contract tests where their promises are the same; host limitations remain explicit. Visitor changes need typechecking and observable coverage of the affected cases.

Tests must permit a different correct implementation. Assert returned values, visible state, documented failures, and consequential effects. Avoid private-method tests, source-text assertions, incidental DOM structure, and mocks that prescribe the internal helper-call sequence. Assert effect counts or ordering only when they are part of the contract, such as preventing a duplicated action. Use test doubles at external or nondeterministic seams, not to replace the behavior being tested.

Choose expected results from the requirement, a worked example, or an independently verified fixture; do not recompute them with the production algorithm or approve snapshots without checking their meaning. Each test should catch a distinct meaningful failure. Favor representative behavior, consequential edge cases, and recovery over test counts or coverage percentages. Consolidate redundant tests and retire tests of superseded internals once behavioral coverage protects the contract. Coverage can reveal gaps; it is not proof of correctness or a reason to test trivia.

Exercise renderer-independent processing without a DOM or renderer imports. Keep browser tests for rendering, bindings, events, accessibility, and lifecycle. Verify server/view separation through the actual package exports and built artifacts when those packages exist. Keep actual-host acceptance separate from protocol and browser checks.

Review each change for correct ownership, a traceable call path, useful invariants, and preserved failure behavior. Keep the change bounded to one observable outcome. Existing prototype code is not an architectural precedent: move misplaced logic and remove superseded code when working on that responsibility, preserving required behavior and migrating owned callers together without absorbing unrelated epics.
