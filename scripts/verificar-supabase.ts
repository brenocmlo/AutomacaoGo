/**
 * Diagnóstico do Supabase sem expor segredos: formato das chaves, tabelas criadas,
 * funções e usuários. Uso: npx tsx scripts/verificar-supabase.ts
 */
import { config as dotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const sec = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const formato = (k: string) =>
  !k ? 'vazia' : k.startsWith('sb_secret_') ? 'secreta (sb_secret_)' : k.startsWith('sb_publishable_') ? 'PÚBLICA (sb_publishable_)' : k.startsWith('eyJ') ? 'JWT legado' : 'formato desconhecido';

async function main() {
  console.log(`URL: ${url ? 'ok' : 'vazia'}`);
  console.log(`Chave pública: ${formato(pub)}`);
  console.log(`Chave de serviço: ${formato(sec)}`);
  if (!url || !sec || sec.startsWith('sb_publishable_')) return;

  const admin = createClient(url, sec, { auth: { persistSession: false } });
  for (const t of ['perfis', 'simulacoes', 'decisoes', 'log_auditoria']) {
    const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
    console.log(`tabela ${t}: ${error ? `ERRO ${error.code ?? ''} ${error.message}` : `ok (${count} linhas)`}`);
  }
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  console.log(`usuários no Auth: ${error ? `ERRO ${error.message}` : data.users.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
