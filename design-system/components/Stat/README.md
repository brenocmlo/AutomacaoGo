# Stat

A KPI tile: a label, one big tabular figure and a muted detail line.

Source: `Stat` in `src/components/ui.tsx`.

- **Props**: `rotulo` (label), `valor`, optional `detalhe`, optional `tom` (`ok | warn | danger | info`), which colors only the value.
- Type: `label` → `stat-value` → `caption`, inside a padded Card.
- Two-up on mobile, four-up from `lg`, gap `space-3`.
- Money uses compact `brl(v, true)` ("R$ 1,8 mi"). Leave `tom` empty for counts that carry no judgement.
