import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { BaseEntrada } from '@/lib/data/base';
import { planejarHora } from '@/lib/geracao/eventos';
import { geradorLigado, intensidadeConfigurada, type EventoGerado, type Intensidade } from '@/lib/geracao/tipos';
import { clienteAgente } from '@/lib/supabase/agentes';
import { todas } from '@/lib/supabase/paginacao';
import { inserirTolerante } from './leitor';

/**
 * Agente gerador de eventos (conta `agente_gerador`). Uma vez por hora simulada, faz chegar títulos e mensagens
 * novos de fornecedores na simulação. Pela RLS só INSERE em `eventos_gerados` e no log: não lê decisões, não aprova,
 * não age em título. O que ele gera é lido por todos pelo mesmo caminho (`baseComEventos`), como se tivesse vindo do ERP.
 *
 * Determinístico por (simulação, hora): a estrutura vem de uma semente e a chave única impede duplicar ao reexecutar o ciclo.
 * Só o TEXTO das mensagens vem da IA; com falha, timeout ou saída reprovada na validação, entra o modelo fixo (nunca trava o ciclo).
 */

export interface ResultadoGerador {
  ativo: boolean;
  /** Eventos (acontecimentos) criados nesta execução. */
  eventos: number;
  /** Linhas de arquivos criadas nesta execução. */
  linhas: number;
  ia: { chamadas: number; falhas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number };
  /** Preenchido quando o gerador falhou e o ciclo seguiu sem ele. */
  erro?: string;
}

export const SEM_GERADOR: ResultadoGerador = { ativo: false, eventos: 0, linhas: 0, ia: { chamadas: 0, falhas: 0, tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 } };
const novoResultado = (): ResultadoGerador => ({ ...SEM_GERADOR, ia: { ...SEM_GERADOR.ia }, ativo: true });

interface LinhaEvento {
  hora_simulada: string;
  evento: string;
  trilha: EventoGerado['trilha'];
  arquivo: EventoGerado['arquivo'];
  linha: Record<string, string>;
  fornecedor_id: string | null;
  origem: EventoGerado['origem'];
  modelo_ia: string | null;
  chave: string;
}

const paraHora = (ts: string): HoraSimulada => ts.replace(' ', 'T').slice(0, 16);

/**
 * Eventos já gerados na simulação (lidos por quem tem permissão de leitura: operação, painel). Sem a tabela
 * (migração 9 ainda não aplicada) ou com erro de leitura devolve [] e a simulação segue só com a base de CSV.
 */
export async function lerEventosGerados(cliente: SupabaseClient, sim: string): Promise<EventoGerado[]> {
  try {
    const linhas = await todas<LinhaEvento>((de, ate) =>
      cliente.from('eventos_gerados')
        .select('hora_simulada, evento, trilha, arquivo, linha, fornecedor_id, origem, modelo_ia, chave')
        .eq('simulacao_id', sim).order('id').range(de, ate),
    );
    return linhas.map((l) => ({
      chave: l.chave, evento: l.evento, hora: paraHora(l.hora_simulada), trilha: l.trilha, arquivo: l.arquivo,
      linha: l.linha, origem: l.origem, modeloIa: l.modelo_ia, fornecedorId: l.fornecedor_id,
    }));
  } catch {
    return [];
  }
}

function logDoEvento(sim: string, hora: HoraSimulada, grupo: EventoGerado[]): Record<string, unknown> | null {
  const titulo = grupo.find((e) => e.arquivo === 'contas_a_pagar');
  const base = { simulacao_id: sim, data_hora_simulada: `${hora}:00`, ator_tipo: 'sistema', chave: `gerador|${grupo[0]!.evento}` };
  if (titulo) {
    const l = titulo.linha;
    return {
      ...base, entidade: 'titulo', entidade_id: l.titulo_id, valor_em_jogo: Number(l.valor),
      acao: titulo.trilha === 'duplicidade' ? 'gerou título relançado (duplicidade)' : 'gerou título de fornecedor',
      motivo: `Evento gerado (${titulo.trilha}): ${l.historico}, vencimento ${l.vencimento}, lote ${l.lote_remessa}.`,
    };
  }
  return null;
}

/**
 * Gera (se ainda não gerou) os eventos desta hora e os grava. `existentes`: tudo o que a simulação já tem em
 * `eventos_gerados`, lido por outra conta. Devolve só os eventos NOVOS gravados agora.
 */
export async function executarGerador(
  sim: string,
  hora: HoraSimulada,
  base: BaseEntrada,
  config: ConfigGoAudit,
  existentes: readonly EventoGerado[],
  opcoes: { intensidade?: Intensidade; cliente?: SupabaseClient } = {},
): Promise<{ novos: EventoGerado[]; resultado: ResultadoGerador }> {
  if (!geradorLigado()) return { novos: [], resultado: SEM_GERADOR };
  const r = novoResultado();
  try {
    // Já gerou esta hora (ciclo reexecutado, ou caiu no meio): os eventos estão lá, não se faz nada.
    if (existentes.some((e) => e.hora === hora)) return { novos: [], resultado: r };
    const plano = planejarHora(base, config, {
      sim, hora, intensidade: opcoes.intensidade ?? intensidadeConfigurada(), anteriores: existentes.filter((e) => e.hora < hora),
    });
    if (!plano.eventos.length) return { novos: [], resultado: r };

    const cliente = opcoes.cliente ?? (await clienteAgente('gerador'));
    
    const linhas = plano.eventos.map((e) => ({
      simulacao_id: sim, hora_simulada: `${e.hora}:00`, evento: e.evento, trilha: e.trilha, arquivo: e.arquivo, linha: e.linha,
      fornecedor_id: e.fornecedorId ?? null, origem: e.origem, modelo_ia: e.modeloIa ?? null, chave: e.chave,
    }));
    await inserirTolerante(cliente, 'eventos_gerados', sim, linhas, (l) => String(l.chave));

    const porEvento = new Map<string, EventoGerado[]>();
    for (const e of plano.eventos) porEvento.set(e.evento, [...(porEvento.get(e.evento) ?? []), e]);
    const logs = [...porEvento.values()].map((g) => logDoEvento(sim, hora, g)).filter((x): x is Record<string, unknown> => x !== null);
    await inserirTolerante(cliente, 'log_auditoria', sim, logs, (l) => String(l.chave));

    r.eventos = porEvento.size;
    r.linhas = plano.eventos.length;
    return { novos: plano.eventos, resultado: r };
  } catch (e) {
    // O gerador é um enfeite vivo da demo: sem conta, sem migração ou sem rede, o ciclo segue só com a base de CSV.
    r.erro = e instanceof Error ? e.message : String(e);
    console.warn(`[gerador] ${hora}: ${r.erro}`);
    return { novos: [], resultado: r };
  }
}
