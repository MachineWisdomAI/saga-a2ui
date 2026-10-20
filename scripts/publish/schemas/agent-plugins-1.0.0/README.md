# Agent Plugins 1.0.0 schemas

`plugin.schema.json` and `mcp.schema.json` are unmodified copies of the official machine-readable
schemas of the [Agent Plugins specification 1.0.0](https://agent-plugins.org/specification.md).
`saga publish` validates the `plugin.json` and `mcp.json` it generates against them; SAGA keeps no
competing manifest definition.

- Source: <https://github.com/agentplugins/agent-plugins-spec> (`schemas/1.0.0/`, `main` at
  `ff8ab5e392cc87bd88d87c060815a87490e51003` when copied), also served from
  `https://agent-plugins.org/schemas/1.0.0/`.
- Copied: 2026-10-20.
- License: schemas and other software material in that repository are Apache-2.0
  ([LICENSE.md](https://github.com/agentplugins/agent-plugins-spec/blob/main/LICENSE.md)), the
  license of this repository. The specification text itself is CC BY 4.0 and is not copied.
- SHA-256 (pinned in `scripts/publish/chatgpt.ts`; a copy that differs makes the validator
  unavailable, never passing):
  - `plugin.schema.json` `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883`
  - `mcp.schema.json` `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb`

To update: fetch the new schemas, review the specification's change log, replace both files, update
the digests and the documentation date in `scripts/publish/chatgpt.ts`, and rerun the tests.
