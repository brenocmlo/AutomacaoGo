# NavLink

A sidebar navigation item: icon and label, highlighted when its route is active.

Source: `src/components/nav-link.tsx`; the shell in `src/app/(painel)/layout.tsx`.

- **Props**: `href`, `icone` (a 16px Lucide icon), children, `desabilitado`.
- **States**: rest `muted`; hover `surface-2` + `text`; active `accent-soft` fill, `accent` text, weight 500; disabled 60% opacity, not clickable, with an "em breve" `micro` tag and the tooltip "Próxima etapa".
- `radius-lg`, padding `space-2` × `space-3`, icon gap `space-2-5`; items stack `space-1` apart.
- The sidebar is 224px of `surface` with a right `border`: the brand (shield mark + `wordmark`) on top, the signed-in user's e-mail and role at the bottom in `caption`.
