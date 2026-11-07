# Field

Text inputs, search boxes and selects, recessed into the `bg` color with a `border` hairline.

Source: `src/app/(auth)/login/formulario.tsx`, and the filter bar and `Select` in `src/app/(painel)/auditoria/page.tsx`.

- **Labeled input**: `muted` label above; input `radius-md`, `space-2` × `space-3`, 14px; the border turns `accent` on focus.
- **Search**: a `muted` icon plus a borderless input inside a bordered `bg` box.
- **Select**: native `<select>`, same border and fill, `space-1-5` × `space-2`. The empty option names the unfiltered state ("Todos os destinos", "Qualquer urgência").
- **Error**: `danger` text under the form, a plain sentence.
- Required reasons for overrides are inputs with the requirement in the placeholder: "Justificativa (obrigatória)".
- Gap: no focus ring beyond the border color — add one (README, Known gaps).
