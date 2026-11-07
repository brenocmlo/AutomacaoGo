'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { Badge } from '@/components/ui';

const TABELAS = ['ciclos', 'decisoes', 'alertas', 'notificacoes'];
const POLL_MS = 15_000;

/**
 * Atualiza a tela aberta quando o banco muda (ex.: outro usuário avançou o relógio).
 * Assina o Realtime com o token do próprio usuário (RLS vale). Se a conexão não sobe, cai
 * para refresh periódico. Eventos em rajada viram um único refresh.
 */
export function TempoReal() {
  const router = useRouter();
  const [estado, setEstado] = useState<'conectando' | 'ao_vivo' | 'periodico'>('conectando');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let vivo = true;
    let cliente: SupabaseClient | null = null;
    let canal: RealtimeChannel | null = null;
    let renovar: ReturnType<typeof setInterval> | null = null;
    const atualizar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 700);
    };

    (async () => {
      try {
        const r = await fetch('/api/tempo-real', { cache: 'no-store' });
        if (!r.ok) throw new Error('sem token');
        const { token, url, anon } = (await r.json()) as { token: string; url: string; anon: string };
        if (!vivo) return;
        cliente = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
        await cliente.realtime.setAuth(token);
        canal = cliente.channel('painel');
        for (const table of TABELAS) canal.on('postgres_changes', { event: '*', schema: 'public', table }, atualizar);
        canal.subscribe((s) => {
          if (!vivo) return;
          setEstado(s === 'SUBSCRIBED' ? 'ao_vivo' : 'periodico');
        });
        // O token expira; busca outro antes disso.
        renovar = setInterval(async () => {
          const n = await fetch('/api/tempo-real', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (n?.token) await cliente?.realtime.setAuth(n.token);
        }, 20 * 60_000);
      } catch {
        if (vivo) setEstado('periodico');
      }
    })();

    return () => {
      vivo = false;
      if (timer.current) clearTimeout(timer.current);
      if (renovar) clearInterval(renovar);
      if (canal && cliente) void cliente.removeChannel(canal);
    };
  }, [router]);

  // Fallback: sem Realtime, atualiza de tempo em tempo (só com a aba visível).
  useEffect(() => {
    if (estado !== 'periodico') return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [estado, router]);

  if (estado === 'ao_vivo') return <Badge tom="ok" title="O painel se atualiza sozinho quando o banco muda">Ao vivo</Badge>;
  if (estado === 'periodico') return <Badge tom="warn" title="Realtime indisponível; atualizando a cada 15 s">Atualização periódica</Badge>;
  return <Badge tom="neutral">Conectando</Badge>;
}
