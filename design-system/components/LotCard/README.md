# LotCard

A payment batch about to close: bank and lot, what is in it, and the time left.

Source: `src/app/(painel)/page.tsx` (próximos fechamentos).

- A Card with `space-4` padding and gap; a leading `landmark` icon in an `accent-soft` tile (`radius-lg`, `space-2-5`).
- Middle: `body-strong` "Banco · Lote", then a `caption` line in `muted`: closing time (`horaBR`), count, compact amount.
- Right: the countdown in `amount` type via `duracao()`, turning `danger` under 2 hours; "para o fechamento" in `caption`.
- Two-up from `sm`. With no open lot, a padded muted Card: "Nenhum lote aberto no período."
