import { CalendarioBancario, fechamentoDoLote, minutosEntre, urgencia, type HoraSimulada, type Urgencia } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import { recortarAte, type BaseEntrada } from '@/lib/data/base';
import { Indices } from '@/lib/data/indices';
import type { AgendaItem } from '@/lib/data/tipos';
import { decidirDestino, type DecisaoDestino } from './destino';
import { REGRAS } from './index';
import type { AprovacaoConhecida, ContextoRegras, ResultadoRegra } from './tipos';

export interface AvaliacaoTitulo {
  tituloId: string;
  fornecedorId: string;
  categoria: string;
  valor: number;
  lote: string;
  banco: string;
  fechamento: HoraSimulada;
  urgencia: Urgencia;
  resultados: ResultadoRegra[];
  regrasDisparadas: string[];
  pendenciasLigacao: string[];
  decisao: DecisaoDestino;
}

export interface OpcoesMotor {
  /** Movimentos do GoAudit: títulos retirados (saem) e devolvidos (voltam). */
  retirados?: Set<string>;
  devolvidos?: Set<string>;
  /** Aprovações dadas no GoAudit (somam às do ERP). */
  aprovacoesSistema?: AprovacaoConhecida[];
  /** Avaliar também lotes já fechados (para relatórios). */
  incluirFechados?: boolean;
}

function alcadaDe(valor: string | undefined): number {
  if (!valor) return 0;
  if (/sem limite/i.test(valor)) return Infinity;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function agendaEfetiva(base: BaseEntrada, retirados = new Set<string>(), devolvidos = new Set<string>()): AgendaItem[] {
  return base.agenda.filter((a) => !retirados.has(a.titulo_id) || devolvidos.has(a.titulo_id));
}

const ORDEM_URGENCIA: Record<Urgencia, number> = { IMEDIATA: 0, HOJE: 1, NORMAL: 2, FECHADO: 3 };

/** Ordena a fila: urgência, depois risco, depois valor. */
export function ordenarFila(av: AvaliacaoTitulo[]): AvaliacaoTitulo[] {
  return [...av].sort(
    (a, b) =>
      ORDEM_URGENCIA[a.urgencia] - ORDEM_URGENCIA[b.urgencia] ||
      b.decisao.risco - a.decisao.risco ||
      b.valor - a.valor,
  );
}

/**
 * Avalia todos os títulos dos lotes abertos na hora simulada. Função pura em relação
 * ao banco: recebe a base (CSV) e o estado do GoAudit (retiradas, aprovações).
 */
export function avaliarAgenda(baseCompleta: BaseEntrada, config: ConfigGoAudit, agora: HoraSimulada, op: OpcoesMotor = {}): AvaliacaoTitulo[] {
  return avaliarComIndices(baseCompleta, config, agora, op).avaliacoes;
}

/** Igual a avaliarAgenda, mas devolve também os índices (o painel usa no detalhe do título). */
export function avaliarComIndices(
  baseCompleta: BaseEntrada,
  config: ConfigGoAudit,
  agora: HoraSimulada,
  op: OpcoesMotor = {},
): { avaliacoes: AvaliacaoTitulo[]; idx: Indices } {
  const base = recortarAte(baseCompleta, agora, config.chegada.extrato_hora_disponivel);
  const idx = new Indices(base);
  const cal = new CalendarioBancario(base.feriados);

  const usuarios = new Map(base.usuarios.map((u) => [u.login, u]));
  const aprovacoes = new Map<string, AprovacaoConhecida[]>();
  const add = (a: AprovacaoConhecida) => aprovacoes.set(a.tituloId, [...(aprovacoes.get(a.tituloId) ?? []), a]);
  for (const a of base.aprovacoesErp) {
    const u = usuarios.get(a.aprovador);
    add({
      tituloId: a.titulo_id,
      aprovador: a.aprovador,
      pessoaId: u?.pessoa_id || null,
      alcada: alcadaDe(u?.alcada_rs),
      decisao: a.decisao === 'aprovado' ? 'aprovado' : 'reprovado',
    });
  }
  for (const a of op.aprovacoesSistema ?? []) add(a);

  const agenda = agendaEfetiva(base, op.retirados, op.devolvidos);
  const ctx: ContextoRegras = { idx, politicas: base.politicas, config, cal, agora, agenda, aprovacoes };

  const out: AvaliacaoTitulo[] = [];
  for (const item of agenda) {
    const fechamento = fechamentoDoLote(item.data_prevista, item.horario_fechamento);
    if (!op.incluirFechados && minutosEntre(agora, fechamento) <= 0) continue;
    const d = idx.dossie(item.titulo_id);
    const resultados = Object.values(REGRAS).map((r) => r(d, ctx));
    const decisao = decidirDestino(d, resultados, agora, fechamento, base.politicas, config);
    out.push({
      tituloId: item.titulo_id,
      fornecedorId: item.fornecedor_id,
      categoria: d.fornecedor?.categoria ?? '',
      valor: d.valor,
      lote: item.lote_remessa,
      banco: item.banco_pagador,
      fechamento,
      urgencia: urgencia(agora, fechamento, config.urgencia.imediata_horas_antes_fechamento),
      resultados,
      regrasDisparadas: resultados.filter((r) => !r.passou).map((r) => r.codigo),
      pendenciasLigacao: d.pendencias,
      decisao,
    });
  }
  return { avaliacoes: ordenarFila(out), idx };
}
