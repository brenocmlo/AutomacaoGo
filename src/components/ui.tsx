import type { ReactNode } from 'react';
import type { Destino } from '@/lib/rules/destino';
import type { Urgencia } from '@/lib/clock/relogio';

export type Tom = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const TONS: Record<Tom, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-neutral-soft text-muted',
};

export function Badge({ tom = 'neutral', children, title }: { tom?: Tom; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${TONS[tom]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface ${className}`}>{children}</section>;
}

export function CardTitulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold">{children}</h2>
      {extra}
    </div>
  );
}

export function Stat({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: Tom }) {
  const cor = tom === 'danger' ? 'text-danger' : tom === 'ok' ? 'text-ok' : tom === 'warn' ? 'text-warn' : tom === 'info' ? 'text-info' : '';
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{rotulo}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${cor}`}>{valor}</p>
      {detalhe && <p className="tabular mt-1 text-xs text-muted">{detalhe}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Formatação e rótulos
// ---------------------------------------------------------------------------

export function brl(v: number | null | undefined, compacto = false): string {
  if (v == null) return '—';
  if (compacto && Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (compacto && Math.abs(v) >= 10_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "2026-11-03T08:00" → "ter, 03/11 08:00" */
export function horaBR(h: string): string {
  const [data, hora] = h.split('T');
  const [a, m, d] = data!.split('-').map(Number);
  const dow = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay();
  return `${DIAS[dow]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} ${hora?.slice(0, 5) ?? ''}`;
}

export function duracao(minutos: number): string {
  if (minutos <= 0) return 'fechado';
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = minutos % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m}min`;
}

export const DESTINOS: Record<Destino | 'APROVADO' | 'RECUSADO' | 'DEVOLVIDO' | 'ENVIADO', { rotulo: string; tom: Tom }> = {
  LIBERADO_AUTOMATICO: { rotulo: 'Liberado automático', tom: 'ok' },
  CONFERIDO_AGUARDANDO_APROVADOR: { rotulo: 'Conferido, aguarda aprovador', tom: 'info' },
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', tom: 'warn' },
  RETIRADO: { rotulo: 'Retirado do lote', tom: 'danger' },
  APROVADO: { rotulo: 'Aprovado', tom: 'ok' },
  RECUSADO: { rotulo: 'Recusado', tom: 'danger' },
  DEVOLVIDO: { rotulo: 'Devolvido ao lote', tom: 'ok' },
  ENVIADO: { rotulo: 'Enviado ao banco', tom: 'neutral' },
};

export function destinoUi(d: string): { rotulo: string; tom: Tom } {
  return DESTINOS[d as keyof typeof DESTINOS] ?? { rotulo: d, tom: 'neutral' };
}

export const URGENCIAS: Record<Urgencia, { rotulo: string; tom: Tom }> = {
  IMEDIATA: { rotulo: 'Imediata', tom: 'danger' },
  HOJE: { rotulo: 'Hoje', tom: 'warn' },
  NORMAL: { rotulo: 'Normal', tom: 'neutral' },
  FECHADO: { rotulo: 'Fechado', tom: 'neutral' },
};

export const SEVERIDADES: Record<string, { rotulo: string; tom: Tom }> = {
  critica: { rotulo: 'Crítica', tom: 'danger' },
  conferencia: { rotulo: 'Conferência', tom: 'warn' },
  aprovacao: { rotulo: 'Aprovação', tom: 'info' },
  alerta: { rotulo: 'Alerta', tom: 'neutral' },
};

export const PAPEIS: Record<string, string> = {
  aprovador: 'Aprovador',
  consulta: 'Consulta',
  admin: 'Administração',
  agente_operacao: 'Agente de operação',
  agente_validacao: 'Agente de validação',
  agente_leitor: 'Leitor de mensagens',
};
