import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { Indices } from '@/lib/data/indices';
import type { Leitura } from '@/lib/mensagens/leitor';
import type { ResultadoIA } from '@/lib/mensagens/ia';
import { todas } from '@/lib/supabase/paginacao';

/**
 * Agente leitor de mensagens (seção 6.2). Roda com a conta `agente_leitor`, que pela RLS só insere
 * em `mensagens_processadas` e no log: não lê decisões, lotes nem aprovações, e não tem como agir.
 * Grava só o resultado fechado da leitura; o texto original não vai para o banco.
 * Idempotente: cada comunicação é gravada uma vez por simulação.
 */

export interface ResultadoLeitor {
  lidas: number;
  novas: number;
  emRevisao: number;
  comRisco: number;
  ia: ResultadoIA;
}

function partes<T>(itens: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n));
  return out;
}

/**
 * Insere sem upsert: com ON CONFLICT o Postgres também confere a política de LEITURA da tabela,
 * e a conta do leitor não lê nada (de propósito). Duplicata (23505) = já gravado → ignora.
 * O que já foi gravado neste processo nem é reenviado; se um lote bater em duplicata, regrava linha a linha.
 */
const gravados = new Map<string, Set<string>>();
export async function inserirTolerante(cliente: SupabaseClient, tabela: string, sim: string, linhas: Record<string, unknown>[], chaveDe: (l: Record<string, unknown>) => string) {
  const feitos = gravados.get(`${sim}|${tabela}`) ?? new Set<string>();
  gravados.set(`${sim}|${tabela}`, feitos);
  const novas = linhas.filter((l) => !feitos.has(chaveDe(l)));
  const marcar = (ls: Record<string, unknown>[]) => ls.forEach((l) => feitos.add(chaveDe(l)));
  for (const lote of partes(novas)) {
    const { error } = await cliente.from(tabela).insert(lote);
    if (!error) { marcar(lote); continue; }
    if (error.code !== '23505') throw new Error(`${tabela}: ${error.message}`);
    for (const l of lote) {
      const { error: e } = await cliente.from(tabela).insert(l);
      if (e && e.code !== '23505') throw new Error(`${tabela}: ${e.message}`);
      feitos.add(chaveDe(l));
    }
  }
}

export async function executarLeitor(cliente: SupabaseClient, sim: string, hora: HoraSimulada, idx: Indices, ia: ResultadoIA): Promise<ResultadoLeitor> {
  const horaTs = `${hora}:00`;
  const leituras = idx.leituras;
  const r: ResultadoLeitor = { lidas: leituras.length, novas: 0, emRevisao: 0, comRisco: 0, ia };
  if (!leituras.length) return r;

  // A conta do leitor não lê a tabela de volta: as chaves únicas garantem a idempotência.
  const linhas = leituras.map((l) => ({
    simulacao_id: sim,
    comunicacao_id: l.comunicacaoId,
    canal: l.canal,
    tipo: l.tipo,
    dados: { urgencia: l.urgencia, fora_do_processo: l.foraDoProcesso, fornecedor_id: l.fornecedorId, nf: l.nfCitada, risco: l.risco, boletos: l.boletos, resumo: l.resumo, ia: l.ia },
    remetente_confere: l.remetenteConfere,
    sinais: l.sinais,
    confianca: l.confianca,
    revisao_humana: l.revisaoHumana,
    modelo_ia: l.modelo,
    hora_simulada: l.dataHora.replace(' ', 'T').slice(0, 19),
  }));
  await inserirTolerante(cliente, 'mensagens_processadas', sim, linhas, (l) => String(l.comunicacao_id));
  r.novas = leituras.length;
  r.emRevisao = leituras.filter((l) => l.revisaoHumana).length;
  r.comRisco = leituras.filter((l) => l.risco !== 'nenhum').length;

  // Log: uma linha por mensagem de risco ou em revisão (as rotineiras ficam só na tabela).
  const relevantes = leituras.filter((l) => l.risco !== 'nenhum' || l.revisaoHumana);
  await inserirTolerante(
    cliente, 'log_auditoria', sim,
    relevantes.map((l) => ({
        simulacao_id: sim,
        data_hora_simulada: horaTs,
        ator_tipo: 'leitor_mensagens',
        acao: l.risco === 'nenhum' ? 'classificou mensagem para revisão humana' : `classificou mensagem de risco (${l.risco})`,
        entidade: 'mensagem',
        entidade_id: l.comunicacaoId,
        motivo: `${l.resumo} · confiança ${l.confianca.toFixed(2)}`.slice(0, 1000),
        chave: `leitor|${l.comunicacaoId}`,
    })),
    (l) => String(l.chave),
  );
  // Custo de IA visível (princípio 8): modelo, tokens e custo estimado de cada ciclo que chamou o proxy.
  if (ia.chamadas || ia.falhas) {
    await inserirTolerante(cliente, 'log_auditoria', sim, [
      {
        simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'leitor_mensagens', acao: 'chamou o AI Proxy', entidade: 'ciclo', entidade_id: hora,
        motivo: `${ia.chamadas} chamadas, ${ia.falhas} falhas; ${ia.tokensEntrada} tokens de entrada, ${ia.tokensSaida} de saída; custo estimado US$ ${ia.custoUsd.toFixed(5)}`,
        tokens_entrada: ia.tokensEntrada, tokens_saida: ia.tokensSaida, custo_usd: ia.custoUsd,
        chave: `leitor-ia|${hora}`,
      },
    ], (l) => String(l.chave));
  }
  return r;
}

/**
 * Alerta de golpe (C06): quem decide e age é o agente de operação, nunca o leitor. Só mensagens de
 * risco crítico ou que se passam por executivo geram alerta; phishing comum (C07) é só classificado.
 * Quem recebe: o acionamento da R14 e, se se passa por executivo, a diretora financeira.
 */
export async function alertarGolpes(op: SupabaseClient, sim: string, hora: HoraSimulada, idx: Indices, config: ConfigGoAudit): Promise<number> {
  const horaTs = `${hora}:00`;
  const base = (config.acionamento.por_regra.R14 ?? []).filter((p) => !p.startsWith('@'));
  const alvo = (l: Leitura) => (l.sinais.includes('personificacao_executivo') ? (config.acionamento.golpe_executivo ?? ['PS03', 'PS08']) : base);
  const linhas = idx.leituras
    .filter((l) => l.risco === 'critico' || l.sinais.includes('personificacao_executivo'))
    .flatMap((l) =>
      alvo(l).map((dono) => ({
        simulacao_id: sim,
        tipo: 'golpe',
        fornecedor_id: l.fornecedorId,
        dono_pessoa_id: dono,
        regras: ['R14'],
        mensagem: `Possível golpe por mensagem (${l.canal}): ${l.resumo}. Nenhum pagamento deve sair por esse pedido.`,
        chave: `golpe|${l.comunicacaoId}|${dono}`,
        hora_simulada: horaTs,
      })),
    );
  for (const p of partes(linhas)) {
    const { error } = await op.from('alertas').upsert(p, { onConflict: 'simulacao_id,chave', ignoreDuplicates: true });
    if (error) throw new Error(`alertas (golpe): ${error.message}`);
  }
  return linhas.length;
}

export { todas };
