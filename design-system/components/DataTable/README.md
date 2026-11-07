# DataTable

The audit queue table: dense rows of badges, mono IDs and right-aligned tabular amounts.

Source: `src/app/(painel)/auditoria/page.tsx`.

- Sits in a Card with hidden overflow, wrapped in a horizontal scroller.
- Header: a `surface-2` band, `caption` in `muted`, weight 500. Cells: `space-2` × `space-3`; rows divided by `border`; hover `surface-2`; the selected row `accent-soft`.
- Columns: urgency badge, title ID in mono `id`, supplier (truncated), amount right-aligned and tabular, lot code in `muted`, rule-group badges (neutral; the tooltip lists the codes), destination badge.
- Cap the rows (200) and say so in a muted footer; an empty result is one centered muted line: "Nenhum título com esses filtros."
- Selecting a row opens the detail panel beside the table from `xl` up.
