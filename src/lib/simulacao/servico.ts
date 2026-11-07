import type { SupabaseClient } from '@supabase/supabase-js';
import { minutosEntre, somarMinutos, type HoraSimulada } from '@/lib/clock/relogio';
import { contexto, nomeCenario } from '@/lib/contexto';
import { executarCiclo, paraHora, type ResultadoCiclo } from '@/lib/agents/ciclo';

export interface Simulacao {
  id: string;
  nome: string;
  cenario: string;
  inicio: HoraSimulada;
  fim: HoraSimulada;
  hora: HoraSimulada;
  situacao: 'ativa' | 'pausada' | 'encerrada';
}

/** Simulação mais recente (lida com a sessão de quem pede, sob RLS). */
export async function simulacaoAtual(cliente: SupabaseClient): Promise<Simulacao | null> {
  const { data } = await cliente
    .from('simulacoes')
    .select('id, nome, cenario, inicio, fim, hora_simulada, situacao')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, nome: data.nome, cenario: data.cenario, situacao: data.situacao,
    inicio: paraHora(data.inicio), fim: paraHora(data.fim), hora: paraHora(data.hora_simulada),
  };
}

/**
 * Inicia uma simulação nova e roda o primeiro ciclo (reinício rápido da demo).
 *
 * Nada é apagado: todas as tabelas de estado (decisões, movimentos de lote, solicitações, alertas,
 * notificações, mensagens processadas, ciclos) são chaveadas por `simulacao_id`, e o painel só lê a
 * simulação mais recente. Uma `simulacao_id` nova já é uma tela limpa, sem DELETE (que o log de
 * auditoria imutável também impediria: a FK dele é `on delete restrict`). As contas ficam.
 * O custo do reinício é um ciclo (~2 s de regras + gravações); a leitura das mensagens por IA só
 * demora na primeira vez do processo (poucas mensagens na base enxuta); depois vem do cache (ver `npm run demo:aquecer`).
 */
export async function iniciarSimulacao(admin: SupabaseClient): Promise<{ sim: Simulacao; ciclo: ResultadoCiclo }> {
  const p = contexto().base.politicas.periodo;
  const inicio = p.inicio.slice(0, 16);
  const { error: e1 } = await admin.from('simulacoes').update({ situacao: 'encerrada' }).neq('situacao', 'encerrada');
  if (e1) throw new Error(e1.message);
  const { error } = await admin.from('simulacoes').insert({
    nome: `Simulação ${new Date().toLocaleString('pt-BR')}`,
    cenario: nomeCenario(),
    inicio: `${inicio}:00`,
    fim: `${p.fim.slice(0, 16)}:00`,
    hora_simulada: `${inicio}:00`,
  });
  if (error) throw new Error(error.message);
  const sim = (await simulacaoAtual(admin))!;
  return { sim, ciclo: await executarCiclo(sim.id, sim.hora) };
}

/** Avança o relógio N passos; cada passo é um ciclo completo. */
export async function avancarSimulacao(admin: SupabaseClient, passos: number): Promise<ResultadoCiclo[]> {
  const sim = await simulacaoAtual(admin);
  if (!sim) throw new Error('Nenhuma simulação iniciada.');
  if (sim.situacao !== 'ativa') throw new Error(`A simulação está ${sim.situacao}.`);
  const passo = contexto().config.relogio.passo_minutos;
  const out: ResultadoCiclo[] = [];
  let hora = sim.hora;
  for (let i = 0; i < passos && minutosEntre(hora, sim.fim) > 0; i++) {
    hora = somarMinutos(hora, passo);
    const encerrou = minutosEntre(hora, sim.fim) <= 0;
    const { error } = await admin
      .from('simulacoes')
      .update({ hora_simulada: `${hora}:00`, ...(encerrou ? { situacao: 'encerrada' } : {}) })
      .eq('id', sim.id);
    if (error) throw new Error(error.message);
    out.push(await executarCiclo(sim.id, hora));
  }
  return out;
}

export async function pausarSimulacao(admin: SupabaseClient, pausar: boolean): Promise<void> {
  const sim = await simulacaoAtual(admin);
  if (!sim || sim.situacao === 'encerrada') return;
  const { error } = await admin.from('simulacoes').update({ situacao: pausar ? 'pausada' : 'ativa' }).eq('id', sim.id);
  if (error) throw new Error(error.message);
}
