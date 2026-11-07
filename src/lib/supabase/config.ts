/** Chave pública: aceita o nome novo (publishable) e o antigo (anon). */
function chavePublica(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/** Supabase está configurado? Sem as chaves, o painel roda em "modo local" (sem login). */
export function supabaseConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && chavePublica());
}

export function chavesPublicas(): { url: string; anon: string } {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, anon: chavePublica()! };
}
