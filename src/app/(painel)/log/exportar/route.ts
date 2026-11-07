import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor, usuarioAtual } from '@/lib/supabase/servidor';
import { simulacaoAtual } from '@/lib/simulacao/servico';
import { todas } from '@/lib/supabase/paginacao';
import { COLUNAS_LOG, filtrarLog } from '@/lib/painel/log';

/** Exporta o log de auditoria em CSV (prestação de contas). Leitura com a sessão do usuário: a RLS decide o que sai. */
export async function GET(req: NextRequest) {
  if (!supabaseConfigurado()) return NextResponse.json({ erro: 'Supabase não configurado (modo local).' }, { status: 503 });
  if (!(await usuarioAtual())) return NextResponse.json({ erro: 'Sem sessão.' }, { status: 401 });
  const cliente = await supabaseServidor();
  const sim = await simulacaoAtual(cliente);
  if (!sim) return NextResponse.json({ erro: 'Nenhuma simulação.' }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const f = { ator: sp.get('ator') || undefined, acao: sp.get('acao') || undefined, entidade: sp.get('entidade') || undefined, busca: sp.get('busca') || undefined };
  const colunas = COLUNAS_LOG.split(',').map((c) => c.trim());
  const linhas = await todas<Record<string, unknown>>((de, ate) =>
    filtrarLog(cliente.from('log_auditoria').select(COLUNAS_LOG).eq('simulacao_id', sim.id), f).order('log_id').range(de, ate),
  );

  const celula = (v: unknown) => {
    if (v == null) return '';
    let s = Array.isArray(v) ? v.join(' ') : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // evita fórmula ao abrir no Excel
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [colunas.join(','), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(','))].join('\r\n') + '\r\n';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="log_auditoria_${sim.hora.replace(/[:T]/g, '-')}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
