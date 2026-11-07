import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { chavesPublicas } from './config';

/**
 * Cliente com a service_role, para o que só a API de administração do Supabase Auth faz: criar e
 * remover logins. ÚNICO uso em tempo de execução, e só por Server Actions da tela Equipe depois de
 * conferir, no JWT, que quem chama é admin. Nunca vai ao navegador, nunca é logado, e os agentes
 * continuam entrando com as próprias contas (nunca com esta chave).
 */
export function clienteAdmin() {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente: a tela Equipe precisa dela para criar logins.');
  return createClient(chavesPublicas().url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
