# Brand

How to name saga a2ui, use its logo and present it. The files live in [`assets/brand/`](../assets/brand/).

## Names

- **saga a2ui** is the framework. Write it in lowercase, both words, everywhere: titles, prose, package metadata and the start of a sentence. Expand it once per page as **Safe AGentic Apps**.
- **Saga**, capitalized, is an app built with saga a2ui: "the podcast demo is a Saga", "build your Saga". A Saga is a Safe AGentic App.
- Don't call the framework "Saga", "SAGA", "Saga A2UI" or plain "saga". The bare word collides with Redux-Saga, the saga pattern and other products; "a2ui" keeps the framework findable.
- Package scopes, repository names and code identifiers keep their existing spelling (`@saga-a2ui/*`, `saga-a2ui`).

## The logo

The mark is the Wyrm: a small guardian dragon whose body is the letter `s`. In the sagas, dragons guard the hoard; this one guards what your app lets through. *Wyrm* is an old Germanic word for a dragon.

| File | Use |
| --- | --- |
| `saga-a2ui-lockup-on-night.svg` | The default logo on dark grounds: the Wyrm with the wordmark. |
| `saga-a2ui-lockup-on-paper.svg` | The default logo on white or light grounds. |
| `saga-a2ui-wordmark-on-night.svg`, `saga-a2ui-wordmark-on-paper.svg` | The name alone, where the Wyrm already appears nearby. |
| `wyrm-mark-on-night.svg`, `wyrm-mark-on-paper.svg` | The Wyrm alone, 20px and larger. |
| `wyrm-tile.svg` | The Wyrm on a dark square: the source of every app icon. |
| `icons/saga-a2ui-16.png`, `-32.png`, `-48.png`, `icons/favicon.ico` | Favicons. |
| `icons/saga-a2ui-180.png` | Apple touch (home-screen) icon. |
| `icons/saga-a2ui-512.png` | Organization avatars on GitHub and npm. |
| `readme-banner.svg` | The README header. |
| `social-preview.png` | The repository social preview and link cards (1280 × 640). |

- Every SVG is self-contained: no scripts, fonts or external references. The wordmark is outlined from [Fredoka](https://fonts.google.com/specimen/Fredoka) (SIL Open Font License 1.1); `saga` is SemiBold and `a2ui` Regular.
- Use the files rather than retyping the name or assembling the lockup. Keep clear space equal to the height of the `a` on every side, and the lockup at least 120px wide on screen.
- The mark has four parts: the `s`-shaped body tapering to a tail, a wedge-shaped head, one eye and three spines. Don't add or remove parts, mirror it, recolour it, outline it, or add shadows or gradients.
- Keep the Wyrm friendly. New poses for illustrations keep its four parts, proportions and green.
- Draw on Norse stories, never on Norse symbols: no runes and no valknut.

## Color

| Name | Value | Use |
| --- | --- | --- |
| Night | `#0b0e0c` | The home ground for banners, tiles and dark surfaces. |
| White | `#ffffff` | Type and the logo on Night. |
| Saga green | `#39ff88` | The Wyrm and `a2ui` on Night, and the left-edge light in the banner. Never text on a light ground. |
| Deep green | `#0e9f4f` | The Wyrm and `a2ui` on light grounds. |
| Green text on light | `#067a3c` | Links and green text on white (5.4:1). |

The banner's light is a radial gradient anchored at the left edge, fading from saga green at 90% opacity to transparent; keep type right of its brightest part.

## Type

Set headlines in Fredoka, text in [Nunito Sans](https://fonts.google.com/specimen/Nunito+Sans) and code in [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono). All three use the SIL Open Font License.

## Using the name and marks

- The saga a2ui name and marks belong to Machine Wisdom AI. The Apache-2.0 license covers the code, not the marks; its section 6 grants no trademark rights.
- No permission is needed to refer to saga a2ui by name, link to it, call your app a Saga, or show the unmodified logo when writing about saga a2ui or crediting it.
- Ask first before using modified marks, putting the Wyrm in your own product's name, logo or icon, making merchandise, or implying endorsement, partnership or certification. Open an issue to ask.
