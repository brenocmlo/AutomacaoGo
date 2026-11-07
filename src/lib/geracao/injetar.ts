import type { BaseEntrada } from '@/lib/data/base';
import type { HoraSimulada } from '@/lib/clock/relogio';
import { paraMs } from '@/lib/clock/relogio';
import type { ArquivoGerado, EventoGerado } from './tipos';

/** Em qual lista da BaseEntrada cada arquivo gerado entra. */
const DESTINO: Record<ArquivoGerado, keyof BaseEntrada> = {
  contas_a_pagar: 'titulos',
  agenda_remessa: 'agenda',
  notas_fiscais: 'notas',
  nf_duplicatas: 'duplicatas',
  pedidos_compra: 'pedidos',
  dda_boletos: 'dda',
  recebimentos_mercadoria: 'recebimentos',
  comunicacoes_fornecedores: 'comunicacoes',
  alteracoes_cadastro: 'alteracoes',
};

/**
 * Versão dos eventos, para chave de cache: eles só crescem (inserção idempotente), então
 * a quantidade e a última chave identificam o conjunto.
 */
export function versaoEventos(eventos: readonly EventoGerado[]): string {
  if (!eventos.length) return '0';
  let ultima = eventos[0]!.chave;
  for (const e of eventos) if (e.chave > ultima) ultima = e.chave;
  return `${eventos.length}:${ultima}`;
}

/**
 * Base de entrada + o que o gerador criou. Única porta de entrada dos eventos: o ciclo (motor, leitor,
 * resumos) e o painel chamam esta função, então enxergam as mesmas linhas. A base original nunca é alterada.
 * `ate`: só entram os eventos que já chegaram nessa hora (o motor ainda recorta pelo carimbo de cada linha).
 */
export function baseComEventos(base: BaseEntrada, eventos: readonly EventoGerado[], ate?: HoraSimulada): BaseEntrada {
  const validos = ate ? eventos.filter((e) => paraMs(e.hora) <= paraMs(ate)) : eventos;
  if (!validos.length) return base;
  const extra = new Map<keyof BaseEntrada, Record<string, string>[]>();
  const vistos = new Set<string>();
  for (const e of validos) {
    if (vistos.has(e.chave)) continue; // a mesma linha nunca entra duas vezes
    vistos.add(e.chave);
    const k = DESTINO[e.arquivo];
    extra.set(k, [...(extra.get(k) ?? []), e.linha]);
  }
  const out = { ...base } as Record<string, unknown>;
  for (const [k, linhas] of extra) out[k] = [...(base[k] as unknown[]), ...linhas];
  return out as unknown as BaseEntrada;
}
