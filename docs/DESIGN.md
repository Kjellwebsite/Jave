# JAVELIN Design System

`@jave/ui` is the design system for every JAVE surface (dashboard, public profiles, the Discord Activity).
This document defines how things look and read. The source of truth for values is
`packages/ui/src/tokens.ts`, mirrored into Tailwind v4 in `packages/ui/src/styles.css`;
`tokens.test.ts` fails the build if they drift or if any text colour drops below WCAG AA.

Screenshots of the current build: [`docs/screenshots/`](./screenshots).

## 1. Principles

**Precision · aerospace · engineering · chrome · aluminium · intelligence · minimalism.**
Premium hardware and a technical instrument, not a game and not a template.

1. **Near-monochrome.** Six materials — Chrome `#E8EAED`, Aluminium `#B8BDC3`, Steel `#737981`,
   Graphite `#181A1D`, Black `#08090A`, White `#FFFFFF`. Colour is reserved for status and for two
   role accents (TRIAL `#9FB4C7`, SUPPORTER `#C9B98F`).
2. **Depth without glow.** Hairline borders, a 1px machined top edge, short dark shadows. No neon,
   no bloom, no purple, no gradient backgrounds.
3. **Large negative space.** Content breathes; density is earned by data tables, never by layout.
4. **Descriptive, never a score.** Capability is VERIFIED, CLAIMED or UNKNOWN — per facet. There is
   no global number for a person, and the UI never implies one.
5. **Calm authority.** Refusals, errors and empty screens are quiet, exact and actionable.

## 2. Colour tokens

Components use **semantic** tokens only (`bg-surface`, `text-fg-muted`, `border-line`), never hex.
Dark is the primary theme; light (`data-theme="light"`) is a faithful inversion.

| Role       | Token                                                               | Dark                              | Use                                              |
| ---------- | ------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| Canvas     | `canvas`                                                            | `#08090A`                         | Page background                                  |
| Surface    | `surface` / `surface-raised` / `surface-sunken` / `surface-overlay` | `#0E0F11` …                       | Cards, hover rows, inputs, menus                 |
| Lines      | `line-subtle` / `line` / `line-strong`                              | `#16181B` / `#202328` / `#2C3035` | Dividers, card borders, control borders          |
| Text       | `fg` / `fg-muted` / `fg-subtle`                                     | `#E8EAED` / `#B8BDC3` / `#8B9097` | Primary, secondary, tertiary text — all ≥ 4.5:1  |
| Decoration | `fg-faint`                                                          | `#5E636A`                         | Icons and disabled only — **never** legible text |
| Action     | `action` / `action-fg`                                              | chrome / black                    | Primary button, checked controls                 |
| Status     | `success` `warning` `danger` `info`                                 | desaturated                       | Status only, at 8% fills with 35% borders        |

Status colours are desaturated but pass AA on every surface (asserted in tests).

## 3. Typography

| Style          | Family     | Size     | Notes                                                            |
| -------------- | ---------- | -------- | ---------------------------------------------------------------- |
| `type-display` | Orbitron   | 40       | Uppercase, 0.14em tracking. Wordmark-scale identity moments.     |
| `type-title`   | Orbitron   | 22       | Uppercase, 0.16em. Page titles (`PageHeader`). One or two words. |
| `type-numeral` | Orbitron   | 30       | Large counts (`Stat`), tabular.                                  |
| `type-heading` | Geist      | 15 / 600 | Panel and section headings, member names.                        |
| `text-body`    | Geist      | 14       | All interface and body text.                                     |
| `text-small`   | Geist      | 13       | Descriptions, hints, meta.                                       |
| `type-eyebrow` | Geist Mono | 11 / 500 | Uppercase labels, column headers, badges. 0.08em.                |
| `type-data`    | Geist Mono | inherit  | IDs, timestamps, codes, counts in tables. Tabular.               |

- **Orbitron is for identity only**: wordmark, uppercase page titles, rank letters, large numerals,
  the name on a JVLN PROFILE. Never paragraphs, never buttons, never table cells.
- Fonts are self-hosted (`@fontsource-variable/*`), bundled by the app. No runtime Google Fonts.
- Timestamps are `YYYY-MM-DD HH:mm` in the viewer's time zone, in Geist Mono.

## 4. Space, shape, depth, motion

- **Spacing:** 4px base (Tailwind's scale: `p-1` = 4px). Common rhythm: 12 / 16 / 20 / 24 / 32 / 40.
  Page gutters 16 → 24 → 40px; sections 32–40px apart.
- **One radius system:** `sm` 3px (badges, plates), `md` 5px (controls, buttons), `lg` 8px (cards,
  dialogs, menus), `full` (switches, dots). Nothing else.
- **Hairlines:** always 1px. `line-subtle` between rows, `line` around cards, `line-strong` around controls.
- **Shadows:** `shadow-sm` for raised cards (with `machined` top edge), `shadow-lg` only for
  floating layers (menus, dialogs, toasts). No coloured shadows, no glow.
- **Materials:** `machined` (1px top highlight), `chrome-plate` (brushed chrome fill: primary button,
  VERIFIED ranks), `blueprint-grid` and `corner-ticks` (identity surfaces only: sign-in, public profile),
  `scroll-fade-x` (trailing-edge fade on horizontal rails, so a clipped tab reads as "more").
- **Motion:** 120–260ms, `cubic-bezier(0.2, 0, 0, 1)`. Fades and 4px rises only. Everything respects
  `prefers-reduced-motion`.
- **Z-index:** sticky 10 · sidebar 20 · header 30 · overlay 50 · modal 60 · popover 70 · toast 80 · tooltip 90.

## 5. Icons

lucide-react through `<Icon>` only: stroke **1.5**, sizes **14 / 16 / 20** (`sm` / `md` / `lg`).
Decorative by default (`aria-hidden`); pass `label` when the icon carries meaning. Icon-only
controls use `IconButton`, which requires an accessible `label` (also shown as a tooltip).

## 6. Components

Everything below is exported from `@jave/ui`.

**Buttons.** `primary` (chrome plate) — one per view, the main commitment. `secondary` — ordinary
actions. `ghost` — low-emphasis and toolbars. `danger` — destructive, always behind confirmation.
Labels say what happens ("Grant role", "Save branding"), never "OK" / "Submit". `loading` shows a
spinner, disables the button and sets `aria-busy`.

**Cards & panels.** `Card` for grouping; `Panel` for a titled card with a hairline header strip and an
optional `flush` body for edge-to-edge lists and tables. Don't nest cards.

**Modals.** `Dialog` for focused tasks; `ConfirmDialog` / the dashboard's `ConfirmActionDialog` for
consequential actions (role changes, rank verification). Title states the action, description states
the consequence, Cancel is always available and safe. Errors stay inside the dialog; success closes it
and announces the result with a toast.

**Tables.** `Table` scrolls inside its container so the page never scrolls sideways. Header cells are
eyebrows. Use `dense` for logs. On phones, hide secondary columns and fold key facts under the
primary cell. Empty results use `TableEmptyRow` with a way out ("Clear filters").

**Badges.** `Badge` for categories; `StatusBadge` for state — use `quiet` for the expected state
(SUCCESS, IN GUILD, GOOD) so exceptions (DENIED, DEPARTED, RESTRICTED) stand out.

**Forms.** Every control is wrapped in `Field` (label, description, error, all wired with
`aria-describedby`). Use `NativeSelect` in plain forms (it works before hydration); `Select` for rich
client pickers. Settings rows are two-column (label left, control right) on desktop.

**Readouts.** `Stat` tiles and stat strips are instruments: eyebrow label, Orbitron numeral. A zero
reads in `fg-subtle` so the non-zero facts carry the eye. Grids of tiles never end on a lone tile —
choose the column count from the tile count (the overview and the member stat strip show how).

**Navigation.** Sidebar groups: OVERVIEW · PEOPLE · OPERATIONS · SUPPORT & SAFETY · INTELLIGENCE ·
SYSTEM. The active item has a raised surface and a 2px chrome rail. `LinkTabs` for URL-driven tabs;
below `md` they become a swipeable rail with `scroll-fade-x`, as do the settings and ranking section
lists below `lg`. Every rail ends with `RailActiveIntoView`, which scrolls the rail (never the page)
so the current item is on screen.

## 7. States

| State      | Component                                                      | Rule                                                                                          |
| ---------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Loading    | `Skeleton`, `LoadingState`, route `loading.tsx`                | Shaped like the content it replaces. Announced once.                                          |
| Empty      | `EmptyState`                                                   | Uppercase eyebrow title, one sentence, and the next step when there is one.                   |
| Error      | `ErrorState`                                                   | Never shows internals. Always shows the reference (`E-XXXXXXXX`) that matches the server log. |
| Restricted | `RestrictedState`                                              | "ACCESS RESTRICTED", the capability required, a way back. Never an error.                     |
| Success    | `Callout tone="success"` inline, or a toast for dialog actions | Past tense, specific: "ROLE GRANTED — SUPPORTER — Jun Park."                                  |

## 8. Roles

Code checks capabilities, never role names; the visual language mirrors `packages/core` roles
(`treatment`), asserted by the dashboard test suite.

| Role       | Treatment   | Material                                      |
| ---------- | ----------- | --------------------------------------------- |
| FOUNDER    | holographic | Angled chrome sheen — metallic, never rainbow |
| CORE       | silver      | White → silver gradient                       |
| OPERATIONS | metallic    | Aluminium gradient                            |
| MODERATOR  | steel       | Dark steel                                    |
| VERIFIED   | white       | White outline                                 |
| TRIAL      | accent      | Restrained blue-grey `#9FB4C7`                |
| APPLICANT  | muted       | Grey outline                                  |
| MEMBER     | neutral     | Neutral grey                                  |
| SUPPORTER  | special     | Warm accent `#C9B98F` (cosmetic)              |

`RoleBadge` renders the role in Geist Mono uppercase. A VERIFIED member (the role or any staff role)
also carries the chrome `VERIFIED` mark; don't repeat the VERIFIED role badge next to it.

## 9. Ranks

Ranks F · E · D · C · B · A · S are identity moments, set in Orbitron on square plates (`RankBadge`).
The three epistemic states must be unmistakable at a glance and in a screen reader:

| Status   | Plate                                       | Label              | Screen reader                   |
| -------- | ------------------------------------------- | ------------------ | ------------------------------- |
| VERIFIED | Solid brushed chrome, dark letter           | none (or `always`) | "Rank A, verified"              |
| CLAIMED  | Transparent, **dashed** outline, dim letter | `CLAIMED`          | "Rank A, claimed, not verified" |
| UNKNOWN  | Hairline outline with `—`                   | `UNKNOWN`          | "Rank unknown"                  |

- A domain's rank is its **peak facet** rank. Never sum, average or rank people across domains.
- Boards (`/ranking`) list VERIFIED ranks only, one facet at a time.
- When both exist and differ, show the verified plate with a quiet "claimed B" beside it.
- UNKNOWN is not low. Say so where it matters.

## 10. Copy

Concise, precise, calm, slightly futuristic. Never cringe, no emoji, no exclamation marks.

- Headlines and results in uppercase eyebrow style: `ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped.`
- Explain consequences, not mechanics: "Their access changes immediately."
- Refusals are facts, not blame: "ACCESS RESTRICTED — requires canViewAuditLogs."
- Errors: what happened, what to do, the reference. Never a stack trace, never a SQL message.
- Capability language: _verified_, _claimed_, _demonstrated_, _evidence_. Never "score", "XP", "level up".

## 11. Do / Don't

| Do                                                                       | Don't                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Use semantic tokens and the type roles                                   | Hard-code hex values or ad-hoc font sizes                         |
| Keep one primary action per view                                         | Stack several chrome buttons side by side                         |
| Show CLAIMED and UNKNOWN explicitly                                      | Hide the status of a rank, or blend claims into a verified number |
| Hide controls the actor cannot use, and show ACCESS RESTRICTED for pages | Show disabled buttons that always fail, or crash on 403           |
| Use Orbitron for identity moments                                        | Set paragraphs, buttons or tables in Orbitron                     |
| Keep glow and gradients to the chrome materials                          | Add neon, bloom, purple or decorative gradients                   |
| Test at 390px — no horizontal page scroll                                | Let tables or chip rows widen the page                            |

## 12. Extending the dashboard

- **Add a page:** create `apps/dashboard/app/(console)/<page>/page.tsx` (call `requireConsoleContext()`
  first), a `loading.tsx`, and add **one line** to its group in `apps/dashboard/lib/nav.ts` with the
  capability that gates it. Load data through core services wrapped in `guarded()` so a
  `ForbiddenError` renders ACCESS RESTRICTED.
- **Add a mutation:** a `'use server'` function that calls `runAction()` (same-origin check, live
  session, error references) and then a core service — authorization lives in the service.
- **Consequential action:** `ConfirmActionDialog` with a required reason field.
- **New visual pattern:** add it to `@jave/ui` with tokens, then document it here.
