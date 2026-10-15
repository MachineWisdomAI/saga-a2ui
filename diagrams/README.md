# Blueprint diagrams

| Diagram | Mermaid source | Editable scene | Rendered outputs |
| --- | --- | --- | --- |
| Authorized playback ownership and data flow | [Source](authorized-playback-ownership.mmd) | [Excalidraw](authorized-playback-ownership.excalidraw) | [SVG](authorized-playback-ownership.svg), [PNG](authorized-playback-ownership.png) |
| Authorized playback and failures | [Source](authorized-playback-flow.mmd) | [Excalidraw](authorized-playback-flow.excalidraw) | [SVG](authorized-playback-flow.svg), [PNG](authorized-playback-flow.png) |

These diagrams describe the [draft playback design](../blueprints/features/authorized_playback.blueprint.md), not implemented APIs. Solid arrows show the proposed flow; labels identify checks and outputs. Capability representation, user binding and host result mapping remain open in the Blueprint.

Use the `diagram` skill's offline renderer. Edit the Mermaid source, regenerate the editable scene and both rendered formats, and inspect the PNG before review. Excalidraw scenes also open with File → Open at [Excalidraw](https://excalidraw.com); reconcile a visual edit with the Mermaid source before regenerating so neither version silently diverges. Keep filenames stable with the Blueprint. PNGs use the repository's existing Git LFS rules; verify staged pointers and upload LFS objects with the branch.
