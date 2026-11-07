'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';

/**
 * Botão de formulário que mostra "trabalhando" enquanto a ação do servidor roda e impede o segundo
 * clique. Importa na demo: "Nova simulação" e "+24h" levam alguns segundos (ou um minuto na primeira
 * leitura por IA) e sem aviso a plateia vê a tela parada.
 */
export function BotaoPendente({
  icone, children, pendente, className = '', title, disabled,
}: { icone: ReactNode; children: ReactNode; pendente?: ReactNode; className?: string; title?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} title={title} aria-busy={pending} className={`${className} disabled:opacity-50`}>
      {pending ? <Loader2 className="size-3 animate-spin" /> : icone}
      {pending ? (pendente ?? children) : children}
    </button>
  );
}
