# SAGA tour: explore the synthetic notes workflow

**Synthetic example — server checks simulated.** A static page with no backend. A visitor chooses a
scenario, presses the real **Archive** control of the notes example, watches it end in an allowed,
refused, denied, unknown, independent or obsolete outcome, and follows each explanation to the
source it comes from.

It is not the [demonstration](../lit-node/README.md). The demonstration runs a real local server
and also shows browsing, descriptions and protected Play. The tour runs only the notes example, so
it needs no backend process, listening port or credential once built.

## Build and open it

```sh
npm ci
npm run build:tour        # writes apps/lit-host/dist/tour (ignored)
```

Open `apps/lit-host/dist/tour/index.html` in a browser, or serve that directory from any static
host. Node 22.23.3 or newer builds it. `tour.json` ties the page to the candidate build and the source
commit its links point at. Source links point to that build's commit in the public repository. A dirty build may contain changes those committed links cannot show. The current page footer incorrectly describes the repository as private and the SDK packages as unpublished; those labels do not control repository access or registry availability.

## Follow an Archive interaction

Choose **Allowed: Alice archives her own note**, keep the Lit renderer selected, and press **Archive** under Alpha. The real action runtime first runs the asynchronous session prerequisite and then asks the simulated server to archive the note. The row shows **Archived at 1001**, the backend panel shows `n-1` archived, and the application-owned hold moves from pending to confirmed.

```mermaid
sequenceDiagram
    participant Reader
    participant View as Real notes view and action runtime
    participant World as Simulated server in the page
    Reader->>View: Archive Alpha
    View->>World: Check session prerequisite
    World-->>View: Simulated session valid
    View->>World: Archive note n-1
    World-->>View: Simulated confirmed archive
    View-->>Reader: Archived at 1001; hold confirmed
```

The diagram separates real client behavior from the simulated answers that drive it. Switching to React uses the same action definitions and server contract through the React view; it does not turn the simulated server into a real service.

Try **Unknown outcome** next: the simulation applies the archive and then fails to return confirmation. The row says **Archive status unknown** and sends no automatic retry. In **Two rows**, hold both requests and release them to see independent state. In **Obsolete completion**, reorder and refresh the rows before releasing a held archive: the late response must not overwrite the new row's status. Closing a view cancels its local wait and releases its pending hold, but does not undo a simulated archive already in progress. Inspect the backend panel before deciding what happened; a real application would reconcile with its server.

## What is real and what is simulated

| Real in the tour | Simulated in the tour |
| --- | --- |
| The notes view (`examples/pack1-consumer`), built twice from packed candidate tarballs: Lit and React | Who is asking. Choosing Alice, Bob or no credential authenticates nobody |
| The layout messages, the **Archive** and **Mark read** action definitions, the asynchronous session prerequisite, the direct per-row attachment and the application-owned hold | The session check, the server's decision and the backend, answered by `src/simulated-world.ts` from the demonstration's synthetic notes |
| The action runtime, the renderer and its cleanup | The stand-in host that mounts the view in a sandboxed frame (the repository's local host fixture, as in the demonstration) |

`scripts/tour.test.ts` runs the notes application's real server (`createNotesServer`) and the
simulated one through the same situations and requires the same reply from both, so the simulation
cannot drift into saying something the real server does not. That makes the simulation faithful to
the example. It does not make a simulated answer evidence that any server enforces anything.

## Limits, shown beside the interaction they limit

- A simulated session check does not authenticate anyone.
- A simulated denial does not prove that any server enforces anything.
- Local cancellation does not prove that a remote effect was undone.
- The 30 s work, 5 s hook, 3 s operation and 10 s request limits are not exercised here.
- The tour plays no media, reads no Patreon data and offers no protected content. Episode
  descriptions and Play need the demonstration's server and are not offered.
- Renderer previews: **Lit** is the full renderer. **React** has bounded evidence (direct action
  attachment and the notes application in a local fixture host); it is not renderer parity and there
  is no React starter, template or CLI pair. Lynx delivery was retired and is not offered. A renderer
  joins the list in `src/scenarios.ts` when its preview works.
- The tour is built from packed candidate tarballs of this source, not from registry packages. The SDK also has public npm releases, including both stacks; see [public installation](../../docs/public-install.md) for that separate installation path. This tour does not qualify a registry install.

## Files

| Path | Owner |
| --- | --- |
| `index.html`, `src/tour.ts` | The page and its stand-in host |
| `src/scenarios.ts` | Tour data: each scenario, what to press, what to expect, its limit, the renderer choices |
| `src/simulated-world.ts` | The simulated server and its named controls |
| `src/source-map.ts` | The quoted source lines and guide headings each explanation links to |
| `../../scripts/build-tour.ts` | Builds the page from packed candidate tarballs outside the repository |
| `../../scripts/tour.test.ts`, `../../apps/lit-host/e2e/tour.spec.ts` | Headless and browser qualification |
