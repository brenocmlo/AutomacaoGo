# GoAudit

Auditoria de pagamentos antes de o dinheiro sair.

GoAudit is an internal finance tool: it checks every title in an open payment batch against ERP, purchasing, NF-e, DDA and bank statements, and decides whether money may leave. The interface is a quiet, dense operations console — neutral greys, one blue, and four status tones that always mean the same thing. This system is extracted from the Next.js app (`src/app/globals.css`, `src/components/ui.tsx` and the panel pages), with its colors re-anchored on the **Gogroup brandbook**: brand blue is the accent, #333333 is the ink, #f5f5f5 is the ground, and the full palette is available for color blocking.

## Voice and content

- **Portuguese (pt-BR), plain and specific.** Labels say what happened to the money: "Retirado do lote", "Aguardando aprovação", "Liberado automático". No marketing tone, no exclamation marks, no emoji.
- **Sentence case** everywhere, except the uppercase `overline` section labels in the detail panel and the `micro` "em breve" tag.
- **Numbers are first-class.** Currency through `brl()` — `R$ 48.392,10`, or compact `R$ 1,8 mi` / `R$ 320 mil` in stats. Dates as `ter, 03/11 08:00`; durations as `2h 05min` or `1d 4h`. Every number uses tabular figures (`.tabular`) so columns line up.
- **Explain, don't decorate.** Empty states say why there's nothing and what to do ("Nenhum título com esses filtros." / "Peça à administração da simulação para iniciar."). Tooltips (`title`) carry the longer reason behind a badge.
- Missing value: an em dash `—`.

## Color

### Gogroup palette

Official, from the brandbook ("respeite a paleta, não a altere"). Use the exact values.

| Token | Hex | On it | Role |
| --- | --- | --- | --- |
| `brand-blue` | #2659a5 | white (6.9:1) | **The protagonist** — always present. The interface's `accent` in light. |
| `brand-lime` | #d7d900 | #333333 (8.3:1) | Blocks, charts |
| `brand-amber` | #f8ae13 | #333333 (6.7:1) | Blocks, charts |
| `brand-sky` | #3dbfef | #333333 (6.0:1) | Blocks, charts |
| `brand-pink` | #e61782 | white, large text only (4.4:1) | Blocks |
| `brand-red` | #e5273c | white (4.5:1) | Blocks, large fills |
| `brand-orange` | #e5381a | white, large text only (4.3:1) | Blocks |
| `brand-white` | #ffffff | — | Ground, logo on color |

Brandbook contrast rules, applied here: **never white on lime or sky**, and never put orange, red and pink next to each other (they vibrate). The brand's style is minimalism plus **color blocking** — big flat fields, no shadows, no effects. In the product, that belongs to covers, empty states, onboarding and charts. Data screens stay neutral, so the status tones keep their meaning.

### Interface colors

One action hue, `accent` (= `brand-blue` #2659a5 in light; #6b9bff in dark, where brand blue would be 2.6:1), on a neutral ground (`bg` #f5f5f5, ink `text` #333333). Everything else is a **status tone**, and each tone comes as a pair: a solid (`ok`, `warn`, `danger`, `info`) for text, icons and figures, and a `-soft` fill for badge and panel backgrounds. The neutral tone is `neutral-soft` + `muted`.

| Tone | Means | Examples |
| --- | --- | --- |
| `ok` | Money may go / went right | Liberado automático, Aprovado, Devolvido ao lote, Montante protegido |
| `info` | Checked, waiting on a person by routine | Conferido, aguarda aprovador; severity Aprovação |
| `warn` | A human must decide | Aguardando aprovação, urgency Hoje, Montante em risco |
| `danger` | Money must not leave | Retirado do lote, Recusado, urgency Imediata, severity Crítica |
| `neutral` | Status without judgement | Enviado ao banco, urgency Normal/Fechado, rule codes |

Rules:
- Surfaces stack `bg` → `surface` (cards) → `surface-2` (hover, table header, chips). Separate with a 1px `border`, never shadows — the source uses none.
- Text is `text` or `muted`; don't make up greys.
- Never use a tone for decoration. If something isn't a status, it's neutral or accent.
- Tones are told apart by label as well as hue: a badge always carries its word, never color alone.
- `info` currently shares accent's value. Keep them separate tokens so they can diverge.
- Status *text* colors (`ok`, `warn`, `danger`) are not the brand hues: brand red, lime and amber fail 4.5:1 as 12px text on their tints. Use brand hues for fills and blocks, and status tokens for words.

Dark theme follows the OS (`prefers-color-scheme: dark`); the app has no manual toggle.

## Typography

**Geist** for interface text and **Geist Mono** for identifiers, both loaded from Google Fonts via `next/font` (no font files in the repo). (The Gogroup brand face is **Poppins** — bold, geometric. It is not used in the app yet; consider it for display moments such as covers or marketing pages. Keep Geist for dense UI.) The scale is Tailwind's: 20 / 18 / 16 / 14 / 12 / 10px. 14px `body` is the default; 12px `caption`/`label` carries most secondary information. Weights are 400, 500 and 600 only — no bold.

- Page = `page-title` + one `body` line in `muted`.
- Card title bar = `card-title`.
- KPIs = `stat-value`, amounts = `amount`, both tabular.
- IDs (`TP004812`, lot codes) = mono `id`; evidence chips = mono `evidence`.

## Space, shape, layout

A 4px grid (`space-1` … `space-6`). Cards pad `space-4`; table cells `space-2` × `space-3`; sections stack `space-6` apart. Radii grow with the container: `radius-md` for controls and badges, `radius-lg` for nav items and inner panels, `radius-xl` for cards.

The shell is a 224px sticky sidebar (logo, nav, user block at the bottom) beside a sticky header bar (simulated clock, clock controls, environment badges) and a `max-w-7xl` content column. The audit queue splits into table + detail panel side by side from `xl`.

## Iconography

[Lucide](https://lucide.dev) (`lucide-react` 1.70), 2px stroke, round caps, `currentColor`. Sizes: 16px (`size-4`) in nav and inline, 12–14px inside small buttons and captions, 20–24px for the logo mark and lot tiles, 40px for empty states. Icons take the color of their meaning (`text-accent` for the logo, `text-danger` for a failed rule, `text-muted` for decoration). See the Icons asset group.

**Logo**: there is no drawn logo — the brand is Lucide's `ShieldCheck` in `accent` beside the word "GoAudit" in `wordmark`. See the Logos asset group.

## Components

Badge, Button, Card, Stat, Field, NavLink, DataTable, LotCard and DestinationBar. The app has no component library build; components here are static HTML renditions styled by `components/bundle.css`, hand-written from the Tailwind classes in the source files each README names.

## Known gaps (kept from the source, flagged)

- **White on dark-theme solids fails contrast**: `on-solid` on dark `accent` is 2.6:1, on dark `ok` 2.0:1, on dark `danger` 2.4:1. Light theme passes (5.2, 5.1, 5.6:1). Fix by giving dark buttons dark text (e.g. `bg`) or darker solids.
- **No visible focus ring**: inputs only change border to `accent` on focus (`outline-none`), and buttons/links rely on the browser default. Add a 2px `accent` ring.
- Disabled is expressed only as reduced opacity (50–60%).

## Not synced

- Fonts: Geist and Geist Mono are hosted (Google Fonts), so no font files were copied.
- The Gogroup logo from the brandbook was not imported; GoAudit uses its own shield mark.
- Not built as live components: the app is a Next.js app, not a library, so there is no bundle; previews are static.
- Page-level compositions (login card, decision panel, systems comparison grid) are described in components rather than carded on their own.
