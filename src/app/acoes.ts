'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { somarMinutos } from '@/lib/clock/relogio';
import { COOKIE_HORA, contexto, horaSimulada, limitarHora, periodo } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor, usuarioAtual } from '@/lib/supabase/servidor';
import { avancarSimulacao, iniciarSimulacao, pausarSimulacao } from '@/lib/simulacao/servico';

/** Só admin conduz a simulação (em modo local, qualquer um). Checado no servidor, pelo JWT. */
async function exigirAdmin() {
  if (!supabaseConfigurado()) return;
  const u = await usuarioAtual();
  if (u?.papel !== 'admin') throw new Error('Só a administração da simulação controla o relógio.');
}

async function gravarHoraLocal(h: string) {
  (await cookies()).set(COOKIE_HORA, limitarHora(h), { httpOnly: true, sameSite: 'lax', path: '/' });
}

export async function avancarRelogio(formData: FormData) {
  await exigirAdmin();
  const passos = Math.max(1, Number(formData.get('passos') ?? 1) || 1);
  if (supabaseConfigurado()) {
    await avancarSimulacao(await supabaseServidor(), passos);
  } else {
    await gravarHoraLocal(somarMinutos(await horaSimulada(), contexto().config.relogio.passo_minutos * passos));
  }
  revalidatePath('/', 'layout');
}

export async function reiniciarRelogio() {
  await exigirAdmin();
  if (supabaseConfigurado()) await iniciarSimulacao(await supabaseServidor());
  else await gravarHoraLocal(periodo().inicio);
  revalidatePath('/', 'layout');
}

export async function alternarPausa(formData: FormData) {
  await exigirAdmin();
  if (supabaseConfigurado()) await pausarSimulacao(await supabaseServidor(), formData.get('pausar') === '1');
  revalidatePath('/', 'layout');
}

export async function sair() {
  if (supabaseConfigurado()) await (await supabaseServidor()).auth.signOut();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Ações humanas: só pelas funções do banco (rpc), que validam alçada, segregação e
// aprovação dupla e gravam o log na mesma transação. O botão escondido é conforto;
// quem garante a permissão é o banco.
// ---------------------------------------------------------------------------

export interface EstadoAcao {
  ok: string | null;
  erro: string | null;
}

async function rpc(nome: string, args: Record<string, unknown>): Promise<EstadoAcao> {
  if (!supabaseConfigurado()) return { ok: null, erro: 'Disponível só com o Supabase conectado.' };
  const { data, error } = await (await supabaseServidor()).rpc(nome, args);
  revalidatePath('/', 'layout');
  return error ? { ok: null, erro: error.message } : { ok: String(data ?? 'ok'), erro: null };
}

export async function aprovar(_: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  return rpc('aprovar_solicitacao', { p_solicitacao: String(formData.get('solicitacao')), p_comentario: String(formData.get('comentario') ?? '') || null });
}

export async function recusar(_: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  return rpc('recusar_solicitacao', { p_solicitacao: String(formData.get('solicitacao')), p_motivo: String(formData.get('motivo') ?? '') });
}

export async function decidir(_: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  return rpc('decisao_humana', {
    p_simulacao: String(formData.get('simulacao')),
    p_titulo: String(formData.get('titulo')),
    p_acao: String(formData.get('acao')),
    p_justificativa: String(formData.get('justificativa') ?? ''),
  });
}

export async function aprovarEmLote(formData: FormData) {
  const ids = formData.getAll('solicitacao').map(String);
  for (const id of ids) await rpc('aprovar_solicitacao', { p_solicitacao: id, p_comentario: 'Aprovado em lote' });
  revalidatePath('/', 'layout');
}
