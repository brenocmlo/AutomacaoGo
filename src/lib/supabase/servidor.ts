import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { chavesPublicas, supabaseConfigurado } from './config';

/** Cliente Supabase com a sessão do usuário (cookie httpOnly). Só no servidor. */
export async function supabaseServidor() {
  const { url, anon } = chavesPublicas();
  const loja = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => loja.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) loja.set(name, value, options);
        } catch {
          // Em Server Component não dá para gravar cookie; o proxy renova a sessão.
        }
      },
    },
  });
}

export interface Usuario {
  id: string;
  email: string;
  papel: string | null;
  alcada: number | null;
  pessoaId: string | null;
}

/**
 * Usuário logado, com papel/alçada/pessoa vindos das claims do JWT (gravadas pelo hook
 * do banco). Nada que o navegador envie define permissão. Em modo local: null.
 */
export async function usuarioAtual(): Promise<Usuario | null> {
  if (!supabaseConfigurado()) return null;
  const supa = await supabaseServidor();
  const { data } = await supa.auth.getClaims();
  const c = data?.claims as Record<string, unknown> | undefined;
  if (!c?.sub) return null;
  return {
    id: String(c.sub),
    email: String(c.email ?? ''),
    papel: typeof c.papel === 'string' ? c.papel : null,
    alcada: typeof c.alcada === 'number' ? c.alcada : null,
    pessoaId: typeof c.pessoa_id === 'string' ? c.pessoa_id : null,
  };
}
