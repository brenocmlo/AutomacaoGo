import { minutosEntre } from '@/lib/clock/relogio';
import { todas } from '@/lib/supabase/paginacao';
import { supabaseServidor } from '@/lib/supabase/servidor';
import type { Painel } from './dados';

/** Leituras do log de auditoria, custo de IA e gargalos. Sempre com a sessão do usuário (RLS). */

export interface LinhaLog {
  log_id: number;
  data_hora_real: string;
  data_hora_simulada: string | null;
  ator_tipo: string;
  ator_papel: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  regras: string[];
  motivo: string | null;
  valor_em_jogo: number | null;
  modelo_ia: string | null;
  situacao: string;
}

export interface FiltrosLog {
  ator?: string;
  acao?: string;
  entidade?: string;
  busca?: string;
}

export const COLUNAS_LOG =
  'log_id, data_hora_real, data_hora_simulada, ator_tipo, ator_id, ator_papel, acao, entidade, entidade_id, regras, evidencias, motivo, valor_em_jogo, modelo_ia, tokens_entrada, tokens_saida, custo_usd, confianca, log_relacionado, situacao';

/** Aplica os filtros da tela e da exportação (a mesma consulta nos dois). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filtrarLog(q: any, f: FiltrosLog): any {
  if (f.ator) q = q.eq('ator_tipo', f.ator);
  if (f.entidade) q = q.eq('entidade', f.entidade);
  if (f.acao) q = q.eq('acao', f.acao);
  if (f.busca) {
    const b = f.busca.replace(/[%,()]/g, ' ').trim();
    if (b) q = q.or(`entidade_id.ilike.%${b}%,motivo.ilike.%${b}%,acao.ilike.%${b}%`);
  }
  return q;
}

export async function ultimosLogs(p: Painel, f: FiltrosLog, limite = 100): Promise<LinhaLog[]> {
  if (!p.sim) return [];
  const q = (await supabaseServidor()).from('log_auditoria').select(COLUNAS_LOG).eq('simulacao_id', p.sim.id);
  const { data } = await filtrarLog(q, f).order('log_id', { ascending: false }).limit(limite);
  return (data ?? []) as unknown as LinhaLog[];
}

// ---------------------------------------------------------------------------
// Custo de IA (linhas 'leitor-ia|<hora>' do log)
// ---------------------------------------------------------------------------

export interface DiaIA {
  dia: string;
  chamadas: number;
  falhas: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}

export interface CustoIA {
  total: DiaIA;
  porDia: DiaIA[];
  modelos: string[];
}

const vazioIA = (dia: string): DiaIA => ({ dia, chamadas: 0, falhas: 0, tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 });

/** Lê as colunas de uso; nas linhas antigas (sem colunas) extrai do texto do motivo. */
export function usoDaLinha(l: { motivo: string | null; tokens_entrada: number | null; tokens_saida: number | null; custo_usd: number | string | null }) {
  const m = l.motivo?.match(/(\d+) chamadas, (\d+) falhas; (\d+) tokens de entrada, (\d+) de saída; custo estimado US\$ ([\d.]+)/);
  return {
    chamadas: m ? Number(m[1]) : 0,
    falhas: m ? Number(m[2]) : 0,
    tokensEntrada: l.tokens_entrada ?? (m ? Number(m[3]) : 0),
    tokensSaida: l.tokens_saida ?? (m ? Number(m[4]) : 0),
    custoUsd: l.custo_usd != null ? Number(l.custo_usd) : m ? Number(m[5]) : 0,
  };
}

export async function custoIA(p: Painel): Promise<CustoIA> {
  const total = vazioIA('total');
  if (!p.sim) return { total, porDia: [], modelos: [] };
  const cliente = await supabaseServidor();
  const sim = p.sim.id;
  const linhas = await todas<{
    data_hora_simulada: string | null; entidade_id: string | null; motivo: string | null;
    tokens_entrada: number | null; tokens_saida: number | null; custo_usd: number | string | null; modelo_ia: string | null;
  }>((de, ate) =>
    cliente.from('log_auditoria').select('data_hora_simulada, entidade_id, motivo, tokens_entrada, tokens_saida, custo_usd, modelo_ia')
      .eq('simulacao_id', sim).eq('acao', 'chamou o AI Proxy').order('log_id').range(de, ate),
  );
  const dias = new Map<string, DiaIA>();
  const modelos = new Set<string>();
  for (const l of linhas) {
    const dia = (l.data_hora_simulada ?? l.entidade_id ?? '').slice(0, 10);
    const d = dias.get(dia) ?? vazioIA(dia);
    const u = usoDaLinha(l);
    for (const k of ['chamadas', 'falhas', 'tokensEntrada', 'tokensSaida', 'custoUsd'] as const) {
      d[k] += u[k];
      total[k] += u[k];
    }
    dias.set(dia, d);
    if (l.modelo_ia) modelos.add(l.modelo_ia);
  }
  return { total, porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)), modelos: [...modelos] };
}

export const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;

// ---------------------------------------------------------------------------
// Gargalos (seção 8)
// ---------------------------------------------------------------------------

export interface Gargalos {
  filaPorAprovador: { aprovador: string; qtd: number; valor: number }[];
  paradosPerto: { tituloId: string; valor: number; minutos: number; exigidos: string[] }[];
  tempoAteAcao: { medianaMin: number | null; acoes: number; semAcao: number };
  falsoPositivo: { retiradas: number; desfeitasValidacao: number; desfeitasHumanos: number; taxa: number | null };
  avisos: { ativos: number; consolidados: number; descartados: number };
}

export const JANELA_PERTO_MIN = 180;

const ts = (s: string) => s.slice(0, 16).replace(' ', 'T');

export async function gargalos(p: Painel): Promise<Gargalos> {
  const g: Gargalos = {
    filaPorAprovador: [], paradosPerto: [],
    tempoAteAcao: { medianaMin: null, acoes: 0, semAcao: 0 },
    falsoPositivo: { retiradas: 0, desfeitasValidacao: 0, desfeitasHumanos: 0, taxa: null },
    avisos: { ativos: 0, consolidados: 0, descartados: 0 },
  };
  if (!p.sim) return g;
  const cliente = await supabaseServidor();
  const sim = p.sim.id;

  const [pend, dec, alertas, humanos, retiradas, validacao, notifs] = await Promise.all([
    todas<{ titulo_id: string; valor: number | string; aprovadores_exigidos: string[] }>((de, ate) =>
      cliente.from('solicitacoes_aprovacao').select('titulo_id, valor, aprovadores_exigidos').eq('simulacao_id', sim).eq('situacao', 'pendente').order('id').range(de, ate)),
    todas<{ titulo_id: string; fechamento: string }>((de, ate) =>
      cliente.from('decisoes').select('titulo_id, fechamento').eq('simulacao_id', sim).in('destino', ['AGUARDANDO_APROVACAO', 'CONFERIDO_AGUARDANDO_APROVADOR']).order('titulo_id').range(de, ate)),
    todas<{ titulo_id: string | null; hora_simulada: string; situacao: string }>((de, ate) =>
      cliente.from('alertas').select('titulo_id, hora_simulada, situacao').eq('simulacao_id', sim).not('titulo_id', 'is', null).order('id').range(de, ate)),
    todas<{ entidade_id: string | null; data_hora_simulada: string | null; acao: string }>((de, ate) =>
      cliente.from('log_auditoria').select('entidade_id, data_hora_simulada, acao').eq('simulacao_id', sim).eq('ator_tipo', 'humano').eq('entidade', 'titulo').order('log_id').range(de, ate)),
    todas<{ entidade_id: string | null }>((de, ate) =>
      cliente.from('log_auditoria').select('entidade_id').eq('simulacao_id', sim).eq('ator_tipo', 'agente_operacao').eq('acao', 'retirou do lote').order('log_id').range(de, ate)),
    todas<{ acao: string }>((de, ate) =>
      cliente.from('log_auditoria').select('acao').eq('simulacao_id', sim).eq('ator_tipo', 'agente_validacao').like('acao', 'devolveu%').order('log_id').range(de, ate)),
    todas<{ situacao: string }>((de, ate) =>
      cliente.from('notificacoes').select('situacao').eq('simulacao_id', sim).order('id').range(de, ate)),
  ]);

  // Fila por aprovador
  const porAprov = new Map<string, { qtd: number; valor: number }>();
  for (const s of pend) {
    for (const a of s.aprovadores_exigidos) {
      const x = porAprov.get(a) ?? { qtd: 0, valor: 0 };
      x.qtd++;
      x.valor += Number(s.valor);
      porAprov.set(a, x);
    }
  }
  g.filaPorAprovador = [...porAprov].map(([aprovador, x]) => ({ aprovador, ...x })).sort((a, b) => b.valor - a.valor);

  // Parados perto do fechamento
  const fech = new Map(dec.map((d) => [d.titulo_id, ts(d.fechamento)]));
  for (const s of pend) {
    const f = fech.get(s.titulo_id);
    if (!f) continue;
    const minutos = minutosEntre(p.hora, f);
    if (minutos > 0 && minutos <= JANELA_PERTO_MIN) g.paradosPerto.push({ tituloId: s.titulo_id, valor: Number(s.valor), minutos, exigidos: s.aprovadores_exigidos });
  }
  g.paradosPerto.sort((a, b) => a.minutos - b.minutos);

  // Tempo entre alerta e primeira ação humana no título (relógio simulado)
  const acoesPorTitulo = new Map<string, string[]>();
  for (const h of humanos) {
    if (!h.entidade_id || !h.data_hora_simulada) continue;
    const l = acoesPorTitulo.get(h.entidade_id) ?? [];
    l.push(ts(h.data_hora_simulada));
    acoesPorTitulo.set(h.entidade_id, l);
  }
  const esperas: number[] = [];
  for (const a of alertas) {
    const inicio = ts(a.hora_simulada);
    const depois = (acoesPorTitulo.get(a.titulo_id!) ?? []).filter((h) => h >= inicio).sort()[0];
    if (depois) esperas.push(minutosEntre(inicio, depois));
    else if (a.situacao === 'aberto') g.tempoAteAcao.semAcao++;
  }
  esperas.sort((a, b) => a - b);
  g.tempoAteAcao.acoes = esperas.length;
  g.tempoAteAcao.medianaMin = esperas.length ? esperas[Math.floor(esperas.length / 2)]! : null;

  // Retiradas desfeitas (falso positivo)
  const retirados = new Set(retiradas.map((r) => r.entidade_id));
  g.falsoPositivo.retiradas = retirados.size;
  g.falsoPositivo.desfeitasValidacao = validacao.length;
  g.falsoPositivo.desfeitasHumanos = humanos.filter((h) => h.acao.startsWith('devolveu')).length;
  if (retirados.size) g.falsoPositivo.taxa = (validacao.length + g.falsoPositivo.desfeitasHumanos) / retirados.size;

  g.avisos = {
    ativos: notifs.filter((n) => n.situacao === 'ativa').length,
    consolidados: notifs.filter((n) => n.situacao === 'consolidada').length,
    descartados: notifs.filter((n) => n.situacao === 'descartada').length,
  };
  return g;
}
