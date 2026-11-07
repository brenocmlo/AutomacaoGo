import Link from 'next/link';
import { ArrowRight, Landmark, PlayCircle } from 'lucide-react';
import { Badge, Card, CardTitulo, Stat, URGENCIAS, brl, destinoUi, duracao, horaBR } from '@/components/ui';
import { reiniciarRelogio } from '@/app/acoes';
import { nomeFornecedor, painel, resumo, type DestinoPainel } from '@/lib/painel/dados';
import { calcularPlacar } from '@/lib/painel/placar';
import { custoIA, usd } from '@/lib/painel/log';
import { supabaseConfigurado } from '@/lib/supabase/config';

export default async function VisaoGeral() {
  const p = await painel();

  if (supabaseConfigurado() && !p.sim) {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <PlayCircle className="mx-auto size-10 text-accent" />
        <h1 className="mt-3 text-lg font-semibold">Nenhuma simulação iniciada</h1>
        <p className="mt-1 text-sm text-muted">A simulação começa em 02/11/2026 08:00 e avança de hora em hora. A cada passo, o agente de operação confere a agenda e grava as decisões.</p>
        {p.usuario?.papel === 'admin' ? (
          <form action={reiniciarRelogio} className="mt-4">
            <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-solid">Iniciar simulação</button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted">Peça à administração da simulação para iniciar.</p>
        )}
      </Card>
    );
  }

  const r = resumo(p);
  const [placar, ia] = await Promise.all([calcularPlacar(p), custoIA(p)]);
  const destaques = p.avaliacoes
    .filter((a) => ['AGUARDANDO_APROVACAO', 'RETIRADO'].includes(a.decisao.destino))
    .slice(0, 8);
  const ordem: DestinoPainel[] = ['LIBERADO_AUTOMATICO', 'CONFERIDO_AGUARDANDO_APROVADOR', 'AGUARDANDO_APROVACAO', 'RETIRADO', 'APROVADO', 'DEVOLVIDO', 'RECUSADO'];
  const totalValor = ordem.reduce((s, d) => s + r.porDestino[d].valor, 0) || 1;
  const aguardando = r.porDestino.AGUARDANDO_APROVACAO.qtd + r.porDestino.CONFERIDO_AGUARDANDO_APROVADOR.qtd;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Visão geral</h1>
        <p className="text-sm text-muted">Títulos dos lotes ainda abertos, conferidos contra ERP, Compras, NF-e, DDA e extratos.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {r.proximosFechamentos.map((l) => (
          <Card key={l.lote} className="flex items-center gap-4 p-4">
            <div className="rounded-lg bg-accent-soft p-2.5 text-accent"><Landmark className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{l.banco} · {l.lote}</p>
              <p className="tabular text-xs text-muted">Fecha {horaBR(l.fechamento)} · {l.titulos} títulos · {brl(l.valor, true)}</p>
            </div>
            <div className="text-right">
              <p className={`tabular text-lg font-semibold ${l.minutos < 120 ? 'text-danger' : ''}`}>{duracao(l.minutos)}</p>
              <p className="text-xs text-muted">para o fechamento</p>
            </div>
          </Card>
        ))}
        {r.proximosFechamentos.length === 0 && <Card className="p-4 text-sm text-muted">Nenhum lote aberto no período.</Card>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat rotulo="Títulos na fila" valor={r.fila.toLocaleString('pt-BR')} detalhe={`${r.enviados.qtd} já enviados ao banco`} />
        <Stat rotulo="Liberados automático" valor={r.porDestino.LIBERADO_AUTOMATICO.qtd} detalhe={brl(r.porDestino.LIBERADO_AUTOMATICO.valor, true)} tom="ok" />
        <Stat rotulo="Aguardando aprovação" valor={aguardando} detalhe={`${r.porDestino.AGUARDANDO_APROVACAO.qtd} por exigência da política`} tom="warn" />
        <Stat rotulo="Retirados do lote" valor={r.porDestino.RETIRADO.qtd} detalhe={`${r.alertas} alertas abertos`} tom="danger" />
        <Stat rotulo="Montante protegido" valor={brl(r.montanteProtegido, true)} detalhe="retirado antes de sair" tom="ok" />
        <Stat rotulo="Montante em risco" valor={brl(r.montanteEmRisco, true)} detalhe="aguardando decisão humana" tom="warn" />
        <Stat rotulo="Aprovados por humanos" valor={r.porDestino.APROVADO.qtd + r.porDestino.DEVOLVIDO.qtd} detalhe={`${r.porDestino.RECUSADO.qtd} recusados`} tom="info" />
        <Stat rotulo="Custo de IA" valor={usd(ia.total.custoUsd)} detalhe={ia.total.chamadas ? `${ia.total.chamadas} chamadas · ${(ia.total.tokensEntrada + ia.total.tokensSaida).toLocaleString('pt-BR')} tokens` : 'regras rodam sem IA'} />
      </div>

      <Card>
        <CardTitulo extra={<span className="text-xs text-muted">estimativa em R$; quanto menos negativo, melhor</span>}>Placar estimado</CardTitulo>
        {placar.disponivel ? (
          <div className="grid gap-px bg-border md:grid-cols-2">
            {([['Com GoAudit', placar.com, 'ok'], ['Sem GoAudit (tesoureiro assina tudo)', placar.sem, 'danger']] as const).map(([nome, c, tom]) => (
              <div key={nome} className="space-y-2 bg-surface p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{nome}</p>
                  <p className={`tabular text-2xl font-semibold ${tom === 'ok' ? 'text-ok' : 'text-danger'}`}>{brl(c.total)}</p>
                </div>
                <ul className="space-y-1 text-xs">
                  {c.linhas.map((l) => (
                    <li key={l.rotulo} className="flex justify-between gap-2"><span className="text-muted">{l.rotulo} ({l.detalhe})</span><span className="tabular">{brl(l.valor)}</span></li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="bg-surface px-4 pb-3 text-xs text-muted md:col-span-2">
              Diferença a favor do GoAudit: <span className="tabular font-medium text-text">{brl(placar.com.total - placar.sem.total)}</span> · {placar.indevidosJaFechados} de {placar.indevidosTotal} títulos indevidos do gabarito já passaram do fechamento; {brl(placar.protegido, true)} barrados e {brl(placar.indevidosAindaEmRisco, true)} ainda em risco. Um atraso conta 7 dias (multa, juros e custo de relacionamento).
            </p>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">{placar.motivo}</p>
        )}
      </Card>

      <Card>
        <CardTitulo>Destino dos títulos (por valor)</CardTitulo>
        <div className="space-y-3 p-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
            {ordem.map((d) => (
              <div key={d} title={destinoUi(d).rotulo} style={{ width: `${(r.porDestino[d].valor / totalValor) * 100}%` }}
                className={{ ok: 'bg-ok', info: 'bg-info', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-muted' }[destinoUi(d).tom]} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            {ordem.filter((d) => r.porDestino[d].qtd > 0).map((d) => (
              <Link key={d} href={`/auditoria?destino=${d}`} className="flex items-center gap-2 hover:underline">
                <Badge tom={destinoUi(d).tom}>{r.porDestino[d].qtd}</Badge>
                <span>{destinoUi(d).rotulo}</span>
                <span className="tabular text-muted">{brl(r.porDestino[d].valor, true)}</span>
              </Link>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardTitulo extra={<Link href="/auditoria" className="flex items-center gap-1 text-xs text-accent hover:underline">Ver fila completa<ArrowRight className="size-3" /></Link>}>
          Precisam de atenção primeiro
        </CardTitulo>
        <ul className="divide-y divide-border">
          {destaques.map((a) => (
            <li key={a.tituloId}>
              <Link href={`/auditoria?t=${a.tituloId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <Badge tom={URGENCIAS[a.urgencia].tom}>{URGENCIAS[a.urgencia].rotulo}</Badge>
                <span className="font-mono text-xs text-muted">{a.tituloId}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{nomeFornecedor(p.hora, a.fornecedorId)}</span>
                <span className="flex gap-1">{a.regrasDisparadas.map((c) => <Badge key={c}>{c}</Badge>)}</span>
                <span className="tabular w-28 text-right text-sm font-medium">{brl(a.valor)}</span>
                <Badge tom={destinoUi(a.decisao.destino).tom}>{destinoUi(a.decisao.destino).rotulo}</Badge>
              </Link>
            </li>
          ))}
          {destaques.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nada pendente nos lotes abertos.</li>}
        </ul>
      </Card>
    </div>
  );
}
