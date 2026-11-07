import { minutosEntre, type HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { Politicas } from '@/lib/config/politicas';
import type { DossieTitulo } from '@/lib/data/indices';
import { resolverAcionamento } from './acionamento';
import { nivelPorValor } from './auxiliares';
import type { ResultadoRegra, Severidade } from './tipos';

export type Destino =
  | 'LIBERADO_AUTOMATICO'
  | 'CONFERIDO_AGUARDANDO_APROVADOR'
  | 'AGUARDANDO_APROVACAO'
  | 'RETIRADO';

export interface DecisaoDestino {
  destino: Destino;
  motivo: string;
  /** Pessoas (pessoa_id da política) a notificar. */
  notificar: string[];
  aprovacao: null | { tipo: 'simples' | 'dupla' | 'alcada_superior'; valor: number; nivel: string; aprovadores: string[] };
  alerta: boolean;
  risco: number;
}

const PESO: Record<Severidade, number> = { critica: 100, conferencia: 60, aprovacao: 40, alerta: 20 };

function resolverPessoas(falhas: ResultadoRegra[], d: DossieTitulo, config: ConfigGoAudit): string[] {
  const dono = d.contrato?.gestor_pessoa_id || config.acionamento.dono_por_categoria[d.fornecedor?.categoria ?? ''] || null;
  const out = new Set<string>();
  for (const f of falhas) {
    // A regra que sabe quem avisar (desvios contratuais: gestor do contrato) manda; as demais seguem a configuração.
    if (f.acionar) f.acionar.forEach((p) => out.add(p));
    else resolverAcionamento([f.codigo], { gestor: dono, dono, responsavel: dono }, config).forEach((p) => out.add(p));
  }
  return [...out];
}

/**
 * Tabela de destinos (seção 5.1). Precedência: crítica > conferência > aprovação >
 * alçada do agente > liberação. Alertas não mudam o destino.
 */
export function decidirDestino(
  d: DossieTitulo,
  resultados: ResultadoRegra[],
  agora: HoraSimulada,
  fechamento: HoraSimulada | null,
  pol: Politicas,
  config: ConfigGoAudit,
  alcadaAgente = pol.alcadas.analistaLiberarAte,
  /** Contrato quando o título é rotina contratual (selo "conforme contrato"). */
  rotina: { contratoId: string; competencia: string | null } | null = null,
): DecisaoDestino {
  const selo = rotina ? ` Conforme contrato ${rotina.contratoId}${rotina.competencia ? ` (competência ${rotina.competencia})` : ''}.` : '';
  const falhas = resultados.filter((r) => !r.passou);
  const de = (s: Severidade) => falhas.filter((f) => f.severidade === s);
  const risco = falhas.length ? Math.max(...falhas.map((f) => PESO[f.severidade])) + Math.min(falhas.length - 1, 5) * 2 : 0;
  const alerta = de('alerta').length > 0;
  const base = { alerta, risco };

  for (const sev of ['critica', 'conferencia'] as const) {
    const fs = de(sev);
    if (fs.length) {
      return {
        ...base,
        destino: 'RETIRADO',
        motivo: fs.map((f) => `${f.codigo}: ${f.motivo}`).join(' '),
        notificar: resolverPessoas(fs, d, config),
        aprovacao: null,
      };
    }
  }

  const aprov = de('aprovacao');
  if (aprov.length) {
    const dupla = aprov.some((f) => f.aprovacao === 'dupla');
    const valor = Math.max(d.valor, ...aprov.map((f) => f.valorConsiderado ?? 0));
    const nivel = nivelPorValor(valor, pol);
    const aprovadores = dupla
      ? ['aprovador', valor > pol.alcadas.aprovadorAte ? pol.alcadas.diretoriaPessoaId : pol.alcadas.coordenacaoPessoaId]
      : [nivel === 'diretoria' ? pol.alcadas.diretoriaPessoaId : 'aprovador'];
    const margem = config.aprovacao.margem_antes_fechamento_min;
    const motivo = aprov.map((f) => `${f.codigo}: ${f.motivo}`).join(' ');
    const notificar = resolverPessoas(aprov, d, config);
    const tipo = dupla ? 'dupla' : aprov.some((f) => f.aprovacao === 'alcada_superior') ? 'alcada_superior' : 'simples';
    if (fechamento && minutosEntre(agora, fechamento) <= margem) {
      return {
        ...base,
        destino: 'RETIRADO',
        motivo: `Sem aprovação até ${margem} min antes do fechamento do lote. ${motivo}`,
        notificar,
        aprovacao: { tipo, valor, nivel, aprovadores },
      };
    }
    return { ...base, destino: 'AGUARDANDO_APROVACAO', motivo, notificar, aprovacao: { tipo, valor, nivel, aprovadores } };
  }

  if (d.valor > alcadaAgente) {
    const nivel = nivelPorValor(d.valor, pol);
    return {
      ...base,
      destino: 'CONFERIDO_AGUARDANDO_APROVADOR',
      motivo: `Passou em todas as checagens; valor acima da alçada do agente. Dossiê pronto para aprovação (${nivel}).${selo}`,
      notificar: [],
      aprovacao: { tipo: 'simples', valor: d.valor, nivel, aprovadores: [nivel === 'diretoria' ? pol.alcadas.diretoriaPessoaId : 'aprovador'] },
    };
  }

  return { ...base, destino: 'LIBERADO_AUTOMATICO', motivo: `Passou em todas as checagens, dentro da alçada do agente.${selo}`, notificar: [], aprovacao: null };
}
