# Card

The base container: a `surface` panel with a 1px `border` and `radius-xl`, optionally topped by a title bar.

Source: `Card` and `CardTitulo` in `src/components/ui.tsx`.

- **Card**: `className` adds padding (`p-4` = `space-4`) or layout; never a shadow.
- **CardTitulo**: `card-title` h2 on the left, optional `extra` on the right (usually an accent link with an arrow), `space-3` × `space-4` padding, bottom `border`.
- Lists inside a card divide rows with `border` and highlight on hover with `surface-2`.
- Inner panels use `radius-lg` and either a `border` or a soft tone fill (decision panel: `warn-soft` when rules failed, `ok-soft` when none did).
