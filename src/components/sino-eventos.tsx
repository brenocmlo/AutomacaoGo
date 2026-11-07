'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell } from 'lucide-react';
import { horaBR } from '@/components/ui';
import type { EventoSino } from '@/lib/painel/eventos';

const CHAVE_VISTO = 'goaudit_sino_visto';
const TOM: Record<EventoSino['tom'], string> = {
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  neutral: 'bg-neutral-soft text-muted',
};
const ROTULO = { notificacao: 'Aviso', alerta: 'Alerta' } as const;

const EVENTO_VISTO = 'goaudit-sino-visto';
const assinar = (cb: () => void) => {
  window.addEventListener(EVENTO_VISTO, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENTO_VISTO, cb);
    window.removeEventListener('storage', cb);
  };
};
const lerVisto = () => {
  try {
    return localStorage.getItem(CHAVE_VISTO) ?? '';
  } catch {
    return '';
  }
};

/**
 * Sino de eventos. O servidor entrega os últimos avisos e alertas; o TempoReal já dá refresh quando o
 * banco muda, então chegar um evento novo troca estas props. Novo = gravado depois da última vez que
 * a pessoa abriu o sino (guardado no navegador). Evento novo com o sino fechado mostra um aviso curto
 * com o que foi; o rótulo do tipo vai junto, para a cor nunca ser o único sinal.
 */
export function SinoEventos({ eventos }: { eventos: EventoSino[] }) {
  const [aberto, setAberto] = useState(false);
  // null no servidor e na hidratação: o contador só aparece depois de ler o que o navegador guardou.
  const visto = useSyncExternalStore<string | null>(assinar, lerVisto, () => null);
  const [toast, setToast] = useState<EventoSino | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const jaMostrados = useRef<Set<string> | null>(null);

  const novos = visto === null ? [] : eventos.filter((e) => e.criadoEm > visto);

  // Aviso curto quando chega algo novo com o sino fechado (o que existia ao carregar a página não conta).
  useEffect(() => {
    if (jaMostrados.current === null) {
      jaMostrados.current = new Set(eventos.map((e) => e.chave));
      return;
    }
    const chegou = eventos.filter((e) => !jaMostrados.current!.has(e.chave));
    chegou.forEach((e) => jaMostrados.current!.add(e.chave));
    if (chegou.length && !aberto) {
      setToast(chegou[0]);
      const t = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(t);
    }
  }, [eventos, aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberto(false);
    };
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  function alternar() {
    setToast(null);
    const abrindo = !aberto;
    setAberto(abrindo);
    if (abrindo && eventos[0]) {
      try {
        localStorage.setItem(CHAVE_VISTO, eventos[0].criadoEm);
      } catch {
        /* sem armazenamento: o contador só volta ao recarregar */
      }
      window.dispatchEvent(new Event(EVENTO_VISTO));
    }
  }

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        onClick={alternar}
        aria-label={novos.length ? `${novos.length} eventos novos` : 'Eventos'}
        aria-expanded={aberto}
        className="relative flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-2"
      >
        <Bell className="size-4" />
        {novos.length > 0 && (
          <span className="tabular absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-on-solid">
            {novos.length > 9 ? '9+' : novos.length}
          </span>
        )}
      </button>

      {toast && !aberto && (
        <button
          type="button"
          onClick={alternar}
          className="absolute right-0 top-10 z-30 w-72 rounded-lg border border-border bg-surface p-3 text-left text-xs"
          role="status"
        >
          <span className="flex items-center gap-1.5">
            <span className={`rounded-md px-1.5 py-0.5 font-medium ${TOM[toast.tom]}`}>Novo · {ROTULO[toast.tipo]}</span>
            <span className="tabular text-muted">{horaBR(toast.hora)}</span>
          </span>
          <span className="mt-1 block font-medium">{toast.titulo}</span>
          <span className="line-clamp-2 text-muted">{toast.texto}</span>
        </button>
      )}

      {aberto && (
        <div className="absolute right-0 top-10 z-30 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface" role="dialog" aria-label="Eventos recentes">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Eventos recentes</h2>
            <Link href="/alertas" onClick={() => setAberto(false)} className="text-xs text-accent hover:underline">Ver tudo</Link>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {eventos.map((e) => (
              <li key={e.chave}>
                <Link href={e.href} onClick={() => setAberto(false)} className="block px-4 py-2.5 hover:bg-surface-2">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={`rounded-md px-1.5 py-0.5 font-medium ${TOM[e.tom]}`}>{ROTULO[e.tipo]}</span>
                    <span className="tabular text-muted">{horaBR(e.hora)}</span>
                    {visto !== null && e.criadoEm > visto && <span className="ml-auto text-accent">novo</span>}
                  </span>
                  <span className="mt-1 block text-sm font-medium">{e.titulo}</span>
                  <span className="line-clamp-3 text-xs text-muted">{e.texto}</span>
                </Link>
              </li>
            ))}
            {!eventos.length && <li className="px-4 py-8 text-center text-sm text-muted">Nenhum evento ainda. Avance o relógio.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
