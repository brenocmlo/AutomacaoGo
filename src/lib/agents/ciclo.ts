import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import { contexto } from '@/lib/contexto';
import { avaliarComIndices } from '@/lib/rules/motor';
import { todas } from '@/lib/supabase/paginacao';
import { registrarContratos, type ResultadoContratos } from './contratos';
import { recortarAte } from '@/lib/data/base';
import { refinarComIA } from '@/lib/mensagens/ia';
import { alertarGolpes, executarLeitor, type ResultadoLeitor } from './leitor';
import { executarValidacao, type ResultadoValidacao } from './validacao';
import { clienteAgente } from '@/lib/supabase/agentes';
import { gerarResumos, type ResultadoResumos } from './resumos';
import { executarOperacao, fecharLotes, type DecisaoAtual, type ResultadoOperacao } from './operacao';

export { todas };

export const paraHora = (ts: string): HoraSimulada => ts.replace(' ', 'T').slice(0, 16);

export interface ResultadoCiclo extends Partial<ResultadoOperacao> {
  contratos?: ResultadoContratos;
  validacao?: ResultadoValidacao;
  leitor?: ResultadoLeitor;
  resumos?: ResultadoResumos;
  hora: HoraSimulada;
  jaExecutado: boolean;
  titulosAvaliados: number;
  enviados: number;
  duracaoMs: number;
}

async function estadoAtual(cliente: SupabaseClient, sim: string) {
  const decisoes = await todas<DecisaoAtual & { valor: number | string }>((de, ate) =>
    cliente.from('decisoes').select('titulo_id, destino, regras, lote, fechamento, valor').eq('simulacao_id', sim).range(de, ate),
  );
  const movimentos = await todas<{ titulo_id: string; tipo: string; id: number }>((de, ate) =>
    cliente.from('movimentos_lote').select('id, titulo_id, tipo').eq('simulacao_id', sim).order('id').range(de, ate),
  );
  const pendentes = await todas<{ id: string; titulo_id: string }>((de, ate) =>
    cliente.from('solicitacoes_aprovacao').select('id, titulo_id').eq('simulacao_id', sim).eq('situacao', 'pendente').range(de, ate),
  );
  const ultimo = new Map<string, string>();
  for (const m of movimentos) ultimo.set(m.titulo_id, m.tipo); // ordenado por id: o último vence
  return {
    atuais: new Map(decisoes.map((d) => [d.titulo_id, { ...d, valor: Number(d.valor) }])),
    retirados: new Set([...ultimo].filter(([, tipo]) => tipo === 'retirada').map(([t]) => t)),
    pendentes: new Map(pendentes.map((p) => [p.titulo_id, p.id])),
  };
}

/**
 * Um passo do relógio (seção 7), na hora já avançada. Idempotente: se o ciclo desta
 * hora já foi concluído, não faz nada; se caiu no meio, as chaves únicas evitam ações em dobro.
 */
export async function executarCiclo(sim: string, hora: HoraSimulada): Promise<ResultadoCiclo> {
  const t0 = Date.now();
  const op = await clienteAgente('operacao');
  const horaTs = `${hora}:00`;

  const { data: existente } = await op.from('ciclos').select('id, situacao').eq('simulacao_id', sim).eq('hora_simulada', horaTs).maybeSingle();
  if (existente?.situacao === 'concluido') {
    return { hora, jaExecutado: true, titulosAvaliados: 0, enviados: 0, duracaoMs: Date.now() - t0 };
  }
  let cicloId = existente?.id as number | undefined;
  if (!cicloId) {
    const { data, error } = await op.from('ciclos').insert({ simulacao_id: sim, hora_simulada: horaTs }).select('id').single();
    if (error) throw new Error(`ciclos: ${error.message}`);
    cicloId = data.id as number;
  }

  try {
    const { base, config } = contexto();
    const estado = await estadoAtual(op, sim);
    // 2–4) o que chegou até a hora. A IA lê as mensagens novas primeiro (falha = regras, RNF13); depois o motor de regras.
    const chegadas = recortarAte(base, hora, config.chegada.extrato_hora_disponivel).comunicacoes;
    // O que este ciclo lê pela primeira vez nesta simulação: tudo no primeiro ciclo; depois, o que chegou desde o anterior.
    const { data: anterior } = await op.from('ciclos').select('hora_simulada').eq('simulacao_id', sim).eq('situacao', 'concluido')
      .lt('hora_simulada', horaTs).order('hora_simulada', { ascending: false }).limit(1).maybeSingle();
    const desde = anterior ? paraHora(anterior.hora_simulada as string) : null;
    const ia = await refinarComIA(chegadas, desde ? chegadas.filter((c) => paraHora(c.data_hora) > desde) : chegadas);
    const { avaliacoes, idx, contratos } = avaliarComIndices(base, config, hora, { retirados: estado.retirados });
    // 3) o leitor (conta própria, sem poder de ação) processa as mensagens novas; o R14 já usou o resultado dele
    const leitor = await executarLeitor(await clienteAgente('leitor'), sim, hora, idx, ia);
    const lancadoPor = new Map(base.titulos.map((t) => [t.titulo_id, t.lancado_por]));
    const donoAlerta = (cod: string) => config.acionamento.por_regra[cod]?.find((p) => !p.startsWith('@')) ?? null;

    // 5) agente de operação executa os destinos
    const r = await executarOperacao(op, sim, hora, avaliacoes, estado.atuais, estado.retirados, estado.pendentes, lancadoPor, donoAlerta);

    // 5-IA) resumo curto em linguagem de negócio das decisões não triviais (falha não trava o ciclo)
    const resumos = await gerarResumos(op, sim, hora, avaliacoes, idx);

    // 5a) alerta de golpe por mensagem: quem age é a operação, nunca o leitor
    await alertarGolpes(op, sim, hora, idx, config);

    // 5b) vínculo com contratos, competências e alertas dos desvios D01–D10
    const rc = await registrarContratos(op, sim, hora, contratos, idx);

    // 6) agente de validação (conta própria) revisa o que a operação decidiu, antes do fechamento.
    // Avalia a agenda inteira (sem tirar as retiradas) para ter as evidências de quem foi retirado.
    const val = await clienteAgente('validacao');
    const completa = avaliarComIndices(base, config, hora);
    const rv = await executarValidacao(val, sim, hora, { avaliacoes: completa.avaliacoes, idx: completa.idx, config, contratos: completa.contratos });
    if (rv.devolvidas || rv.retiradas) {
      // o que a validação mexeu vale para o fechamento deste mesmo ciclo
      const novo = await estadoAtual(op, sim);
      for (const [t, d] of novo.atuais) estado.atuais.set(t, d);
    }

    // 7) lotes que fecharam
    const mexidos = new Set(rv.mexidos);
    for (const a of avaliacoes) {
      if (mexidos.has(a.tituloId)) continue; // a validação já decidiu
      const atual = estado.atuais.get(a.tituloId);
      if (!atual || !['APROVADO', 'RECUSADO', 'DEVOLVIDO', 'ENVIADO'].includes(atual.destino)) {
        estado.atuais.set(a.tituloId, { titulo_id: a.tituloId, destino: a.decisao.destino, regras: a.regrasDisparadas, lote: a.lote, fechamento: a.fechamento, valor: a.valor });
      }
    }
    const enviados = await fecharLotes(op, sim, hora, estado.atuais);

    await op.from('log_auditoria').upsert(
      {
        simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'motor_regras', acao: 'avaliou a agenda', entidade: 'ciclo',
        entidade_id: hora, motivo: `${avaliacoes.length} títulos avaliados; ${r.decisoesGravadas} decisões mudaram; ${r.retiradas} retiradas; ${enviados} enviados; ${rc.alertas} alertas de contrato; mensagens: ${leitor.lidas} lidas, ${leitor.comRisco} de risco; validação: ${rv.revisadas} revisadas, ${rv.devolvidas} devolvidas`,
        chave: `ciclo|${hora}`,
      },
      { onConflict: 'simulacao_id,chave', ignoreDuplicates: true },
    );

    const duracaoMs = Date.now() - t0;
    await op.from('ciclos').update({ situacao: 'concluido', duracao_ms: duracaoMs, titulos_avaliados: avaliacoes.length }).eq('id', cicloId);
    return { hora, jaExecutado: false, titulosAvaliados: avaliacoes.length, enviados, duracaoMs, contratos: rc, validacao: rv, leitor, resumos, ...r };
  } catch (e) {
    await op.from('ciclos').update({ situacao: 'falhou', duracao_ms: Date.now() - t0 }).eq('id', cicloId);
    throw e;
  }
}
