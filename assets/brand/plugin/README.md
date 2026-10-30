# SAGA A2UI dragon: plugin branding

The default branding of a prepared ChatGPT plugin package (`saga publish prepare --target chatgpt`) when
the application supplies none. The mark is the SAGA A2UI **dragon**. An application's own
branding always wins; see [the publish README](../../../scripts/publish/README.md).

| File | Field | What |
| --- | --- | --- |
| `composer-icon-light.png` | `composerIcon` | 128 × 128, transparent, the dragon's head on light surfaces |
| `composer-icon-dark.png` | `composerIconDark` | 128 × 128, transparent, the dragon's head on dark surfaces |
| `logo-light.png` | `logo` | 512 × 512, the full mark on a light solid tile |
| `logo-dark.png` | `logoDark` | 512 × 512, the full mark on a dark solid tile |

The composer icon is the head crop of the mark, because a host draws it small (32 px and below) on
its own surface, so it is transparent. The logo is the full mark on a solid tile, for 48 px and
larger, because a listing places it on a surface the package does not control.

## Provenance

These are the second edition of the SAGA A2UI dragon artwork, selected by the operator on 30 October
2026 and adopted here unchanged: the four files are the supplied 128 px head and 512 px tile
renditions, byte for byte, with no redrawing, resizing or recolouring in this repository. Each
file's role follows the edition's own guidance, head crops for rendered sizes up to 32 px and the
full mark from 48 px. The four files here carry these SHA-256 digests:

| File | SHA-256 |
| --- | --- |
| `composer-icon-light.png` | `59b21877707e9f3ae59c47ea5a00bed4938a0c7a99903a555155f06b6ae61a2d` |
| `composer-icon-dark.png` | `87f6878befdebe02ef954dbd2c92a47c0a84f803033ae0da279f031d93ea7013` |
| `logo-light.png` | `66f444d50e29b7317bbf0a0743fa08630239e7f2e17f022d25dc042e01c7e95c` |
| `logo-dark.png` | `3dab20a89fd8318abab9b83ab6490162ab5ccc4d0157a37d2af3afbd4e59c07c` |

`scripts/publish/publish.test.ts` checks these digests, so a replacement is a deliberate change to
this table and the test together. The files use Git LFS (`*.png` in `.gitattributes`); a checkout
that skipped LFS downloads needs `git lfs pull --include='assets/brand/plugin/*.png'` before a
default-branded package can be prepared.

These files replace the first edition (digests recorded in the repository history), which is
superseded. Packages and releases prepared from the first edition carry that artwork until a new
package is prepared and qualified. The files are source artwork; whether a host renders an
installed App with them is a separate matter that package validation does not establish.
