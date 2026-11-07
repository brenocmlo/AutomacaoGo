# DestinationBar

A single stacked bar showing how the open batches' value splits across destinations, with a linked legend.

Source: `src/app/(painel)/page.tsx`.

- Track: 12px tall, `radius-full`, `surface-2`; each segment in its destination's solid tone (neutral uses `muted`), width proportional to value, `title` = the destination label.
- Fixed order: Liberado automático, Conferido, Aguardando aprovação, Retirado, Aprovado, Devolvido, Recusado.
- Legend: a tone Badge with the count, the label, and the compact amount in `muted`; each entry links to the queue filtered by that destination. Hide entries with no titles.
