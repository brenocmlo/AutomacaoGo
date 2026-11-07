# Button

A compact action button: solid for the decision, outline for the alternatives.

Source: `botao` in `src/components/acoes-titulo.tsx`; the large variant from the login form and the empty state.

- **Small (default)**: `label` type, `radius-md`, padding `space-1-5` × `space-3`. **Large**: 14px, padding `space-2` × `space-4` — the one primary action on a screen (Entrar, Iniciar simulação, Filtrar).
- **Variants**: `primary` (`accent` fill), `approve` (`ok` fill — only for Aprovar), `danger` (`danger` fill — confirming a refusal), `outline` (1px `border`, hover `surface-2`). Text on solids is `on-solid`.
- One solid button per group; alternatives are outline.
- Refusing or overriding opens an inline form asking for a reason (`Motivo da recusa`, `Justificativa (obrigatória)`) before Confirmar.
- Pending: disable (50% opacity) and change the label ("Entrando…").
- Dark theme: white on the dark solids fails contrast — see README, Known gaps.
