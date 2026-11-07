'use server';

import { redirect } from 'next/navigation';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor } from '@/lib/supabase/servidor';

export interface EstadoLogin {
  erro: string | null;
}

export async function entrar(_: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  if (!supabaseConfigurado()) redirect('/');
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Informe e-mail e senha.' };
  const supa = await supabaseServidor();
  const { error } = await supa.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: 'E-mail ou senha inválidos.' };
  redirect('/');
}
