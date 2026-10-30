# SAGA A2UI dragon: plugin branding

The default branding of a prepared ChatGPT plugin package (`saga publish prepare --target chatgpt`) when
the application supplies none. The mark is the SAGA A2UI **dragon**. An application's own
branding always wins; see [the publish README](../../../scripts/publish/README.md).

| File | Field | What |
| --- | --- | --- |
| `composer-icon-light.png` | `composerIcon` | 128 × 128, transparent, deep green `#0e9f4f` mark |
| `composer-icon-dark.png` | `composerIconDark` | 128 × 128, transparent, saga green `#39ff88` mark |
| `logo-light.png` | `logo` | 512 × 512, deep green mark on a white tile |
| `logo-dark.png` | `logoDark` | 512 × 512, saga green mark on a Night `#0b0e0c` tile |

The composer icon is transparent because the host draws it on its own surface, so each theme's
green is chosen for that surface: `#0e9f4f` is 3.45:1 on white and `#39ff88` is 14.6:1 on Night.
The logo is a solid tile because a listing places it on a surface the package does not control.

## Provenance

The geometry is the founder's dragon mark, supplied on 30 October 2026 and selected for these
defaults. The theme variants were produced from the supplied file unchanged in geometry: the
halo of near-transparent pixels is dropped, the mark is cropped, filled with the theme's green and
fitted to the square (88% for a transparent icon, 76% on a tile). The four files here are the 128 px
transparent and 512 px tile outputs of that process, with these SHA-256 digests:

| File | SHA-256 |
| --- | --- |
| `composer-icon-light.png` | `b4bad3c7c3ff6baec188c69ac60f622c03c81b12d5aa6a4c9a4ca8f27c136912` |
| `composer-icon-dark.png` | `7609a165f30649cb6a06d5711da4b9e57918671b07bf9fbc9ec8f9a227969cab` |
| `logo-light.png` | `622ac01fb4ef89a81f8e17671bc8f299aabb1fd9c00439939bccbcd4ef685a1c` |
| `logo-dark.png` | `1c5d3adb66e8661fde7e3c37633fb459cca7eb19c0d1c2058271cda2ba08ca8e` |

`scripts/publish/publish.test.ts` checks these digests, so a replacement is a deliberate change to
this table and the test together. The files use Git LFS (`*.png` in `.gitattributes`); a checkout
that skipped LFS downloads needs `git lfs pull --include='assets/brand/plugin/*.png'` before a
default-branded package can be prepared.

These files replace the first edition's `plugin-icon.svg`, which suited dark surfaces only. They
are source artwork; whether a host renders an installed App with them is a separate matter that
package validation does not establish.
