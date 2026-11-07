import type { HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { AnaliseContratos } from '@/lib/contratos/tipos';
import type { Indices } from '@/lib/data/indices';
import { telefoneAnterior, trocasBancariasRecentes, type TrocaBancaria } from '@/lib/rules/auxiliares';
import type { AvaliacaoTitulo } from '@/lib/rules/motor';
import type { ResultadoRegra } from '@/lib/rules/tipos';

/**
 * Revisores do agente de validação (seção 6.4): a segunda olhada, mais funda, sobre o que o
 * agente de operação decidiu rápido. Funções puras sobre o dossiê estruturado (nunca o texto
 * bruto de mensagens). Hoje são determinísticos; o modelo de IA entra aqui depois, só nos casos caros.
 *
 * Regra de ouro: só devolve ao lote se TODAS as falhas que retiraram ou que pedem aprovação forem
 * refutadas. Na dúvida, mantém (retirar é reversível; pagar não é).
 */

export interface ContextoRevisao {
  idx: Indices;
  config: ConfigGoAudit;
  agora: HoraSimulada;
  contratos: AnaliseContratos;
  /** Destino atual de cada título no banco (para saber o que de fato vai ser pago). */
  destinos: Map<string, string>;
}

export interface RevisaoRegra {
  codigo: string;
  refutada: boolean;
  porque: string;
}

export interface Veredito {
  acao: 'devolver' | 'manter' | 'retirar';
  motivo: string;
  regras: RevisaoRegra[];
}

type Revisor = (av: AvaliacaoTitulo, r: ResultadoRegra, ctx: ContextoRevisao) => RevisaoRegra;

// ------------------------------------------------------------------ telefones
interface Telefone {
  ddd: string | null;
  numero: string; // 8 ou 9 dígitos
}

/** Telefones citados num texto livre: "(85) 3788-0117", "85 99487-1122", "+55 85 3788 0117", "3788-0117". */
export function telefonesNoTexto(texto: string): Telefone[] {
  const out: Telefone[] = [];
  const re = /(?:\+?55[\s.-]*)?(?:\(?(\d{2})\)?[\s.-]*)?(9?\d{4})[\s.-]?(\d{4})(?!\d)/g;
  for (const m of texto.matchAll(re)) {
    // Datas (22/06/2026) não casam: exigem 4+4 dígitos seguidos por separador simples.
    out.push({ ddd: m[1] ?? null, numero: `${m[2]}${m[3]}` });
  }
  return out;
}

function normalizar(tel: string): Telefone | null {
  const d = tel.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 10 || d.length === 11) return { ddd: d.slice(0, 2), numero: d.slice(2) };
  if (d.length === 8 || d.length === 9) return { ddd: null, numero: d };
  return null;
}

/** Mesmo telefone? Número igual (8 últimos dígitos, tolera o 9 do celular) e DDD igual quando o texto traz. */
function mesmoTelefone(a: Telefone, b: Telefone): boolean {
  if (a.numero.slice(-8) !== b.numero.slice(-8)) return false;
  return !a.ddd || !b.ddd || a.ddd === b.ddd;
}

/** A confirmação da troca foi, de fato, uma ligação para o telefone que estava no cadastro antes? */
function confirmacaoSeSustenta(troca: TrocaBancaria, ctx: ContextoRevisao, fornecedorId: string): { ok: boolean; porque: string } {
  const f = ctx.idx.fornecedorPorId.get(fornecedorId)!;
  const conf = troca.alteracoes.find((a) => /^sim/i.test(a.confirmacao_registrada));
  if (!conf) return { ok: false, porque: 'não há confirmação registrada para a troca' };
  if (!/liga[çc][ãa]o|telefone/i.test(conf.confirmacao_como)) return { ok: false, porque: 'a confirmação não foi por ligação' };
  const todas = ctx.idx.alteracoesPorFornecedor.get(fornecedorId) ?? [];
  const anterior = normalizar(telefoneAnterior(f, todas, troca.data, ctx.config.regras.R07.janela_dias));
  if (!anterior) return { ok: false, porque: 'o cadastro anterior não tem telefone utilizável' };
  const citados = telefonesNoTexto(conf.confirmacao_como);
  const bate = citados.find((t) => mesmoTelefone(t, anterior));
  if (!bate) return { ok: false, porque: `a ligação não foi para o telefone anterior do cadastro (${anterior.ddd ?? ''} ${anterior.numero})` };
  return {
    ok: true,
    porque: `a ligação foi para o telefone anterior do cadastro (${anterior.ddd ?? ''} ${anterior.numero}), só escrito ${bate.ddd ? 'em outro formato' : 'sem o DDD'} em "${conf.confirmacao_como}"`,
  };
}

function trocasRefutadas(av: AvaliacaoTitulo, ctx: ContextoRevisao): { ok: boolean; porque: string } {
  const f = ctx.idx.fornecedorPorId.get(av.fornecedorId);
  if (!f) return { ok: false, porque: 'fornecedor não cadastrado' };
  const ruins = trocasBancariasRecentes(ctx.idx, f, ctx.agora, ctx.config.regras.R07.janela_dias).filter((t) => !t.confirmacaoValida);
  if (!ruins.length) return { ok: true, porque: 'não há troca bancária recente sem confirmação' };
  const revisoes = ruins.map((t) => confirmacaoSeSustenta(t, ctx, f.fornecedor_id));
  const falha = revisoes.find((r) => !r.ok);
  return falha ?? { ok: true, porque: revisoes.map((r) => r.porque).join('; ') };
}

// ------------------------------------------------------------------ revisores por regra
const R09_TROCA = 'fornecedor com troca bancária recente sem confirmação válida';

const REVISORES: Partial<Record<string, Revisor>> = {
  // Troca bancária "sem confirmação válida": a operação compara dígitos crus; a validação lê os telefones do texto.
  R07: (av, r, ctx) => {
    const t = trocasRefutadas(av, ctx);
    return { codigo: r.codigo, refutada: t.ok, porque: t.porque };
  },
  // Aprovação dupla: só cai se o único motivo era a troca bancária, e ela se sustenta.
  R09: (av, r, ctx) => {
    const motivos = r.motivo.replace(/^Exige aprovação dupla:\s*/, '').replace(/\.$/, '').split(/;\s*/);
    if (motivos.some((m) => m !== R09_TROCA)) return { codigo: r.codigo, refutada: false, porque: `há outros motivos para a aprovação dupla (${motivos.join('; ')})` };
    const t = trocasRefutadas(av, ctx);
    return { codigo: r.codigo, refutada: t.ok, porque: t.ok ? `o único motivo era a troca bancária, e ${t.porque}` : t.porque };
  },
  // Excedente na competência: deixa de ser excedente se o título anterior não vai ser pago (retirado, recusado ou cancelado).
  D03: (av, r, ctx) => {
    const info = av.contrato;
    const comp = ctx.contratos.competencias.find((c) => c.contratoId === info?.contratoId && c.competencia === info?.competencia);
    const anteriores = (comp?.titulos ?? []).filter((t) => t !== av.tituloId).slice(0, Math.max(0, (comp?.titulos ?? []).indexOf(av.tituloId)));
    const vaoSerPagos = anteriores.filter((t) => {
      const status = ctx.idx.tituloPorId.get(t)?.status;
      const destino = ctx.destinos.get(t);
      return status !== 'cancelado' && destino !== 'RETIRADO' && destino !== 'RECUSADO';
    });
    return vaoSerPagos.length
      ? { codigo: r.codigo, refutada: false, porque: `o título ${vaoSerPagos[0]} da mesma competência segue para pagamento` }
      : { codigo: r.codigo, refutada: true, porque: `os títulos anteriores da competência (${anteriores.join(', ')}) não serão pagos: este é a cobrança válida` };
  },
};

/** Revisão de um título que o agente de operação retirou do lote. */
export function revisarRetirada(av: AvaliacaoTitulo, ctx: ContextoRevisao): Veredito {
  if (/^Sem aprovação até/.test(av.decisao.motivo)) {
    return { acao: 'manter', motivo: 'Retirado por falta de aprovação humana no prazo: só um aprovador pode liberar.', regras: [] };
  }
  const falhas = av.resultados.filter((r) => !r.passou && r.severidade !== 'alerta');
  if (!falhas.length) return { acao: 'manter', motivo: 'Sem falha registrada para revisar.', regras: [] };
  const regras = falhas.map((r) => {
    const rev = REVISORES[r.codigo];
    return rev ? rev(av, r, ctx) : { codigo: r.codigo, refutada: false, porque: 'evidência objetiva; fica para decisão humana' };
  });
  const sustenta = regras.filter((r) => !r.refutada);
  if (sustenta.length) {
    return { acao: 'manter', motivo: `Retirada confirmada: ${sustenta.map((r) => `${r.codigo} (${r.porque})`).join('; ')}.`, regras };
  }
  return { acao: 'devolver', motivo: `Falso positivo: ${regras.map((r) => `${r.codigo}: ${r.porque}`).join('; ')}. Devolvido ao lote antes do fechamento.`, regras };
}

/** Revisão de liberação automática acima do valor de corte: retira se houver sinal de risco não tratado. */
export function revisarLiberacao(av: AvaliacaoTitulo, ctx: ContextoRevisao): Veredito {
  const corte = ctx.config.validacao.valor_corte_liberacao;
  if (av.valor <= corte) return { acao: 'manter', motivo: 'Abaixo do valor de corte.', regras: [] };
  const sinais = av.resultados.filter((r) => !r.passou && r.severidade === 'alerta');
  if (!sinais.length) return { acao: 'manter', motivo: `Liberação acima de ${corte} conferida: nenhum sinal de risco.`, regras: [] };
  return {
    acao: 'retirar',
    motivo: `Liberação automática acima do valor de corte com sinais de risco: ${sinais.map((s) => `${s.codigo} (${s.motivo})`).join('; ')}.`,
    regras: sinais.map((s) => ({ codigo: s.codigo, refutada: false, porque: s.motivo })),
  };
}
