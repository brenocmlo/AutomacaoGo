import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor } from '@/lib/supabase/servidor';
import { simulacaoAtual } from '@/lib/simulacao/servico';

/** Um evento que a pessoa vê no sino: aviso do agente ou alerta aberto. */
export interface EventoSino {
  /** Estável entre renders: n-<id> (notificação) ou a-<id> (alerta). */
  chave: string;
  tipo: 'notificacao' | 'alerta';
  titulo: string;
  texto: string;
  /** Hora simulada em que o evento aconteceu. */
  hora: string;
  /** Momento real em que foi gravado (ISO): serve para saber o que é novo desde a última vez que o sino foi aberto. */
  criadoEm: string;
  tom: 'danger' | 'warn' | 'info' | 'neutral';
  href: string;
}

const NOME_ALERTA: Record<string, string> = {
  contrato: 'Alerta de contrato',
  golpe: 'Possível golpe',
  divergencia: 'Divergência',
};

/** Últimos eventos da simulação atual, do mais novo ao mais antigo, respeitando a RLS de quem está logado. */
export async function eventosRecentes(limite = 15): Promise<EventoSino[]> {
  if (!supabaseConfigurado()) return [];
  const cliente = await supabaseServidor();
  const sim = await simulacaoAtual(cliente);
  if (!sim) return [];

  const [notificacoes, alertas] = await Promise.all([
    cliente.from('notificacoes').select('id, assunto, mensagem, titulos, urgencia, hora_simulada, criado_em')
      .eq('simulacao_id', sim.id).eq('situacao', 'ativa').order('criado_em', { ascending: false }).limit(limite),
    cliente.from('alertas').select('id, tipo, titulo_id, regras, mensagem, hora_simulada, criado_em')
      .eq('simulacao_id', sim.id).eq('situacao', 'aberto').order('criado_em', { ascending: false }).limit(limite),
  ]);

  const out: EventoSino[] = [];
  for (const n of notificacoes.data ?? []) {
    const urgente = n.urgencia === 'IMEDIATA' || n.urgencia === 'imediata';
    out.push({
      chave: `n-${n.id}`, tipo: 'notificacao', titulo: n.assunto, texto: n.mensagem,
      hora: String(n.hora_simulada), criadoEm: n.criado_em, tom: urgente ? 'danger' : 'warn',
      href: n.titulos?.[0] ? `/auditoria?t=${n.titulos[0]}` : '/alertas',
    });
  }
  for (const a of alertas.data ?? []) {
    out.push({
      chave: `a-${a.id}`, tipo: 'alerta', titulo: `${NOME_ALERTA[a.tipo] ?? 'Alerta'}${a.regras?.length ? ` · ${a.regras.join(', ')}` : ''}`,
      texto: a.mensagem, hora: String(a.hora_simulada), criadoEm: a.criado_em, tom: a.tipo === 'golpe' ? 'danger' : 'info',
      href: a.titulo_id ? `/auditoria?t=${a.titulo_id}` : '/alertas',
    });
  }
  return out.sort((x, y) => y.criadoEm.localeCompare(x.criadoEm)).slice(0, limite);
}
