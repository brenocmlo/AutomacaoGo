/**
 * Carga inicial dos usuários de demonstração (B2). Usa a service_role — só aqui e nas migrações.
 *
 * Perfis mínimos do MVP, derivados da base (sem lista fixa no código):
 *  - aprovador: Cláudia Ferraz, aprovadora do ERP (alçada de usuarios_sistema.csv)
 *  - consulta : gestor de contrato (PS10), ver PESSOAS_CONSULTA_DEMO
 *  - admin    : conduz a simulação
 *  - agentes  : operação (alçada = a do analista na política), validação e leitor
 * E-mails fictícios (@example.com). Senha única de demo em DEMO_SENHA.
 *
 * Uso: npx tsx scripts/carregar-usuarios.ts
 */
import { config as dotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { carregarConfig, pastaBase } from '@/lib/config/config';
import { carregarBase } from '@/lib/data/base';
import { EMAIL_ADMIN_PADRAO, contasDemoHumanas } from '@/lib/auth/contas-demo';

dotenv({ path: '.env.local' });

function exigirEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome} (ver .env.example)`);
  return v;
}

export interface UsuarioDemo {
  email: string;
  senha: string;
  nome: string;
  papel: 'aprovador' | 'consulta' | 'admin' | 'agente_operacao' | 'agente_validacao' | 'agente_leitor' | 'agente_gerador';
  alcada: number | null;
  pessoa_id: string | null;
  login_origem: string | null;
}

export function usuariosDemo(): UsuarioDemo[] {
  const base = carregarBase(pastaBase(carregarConfig()));
  const senha = exigirEnv('DEMO_SENHA');
  const out: UsuarioDemo[] = contasDemoHumanas(base, process.env.ADMIN_EMAIL ?? EMAIL_ADMIN_PADRAO).map((c) => ({ ...c, senha }));

  const agentes = [
    ['AGENTE_OPERACAO', 'Agente de operação', 'agente_operacao', base.politicas.alcadas.analistaLiberarAte],
    ['AGENTE_VALIDACAO', 'Agente de validação', 'agente_validacao', 0],
    ['AGENTE_LEITOR', 'Leitor de mensagens', 'agente_leitor', 0],
  ] as const;
  for (const [env, nome, papel, alcada] of agentes) {
    out.push({ email: exigirEnv(`${env}_EMAIL`), senha: exigirEnv(`${env}_SENHA`), nome, papel, alcada, pessoa_id: null, login_origem: null });
  }
  // Gerador de eventos da simulação (migração 9): conta só de inserção em eventos_gerados. Opcional; sem as variáveis, a simulação roda só com a base de CSV.
  if (process.env.AGENTE_GERADOR_EMAIL && process.env.AGENTE_GERADOR_SENHA) {
    out.push({ email: process.env.AGENTE_GERADOR_EMAIL, senha: process.env.AGENTE_GERADOR_SENHA, nome: 'Gerador de eventos', papel: 'agente_gerador', alcada: 0, pessoa_id: null, login_origem: null });
  } else {
    console.warn('AGENTE_GERADOR_EMAIL / AGENTE_GERADOR_SENHA ausentes: conta do gerador de eventos não criada.');
  }
  return out;
}

async function main() {
  const supa = createClient(exigirEnv('NEXT_PUBLIC_SUPABASE_URL'), exigirEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existentes = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) existentes.set(u.email, u.id);
    if (data.users.length < 200) break;
  }

  for (const u of usuariosDemo()) {
    let id = existentes.get(u.email);
    if (!id) {
      const { data, error } = await supa.auth.admin.createUser({ email: u.email, password: u.senha, email_confirm: true });
      if (error) throw new Error(`${u.email}: ${error.message}`);
      id = data.user.id;
    } else {
      const { error } = await supa.auth.admin.updateUserById(id, { password: u.senha });
      if (error) throw new Error(`${u.email}: ${error.message}`);
    }
    const { error } = await supa.from('perfis').upsert({
      id, nome: u.nome, email: u.email, papel: u.papel, alcada: u.alcada, pessoa_id: u.pessoa_id, login_origem: u.login_origem, ativo: true,
    });
    if (error) throw new Error(`perfil ${u.email}: ${error.message}`);
    console.log(`${u.papel.padEnd(17)} ${u.email.padEnd(40)} alçada=${u.alcada ?? 'sem limite'} ${u.pessoa_id ?? ''}`);
  }
}

if (process.argv[1]?.includes('carregar-usuarios')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
