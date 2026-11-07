import type { SupabaseClient } from '@supabase/supabase-js';
import { minutosEntre, type HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { AnaliseContratos } from '@/lib/contratos/tipos';
import type { Indices } from '@/lib/data/indices';
import type { AvaliacaoTitulo } from '@/lib/rules/motor';
import { todas } from '@/lib/supabase/paginacao';
import { revisarLiberacao, revisarRetirada, type ContextoRevisao, type Veredito } from './revisores';

/**
 * Agente de validação (seção 6.4). Roda depois da operação, com a própria conta e o próprio JWT
 * (quem executa não confere a si mesmo). Antes do fechamento de cada lote, dentro da margem
 * configurada, revisa:
 *  - retiradas: devolve ao lote o falso positivo, a tempo de evitar multa, juros e custo de relacionamento;
 *  - liberações automáticas acima do valor de corte: retira se houver sinal de risco;
 *  - notificações: descarta as que perderam o motivo e consolida as repetidas (cada acionamento custa caro).
 * Cada revisão vai ao log com o título, as regras e a justificativa. Idempotente (chaves únicas).
 */

export interface ResultadoValidacao {
  revisadas: number;
  devolvidas: number;
  confirmadas: number;
  retiradas: number;
  notificacoesDescartadas: number;
  notificacoesConsolidadas: number;
  /** Títulos cujo destino a validação alterou neste ciclo (devolvidos ou retirados). */
  mexidos: string[];
}

interface DecisaoBanco {
  titulo_id: string;
  destino: string;
  fechamento: string;
  valor: number | string;
  lote: string;
  regras: string[];
}

const RESOLVIDOS = new Set(['DEVOLVIDO', 'APROVADO', 'RECUSADO', 'ENVIADO']);

function partes<T>(itens: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n));
  return out;
}

const assuntoBase = (assunto: string) => assunto.replace(/\s*\(\d+ títulos?\)\s*$/, '');

export async function executarValidacao(
  cliente: SupabaseClient,
  sim: string,
  hora: HoraSimulada,
  entrada: { avaliacoes: AvaliacaoTitulo[]; idx: Indices; config: ConfigGoAudit; contratos: AnaliseContratos },
): Promise<ResultadoValidacao> {
  const horaTs = `${hora}:00`;
  const { config } = entrada;
  const r: ResultadoValidacao = { revisadas: 0, devolvidas: 0, confirmadas: 0, retiradas: 0, notificacoesDescartadas: 0, notificacoesConsolidadas: 0, mexidos: [] };

  const decisoes = await todas<DecisaoBanco>((de, ate) =>
    cliente.from('decisoes').select('titulo_id, destino, fechamento, valor, lote, regras').eq('simulacao_id', sim).order('titulo_id').range(de, ate),
  );
  const destinos = new Map(decisoes.map((d) => [d.titulo_id, d.destino]));
  const avPorTitulo = new Map(entrada.avaliacoes.map((a) => [a.tituloId, a]));
  const ctx: ContextoRevisao = { idx: entrada.idx, config, agora: hora, contratos: entrada.contratos, destinos };

  // 1) Casos dos lotes que fecham dentro da margem de revisão
  const margem = config.validacao.margem_revisao_min;
  const noPrazo = (d: DecisaoBanco) => {
    const min = minutosEntre(hora, d.fechamento.slice(0, 16).replace(' ', 'T'));
    return min > 0 && min <= margem;
  };
  const casos: { d: DecisaoBanco; av: AvaliacaoTitulo; v: Veredito }[] = [];
  for (const d of decisoes.filter(noPrazo)) {
    const av = avPorTitulo.get(d.titulo_id);
    if (!av) continue;
    if (d.destino === 'RETIRADO') casos.push({ d, av, v: revisarRetirada(av, ctx) });
    else if (d.destino === 'LIBERADO_AUTOMATICO' && Number(d.valor) > config.validacao.valor_corte_liberacao) casos.push({ d, av, v: revisarLiberacao(av, ctx) });
  }

  const log: Record<string, unknown>[] = [];
  const devolver = casos.filter((c) => c.v.acao === 'devolver');
  const retirar = casos.filter((c) => c.v.acao === 'retirar');

  for (const c of devolver) {
    const { error } = await cliente.from('decisoes').update({
      destino: 'DEVOLVIDO', motivo: c.v.motivo.slice(0, 1000), agente: 'agente_validacao', hora_simulada: horaTs, atualizado_em: new Date().toISOString(),
    }).eq('simulacao_id', sim).eq('titulo_id', c.d.titulo_id).eq('destino', 'RETIRADO');
    if (error) throw new Error(`validação (devolver ${c.d.titulo_id}): ${error.message}`);
  }
  if (devolver.length) {
    const { error } = await cliente.from('movimentos_lote').upsert(
      devolver.map((c) => ({ simulacao_id: sim, titulo_id: c.d.titulo_id, lote: c.d.lote, tipo: 'devolucao', motivo: c.v.motivo.slice(0, 500), hora_simulada: horaTs })),
      { onConflict: 'simulacao_id,titulo_id,hora_simulada,tipo', ignoreDuplicates: true },
    );
    if (error) throw new Error(`validação (movimentos): ${error.message}`);
  }
  for (const c of retirar) {
    const { error } = await cliente.from('decisoes').update({
      destino: 'RETIRADO', motivo: c.v.motivo.slice(0, 1000), agente: 'agente_validacao', hora_simulada: horaTs, atualizado_em: new Date().toISOString(),
    }).eq('simulacao_id', sim).eq('titulo_id', c.d.titulo_id).eq('destino', 'LIBERADO_AUTOMATICO');
    if (error) throw new Error(`validação (retirar ${c.d.titulo_id}): ${error.message}`);
  }
  if (retirar.length) {
    const { error } = await cliente.from('movimentos_lote').upsert(
      retirar.map((c) => ({ simulacao_id: sim, titulo_id: c.d.titulo_id, lote: c.d.lote, tipo: 'retirada', motivo: c.v.motivo.slice(0, 500), hora_simulada: horaTs })),
      { onConflict: 'simulacao_id,titulo_id,hora_simulada,tipo', ignoreDuplicates: true },
    );
    if (error) throw new Error(`validação (movimentos): ${error.message}`);
  }

  for (const c of casos) {
    const acao =
      c.v.acao === 'devolver' ? 'devolveu ao lote (falso positivo)' : c.v.acao === 'retirar' ? 'retirou liberação de alto valor' : c.d.destino === 'RETIRADO' ? 'confirmou a retirada' : 'conferiu a liberação';
    destinos.set(c.d.titulo_id, c.v.acao === 'devolver' ? 'DEVOLVIDO' : c.v.acao === 'retirar' ? 'RETIRADO' : c.d.destino);
    log.push({
      simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'agente_validacao', acao, entidade: 'titulo', entidade_id: c.d.titulo_id,
      regras: c.d.regras ?? [], evidencias: [...new Set(c.av.resultados.filter((x) => !x.passou).flatMap((x) => x.evidencias))].slice(0, 50),
      motivo: `Decisão original: ${c.d.destino}. ${c.v.motivo}`.slice(0, 1000), valor_em_jogo: Number(c.d.valor),
      chave: `validacao|${c.d.titulo_id}|${c.d.destino}|${c.v.acao}`,
    });
  }
  r.mexidos = [...devolver, ...retirar].map((c) => c.d.titulo_id);
  r.revisadas = casos.length;
  r.devolvidas = devolver.length;
  r.retiradas = retirar.length;
  r.confirmadas = casos.filter((c) => c.v.acao === 'manter').length;

  // 2) Notificações: descarta as que perderam o motivo; consolida as repetidas da mesma pessoa e assunto
  const ativas = await todas<{ id: number; pessoa_id: string; assunto: string; mensagem: string; titulos: string[]; urgencia: string | null }>((de, ate) =>
    cliente.from('notificacoes').select('id, pessoa_id, assunto, mensagem, titulos, urgencia').eq('simulacao_id', sim).eq('situacao', 'ativa').order('id').range(de, ate),
  );
  const semMotivo = ativas.filter((n) => n.titulos.length > 0 && n.titulos.every((t) => RESOLVIDOS.has(destinos.get(t) ?? '')));
  for (const p of partes(semMotivo.map((n) => n.id))) {
    const { error } = await cliente.from('notificacoes').update({ situacao: 'descartada' }).in('id', p);
    if (error) throw new Error(`validação (descartar notificações): ${error.message}`);
  }
  r.notificacoesDescartadas = semMotivo.length;
  if (semMotivo.length) {
    log.push({
      simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'agente_validacao', acao: 'descartou avisos sem efeito', entidade: 'ciclo', entidade_id: hora,
      motivo: `${semMotivo.length} aviso(s) cujos títulos já foram devolvidos, aprovados, recusados ou enviados`, chave: `validacao|descartes|${hora}`,
    });
  }

  const descartadas = new Set(semMotivo.map((n) => n.id));
  const grupos = new Map<string, typeof ativas>();
  for (const n of ativas.filter((x) => !descartadas.has(x.id))) {
    const k = `${n.pessoa_id}|${assuntoBase(n.assunto)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), n]);
  }
  for (const [k, grupo] of grupos) {
    if (grupo.length < 2) continue;
    const [pessoa, base] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const titulos = [...new Set(grupo.flatMap((n) => n.titulos))];
    const { error } = await cliente.from('notificacoes').insert({
      simulacao_id: sim, pessoa_id: pessoa, assunto: `${base} (${titulos.length} títulos)`,
      mensagem: `Consolidado de ${grupo.length} avisos repetidos.\n${titulos.slice(0, 30).join(', ')}${titulos.length > 30 ? ` … e mais ${titulos.length - 30}` : ''}`,
      titulos, urgencia: grupo.some((n) => n.urgencia === 'IMEDIATA') ? 'IMEDIATA' : 'NORMAL', chave: `consolidado|${base}|${hora}`, hora_simulada: horaTs,
    });
    if (error && error.code !== '23505') throw new Error(`validação (consolidar): ${error.message}`);
    const { error: e2 } = await cliente.from('notificacoes').update({ situacao: 'consolidada' }).in('id', grupo.map((n) => n.id));
    if (e2) throw new Error(`validação (consolidar): ${e2.message}`);
    r.notificacoesConsolidadas += grupo.length;
    log.push({
      simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'agente_validacao', acao: 'consolidou avisos repetidos', entidade: 'ciclo', entidade_id: hora,
      motivo: `${grupo.length} avisos de "${base}" para ${pessoa} viraram um só (${titulos.length} títulos)`, chave: `validacao|consolidado|${pessoa}|${base}|${hora}`,
    });
  }

  for (const p of partes(log, 500)) {
    const { error } = await cliente.from('log_auditoria').upsert(p, { onConflict: 'simulacao_id,chave', ignoreDuplicates: true });
    if (error) throw new Error(`validação (log): ${error.message}`);
  }
  return r;
}
