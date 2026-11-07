import { NextResponse } from 'next/server';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor } from '@/lib/supabase/servidor';

/**
 * Entrega ao navegador o token da PRÓPRIA sessão para assinar o Realtime (o cookie é httpOnly).
 * É o JWT do usuário, não uma chave de serviço: a RLS continua valendo nos eventos.
 */
export async function GET() {
  if (!supabaseConfigurado()) return NextResponse.json({ erro: 'Modo local.' }, { status: 503 });
  const { data } = await (await supabaseServidor()).auth.getSession();
  if (!data.session) return NextResponse.json({ erro: 'Sem sessão.' }, { status: 401 });
  return NextResponse.json(
    { token: data.session.access_token, url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
