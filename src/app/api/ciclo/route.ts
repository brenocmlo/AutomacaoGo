import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor, usuarioAtual } from '@/lib/supabase/servidor';
import { avancarSimulacao, simulacaoAtual } from '@/lib/simulacao/servico';

/**
 * Ciclo do relógio (seção 7). Protegido: só o papel admin (claim do JWT, validada no
 * servidor). Cada agente grava com a própria sessão dentro do ciclo.
 *   GET  → simulação atual
 *   POST { passos?: number } → avança N horas, um ciclo por hora
 */
async function exigirAdmin() {
  if (!supabaseConfigurado()) return NextResponse.json({ erro: 'Supabase não configurado (modo local).' }, { status: 503 });
  const u = await usuarioAtual();
  if (!u) return NextResponse.json({ erro: 'Sem sessão.' }, { status: 401 });
  if (u.papel !== 'admin') return NextResponse.json({ erro: 'Só a administração da simulação.' }, { status: 403 });
  return null;
}

export async function GET() {
  const negado = await exigirAdmin();
  if (negado) return negado;
  return NextResponse.json({ simulacao: await simulacaoAtual(await supabaseServidor()) });
}

export async function POST(req: NextRequest) {
  const negado = await exigirAdmin();
  if (negado) return negado;
  const corpo = (await req.json().catch(() => ({}))) as { passos?: number };
  const passos = Math.min(Math.max(Math.trunc(corpo.passos ?? 1), 1), 168);
  try {
    const ciclos = await avancarSimulacao(await supabaseServidor(), passos);
    return NextResponse.json({ ciclos });
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
