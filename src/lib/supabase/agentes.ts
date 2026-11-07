import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chavesPublicas } from './config';

/**
 * Sessões dos agentes. Cada agente entra com a PRÓPRIA conta (e-mail/senha do servidor)
 * e grava com o próprio JWT, sujeito à RLS. A service_role nunca é usada em execução.
 */
export type Agente = 'operacao' | 'validacao' | 'leitor' | 'gerador';

const sessoes = new Map<Agente, Promise<SupabaseClient>>();

async function entrar(agente: Agente): Promise<SupabaseClient> {
  const pref = `AGENTE_${agente.toUpperCase()}`;
  const email = process.env[`${pref}_EMAIL`];
  const senha = process.env[`${pref}_SENHA`];
  if (!email || !senha) throw new Error(`Credenciais do agente ${agente} ausentes (${pref}_EMAIL / ${pref}_SENHA).`);
  const { url, anon } = chavesPublicas();
  const cliente = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`Login do agente ${agente} falhou: ${error.message}`);
  return cliente;
}

export async function clienteAgente(agente: Agente): Promise<SupabaseClient> {
  let s = sessoes.get(agente);
  if (!s) {
    s = entrar(agente);
    sessoes.set(agente, s);
    s.catch(() => sessoes.delete(agente));
  }
  const cliente = await s;
  const { data } = await cliente.auth.getSession();
  if (!data.session) {
    sessoes.delete(agente);
    return clienteAgente(agente);
  }
  return cliente;
}
