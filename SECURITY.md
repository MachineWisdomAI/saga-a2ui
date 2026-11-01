# Security Policy

## System and Scope

saga a2ui is a public TypeScript SDK for rendering and delivering agentic
applications through A2UI and MCP. Its public release set contains the seven
packages under `packages/`. The repository also owns maintained starter
templates, source CLI and publication tooling, development hosts,
demonstrations, qualification fixtures, workflows, and generators.

Security review covers the current revision of repository-authored, tracked
source and executable configuration, including:

- the seven public SDK packages;
- maintained templates and generated-starter sources;
- repository CLI, publication, release, archive, documentation, and
  verification tooling;
- development applications, demonstrations, and fixtures where their actual
  execution context makes a defect meaningful;
- CI workflows and direct runtime, development, and peer dependency
  declarations owned by this repository.

Tests and documentation may establish intended behavior, supported use, or a
security-relevant limitation. They do not by themselves prove that a control
works.

Installed `node_modules`, ignored build output, coverage output, Git metadata,
and nested `.claude/worktrees` or `.wise-agents/worktrees` are not
repository-authored source. Exact locked dependency code may be inspected to
validate an owned call-site assumption, but defects in that code are not
attributed to saga a2ui unless this repository's direct dependency selection
or integration makes the risk actionable here.

Source, merge, package preparation, npm publication, installation, deployment,
and live-host acceptance are separate claims. A source review does not
establish any later state.

## Threat Model and Trust Boundaries

Realistic attacker-controlled inputs include:

- A2UI messages, MCP requests and results, action inputs, content, links,
  images, and host-provided values;
- HTTP and Fetch requests handled by maintained server adapters;
- release manifests, archives, paths, assets, endpoint URLs, and remote
  responses processed by repository tooling;
- repository changes or files processed by CI or by a maintainer using the
  documented development workflow.

Important assets include application and user data, authenticated identity and
authorization context, credentials, local files, generated packages, release
evidence, CI integrity, and the availability of processes handling untrusted
input.

The application owns business authorization, authoritative effects, verified
identity, tenant policy, and deployment configuration. The SDK and maintained
adapters must preserve those decisions, keep request and session state
isolated, and must not bypass, conflate, or silently broaden supplied
authority.

The source CLI and publication commands are local operator tools, not
internet-facing services. Their documented inputs, referenced files, archives,
and contacted endpoints may still be untrusted. An operator choosing to run a
command is trusted; that choice does not make every file or endpoint consumed
by the command trusted.

Content policy constrains supported content handling. It does not sandbox
arbitrary application JavaScript, replace server authorization, or roll back
application effects that have already started.

## Security Invariants

The following properties must hold on supported paths:

1. Untrusted structured input is validated and subject to finite structural,
   byte, item, and retained-state limits before consequential allocation,
   parsing, copying, rendering, or dispatch.
2. Authentication and application authorization precede protected effects.
   Identity, request state, action resources, and lifecycle state do not leak
   across requests, sessions, views, or principals.
3. Actions and tool calls require explicit application-owned meaning and
   authority. Presentation content alone cannot invent or authorize an
   application effect.
4. Network tooling contacts only an admitted destination. Redirects and
   resolution changes cannot move credentials or requests to an unauthorized
   origin.
5. Archive, generator, staging, packaging, and cleanup operations remain
   within owned destinations. They do not follow attacker-controlled paths or
   replacements to overwrite or remove unrelated data.
6. Browser-visible text, links, images, and terminal output are handled through
   their owning validation and encoding policies. Untrusted content does not
   become executable code or terminal control.
7. Secrets and sensitive service responses are not placed in generated
   packages, logs, diagnostics, public evidence, or public issue reports.
8. Request, stream, subscription, and asynchronous-construction lifetimes are
   bounded and release their owned resources on refusal, cancellation,
   disconnect, and disposal.
9. Release and CI workflows preserve source and artifact identity, use
   appropriately bounded credentials, and pin executable third-party workflow
   actions to reviewed immutable revisions.
10. Owned manifests do not retain a direct dependency version with a known,
    applicable vulnerability when a supported safer version can be adopted
    without disproportionate compatibility or product damage.

## Reportable Findings and Severity Context

A reportable finding requires a concrete, realistically reachable violation of
an invariant in repository-owned code, configuration, defaults, or direct
dependency selection. A report must identify:

- the supported entry point and affected owner;
- the attacker-controlled input and required preconditions;
- the consequential effect and existing controls;
- the exact source revision and relevant dependency resolution;
- validation performed and important limitations.

For dependencies, a report must use current authoritative advisory and package
evidence. A newer version existing is not itself a finding. Report a direct
runtime dependency, development dependency, CI action, or actionable
transitive advisory only when the selected version is affected and the
repository can reduce the risk through a direct dependency or workflow update,
an owned integration change, or a proportionate compensating control.

Development and CI dependencies are reportable when their reachable use can
compromise developer execution, CI credentials, release artifacts, or
published packages. They are not assigned production-service severity merely
because they appear in the repository.

Severity reflects realistic exposure, privileges required, default versus
opt-in use, affected assets, repeatability, and compensating controls.
Internet-facing server paths, credentials, cross-principal effects, release
integrity, and writes outside an owned destination normally carry more weight
than local synthetic fixtures or explicit maintainer-only operations.

Related symptoms with one root cause should be consolidated. A proportionate
repair may leave documented residual risk. Security review does not require
eliminating every theoretical failure mode at the cost of breaking supported
behavior, materially degrading normal performance, or preventing continued
framework development.

## Out of Scope, Exclusions, and Accepted Risk

The following are not reportable by themselves:

- generalized vulnerabilities or maintenance concerns in the Node.js
  ecosystem that are not attributable to an owned direct dependency choice or
  integration;
- the mere existence of a newer dependency release without an applicable
  security or maintenance reason to adopt it;
- defects requiring control of the operating system, Node runtime, package
  registry, maintainer account, or an equally privileged same-authority local
  process, unless saga a2ui claims a boundary against that actor;
- nation-state or similarly exceptional attack assumptions unsupported by the
  product's deployment and users;
- application business-policy, tenant, entitlement, or authentication defects
  outside SDK-owned adapters and documented starter behavior;
- external host, ingress, identity-provider, portal, registry, or deployment
  configuration not represented in the reviewed source;
- arbitrary JavaScript sandboxing, rollback of already-started application
  effects, or a guarantee of complete resistance to resource exhaustion;
- retired or historical integrations presented only as qualification evidence,
  unless their tooling is still executed by a supported repository workflow.

A filesystem race is reportable only when the claimed attacker has a meaningful
lower-trust ability to modify the affected path without already having
equivalent authority to alter the executed code or its output.

Residual risk may be accepted or classified as mitigated only when its
reachability, impact, compensating controls, compatibility or usability cost,
and a trigger for reconsideration are stated. “Difficult to fix” or “unlikely”
alone is not suppression authority.

## Known Limitations and Compensating Controls

Dependency safety is time-sensitive. A scan must state when registry,
maintainer, and advisory evidence was checked. If current evidence cannot be
accessed, dependency safety is unverified rather than established.

Where an upstream protocol or framework constrains saga a2ui to an affected
dependency major and no compatible fixed release exists, do not force an
incompatible override and call the issue solved. Establish actual
reachability, apply proportionate ingress or resource controls, record the
remaining risk, and identify the upstream or migration condition that would
permit removal.

Repository source cannot establish live deployment topology, host CSP or
iframe enforcement, identity-provider configuration, tenant isolation,
registry publication, or named-host behavior. Those claims require evidence
from their owning environment.

Passing tests support a claim but do not prove absence of a vulnerability.
Scans must label partial coverage, unexecuted runtime behavior, unavailable
external evidence, and unresolved trust-boundary questions explicitly.

Security claims must name the supported library paths and tested
host/renderer combination.

## Reporting Security Issues

Do not put credentials, personal information, private service responses, or
unnecessary exploitable details in public issues. Maintainers should use a
restricted private coordination channel for sensitive reports until a public
reporting route is established.
