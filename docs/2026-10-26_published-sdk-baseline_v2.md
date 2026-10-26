# Published SDK baseline, 2026-10-26, revision 2

The calibration documents describe `0.7.7-rc.1`, the seven-package npm release that adds Lit and the Lit MCP stack. Registry metadata and tarballs were fetched anonymously on 2026-10-26. All 110 shipped `src/` files match release source `bcfdbb0dcb633a5df5bd5c2072f703d9d6d6ad13` byte for byte; all seven tarballs match their registry SHA-512 integrity values.

The [release receipt](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1) records the independent review, CI, anonymous strict installations, compilation and builds performed for this release. This documentation reconciliation independently rechecked registry metadata, tarball integrity and source bytes; it reuses those installation/build receipts rather than claiming another full qualification run. The release changed publication scope and tooling, not runtime APIs. It establishes neither application deployment nor additional named-host acceptance.

| Package | Version | `latest` at inspection | `next` at inspection | Matching source files |
| --- | --- | --- | --- | --- |
| `@saga-a2ui/core` | `0.7.7-rc.1` | `0.5.6-rc.1` | `0.7.7-rc.1` | 23 |
| `@saga-a2ui/components` | `0.7.7-rc.1` | `0.5.6-rc.1` | `0.7.7-rc.1` | 14 |
| `@saga-a2ui/mcp` | `0.7.7-rc.1` | `0.5.6-rc.1` | `0.7.7-rc.1` | 14 |
| `@saga-a2ui/lit` | `0.7.7-rc.1` | `0.7.7-rc.1` | `0.7.7-rc.1` | 16 |
| `@saga-a2ui/react` | `0.7.7-rc.1` | `0.5.6-rc.1` | `0.7.7-rc.1` | 16 |
| `@saga-a2ui/lit-mcp-stack` | `0.7.7-rc.1` | `0.7.7-rc.1` | `0.7.7-rc.1` | 12 |
| `@saga-a2ui/react-mcp-stack` | `0.7.7-rc.1` | `0.7.6-rc.1` | `0.7.7-rc.1` | 15 |

## Tarball integrity

- `@saga-a2ui/core@0.7.7-rc.1`: `sha512-Iw8uT+SD3pGYRS1tUeS3F9uyS7+sZYxVLN2QQ3EX1SI3T7wLI97IjIQMeHoavYZwjLHKUOCCVTsxoVjWAM6mAg==`
- `@saga-a2ui/components@0.7.7-rc.1`: `sha512-LI/TC8ISqx1jgTMEjgDge9E4R4Hrz8KvKhTzrGCj8sKqTj+sACoDMTVdxz90SMdtkEnEvLkfkG95Won8DIFvCg==`
- `@saga-a2ui/mcp@0.7.7-rc.1`: `sha512-qmSn5bqHqD9rTi7kZ6ANDarrl+Q4l6iEYZzjqGrcyofNG2s0f+iuS4B/gYtMX7HkDaiqxE3rAqTtvDOa++PVrA==`
- `@saga-a2ui/lit@0.7.7-rc.1`: `sha512-YP8HZmougGl66StGfH7q9AQ3fVViQNJg9gBdK9zc0Bbx4ngY/1U0fjClPgLVmVmCoI6SQJDtWcs5nli3wBKznQ==`
- `@saga-a2ui/react@0.7.7-rc.1`: `sha512-d/hDvob68tbxW3hb9WYAd3YOIUmHom9z1t6Ont4p6d3H7fSyOq9mkgebw4xZ1sRDmggdlUAMQ9rTC9HhPq18RA==`
- `@saga-a2ui/lit-mcp-stack@0.7.7-rc.1`: `sha512-UVn22AxzuaaIe51ui+5KhqpGNDKWPe9u+UtgIJFyFRVZb878OpRyztoYduWMGCK0w2ky81aeadsIZQ0bifGvEg==`
- `@saga-a2ui/react-mcp-stack@0.7.7-rc.1`: `sha512-3sc3OrOsrTF4UvKBXyyoEJQR+yJpNdZllhl1e7BuOQvr5UIXeFQ4MYlTdTSPXWDifxddM6niueUYxw6BxYG6NA==`

Both Lit and React applications can install their published stack and framework peers. The source CLI and templates still use matched candidate tarballs for development qualification; candidate privacy does not restrict the published packages. Dist-tags are mutable, so consumer instructions pin an exact version.

The [earlier baseline](2026-10-26_published-sdk-baseline_v1.md) retains the original `0.7.6-rc.1` comparison as a dated observation. Its former Lit publication limitation is superseded by this release. Blueprint design approval, implementation SHAs and historical host observations remain in their existing lifecycle records.
