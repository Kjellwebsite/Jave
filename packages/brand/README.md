# @jave/brand — JAVELIN brand kit

Precision, aerospace, engineering. Chrome and brushed aluminium on graphite.
Everything here is generated from one fixed emblem geometry
(`src/emblem.ts`) and one typeface (Orbitron), by a deterministic pipeline.

```
src/emblem.ts          fixed emblem geometry — do not redesign
src/colors.ts          palette and the metal tones derived from it
src/manifest.ts        typed inventory of every asset + where each one goes
src/svg/*              SVG builders (pure functions)
scripts/render.ts      writes assets/svg + assets/png
scripts/contact-sheet.ts  visual review sheets → preview/ (git-ignored)
fonts/                 Orbitron 600 (SIL OFL 1.1, see fonts/OFL.txt)
```

## Palette

| Name      | Hex       | Use                             |
| --------- | --------- | ------------------------------- |
| Chrome    | `#E8EAED` | Lit metal, wordmark on dark     |
| Aluminium | `#B8BDC3` | Brushed surfaces, motto         |
| Steel     | `#737981` | Shaded facets, divider edges    |
| Graphite  | `#181A1D` | Dark fields, wordmark on light  |
| Black     | `#08090A` | Shadows only                    |
| White     | `#FFFFFF` | Specular highlights, lit facets |
| Trial     | `#9FB4C7` | TRIAL role mark only            |
| Supporter | `#C9B98F` | SUPPORTER role mark only        |

`METAL_TONES` holds the intermediate tones used to render metal (steps on the
aluminium, steel and graphite ramps, two faint founder tints, and light/deep
steps of each accent). A test audits every SVG: each `fill`, `stroke`,
`stop-color`, `flood-color` and `color` must be a palette or metal-tone
`#RRGGBB`, `none`, `currentColor` or a local `url(#id)`; named colours, short
hex, `rgb()`/`hsl()`, inline CSS, unknown elements, tinting colour matrices
and raw (coloured) turbulence noise all fail it.
No neon, no purple, no glow.

## Inventory

All sources are in `assets/svg`, renders in `assets/png`.

| Asset                      | Files                                                                              | Goes to                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Emblem (two-tone metal)    | `emblem.svg`, `emblem-512.png`                                                     | Dark surfaces, UI                                                                      |
| Emblem for light surfaces  | `emblem-on-light.svg`, `emblem-on-light-512.png`                                   | Light surfaces, print                                                                  |
| Emblem, monochrome         | `emblem-mono.svg` (`currentColor`)                                                 | Masks, one-colour use, inline UI                                                       |
| **Server icon** (flagship) | `server-icon.svg`, `server-icon-{1024,512,256,128}.png`                            | Discord → Server Settings → Overview → Icon: upload the **1024**                       |
| Bot avatar                 | `bot-avatar.svg`, `bot-avatar-{1024,512}.png`                                      | Discord Developer Portal → Bot → Icon (and App Icon): upload the **1024**              |
| Server banner              | `server-banner.svg`, `server-banner-960x540.png`                                   | Discord → Server Settings → Overview → Banner (Boost level 2)                          |
| Invite splash              | `invite-splash.svg`, `invite-splash-1920x1080.png`                                 | Discord → Server Settings → Overview → Invite Background (Boost level 1)               |
| Role icons                 | `role-{founder,core,operations,moderator,verified,trial,supporter}.svg`, `-64.png` | Discord → Server Settings → Roles → Role Icon (Boost level 2): upload the **64px PNG** |
| Favicon                    | `favicon.svg`, `favicon-32.png`, `favicon-16.png`                                  | Dashboard and Activity `<link rel="icon">`                                             |
| Touch icon                 | `apple-touch-icon.svg`, `apple-touch-icon-180.png`                                 | Dashboard `<link rel="apple-touch-icon">` (full-bleed; iOS masks it)                   |
| Open Graph image           | `og-image.svg`, `og-image-1200x630.png`                                            | Dashboard and public profiles: `og:image`, `twitter:image`                             |
| Wordmark                   | `wordmark.svg`, `wordmark-on-light.svg`, `wordmark-mono.svg`                       | Headers, documents                                                                     |
| Horizontal lockup          | `lockup.svg`, `lockup-on-light.svg`                                                | Headers, email, slides                                                                 |
| Stacked lockup             | `lockup-stacked.svg`, `lockup-stacked-on-light.svg`                                | Square spaces, covers                                                                  |

Role marks: FOUNDER — the full emblem, holographic chrome over black chrome ·
CORE — the spear as a spearhead, silver · OPERATIONS — a delta wing, metallic ·
MODERATOR — a dark steel shield with the spear inlaid · VERIFIED — a machined
check, white and silver · TRIAL — a diamond, one facet solid and one still open ·
SUPPORTER — a four-point star in the supporter accent.

### Using assets from code

```ts
import { BRAND_TARGETS, BRAND_COLORS, brandAssetModuleId } from '@jave/brand';

BRAND_TARGETS.discord.serverIcon; // 'assets/png/server-icon-1024.png' (relative to packages/brand)
brandAssetModuleId(BRAND_TARGETS.web.ogImage); // '@jave/brand/assets/png/og-image-1200x630.png'
```

The package exports `./assets/*`, so bundlers can import files directly
(`import og from '@jave/brand/assets/png/og-image-1200x630.png'`). For
Next.js `public/`, copy `favicon.svg`, `favicon-32.png`, `favicon-16.png`,
`apple-touch-icon-180.png` and `og-image-1200x630.png`, then:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" />
<meta property="og:image" content="https://<public-url>/og-image-1200x630.png" />
```

## Usage rules

**Clear space.** Keep empty space around the emblem of at least ¼ of its
height; around a lockup, at least the wordmark's cap height on every side.
Nothing — text, edges, other marks — enters that space.

**Minimum sizes.**

| Mark                              | Minimum                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| Emblem, two-tone                  | 24 px tall. Below that use the favicon (tile) or `emblem-mono`.           |
| Emblem on a tile (favicon, icons) | 16 px (server icon and bot avatar: contrast tested at 16 and 32 px)       |
| Wordmark                          | 80 px wide (cap height ≥ 9 px)                                            |
| Horizontal lockup                 | 140 px wide                                                               |
| Motto                             | cap height ≥ 8 device px in every context the asset is sized for (tested) |

The motto contexts are: the invite splash in the smallest supported window on
a 1× screen (8 px); the Open Graph image in a 400 px Discord embed on a 1×
screen (8 px); the server banner in Discord's 240 px desktop sidebar on a 2×
screen (9 device px) and in the ≈320 pt mobile channel list on a 3× phone
(18 device px). **Known gap:** in the desktop sidebar on a standard-density
(1×) screen the banner motto is 4.5 px tall — too small to read; there the
lockup carries the banner. The motto stays on the banner because it is part of
the banner's brief. In any new layout, leave the motto out rather than set it
below the minimum.

**Do**

- Use the dark variants on graphite/black and the `-on-light` variants on white or chrome.
- Scale proportionally, from the SVG sources.
- Keep the emblem upright and symmetric; light always comes from the upper left (lit left facets, shaded right facets).
- Set the motto in capitals exactly as `BRAND_MOTTO`: `YOU THINK YOU’RE ELITE? PROVE IT.`

**Don't**

- Redraw, rotate, skew, outline or re-proportion the emblem, or re-space the wordmark.
- Add glow, neon, bevel effects, gradients of your own, or any colour outside the palette.
- Put the metallic emblem on busy photography or on mid-grey where neither variant has contrast.
- Retype the wordmark in a live font; use the outlined SVGs.
- Use role marks as general decoration; each belongs to its role.

## Discord notes

- Discord shows server icons and avatars as **circles** (48 px in the server
  list). The plate's corners stay inside the crop circle and the emblem stays
  within 72% of its radius; a test renders the icons and checks this.
- Discord scales the invite splash to cover the window (CSS `cover`: centred,
  overflow cropped) and centres a ≈480 px invite card over it. The brand block
  sits in the region that stays visible and clear of the card on every
  supported window — 16:9 down to 1280×720, 16:10, 4:3, tablet landscape and
  21:9 (`INVITE_SPLASH_VIEWPORTS`; tested per window). A faint watermark
  balances the right. Portrait phones are out of scope: the card covers the
  middle of any splash there.
- The banner's top band (192 of 540 px) is where Discord draws the server
  name, so the lockup, divider and motto sit centred in the band below it
  (tested).
- The icons are built for small sizes: at 16 and 32 px, every pixel that the
  lit or the shaded half of the emblem dominates stays at least 30 luma levels
  away from the bare plate (tested for the server icon and the bot avatar).
  The server icon gets there with a mid-silver face, a shallow shaded well
  behind the emblem, chrome that falls to graphite on its shaded side, and a
  relief shadow cast down and to the right.

## Re-rendering

```sh
pnpm --filter @jave/brand render                    # everything
pnpm --filter @jave/brand render server-icon og-image   # selected assets
pnpm --filter @jave/brand preview                   # contact sheets → packages/brand/preview/
pnpm --filter @jave/brand preview server            # one sheet
```

- Rendering uses `@resvg/resvg-js` with system fonts disabled; all type is
  outlined from `fonts/Orbitron-600.ttf` with opentype.js at render time.
- Small outputs are rendered supersampled (up to 8×, targeting 2048 px) and
  reduced with an exact box filter in linear light; icon sizes derive from one
  master so they match exactly. PNGs are written by a small built-in encoder
  (RGB when opaque, RGBA otherwise), so identical sources give identical bytes.
- The committed PNGs must stay under 6 MB in total (the render script and the
  tests enforce it).
- Files are written through a temporary file and a rename, PNGs before their
  SVG, so an interrupted run leaves whole files and a stale SVG (which the
  tests catch), never a truncated asset.
- The tests rebuild every SVG and compare it with the committed file, and
  compare every committed PNG with a fresh render of its committed SVG
  (perceptually, reduced to ≈32 px, so it catches a stale PNG after a merge
  without depending on zlib bytes): after changing a builder, colour or layout,
  run `render` and commit the results.

```sh
cd packages/brand && npx vitest run --maxWorkers=2   # tests (project "brand")
pnpm --filter @jave/brand typecheck
```

## Licences

Orbitron is © 2018 The Orbitron Project Authors, licensed under the SIL Open
Font License 1.1 (`fonts/OFL.txt`). Only the unmodified font file is
distributed; assets contain outlines, not font software.
