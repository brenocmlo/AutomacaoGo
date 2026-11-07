import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import { iaDisponivel, MODELO_RESUMO, resumirDecisaoComModelo, type UsoIA } from '@/lib/ai/proxy';
import { raizProjeto } from '@/lib/config/config';
import type { Indices } from '@/lib/data/indices';
import { nfNormalizada } from '@/lib/data/normalizadores';
import type { AvaliacaoTitulo } from '@/lib/rules/motor';
import { brl } from '@/lib/rules/tipos';
import { ASSUNTO_POR_REGRA } from './operacao';

/**
 * Resumo curto em linguagem de negócio (seção 6.3, item 4) das decisões não triviais: retirada e
 * aguardando aprovação. Chamado pelo agente de operação DEPOIS de gravar as decisões; grava em
 * decisoes.resumo_ia. Falha, timeout ou IA desligada NUNCA travam o ciclo: o título segue sem resumo.
 *
 * O que vai ao modelo é o dossiê estruturado das regras (montarDossie), nunca o texto de uma mensagem.
 * Cache por conteúdo do dossiê (título + regras + evidências): só título novo ou decisão que mudou chama a IA;
 * "Nova simulação" reaproveita o texto (e o uso dele é contado no ciclo, como no leitor).
 */

export const DESTINOS_COM_RESUMO = new Set(['RETIRADO', 'AGUARDANDO_APROVACAO']);
const ROTULO_DESTINO: Record<string, string> = { RETIRADO: 'retirado do lote', AGUARDANDO_APROVACAO: 'aguardando aprovação' };

const MAX_POR_CICLO = 12;
const CONCORRENCIA = 4;
const PRAZO_TOTAL_MS = 45_000;

export interface Dossie {
  titulo: string;
  fornecedor: string;
  valor: string;
  vencimento: string | null;
  nf_digitada: string | null;
  nf_normalizada: string | null;
  decisao: string;
  regras: { codigo: string; nome: string; severidade: string; motivo: string }[];
  titulos_relacionados: {
    titulo: string; nf_digitada: string | null; nf_normalizada: string | null; valor: string; vencimento: string; lancado_em: string; situacao: string;
  }[];
  mensagens: { canal: string; tipo: string; risco: string; sinais: string[]; remetente_no_cadastro: boolean | null }[];
  aprovacao: { tipo: string; valor: string; aprovadores: string[] } | null;
  avisar: string[];
}

/** Dossiê estruturado de uma decisão. Só campos fechados das regras e do ERP; nenhum texto bruto de mensagem. */
export function montarDossie(a: AvaliacaoTitulo, idx: Indices): Dossie {
  const t = idx.tituloPorId.get(a.tituloId);
  const falhas = a.resultados.filter((r) => !r.passou);
  const evidencias = new Set(falhas.flatMap((r) => r.evidencias));
  const relacionados = [...evidencias]
    .filter((e) => e !== a.tituloId && idx.tituloPorId.has(e))
    .slice(0, 5)
    .map((e) => {
      const o = idx.tituloPorId.get(e)!;
      return {
        titulo: o.titulo_id,
        nf_digitada: o.numero_nf_digitado || null,
        nf_normalizada: nfNormalizada(o.numero_nf_digitado) || null,
        valor: brl(Number(o.valor)),
        vencimento: o.vencimento,
        lancado_em: o.data_lancamento.slice(0, 16),
        situacao: o.status,
      };
    });
  return {
    titulo: a.tituloId,
    fornecedor: idx.fornecedorPorId.get(a.fornecedorId)?.nome_fantasia ?? a.fornecedorId,
    valor: brl(a.valor),
    vencimento: t?.vencimento ?? null,
    nf_digitada: t?.numero_nf_digitado || null,
    nf_normalizada: nfNormalizada(t?.numero_nf_digitado) || null,
    decisao: ROTULO_DESTINO[a.decisao.destino] ?? a.decisao.destino,
    regras: falhas.map((r) => ({ codigo: r.codigo, nome: ASSUNTO_POR_REGRA[r.codigo] ?? r.codigo, severidade: r.severidade, motivo: r.motivo.slice(0, 300) })),
    titulos_relacionados: relacionados,
    mensagens: idx.leituras
      .filter((l) => evidencias.has(l.comunicacaoId))
      .slice(0, 3)
      .map((l) => ({ canal: l.canal, tipo: l.tipo, risco: l.risco, sinais: l.sinais, remetente_no_cadastro: l.remetenteConfere })),
    aprovacao: a.decisao.aprovacao
      ? { tipo: a.decisao.aprovacao.tipo, valor: brl(a.decisao.aprovacao.valor), aprovadores: a.decisao.aprovacao.aprovadores }
      : null,
    avisar: a.decisao.notificar,
  };
}

export const chaveResumo = (d: Dossie) => createHash('sha1').update(JSON.stringify(d)).digest('hex');

// ---------------------------------------------------------------------------
// Cache (memória do processo + cópia em disco, como o das mensagens)
// ---------------------------------------------------------------------------
export interface ResumoCache { texto: string; uso: UsoIA }
const g = globalThis as typeof globalThis & { __goauditResumos?: Map<string, ResumoCache>; __goauditResumosMtime?: number };
export const cacheResumos: Map<string, ResumoCache> = (g.__goauditResumos ??= new Map());
export const arquivoCacheResumos = () => path.join(raizProjeto(), 'node_modules', '.cache', 'goaudit', 'resumos-ia.json');

export function carregarCacheResumos(): void {
  try {
    const arq = arquivoCacheResumos();
    const mtime = fs.statSync(arq).mtimeMs;
    if (mtime === g.__goauditResumosMtime) return;
    const { entradas } = JSON.parse(fs.readFileSync(arq, 'utf8')) as { entradas: [string, ResumoCache][] };
    for (const [k, v] of entradas) if (!cacheResumos.has(k)) cacheResumos.set(k, v);
    g.__goauditResumosMtime = mtime;
  } catch {
    // sem arquivo ou ilegível: segue sem ele
  }
}

export function salvarCacheResumos(): void {
  try {
    const arq = arquivoCacheResumos();
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    const tmp = `${arq}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ versao: 1, entradas: [...cacheResumos] }));
    fs.renameSync(tmp, arq);
    g.__goauditResumosMtime = fs.statSync(arq).mtimeMs;
  } catch {
    // o disco é só um atalho
  }
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------
export type GeradorResumo = (dossie: Dossie) => Promise<{ texto: string | null; uso: UsoIA }>;

export interface ResultadoResumos {
  /** Resumos aplicados neste ciclo (inclui os vindos do cache). */
  aplicados: number;
  /** Chamadas reais à IA. */
  chamadas: number;
  falhas: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}

const vazio = (): ResultadoResumos => ({ aplicados: 0, chamadas: 0, falhas: 0, tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 });

/** Núcleo sem banco: dossiês → texto. Respeita cache, limite por ciclo e prazo total; nunca lança. */
export async function produzirResumos(
  dossies: Dossie[],
  gerar: GeradorResumo,
  cache: Map<string, ResumoCache> = cacheResumos,
  opcoes: { max?: number; concorrencia?: number; prazoMs?: number } = {},
): Promise<{ textos: Map<string, string>; r: ResultadoResumos; novos: number }> {
  const { max = MAX_POR_CICLO, concorrencia = CONCORRENCIA, prazoMs = PRAZO_TOTAL_MS } = opcoes;
  const r = vazio();
  const textos = new Map<string, string>();
  const somar = (u: UsoIA) => {
    r.tokensEntrada += u.tokensEntrada;
    r.tokensSaida += u.tokensSaida;
    r.custoUsd += u.custoUsd;
  };
  const faltam: Dossie[] = [];
  for (const d of dossies) {
    const c = cache.get(chaveResumo(d));
    if (c) {
      textos.set(d.titulo, c.texto);
      r.aplicados++;
      somar(c.uso);
    } else faltam.push(d);
  }
  const prazo = Date.now() + prazoMs;
  const fila = faltam.slice(0, max);
  let novos = 0;
  for (let i = 0; i < fila.length && Date.now() < prazo; i += concorrencia) {
    await Promise.all(
      fila.slice(i, i + concorrencia).map(async (d) => {
        try {
          const restante = Math.max(1, prazo - Date.now());
          const res = await Promise.race([
            gerar(d),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('prazo')), restante).unref?.()),
          ]);
          r.chamadas++;
          somar(res.uso);
          if (!res.texto) { r.falhas++; return; }
          cache.set(chaveResumo(d), { texto: res.texto, uso: res.uso });
          textos.set(d.titulo, res.texto);
          r.aplicados++;
          novos++;
        } catch {
          r.falhas++; // sem resumo: o título segue (RNF13)
        }
      }),
    );
  }
  return { textos, r, novos };
}

/**
 * Passo do agente de operação, depois de gravar as decisões: gera e grava resumo_ia das decisões não
 * triviais que ainda não têm resumo (o agente zera resumo_ia quando a decisão do título muda).
 * Nunca lança: qualquer erro vira "sem resumo".
 */
export async function gerarResumos(
  op: SupabaseClient,
  sim: string,
  hora: HoraSimulada,
  avaliacoes: AvaliacaoTitulo[],
  idx: Indices,
  opcoes: { gerador?: GeradorResumo; ativo?: boolean; cache?: Map<string, ResumoCache>; max?: number; prazoMs?: number } = {},
): Promise<ResultadoResumos> {
  const { gerador = resumirDecisaoComModelo, ativo = iaDisponivel(), cache = cacheResumos } = opcoes;
  if (!ativo) return vazio();
  try {
    const candidatas = avaliacoes.filter((a) => DESTINOS_COM_RESUMO.has(a.decisao.destino));
    if (!candidatas.length) return vazio();
    if (cache === cacheResumos) carregarCacheResumos();

    // Só as decisões gravadas, com o mesmo destino e ainda sem resumo.
    const gravadas = new Map<string, { destino: string; resumo_ia: string | null }>();
    for (let i = 0; i < candidatas.length; i += 200) {
      const ids = candidatas.slice(i, i + 200).map((a) => a.tituloId);
      const { data, error } = await op.from('decisoes').select('titulo_id, destino, resumo_ia').eq('simulacao_id', sim).in('titulo_id', ids);
      if (error) return vazio();
      for (const d of (data ?? []) as { titulo_id: string; destino: string; resumo_ia: string | null }[]) gravadas.set(d.titulo_id, d);
    }
    const pendentes = candidatas.filter((a) => {
      const d = gravadas.get(a.tituloId);
      return d && d.destino === a.decisao.destino && !d.resumo_ia;
    });
    if (!pendentes.length) return vazio();

    const dossies = pendentes.map((a) => montarDossie(a, idx));
    const { textos, r, novos } = await produzirResumos(dossies, gerador, cache, { max: opcoes.max, prazoMs: opcoes.prazoMs });
    if (novos && cache === cacheResumos) salvarCacheResumos();

    let gravados = 0;
    for (const a of pendentes) {
      const texto = textos.get(a.tituloId);
      if (!texto) continue;
      const { error } = await op
        .from('decisoes')
        .update({ resumo_ia: texto })
        .eq('simulacao_id', sim)
        .eq('titulo_id', a.tituloId)
        .eq('destino', a.decisao.destino)
        .is('resumo_ia', null);
      if (error) r.falhas++;
      else gravados++;
    }
    r.aplicados = gravados;

    // Custo de IA visível (princípio 8), na mesma ação que o leitor usa: o painel soma as duas.
    if (r.aplicados || r.falhas) {
      await op.from('log_auditoria').upsert(
        {
          simulacao_id: sim, data_hora_simulada: `${hora}:00`, ator_tipo: 'agente_operacao', acao: 'chamou o AI Proxy', entidade: 'ciclo', entidade_id: hora,
          motivo: `resumos das decisões: ${r.aplicados} chamadas, ${r.falhas} falhas; ${r.tokensEntrada} tokens de entrada, ${r.tokensSaida} de saída; custo estimado US$ ${r.custoUsd.toFixed(5)}`,
          modelo_ia: MODELO_RESUMO, tokens_entrada: r.tokensEntrada, tokens_saida: r.tokensSaida, custo_usd: r.custoUsd,
          chave: `resumo-ia|${hora}`,
        },
        { onConflict: 'simulacao_id,chave', ignoreDuplicates: true },
      );
    }
    return r;
  } catch {
    return vazio();
  }
}
