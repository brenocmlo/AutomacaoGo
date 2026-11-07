import { diasEntre, dataDe } from '@/lib/clock/relogio';
import { mesDe, proximoReajuste } from '@/lib/contratos/datas';
import { NOME_DESVIO, type ClasseContrato, type CodigoDesvio, type SituacaoCompetencia } from '@/lib/contratos/tipos';
import { numero } from '@/lib/data/normalizadores';
import type { Contrato } from '@/lib/data/tipos';
import { todas } from '@/lib/supabase/paginacao';
import { supabaseServidor } from '@/lib/supabase/servidor';
import type { Painel } from './dados';

/**
 * Dados da tela de contratos.
 *  - Com simulação no Supabase: competências e alertas vêm do banco, sob RLS (o gestor de área só
 *    recebe as linhas dos contratos em que é gestor_pessoa_id).
 *  - Modo local / sem simulação: vêm do motor (mesma análise), filtrando pelo papel do usuário.
 */

export interface CompetenciaVista {
  contratoId: string;
  competencia: string;
  classe: ClasseContrato;
  valorEsperado: number | null;
  faixaMin: number | null;
  faixaMax: number | null;
  valorCobrado: number;
  qtdTitulos: number;
  titulos: string[];
  situacao: SituacaoCompetencia;
  desvios: string[];
  vencimentoPrevisto: string | null;
}

export interface LinhaContrato {
  contrato: Contrato;
  classe: ClasseContrato;
  fornecedorNome: string;
  valorMensal: number | null;
  atual: CompetenciaVista | null;
  competencias: CompetenciaVista[];
  proximoReajuste: string | null;
  diasParaReajuste: number | null;
  diasParaFimVigencia: number | null;
  venceOuReajustaEm30: boolean;
  situacao: SituacaoCompetencia | 'sem_dados';
}

export interface AlertaContrato {
  codigo: string;
  nome: string;
  competencia: string | null;
  tituloId: string | null;
  mensagem: string;
  donos: string[];
}

export const SITUACOES: Record<SituacaoCompetencia | 'sem_dados', { rotulo: string; tom: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  conforme: { rotulo: 'Conforme', tom: 'ok' },
  desvio: { rotulo: 'Desvio', tom: 'danger' },
  sem_titulo: { rotulo: 'Sem título', tom: 'warn' },
  aguardando: { rotulo: 'Aguardando título', tom: 'neutral' },
  sem_referencia: { rotulo: 'Sem referência', tom: 'neutral' },
  sem_dados: { rotulo: 'Sem dados', tom: 'neutral' },
};

export const CLASSES: Record<ClasseContrato, string> = { fixo: 'Valor fixo', utilidade: 'Consumo', frete: 'Frete' };

const vistaDoBanco = (r: Record<string, unknown>): CompetenciaVista => ({
  contratoId: String(r.contrato_id),
  competencia: String(r.competencia),
  classe: r.classe as ClasseContrato,
  valorEsperado: r.valor_esperado == null ? null : Number(r.valor_esperado),
  faixaMin: r.faixa_min == null ? null : Number(r.faixa_min),
  faixaMax: r.faixa_max == null ? null : Number(r.faixa_max),
  valorCobrado: Number(r.valor_cobrado),
  qtdTitulos: Number(r.qtd_titulos),
  titulos: (r.titulos as string[]) ?? [],
  situacao: r.situacao as SituacaoCompetencia,
  desvios: (r.desvios as string[]) ?? [],
  vencimentoPrevisto: (r.vencimento_previsto as string | null) ?? null,
});

/** Só o gestor de área (papel consulta) é restrito aos próprios contratos; os demais papéis veem todos. */
function visivelLocal(p: Painel, gestor: string): boolean {
  if (!p.usuario || p.usuario.papel !== 'consulta') return true;
  return !!p.usuario.pessoaId && gestor === p.usuario.pessoaId;
}

async function competencias(p: Painel, contratoId?: string): Promise<CompetenciaVista[]> {
  if (p.sim) {
    const cliente = await supabaseServidor();
    const linhas = await todas<Record<string, unknown>>((de, ate) => {
      let q = cliente.from('competencias_contrato')
        .select('contrato_id, competencia, classe, valor_esperado, faixa_min, faixa_max, valor_cobrado, qtd_titulos, titulos, situacao, desvios, vencimento_previsto')
        .eq('simulacao_id', p.sim!.id);
      if (contratoId) q = q.eq('contrato_id', contratoId);
      return q.order('contrato_id').order('competencia').range(de, ate);
    });
    return linhas.map(vistaDoBanco);
  }
  return p.contratos.competencias
    .filter((c) => (!contratoId || c.contratoId === contratoId) && visivelLocal(p, c.gestorPessoaId))
    .map((c): CompetenciaVista => ({
      contratoId: c.contratoId, competencia: c.competencia, classe: c.classe, valorEsperado: c.valorEsperado, faixaMin: c.faixaMin,
      faixaMax: c.faixaMax, valorCobrado: c.valorCobrado, qtdTitulos: c.qtdTitulos, titulos: c.titulos, situacao: c.situacao,
      desvios: c.desvios, vencimentoPrevisto: c.vencimentoPrevisto,
    }));
}

function montarLinha(p: Painel, c: Contrato, comps: CompetenciaVista[]): LinhaContrato {
  const hoje = dataDe(p.hora);
  const mesAtual = mesDe(hoje);
  const f = p.idx.fornecedorPorId.get(c.fornecedor_id);
  const doContrato = comps.filter((x) => x.contratoId === c.contrato_id).sort((a, b) => a.competencia.localeCompare(b.competencia));
  const atual = doContrato.find((x) => x.competencia === mesAtual) ?? doContrato.filter((x) => x.competencia <= mesAtual).at(-1) ?? null;
  const prox = proximoReajuste(c.mes_reajuste, c.data_ultimo_reajuste);
  const diasReaj = prox ? diasEntre(hoje, prox) : null;
  const diasFim = c.fim_vigencia_atual ? diasEntre(hoje, c.fim_vigencia_atual) : null;
  const janela = 30;
  return {
    contrato: c,
    classe: p.contratos.classes.get(c.contrato_id) ?? 'fixo',
    fornecedorNome: f?.nome_fantasia || f?.razao_social || c.fornecedor_id,
    valorMensal: numero(c.valor_mensal),
    atual,
    competencias: doContrato,
    proximoReajuste: prox,
    diasParaReajuste: diasReaj,
    diasParaFimVigencia: diasFim,
    venceOuReajustaEm30: (diasReaj != null && diasReaj >= 0 && diasReaj <= janela) || (diasFim != null && diasFim >= 0 && diasFim <= janela),
    situacao: doContrato.some((x) => x.situacao === 'desvio' && x.competencia >= mesAtual) || atual?.situacao === 'desvio'
      ? 'desvio'
      : (atual?.situacao ?? 'sem_dados'),
  };
}

export interface FiltrosContratos {
  tipo?: string;
  gestor?: string;
  situacao?: string;
  janela?: string; // "30": vence ou reajusta em 30 dias
}

/** Lista de contratos visíveis para o usuário (com o banco, a RLS decide quais). */
export async function listaContratos(p: Painel, f: FiltrosContratos = {}): Promise<{ linhas: LinhaContrato[]; todas: LinhaContrato[] }> {
  const comps = await competencias(p);
  const visiveis = new Set(comps.map((c) => c.contratoId));
  const todasLinhas = p.contratos.contratos
    .filter((c) => visiveis.has(c.contrato_id) || (!p.sim && visivelLocal(p, c.gestor_pessoa_id)))
    .map((c) => montarLinha(p, c, comps))
    .sort((a, b) => Number(b.situacao === 'desvio') - Number(a.situacao === 'desvio') || a.contrato.contrato_id.localeCompare(b.contrato.contrato_id));
  const linhas = todasLinhas.filter((l) =>
    (!f.tipo || l.contrato.tipo === f.tipo) &&
    (!f.gestor || l.contrato.gestor_pessoa_id === f.gestor) &&
    (!f.situacao || l.situacao === f.situacao) &&
    (!f.janela || l.venceOuReajustaEm30),
  );
  return { linhas, todas: todasLinhas };
}

export interface DetalheContrato {
  linha: LinhaContrato;
  titulos: Map<string, { valor: number; vencimento: string; status: string; forma: string }>;
  alertas: AlertaContrato[];
}

export async function detalheContrato(p: Painel, contratoId: string): Promise<DetalheContrato | null> {
  const c = p.idx.contratoPorId.get(contratoId);
  if (!c) return null;
  const comps = await competencias(p, contratoId);
  // Com o banco, contrato sem nenhuma linha visível = fora do alcance do usuário (RLS).
  if (p.sim && comps.length === 0) return null;
  if (!p.sim && !visivelLocal(p, c.gestor_pessoa_id)) return null;
  const linha = montarLinha(p, c, comps);

  const titulos = new Map<string, { valor: number; vencimento: string; status: string; forma: string }>();
  for (const id of comps.flatMap((x) => x.titulos)) {
    const t = p.idx.tituloPorId.get(id);
    if (t) titulos.set(id, { valor: numero(t.valor) ?? 0, vencimento: t.vencimento, status: t.status, forma: t.forma_pagamento });
  }

  let alertas: AlertaContrato[];
  if (p.sim) {
    const { data } = await (await supabaseServidor())
      .from('alertas').select('regras, competencia, titulo_id, mensagem, dono_pessoa_id')
      .eq('simulacao_id', p.sim.id).eq('tipo', 'contrato').eq('contrato_id', contratoId).order('id', { ascending: false }).limit(200);
    const grupos = new Map<string, AlertaContrato>();
    for (const a of (data ?? []) as { regras: string[]; competencia: string | null; titulo_id: string | null; mensagem: string; dono_pessoa_id: string | null }[]) {
      const codigo = a.regras[0] ?? '';
      const k = `${codigo}|${a.competencia}|${a.titulo_id}|${a.mensagem}`;
      const g = grupos.get(k) ?? { codigo, nome: NOME_DESVIO[codigo as CodigoDesvio] ?? codigo, competencia: a.competencia, tituloId: a.titulo_id, mensagem: a.mensagem, donos: [] };
      if (a.dono_pessoa_id && !g.donos.includes(a.dono_pessoa_id)) g.donos.push(a.dono_pessoa_id);
      grupos.set(k, g);
    }
    alertas = [...grupos.values()];
  } else {
    alertas = p.contratos.desvios
      .filter((d) => d.contratoId === contratoId)
      .map((d) => ({ codigo: d.codigo, nome: NOME_DESVIO[d.codigo], competencia: d.competencia, tituloId: d.tituloId, mensagem: d.motivo, donos: d.acionar }));
  }
  return { linha, titulos, alertas };
}
