import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Badge, Card, CardTitulo, brl } from '@/components/ui';
import { GraficoContrato } from '@/components/grafico-contrato';
import { painel } from '@/lib/painel/dados';
import { CLASSES, SITUACOES, detalheContrato } from '@/lib/painel/contratos';

const dataBR = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default async function Contrato({ params }: PageProps<'/contratos/[id]'>) {
  const { id } = await params;
  const p = await painel();
  const det = await detalheContrato(p, decodeURIComponent(id));
  if (!det) notFound();
  const { linha: l, titulos, alertas } = det;
  const c = l.contrato;
  const naFila = new Set(p.avaliacoes.map((a) => a.tituloId));

  const ficha: [string, string][] = [
    ['Objeto', c.objeto || c.tipo],
    ['Classe', `${CLASSES[l.classe]}${l.classe !== 'fixo' ? ' (valor mensal é estimativa)' : ''}`],
    ['Valor mensal', brl(l.valorMensal)],
    ['Vencimento', c.dia_vencimento ? `todo dia ${c.dia_vencimento}` : 'por fatura'],
    ['Forma de pagamento', c.forma_pagamento || '—'],
    ['OC do contrato', c.oc_id || 'sem OC'],
    ['Vigência', `${dataBR(c.inicio_vigencia)} a ${dataBR(c.fim_vigencia_atual)} · ${c.prazo}`],
    ['Reajuste', `${c.indice_reajuste}, mês ${c.mes_reajuste} · último em ${dataBR(c.data_ultimo_reajuste)} · próximo em ${dataBR(l.proximoReajuste)}`],
    ['Gestor', `${c.gestor_contrato} (${c.gestor_pessoa_id})`],
    ['Status', c.status],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/contratos" className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"><ArrowLeft className="size-3.5" />Contratos</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{l.fornecedorNome}</h1>
        <span className="font-mono text-sm text-muted">{c.contrato_id}</span>
        <Badge tom={SITUACOES[l.situacao].tom}>{SITUACOES[l.situacao].rotulo}</Badge>
        {l.venceOuReajustaEm30 && <Badge tom="warn">Vence ou reajusta em 30 dias</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardTitulo>Esperado × cobrado por competência</CardTitulo>
          <div className="p-4"><GraficoContrato competencias={l.competencias} /></div>
        </Card>
        <Card>
          <CardTitulo>Contrato</CardTitulo>
          <dl className="space-y-1.5 p-4 text-xs">
            {ficha.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="shrink-0 text-muted">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card>
        <CardTitulo extra={<Badge tom={alertas.length ? 'warn' : 'neutral'}>{alertas.length}</Badge>}>Alertas do contrato</CardTitulo>
        <ul className="divide-y divide-border">
          {alertas.map((a, i) => (
            <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 text-warn" />
              <Badge tom="warn">{a.codigo}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{a.nome}{a.competencia ? ` · ${a.competencia}` : ''}</p>
                <p className="text-xs text-muted">{a.mensagem}</p>
              </div>
              {a.tituloId && (naFila.has(a.tituloId)
                ? <Link href={`/auditoria?t=${a.tituloId}`} className="font-mono text-xs text-accent hover:underline">{a.tituloId}</Link>
                : <span className="font-mono text-xs text-muted">{a.tituloId}</span>)}
              {a.donos.length > 0 && <span className="text-xs text-muted">avisa {a.donos.join(', ')}</span>}
            </li>
          ))}
          {alertas.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhum alerta para este contrato.</li>}
        </ul>
      </Card>

      <Card className="overflow-x-auto">
        <CardTitulo>Competências e títulos</CardTitulo>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 font-medium">Vencimento previsto</th>
              <th className="px-3 py-2 text-right font-medium">Esperado</th>
              <th className="px-3 py-2 text-right font-medium">Faixa</th>
              <th className="px-3 py-2 text-right font-medium">Cobrado</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Títulos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...l.competencias].reverse().map((x) => (
              <tr key={x.competencia} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{x.competencia}</td>
                <td className="px-3 py-2 text-xs">{dataBR(x.vencimentoPrevisto)}</td>
                <td className="tabular px-3 py-2 text-right">{brl(x.valorEsperado)}</td>
                <td className="tabular px-3 py-2 text-right text-xs text-muted">{x.faixaMin != null ? `${brl(x.faixaMin)} a ${brl(x.faixaMax)}` : '—'}</td>
                <td className="tabular px-3 py-2 text-right">{x.qtdTitulos ? brl(x.valorCobrado) : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge tom={SITUACOES[x.situacao].tom}>{x.situacao === 'desvio' ? 'Fora da faixa / desvio' : SITUACOES[x.situacao].rotulo}</Badge>
                    {x.desvios.map((d) => <Badge key={d}>{d}</Badge>)}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-0.5 text-xs">
                    {x.titulos.slice(0, 8).map((t) => {
                      const info = titulos.get(t);
                      return (
                        <li key={t} className="flex gap-2">
                          {naFila.has(t) ? <Link href={`/auditoria?t=${t}`} className="font-mono text-accent hover:underline">{t}</Link> : <span className="font-mono">{t}</span>}
                          {info && <span className="tabular text-muted">{brl(info.valor)} · venc. {dataBR(info.vencimento)} · {info.status}</span>}
                        </li>
                      );
                    })}
                    {x.titulos.length > 8 && <li className="text-muted">… e mais {x.titulos.length - 8}</li>}
                    {x.titulos.length === 0 && <li className="text-muted">nenhum título</li>}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
