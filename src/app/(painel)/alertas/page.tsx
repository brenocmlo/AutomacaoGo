import Link from 'next/link';
import { Badge, Card, CardTitulo, brl, horaBR } from '@/components/ui';
import { aprovarEmLote } from '@/app/acoes';
import { alertasAbertos, caixaDeEntrada, painel, solicitacoesPendentes } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';

export default async function Alertas() {
  if (!supabaseConfigurado()) {
    return <Card className="mx-auto max-w-lg p-6 text-sm text-muted">Alertas e caixa de entrada exigem o Supabase conectado.</Card>;
  }
  const p = await painel();
  const ehAprovador = p.usuario?.papel === 'aprovador';
  const [notificacoes, alertas, pendentes] = await Promise.all([
    caixaDeEntrada(p),
    alertasAbertos(p),
    ehAprovador ? solicitacoesPendentes(p) : Promise.resolve([]),
  ]);
  // Aprovação em lote: só os conferidos (passaram em tudo) que cabem na alçada de quem está logado.
  const alcada = p.usuario?.alcada ?? Infinity;
  const emLote = pendentes.filter((s) => s.tipo === 'simples' && Number(s.valor) <= alcada);
  const exigem = pendentes.filter((s) => !emLote.includes(s));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alertas e caixa de entrada</h1>
        <p className="text-sm text-muted">{p.usuario?.pessoaId ? `Notificações de ${p.usuario.pessoaId}` : 'Sem pessoa vinculada: notificações vão para as pessoas da política.'}</p>
      </div>

      {ehAprovador && (
        <Card>
          <CardTitulo extra={<Badge tom="info">{pendentes.length} pendentes</Badge>}>Aprovações</CardTitulo>
          {emLote.length > 0 && (
            <form action={aprovarEmLote} className="border-b border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm">Conferidos pelo agente, dentro da sua alçada: <strong>{emLote.length}</strong> títulos · {brl(emLote.reduce((s, x) => s + Number(x.valor), 0), true)}</p>
                <button className="rounded-md bg-ok px-3 py-1.5 text-xs font-medium text-white">Aprovar selecionados</button>
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {emLote.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    <input type="checkbox" name="solicitacao" value={s.id} defaultChecked />
                    <Link href={`/auditoria?t=${s.titulo_id}`} className="font-mono hover:underline">{s.titulo_id}</Link>
                    <span className="min-w-0 flex-1 truncate text-muted">{s.motivo}</span>
                    <span className="tabular">{brl(Number(s.valor))}</span>
                  </li>
                ))}
              </ul>
            </form>
          )}
          <ul className="divide-y divide-border">
            {exigem.slice(0, 50).map((s) => (
              <li key={s.id}>
                <Link href={`/auditoria?t=${s.titulo_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-surface-2">
                  <Badge tom={s.tipo === 'dupla' ? 'danger' : 'warn'}>{s.tipo.replace('_', ' ')}</Badge>
                  <span className="font-mono text-xs">{s.titulo_id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{s.motivo}</span>
                  <span className="text-xs text-muted">{s.aprovadores_exigidos.join(' + ')}</span>
                  <span className="tabular w-28 text-right">{brl(Number(s.valor))}</span>
                </Link>
              </li>
            ))}
            {pendentes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nada aguardando aprovação.</li>}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitulo extra={<Badge>{notificacoes.length}</Badge>}>Minha caixa de entrada</CardTitulo>
        <ul className="divide-y divide-border">
          {notificacoes.map((n) => (
            <li key={n.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {n.urgencia === 'IMEDIATA' && <Badge tom="danger">Imediata</Badge>}
                <span className="text-sm font-medium">{n.assunto}</span>
                <span className="ml-auto text-xs text-muted">{horaBR(n.hora_simulada.slice(0, 16))}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted">{n.mensagem}</pre>
              <div className="mt-1 flex flex-wrap gap-1">
                {n.titulos.slice(0, 12).map((t) => (
                  <Link key={t} href={`/auditoria?t=${t}`} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:underline">{t}</Link>
                ))}
              </div>
            </li>
          ))}
          {notificacoes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhuma notificação para você.</li>}
        </ul>
      </Card>

      <Card>
        <CardTitulo extra={<Badge tom="warn">{alertas.length}</Badge>}>Alertas abertos</CardTitulo>
        <ul className="divide-y divide-border">
          {alertas.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <Badge tom="warn">{a.tipo.replace('_', ' ')}</Badge>
              {a.titulo_id && <Link href={`/auditoria?t=${a.titulo_id}`} className="font-mono text-xs hover:underline">{a.titulo_id}</Link>}
              <span className="min-w-0 flex-1 text-xs text-muted">{a.mensagem}</span>
              {a.dono_pessoa_id && <span className="text-xs text-muted">dono {a.dono_pessoa_id}</span>}
            </li>
          ))}
          {alertas.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhum alerta aberto.</li>}
        </ul>
      </Card>
    </div>
  );
}
