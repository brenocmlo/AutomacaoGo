# Badge

A small tinted label that names a status — destination, urgency, severity, rule code or environment.

Source: `Badge` in `src/components/ui.tsx`.

- **Props**: `tom` — `ok | warn | danger | info | neutral` (default `neutral`); `title` for the tooltip; children = the label.
- **Style**: `label` type (12px/500), `radius-md`, padding `space-0-5` × `space-1-5`; background `<tone>-soft`, text `<tone>` (neutral: `neutral-soft` + `muted`).
- **Use the shared maps** so a status always gets the same word and tone: `DESTINOS`/`destinoUi()`, `URGENCIAS`, `SEVERIDADES`.
- Never color-only: the label must say the state. Put the longer reason in `title`.
- Rule codes (`R01`…`R14`) are neutral badges.
