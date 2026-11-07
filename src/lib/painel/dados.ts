import { cookies } from 'next/headers';
import { contexto } from '@/lib/contexto';
import type { Indices } from '@/lib/data/indices';
import { nomeComparavel, numero } from '@/lib/data/normalizadores';
import { deMs, fechamentoDoLote, minutosEntre, paraMs, type HoraSimulada } from '@/lib/clock/relogio';
import { avaliarComIndices, type AvaliacaoTitulo } from '@/lib/rules/motor';
import type { Destino } from '@/lib/rules/destino';
import { todas } from '@/lib/agents/ciclo';
import { simulacaoAtual, type Simulacao } from '@/lib/simulacao/servico';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor, usuarioAtual, type Usuario } from '@/lib/supabase/servidor';

/**
 * Fonte de dados do painel.
 *  - MODO LOCAL (sem Supabase): roda o motor sobre a base CSV na hora do cookie, sem persistência.
 *  - SUPABASE: hora vem da simulação ativa e o destino de cada título vem da tabela
 *    `decisoes` (lida com a sessão do usuário, sob RLS). O motor continua fornecendo o
 *    dossiê (comparação entre sistemas e evidências), que é derivado da base de entrada.
 */

export const COOKIE_HORA = 'goaudit_hora';
export { contexto };

/** Destinos que aparecem no painel: os do motor + os gravados por humanos/validação/fechamento. */
export type DestinoPainel = Destino | 'APROVADO' | 'RECUSADO' | 'DEVOLVIDO' | 'ENVIADO';

export interface Painel {
  hora: HoraSimulada;
  avaliacoes: AvaliacaoTitulo[];
  idx: Indices;
  sim: Simulacao | null;
  usuario: Usuario | null;
}

/** Visão consolidada para as telas. */
export async function painel(): Promise<Painel> {
  if (!supabaseConfigurado()) {
    const hora = limitarHora((await cookies()).get(COOKIE_HORA)?.value);
    return { hora, ...avaliar(hora), sim: null, usuario: null };
  }
  const cliente = await supabaseServidor();
  const [sim, usuario] = await Promise.all([simulacaoAtual(cliente), usuarioAtual()]);
  const hora = sim?.hora ?? periodo().inicio;
  const base = avaliar(hora);
  if (!sim) return { hora, ...base, sim, usuario };

  const decisoes = await todas<{ titulo_id: string; destino: string; motivo: string | null }>((de, ate) =>
    cliente.from('decisoes').select('titulo_id, destino, motivo').eq('simulacao_id', sim.id).range(de, ate),
  );
  const porTitulo = new Map(decisoes.map((d) => [d.titulo_id, d]));
  const avaliacoes = base.avaliacoes.map((a) => {
    const d = porTitulo.get(a.tituloId);
    if (!d || d.destino === a.decisao.destino) return a;
    return { ...a, decisao: { ...a.decisao, destino: d.destino as Destino, motivo: d.motivo ?? a.decisao.motivo } };
  });
  return { hora, avaliacoes, idx: base.idx, sim, usuario };
}

const avaliacoesCache = new Map<string, { avaliacoes: AvaliacaoTitulo[]; idx: Indices }>();

export function periodo(): { inicio: HoraSimulada; fim: HoraSimulada } {
  const p = contexto().base.politicas.periodo;
  return { inicio: p.inicio.slice(0, 16), fim: p.fim.slice(0, 16) };
}

export function limitarHora(h: string | undefined | null): HoraSimulada {
  const { inicio, fim } = periodo();
  if (!h || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(h)) return inicio;
  const ms = Math.min(Math.max(paraMs(h), paraMs(inicio)), paraMs(fim));
  return deMs(ms);
}

export async function horaSimulada(): Promise<HoraSimulada> {
  if (supabaseConfigurado()) return (await simulacaoAtual(await supabaseServidor()))?.hora ?? periodo().inicio;
  return limitarHora((await cookies()).get(COOKIE_HORA)?.value);
}

export function avaliar(hora: HoraSimulada) {
  const hit = avaliacoesCache.get(hora);
  if (hit) return hit;
  const { base, config } = contexto();
  const r = avaliarComIndices(base, config, hora);
  if (avaliacoesCache.size > 24) avaliacoesCache.delete(avaliacoesCache.keys().next().value!);
  avaliacoesCache.set(hora, r);
  return r;
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

export interface FechamentoLote {
  banco: string;
  lote: string;
  fechamento: HoraSimulada;
  minutos: number;
  titulos: number;
  valor: number;
}

export interface Resumo {
  hora: HoraSimulada;
  fila: number;
  porDestino: Record<DestinoPainel, { qtd: number; valor: number }>;
  alertas: number;
  montanteEmRisco: number;
  montanteProtegido: number;
  enviados: { qtd: number; valor: number };
  proximosFechamentos: FechamentoLote[];
}

export const TODOS_DESTINOS: DestinoPainel[] = [
  'LIBERADO_AUTOMATICO', 'CONFERIDO_AGUARDANDO_APROVADOR', 'AGUARDANDO_APROVACAO', 'RETIRADO',
  'APROVADO', 'RECUSADO', 'DEVOLVIDO', 'ENVIADO',
];

export function resumo({ hora, avaliacoes }: Painel): Resumo {
  const porDestino = Object.fromEntries(TODOS_DESTINOS.map((d) => [d, { qtd: 0, valor: 0 }])) as Resumo['porDestino'];
  for (const a of avaliacoes) {
    const d = a.decisao.destino as DestinoPainel;
    porDestino[d].qtd++;
    porDestino[d].valor += a.valor;
  }

  const { base } = contexto();
  let enviadosQtd = 0;
  let enviadosValor = 0;
  const lotes = new Map<string, FechamentoLote>();
  for (const item of base.agenda) {
    const f = fechamentoDoLote(item.data_prevista, item.horario_fechamento);
    const min = minutosEntre(hora, f);
    const valor = numero(item.valor) ?? 0;
    if (min <= 0) {
      enviadosQtd++;
      enviadosValor += valor;
      continue;
    }
    const l = lotes.get(item.lote_remessa) ?? { banco: item.banco_pagador, lote: item.lote_remessa, fechamento: f, minutos: min, titulos: 0, valor: 0 };
    l.titulos++;
    l.valor += valor;
    lotes.set(item.lote_remessa, l);
  }
  // Próximo lote de cada banco
  const proximos = new Map<string, FechamentoLote>();
  for (const l of [...lotes.values()].sort((a, b) => a.minutos - b.minutos)) if (!proximos.has(l.banco)) proximos.set(l.banco, l);

  return {
    hora,
    fila: avaliacoes.length,
    porDestino,
    alertas: avaliacoes.filter((a) => a.decisao.alerta).length,
    montanteEmRisco: avaliacoes
      .filter((a) => a.decisao.destino === 'AGUARDANDO_APROVACAO' || (a.decisao.alerta && a.decisao.destino !== 'RETIRADO'))
      .reduce((s, a) => s + a.valor, 0),
    montanteProtegido: porDestino.RETIRADO.valor,
    enviados: { qtd: enviadosQtd, valor: enviadosValor },
    proximosFechamentos: [...proximos.values()],
  };
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

export interface FiltrosFila {
  destino?: string;
  urgencia?: string;
  banco?: string;
  lote?: string;
  grupo?: string;
  busca?: string;
}

/** Etiquetas por grupo de regras (seção 10). */
export const GRUPOS_REGRAS: Record<string, { rotulo: string; regras: string[] }> = {
  tres_vias: { rotulo: '3 vias', regras: ['R03', 'R04', 'R05', 'R10'] },
  alcada: { rotulo: 'Alçada', regras: ['R08', 'R09'] },
  bancario: { rotulo: 'Dados bancários', regras: ['R06', 'R07'] },
  duplicidade: { rotulo: 'Duplicidade', regras: ['R01', 'R02'] },
  valor: { rotulo: 'Valor atípico', regras: ['R11', 'R12'] },
  lancador: { rotulo: 'Lançador', regras: ['R13'] },
  mensagem: { rotulo: 'Mensagem', regras: ['R14'] },
};

export function gruposDe(regras: string[]): string[] {
  return Object.entries(GRUPOS_REGRAS)
    .filter(([, g]) => g.regras.some((r) => regras.includes(r)))
    .map(([k]) => k);
}

export function fila({ avaliacoes, idx }: Painel, f: FiltrosFila): AvaliacaoTitulo[] {
  const busca = nomeComparavel(f.busca);
  return avaliacoes.filter((a) => {
    if (f.destino && a.decisao.destino !== f.destino) return false;
    if (f.urgencia && a.urgencia !== f.urgencia) return false;
    if (f.banco && a.banco !== f.banco) return false;
    if (f.lote && a.lote !== f.lote) return false;
    if (f.grupo && !gruposDe(a.resultados.filter((r) => !r.passou).map((r) => r.codigo)).includes(f.grupo)) return false;
    if (busca) {
      const forn = idx.fornecedorPorId.get(a.fornecedorId);
      const alvo = nomeComparavel(`${a.tituloId} ${a.fornecedorId} ${forn?.razao_social ?? ''} ${forn?.nome_fantasia ?? ''}`);
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

export function nomeFornecedor(hora: HoraSimulada, fornecedorId: string): string {
  const f = avaliar(hora).idx.fornecedorPorId.get(fornecedorId);
  return f?.nome_fantasia || f?.razao_social || fornecedorId;
}

// ---------------------------------------------------------------------------
// Detalhe do título
// ---------------------------------------------------------------------------

export interface Coluna {
  titulo: string;
  id: string | null;
  linhas: { rotulo: string; valor: string; alerta?: boolean }[];
}

export interface DetalheTitulo {
  av: AvaliacaoTitulo;
  fornecedorNome: string;
  colunas: Coluna[];
  mensagens: { id: string; data: string; canal: string; remetente: string; assunto: string; confere: boolean }[];
  /** Só com Supabase: linha do tempo do log e solicitação pendente. */
  log: { log_id: number; data_hora_simulada: string | null; ator_tipo: string; ator_papel: string | null; acao: string; motivo: string | null }[];
  solicitacao: { id: string; tipo: string; valor: number; aprovadores_exigidos: string[]; aprovacoes: number } | null;
  retirado: boolean;
}

/** Log e solicitação do título, lidos com a sessão do usuário (RLS). */
async function dadosDoBanco(p: Painel, tituloId: string): Promise<Pick<DetalheTitulo, 'log' | 'solicitacao' | 'retirado'>> {
  if (!p.sim) return { log: [], solicitacao: null, retirado: false };
  const cliente = await supabaseServidor();
  const [log, sol, mov] = await Promise.all([
    cliente.from('log_auditoria').select('log_id, data_hora_simulada, ator_tipo, ator_papel, acao, motivo')
      .eq('simulacao_id', p.sim.id).eq('entidade', 'titulo').eq('entidade_id', tituloId).order('log_id', { ascending: false }).limit(30),
    cliente.from('solicitacoes_aprovacao').select('id, tipo, valor, aprovadores_exigidos, aprovacoes(id)')
      .eq('simulacao_id', p.sim.id).eq('titulo_id', tituloId).eq('situacao', 'pendente').maybeSingle(),
    cliente.from('movimentos_lote').select('tipo').eq('simulacao_id', p.sim.id).eq('titulo_id', tituloId).order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const s = sol.data as { id: string; tipo: string; valor: number; aprovadores_exigidos: string[]; aprovacoes: unknown[] | null } | null;
  return {
    log: log.data ?? [],
    solicitacao: s ? { id: s.id, tipo: s.tipo, valor: Number(s.valor), aprovadores_exigidos: s.aprovadores_exigidos, aprovacoes: s.aprovacoes?.length ?? 0 } : null,
    retirado: mov.data?.tipo === 'retirada',
  };
}

const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function detalhe(p: Painel, tituloId: string): Promise<DetalheTitulo | null> {
  const { avaliacoes, idx } = p;
  const av = avaliacoes.find((a) => a.tituloId === tituloId);
  if (!av) return null;
  const doBanco = await dadosDoBanco(p, tituloId);
  const d = idx.dossie(tituloId);
  const t = d.titulo;
  const f = d.fornecedor;
  const falhou = (cod: string) => av.resultados.some((r) => r.codigo === cod && !r.passou);

  const colunas: Coluna[] = [
    {
      titulo: 'Título no ERP',
      id: t.titulo_id,
      linhas: [
        { rotulo: 'Valor', valor: brl(d.valor), alerta: falhou('R03') || falhou('R11') },
        { rotulo: 'Vencimento', valor: t.vencimento },
        { rotulo: 'NF digitada', valor: t.numero_nf_digitado || '—' },
        { rotulo: 'Parcela', valor: t.parcela },
        { rotulo: 'OC', valor: t.oc_id || '—' },
        { rotulo: 'Forma', valor: t.forma_pagamento },
        { rotulo: 'Lançado por', valor: `${d.lancador?.nome ?? t.lancado_por} em ${t.data_lancamento.slice(0, 16)}`, alerta: falhou('R13') },
        { rotulo: 'Origem', valor: t.origem_lancamento },
      ],
    },
    {
      titulo: 'Duplicata da NF',
      id: d.nf?.chave_acesso ?? null,
      linhas: d.nf
        ? [
            { rotulo: 'NF', valor: `${d.nf.numero_nf} (série ${d.nf.serie})` },
            { rotulo: 'Emitente', valor: d.nf.razao_social_emitente, alerta: falhou('R05') },
            { rotulo: 'Valor da NF', valor: brl(numero(d.nf.valor_total)) },
            { rotulo: 'Duplicata', valor: d.duplicata ? `${d.duplicata.n_dup} · ${brl(numero(d.duplicata.valor))}` : '—', alerta: falhou('R03') },
            { rotulo: 'Vencimento', valor: d.duplicata?.vencimento ?? '—' },
            { rotulo: 'Recebimento', valor: d.recebimentos.map((r) => r.situacao).join(', ') || '—', alerta: falhou('R10') },
          ]
        : [{ rotulo: 'NF', valor: t.numero_nf_digitado ? 'Não encontrada no portal' : 'Sem NF', alerta: Boolean(t.numero_nf_digitado) }],
    },
    {
      titulo: d.contrato ? 'OC / contrato' : 'Pedido de compra',
      id: d.oc?.oc_id ?? d.contrato?.contrato_id ?? null,
      linhas: [
        ...(d.oc
          ? [
              { rotulo: 'OC', valor: `${d.oc.oc_id} (${d.oc.tipo})` },
              { rotulo: 'Fornecedor', valor: d.oc.nome_fornecedor, alerta: falhou('R05') },
              { rotulo: 'Valor', valor: brl(numero(d.oc.valor_total)), alerta: falhou('R04') },
              { rotulo: 'Status', valor: d.oc.status, alerta: d.oc.status !== 'aprovada' },
              { rotulo: 'Comprador', valor: d.oc.comprador || '—' },
            ]
          : [{ rotulo: 'OC', valor: 'Sem OC' }]),
        ...(d.contrato
          ? [
              { rotulo: 'Contrato', valor: d.contrato.contrato_id },
              { rotulo: 'Valor mensal', valor: brl(numero(d.contrato.valor_mensal)), alerta: falhou('R04') },
              { rotulo: 'Gestor', valor: d.contrato.gestor_pessoa_id },
            ]
          : []),
      ],
    },
    {
      titulo: 'Boleto no DDA',
      id: d.dda?.dda_id ?? null,
      linhas:
        t.forma_pagamento !== 'boleto'
          ? [{ rotulo: 'Forma', valor: `Não é boleto (${t.forma_pagamento})` }]
          : [
              { rotulo: 'Banco (linha)', valor: d.boleto?.banco ?? '—', alerta: falhou('R06') },
              { rotulo: 'Valor (linha)', valor: brl(d.boleto?.valor), alerta: falhou('R06') },
              { rotulo: 'Vencimento (linha)', valor: d.boleto?.vencimento ?? '—' },
              { rotulo: 'Beneficiário (DDA)', valor: d.dda ? `${d.dda.beneficiario}` : 'Não está no DDA', alerta: falhou('R06') },
              { rotulo: 'CNPJ (DDA)', valor: d.dda?.cnpj_beneficiario ?? '—' },
              { rotulo: 'Situação', valor: d.dda?.situacao ?? '—', alerta: falhou('R02') },
            ],
    },
    {
      titulo: 'Cadastro do fornecedor',
      id: f?.fornecedor_id ?? null,
      linhas: f
        ? [
            { rotulo: 'Razão social', valor: f.razao_social },
            { rotulo: 'CNPJ', valor: f.cnpj },
            { rotulo: 'Categoria', valor: f.categoria },
            { rotulo: 'Banco / ag / conta', valor: `${f.banco} / ${f.agencia} / ${f.conta}`, alerta: falhou('R07') },
            { rotulo: 'Canais oficiais', valor: `${f.email_cadastrado} · ${f.telefone_cadastrado}` },
            { rotulo: 'Destino no lote', valor: d.agenda?.destino_pagamento ?? '—' },
          ]
        : [{ rotulo: 'Fornecedor', valor: 'Não cadastrado', alerta: true }],
    },
  ];

  // Mensagens relacionadas: do domínio/telefone oficial, citando a NF ou o nome do fornecedor.
  const dominio = f?.email_cadastrado.split('@')[1]?.toLowerCase() ?? '';
  const nomeF = nomeComparavel(f?.nome_fantasia).split(' ')[0] ?? '';
  const telDigitos = (f?.telefone_cadastrado ?? '').replace(/\D/g, '');
  const mensagens = idx.base.comunicacoes
    .filter((c) => {
      const rem = c.remetente.toLowerCase();
      const texto = `${c.assunto} ${c.texto} ${c.anexos}`;
      const doDominio = dominio && rem.endsWith(`@${dominio}`);
      const citaNf = d.nfNumero && new RegExp(`\\b0*${d.nfNumero}\\b`).test(texto);
      const citaNome = nomeF.length >= 4 && nomeComparavel(`${c.nome_remetente} ${c.assunto}`).includes(nomeF);
      return Boolean(doDominio || (citaNf && citaNome));
    })
    .slice(-8)
    .map((c) => {
      const rem = c.remetente.toLowerCase();
      const confere = (dominio !== '' && rem.endsWith(`@${dominio}`)) || (telDigitos.length > 0 && rem.replace(/\D/g, '') === telDigitos);
      return { id: c.comunicacao_id, data: c.data_hora.slice(0, 16), canal: c.canal, remetente: c.remetente, assunto: c.assunto, confere };
    });

  return { av, fornecedorNome: f?.nome_fantasia || f?.razao_social || av.fornecedorId, colunas, mensagens, ...doBanco };
}

// ---------------------------------------------------------------------------
// Caixa de entrada e alertas (Supabase)
// ---------------------------------------------------------------------------

export interface Notificacao {
  id: number;
  assunto: string;
  mensagem: string;
  titulos: string[];
  urgencia: string | null;
  lida: boolean;
  hora_simulada: string;
}

export async function caixaDeEntrada(p: Painel): Promise<Notificacao[]> {
  if (!p.sim) return [];
  const { data } = await (await supabaseServidor())
    .from('notificacoes')
    .select('id, assunto, mensagem, titulos, urgencia, lida, hora_simulada')
    .eq('simulacao_id', p.sim.id)
    .eq('situacao', 'ativa')
    .order('id', { ascending: false })
    .limit(100);
  return (data ?? []) as Notificacao[];
}

export interface SolicitacaoPendente {
  id: string;
  titulo_id: string;
  tipo: string;
  nivel: string;
  valor: number;
  motivo: string;
  aprovadores_exigidos: string[];
}

export async function solicitacoesPendentes(p: Painel): Promise<SolicitacaoPendente[]> {
  if (!p.sim) return [];
  const cliente = await supabaseServidor();
  return todas<SolicitacaoPendente>((de, ate) =>
    cliente.from('solicitacoes_aprovacao').select('id, titulo_id, tipo, nivel, valor, motivo, aprovadores_exigidos')
      .eq('simulacao_id', p.sim!.id).eq('situacao', 'pendente').order('valor', { ascending: false }).range(de, ate),
  );
}

export interface Alerta {
  id: number;
  tipo: string;
  titulo_id: string | null;
  dono_pessoa_id: string | null;
  regras: string[];
  mensagem: string;
  valor: number | null;
  situacao: string;
}

export async function alertasAbertos(p: Painel): Promise<Alerta[]> {
  if (!p.sim) return [];
  const { data } = await (await supabaseServidor())
    .from('alertas').select('id, tipo, titulo_id, dono_pessoa_id, regras, mensagem, valor, situacao')
    .eq('simulacao_id', p.sim.id).eq('situacao', 'aberto').order('id', { ascending: false }).limit(200);
  return (data ?? []) as Alerta[];
}
