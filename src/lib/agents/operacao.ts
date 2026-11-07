import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import type { AvaliacaoTitulo } from '@/lib/rules/motor';
import { brl } from '@/lib/rules/tipos';

/**
 * Agente de operação (seção 6.3). Recebe as avaliações do motor e executa os destinos:
 * grava decisões, retira do lote, abre solicitações de aprovação, notifica e alerta.
 * Tudo com o JWT do próprio agente: o banco recusa o que estiver fora do papel dele.
 * Idempotente: só grava o que mudou e usa chaves únicas (ON CONFLICT DO NOTHING).
 */

/** Destinos decididos por humanos ou pela validação: o agente não sobrescreve. */
export const DESTINOS_FINAIS = new Set(['APROVADO', 'RECUSADO', 'DEVOLVIDO', 'ENVIADO']);

export interface DecisaoAtual {
  titulo_id: string;
  destino: string;
  regras: string[];
  lote: string;
  fechamento: string;
  valor: number;
}

export interface ResultadoOperacao {
  decisoesGravadas: number;
  retiradas: number;
  solicitacoes: number;
  notificacoes: number;
  alertas: number;
}

const ACAO_POR_DESTINO: Record<string, string> = {
  LIBERADO_AUTOMATICO: 'liberou',
  CONFERIDO_AGUARDANDO_APROVADOR: 'conferiu e encaminhou ao aprovador',
  AGUARDANDO_APROVACAO: 'solicitou aprovação',
  RETIRADO: 'retirou do lote',
};

const ASSUNTO_POR_REGRA: Record<string, string> = {
  R01: 'Possível pagamento em duplicidade',
  R02: 'Título já pago por outro caminho',
  R03: 'Divergência entre título e NF',
  R04: 'NF acima da OC ou OC não aprovada',
  R05: 'Fornecedor do título não confere',
  R06: 'Boleto suspeito',
  R07: 'Troca de dados bancários sem confirmação',
  R08: 'Fracionamento / alçada',
  R09: 'Exige aprovação dupla',
  R10: 'Mercadoria sem recebimento',
  R11: 'Valor atípico',
  R12: 'Variação mensal fora da referência',
  R13: 'Lançamento por usuário irregular',
  R14: 'Mensagem de risco',
};

function lotes<T>(itens: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n));
  return out;
}

async function gravar(cliente: SupabaseClient, tabela: string, linhas: Record<string, unknown>[], onConflict: string, ignorar = true) {
  for (const parte of lotes(linhas)) {
    const { error } = await cliente.from(tabela).upsert(parte, { onConflict, ignoreDuplicates: ignorar });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

export async function executarOperacao(
  cliente: SupabaseClient,
  sim: string,
  hora: HoraSimulada,
  avaliacoes: AvaliacaoTitulo[],
  atuais: Map<string, DecisaoAtual>,
  retiradosAgora: Set<string>,
  pendentes: Map<string, string>, // titulo → id da solicitação pendente
  lancadoPor: Map<string, string>,
  donoAlerta: (codigoRegra: string, a: AvaliacaoTitulo) => string | null,
): Promise<ResultadoOperacao> {
  const horaTs = `${hora}:00`;
  const r: ResultadoOperacao = { decisoesGravadas: 0, retiradas: 0, solicitacoes: 0, notificacoes: 0, alertas: 0 };

  const mudaram = avaliacoes.filter((a) => {
    const atual = atuais.get(a.tituloId);
    if (atual && DESTINOS_FINAIS.has(atual.destino)) return false;
    return !atual || atual.destino !== a.decisao.destino || atual.regras.join() !== a.regrasDisparadas.join();
  });

  // 1) Decisões
  await gravar(
    cliente,
    'decisoes',
    mudaram.map((a) => ({
      simulacao_id: sim,
      titulo_id: a.tituloId,
      fornecedor_id: a.fornecedorId,
      categoria: a.categoria,
      valor: a.valor,
      lote: a.lote,
      banco: a.banco,
      fechamento: `${a.fechamento}:00`,
      destino: a.decisao.destino,
      regras: a.regrasDisparadas,
      risco: a.decisao.risco,
      urgencia: a.urgencia,
      motivo: a.decisao.motivo,
      agente: 'agente_operacao',
      donos_pessoa_ids: a.decisao.notificar,
      hora_simulada: horaTs,
      atualizado_em: new Date().toISOString(),
    })),
    'simulacao_id,titulo_id',
    false,
  );
  r.decisoesGravadas = mudaram.length;

  // 2) Retiradas do lote (reversíveis até o fechamento)
  const retirar = mudaram.filter((a) => a.decisao.destino === 'RETIRADO' && !retiradosAgora.has(a.tituloId));
  await gravar(
    cliente,
    'movimentos_lote',
    retirar.map((a) => ({
      simulacao_id: sim, titulo_id: a.tituloId, lote: a.lote, tipo: 'retirada',
      motivo: a.decisao.motivo.slice(0, 500), hora_simulada: horaTs,
    })),
    'simulacao_id,titulo_id,hora_simulada,tipo',
  );
  r.retiradas = retirar.length;

  // 3) Solicitações de aprovação (e expiração quando o título sai do fluxo de aprovação)
  const pedir = mudaram.filter(
    (a) => (a.decisao.destino === 'AGUARDANDO_APROVACAO' || a.decisao.destino === 'CONFERIDO_AGUARDANDO_APROVADOR') && !pendentes.has(a.tituloId) && a.decisao.aprovacao,
  );
  for (const parte of lotes(pedir)) {
    const { error } = await cliente.from('solicitacoes_aprovacao').insert(
      parte.map((a) => ({
        simulacao_id: sim,
        titulo_id: a.tituloId,
        valor: a.decisao.aprovacao!.valor,
        tipo: a.decisao.aprovacao!.tipo,
        nivel: a.decisao.aprovacao!.nivel,
        aprovadores_exigidos: a.decisao.aprovacao!.aprovadores,
        lancado_por: lancadoPor.get(a.tituloId) ?? null,
        motivo: a.decisao.motivo.slice(0, 1000),
        hora_simulada: horaTs,
      })),
    );
    if (error && error.code !== '23505') throw new Error(`solicitacoes_aprovacao: ${error.message}`);
  }
  r.solicitacoes = pedir.length;
  const expirar = mudaram.filter((a) => a.decisao.destino === 'RETIRADO' && pendentes.has(a.tituloId)).map((a) => pendentes.get(a.tituloId)!);
  if (expirar.length) {
    const { error } = await cliente.from('solicitacoes_aprovacao').update({ situacao: 'expirada', concluida_em: new Date().toISOString() }).in('id', expirar);
    if (error) throw new Error(`expirar solicitações: ${error.message}`);
  }

  // 4) Notificações agrupadas por pessoa e assunto (um acionamento por grupo, não por título)
  const grupos = new Map<string, { pessoa: string; assunto: string; titulos: AvaliacaoTitulo[] }>();
  for (const a of mudaram) {
    if (a.decisao.destino !== 'RETIRADO' && a.decisao.destino !== 'AGUARDANDO_APROVACAO') continue;
    const principal = a.resultados.find((x) => !x.passou && x.severidade !== 'alerta')?.codigo ?? a.regrasDisparadas[0] ?? '';
    const assunto = ASSUNTO_POR_REGRA[principal] ?? 'Título exige atenção';
    for (const pessoa of a.decisao.notificar) {
      const k = `${pessoa}|${assunto}`;
      const g = grupos.get(k) ?? { pessoa, assunto, titulos: [] };
      g.titulos.push(a);
      grupos.set(k, g);
    }
  }
  const notifs = [...grupos.values()].map((g) => {
    const total = g.titulos.reduce((s, a) => s + a.valor, 0);
    const imediata = g.titulos.some((a) => a.urgencia === 'IMEDIATA');
    return {
      simulacao_id: sim,
      pessoa_id: g.pessoa,
      assunto: `${g.assunto} (${g.titulos.length} ${g.titulos.length === 1 ? 'título' : 'títulos'})`,
      mensagem: g.titulos.slice(0, 20).map((a) => `${a.tituloId} · ${brl(a.valor)} · ${a.decisao.motivo.slice(0, 200)}`).join('\n') + (g.titulos.length > 20 ? `\n… e mais ${g.titulos.length - 20}` : '') + `\nTotal: ${brl(total)}`,
      titulos: g.titulos.map((a) => a.tituloId),
      urgencia: imediata ? 'IMEDIATA' : 'NORMAL',
      chave: `${hora}|${g.assunto}`,
      hora_simulada: horaTs,
    };
  });
  // Insert simples (não upsert): ON CONFLICT exige SELECT, e o agente de propósito não lê
  // caixas de entrada. Duplicata (23505) = já notificado nesta hora → idempotente.
  for (const n of notifs) {
    const { error } = await cliente.from('notificacoes').insert(n);
    if (error && error.code !== '23505') throw new Error(`notificacoes: ${error.message}`);
    if (!error) r.notificacoes++;
  }

  // 5) Alertas (regras de severidade "alerta": não mudam o destino)
  const alertas = avaliacoes.flatMap((a) =>
    a.resultados
      .filter((x) => !x.passou && x.severidade === 'alerta')
      .map((x) => ({
        simulacao_id: sim,
        tipo: x.codigo === 'R12' ? 'variacao_mensal' : x.codigo === 'R14' ? 'golpe' : 'divergencia',
        titulo_id: a.tituloId,
        fornecedor_id: a.fornecedorId,
        dono_pessoa_id: donoAlerta(x.codigo, a),
        regras: [x.codigo],
        mensagem: x.motivo,
        valor: a.valor,
        chave: `${x.codigo}|${a.tituloId}`,
        hora_simulada: horaTs,
      })),
  );
  await gravar(cliente, 'alertas', alertas, 'simulacao_id,chave');
  r.alertas = alertas.length;

  // 6) Evidências das regras que falharam (só dos títulos que mudaram)
  await gravar(
    cliente,
    'avaliacoes_regras',
    mudaram.flatMap((a) =>
      a.resultados.filter((x) => !x.passou).map((x) => ({
        simulacao_id: sim, hora_simulada: horaTs, titulo_id: a.tituloId, regra: x.codigo, passou: false,
        severidade: x.severidade, evidencias: x.evidencias, motivo: x.motivo,
      })),
    ),
    'simulacao_id,hora_simulada,titulo_id,regra',
  );

  // 7) Log de auditoria (ator preenchido pelo banco a partir do JWT)
  await gravar(
    cliente,
    'log_auditoria',
    mudaram.map((a) => ({
      simulacao_id: sim,
      data_hora_simulada: horaTs,
      ator_tipo: 'agente_operacao',
      acao: ACAO_POR_DESTINO[a.decisao.destino] ?? a.decisao.destino,
      entidade: 'titulo',
      entidade_id: a.tituloId,
      regras: a.regrasDisparadas,
      evidencias: [...new Set(a.resultados.flatMap((x) => (x.passou ? [] : x.evidencias)))].slice(0, 50),
      motivo: a.decisao.motivo.slice(0, 1000),
      valor_em_jogo: a.valor,
      chave: `${a.tituloId}|${hora}|${a.decisao.destino}`,
    })),
    'simulacao_id,chave',
  );

  return r;
}

/** Passo 7 do ciclo: lotes cujo fechamento passou são enviados; o que estava neles conta como pago. */
export async function fecharLotes(cliente: SupabaseClient, sim: string, hora: HoraSimulada, atuais: Map<string, DecisaoAtual>): Promise<number> {
  const horaTs = `${hora}:00`;
  const enviar = [...atuais.values()].filter(
    (d) => d.fechamento.slice(0, 16).replace(' ', 'T') <= hora && !['RETIRADO', 'RECUSADO', 'ENVIADO'].includes(d.destino),
  );
  if (enviar.length === 0) return 0;
  for (const parte of lotes(enviar.map((d) => d.titulo_id))) {
    const { error } = await cliente
      .from('decisoes')
      .update({ destino: 'ENVIADO', hora_simulada: horaTs, atualizado_em: new Date().toISOString() })
      .eq('simulacao_id', sim)
      .in('titulo_id', parte);
    if (error) throw new Error(`fechar lotes: ${error.message}`);
  }
  const porLote = new Map<string, { qtd: number; valor: number }>();
  for (const d of enviar) {
    const l = porLote.get(d.lote) ?? { qtd: 0, valor: 0 };
    l.qtd++;
    l.valor += d.valor;
    porLote.set(d.lote, l);
  }
  await gravar(
    cliente,
    'log_auditoria',
    [...porLote.entries()].map(([lote, l]) => ({
      simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'agente_operacao', acao: 'enviou lote ao banco',
      entidade: 'lote', entidade_id: lote, motivo: `${l.qtd} títulos enviados no fechamento`, valor_em_jogo: l.valor,
      chave: `lote|${lote}|enviado`,
    })),
    'simulacao_id,chave',
  );
  return enviar.length;
}
