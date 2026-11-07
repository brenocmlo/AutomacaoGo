import { mediana } from '@/lib/rules/auxiliares';
import { raizCnpj, numero } from '@/lib/data/normalizadores';
import type { AvaliacaoTitulo } from '@/lib/rules/motor';
import type { Painel } from './dados';

/**
 * Rotina × fora da rotina. Um pagamento é de rotina quando o fornecedor tem histórico pago,
 * o valor fica perto do que ele costuma cobrar, nenhuma regra falhou e, se há contrato, o selo
 * "conforme contrato" vale. Os critérios são explícitos para que quem audita veja o porquê.
 */
export const MINIMO_HISTORICO = 3;
/** Faixa de rotina: até ±25% da mediana dos pagamentos anteriores. */
export const FAIXA_ROTINA = 0.25;

export type ClasseRotina = 'rotina' | 'fora' | 'sem_historico';

export interface PagamentoHistorico {
  tituloId: string;
  data: string;
  valor: number;
  /** Variação em relação ao pagamento anterior (null no primeiro). */
  variacaoAnterior: number | null;
}

export interface LinhaRotina {
  tituloId: string;
  fornecedorId: string;
  fornecedor: string;
  valor: number;
  destino: string;
  classe: ClasseRotina;
  motivos: string[];
  qtdHistorico: number;
  mediana: number | null;
  ultimo: number | null;
  /** Variação do valor atual contra a mediana e contra o último pagamento. */
  variacaoMediana: number | null;
  variacaoUltimo: number | null;
}

/** Pagamentos já feitos ao fornecedor (mesma raiz de CNPJ), do mais antigo ao mais recente. */
export function historicoPagamentos({ idx }: Painel, fornecedorId: string, excluir?: string): PagamentoHistorico[] {
  const f = idx.fornecedorPorId.get(fornecedorId);
  const pagos = (idx.titulosPorRaiz.get(raizCnpj(f?.cnpj)) ?? [])
    .filter((t) => t.status === 'pago' && t.titulo_id !== excluir && (numero(t.valor) ?? 0) > 0)
    .map((t) => ({ tituloId: t.titulo_id, data: (t.data_pagamento || t.vencimento || '').slice(0, 10), valor: numero(t.valor) ?? 0 }))
    .sort((a, b) => a.data.localeCompare(b.data));
  return pagos.map((p, i) => ({ ...p, variacaoAnterior: i === 0 ? null : (p.valor - pagos[i - 1].valor) / pagos[i - 1].valor }));
}

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')}%`;

export function classificar(p: Painel, a: AvaliacaoTitulo, nome: string): LinhaRotina {
  const hist = historicoPagamentos(p, a.fornecedorId, a.tituloId);
  const valores = hist.map((h) => h.valor);
  const med = mediana(valores);
  const ultimo = valores.length ? valores[valores.length - 1] : null;
  const variacaoMediana = med ? (a.valor - med) / med : null;
  const variacaoUltimo = ultimo ? (a.valor - ultimo) / ultimo : null;

  const motivos: string[] = [];
  const falhas = a.regrasDisparadas;
  let classe: ClasseRotina;
  if (hist.length < MINIMO_HISTORICO) {
    classe = 'sem_historico';
    motivos.push(`Só ${hist.length} pagamento${hist.length === 1 ? '' : 's'} anterior${hist.length === 1 ? '' : 'es'} (mínimo ${MINIMO_HISTORICO}).`);
  } else {
    classe = 'rotina';
    if (variacaoMediana != null && Math.abs(variacaoMediana) > FAIXA_ROTINA) {
      classe = 'fora';
      motivos.push(`Valor ${pct(variacaoMediana)} em relação à mediana (limite de rotina: ±${FAIXA_ROTINA * 100}%).`);
    }
  }
  if (falhas.length) {
    if (classe === 'rotina') classe = 'fora';
    motivos.push(`Regras disparadas: ${falhas.join(', ')}.`);
  }
  if (a.contrato && !a.conformeContrato && classe === 'rotina') {
    classe = 'fora';
    motivos.push('Título de contrato sem o selo "conforme contrato".');
  }
  if (classe === 'rotina') motivos.push(a.contrato ? 'Dentro do histórico e conforme o contrato.' : 'Dentro do histórico do fornecedor e sem regra disparada.');

  return {
    tituloId: a.tituloId, fornecedorId: a.fornecedorId, fornecedor: nome, valor: a.valor, destino: a.decisao.destino,
    classe, motivos, qtdHistorico: hist.length, mediana: med, ultimo, variacaoMediana, variacaoUltimo,
  };
}

export function linhasRotina(p: Painel, nomeDe: (fornecedorId: string) => string): LinhaRotina[] {
  return p.avaliacoes.map((a) => classificar(p, a, nomeDe(a.fornecedorId)));
}

export { pct as formatarVariacao };
