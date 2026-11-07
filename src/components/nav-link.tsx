'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, icone, children, desabilitado }: { href: string; icone: ReactNode; children: ReactNode; desabilitado?: boolean }) {
  const path = usePathname();
  const ativo = href === '/' ? path === '/' : path.startsWith(href);
  if (desabilitado) {
    return (
      <span className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted opacity-60" title="Próxima etapa">
        {icone}
        {children}
        <span className="ml-auto text-[10px] uppercase tracking-wide">em breve</span>
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        ativo ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'
      }`}
    >
      {icone}
      {children}
    </Link>
  );
}
