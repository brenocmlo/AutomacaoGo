import Link from 'next/link';
import { Paginacao, paginar } from '@/components/paginacao';
import { Search, X } from 'lucide-react';
import { Badge, Card, CardTitulo, Stat, brl, destinoUi, type Tom } from '@/components/ui';
import { nomeFornecedor, painel } from '@/lib/painel/dados';
import {
  FAIXA_ROTINA, MINIMO_HISTORICO, formatarVariacao, historicoPagamentos, linhasRotina, type ClasseRotina, type LinhaRotina,
} from '@/lib/painel/rotina';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const CLASSES: Record<ClasseRotina, { rotulo: string; tom: Tom }> = {
  rotina: { rotulo: 'Rotina', tom: 'ok' },
  fora: { rotulo: 'Fora da rotina', tom: 'warn' },
  sem_historico: { rotulo: 'Sem histórico', tom: 'neutral' },
};

export default async function Pagamentos({ searchParams }: PageProps<'/pagamentos'>) {
  const sp = await searchParams;
  const classe = um(sp.classe) as ClasseRotina | undefined;
  const busca = um(sp.busca)?.toLowerCase();
  const forn = um(sp.f);
  const ordem = um(sp.ordem) ?? 'variacao';

  const p = await painel();
  const todas = linhasRotina(p, (id) => nomeFornecedor(p.hora, id));
  const conta = (c: ClasseRotina) => todas.filter((l) => l.classe === c).length;
  let linhas = todas.filter((l) => (!classe || l.classe === classe) && (!busca || `${l.tituloId} ${l.fornecedor}`.toLowerCase().includes(busca)));
  const chave = (l: LinhaRotina) => (ordem === 'valor' ? l.valor : Math.abs(l.variacaoMediana ?? -1));
  linhas = [...linhas].sort((a, b) => chave(b) - chave(a));
  const pag = paginar(linhas, sp.pagina);

  const hist = forn ? historicoPagamentos(p, forn) : [];
  const histPag = paginar([...hist].reverse(), sp.ph, 10);
  const selecionada = forn ? todas.filter((l) => l.fornecedorId === forn) : [];
  const qs = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ classe, busca: um(sp.busca), ordem: um(sp.ordem), f: forn, ...extra })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Rotina e variações</h1>
        <p className="text-sm text-muted">
          Cada título da agenda diz se é pagamento de rotina e quanto varia contra o histórico do fornecedor. Rotina = histórico de pelo menos {MINIMO_HISTORICO} pagamentos,
          valor dentro de ±{FAIXA_ROTINA * 100}% da mediana, nenhuma regra disparada e, em contrato, o selo conforme contrato.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat rotulo="Rotina" valor={conta('rotina')} tom="ok" detalhe="podem seguir o fluxo normal" />
        <Stat rotulo="Fora da rotina" valor={conta('fora')} tom="warn" detalhe="valor ou regra fora do padrão" />
        <Stat rotulo="Sem histórico" valor={conta('sem_historico')} detalhe="fornecedor novo ou pouco pago" />
      </div>

      <Card className="p-3">
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-2 focus-within:border-accent">
            <Search className="size-4 text-muted" />
            <input name="busca" defaultValue={um(sp.busca)} placeholder="Título ou fornecedor" className="w-full bg-transparent py-1.5 outline-none" />
          </div>
          <select name="classe" defaultValue={classe ?? ''} className="rounded-md border border-border bg-bg px-2 py-2 text-sm">
            <option value="">Todas as classes</option>
            {Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </select>
          <select name="ordem" defaultValue={ordem} className="rounded-md border border-border bg-bg px-2 py-2 text-sm">
            <option value="variacao">Maior variação primeiro</option>
            <option value="valor">Maior valor primeiro</option>
          </select>
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-on-solid">Filtrar</button>
          {(classe || busca || forn) && <Link href="/pagamentos" className="flex items-center gap-1 text-xs text-muted hover:text-text"><X className="size-3" />Limpar</Link>}
        </form>
      </Card>

      <div className={`grid gap-4 ${forn ? 'xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Classe</th>
                  <th className="px-3 py-2 font-medium">Título</th>
                  <th className="px-3 py-2 font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">Mediana</th>
                  <th className="px-3 py-2 text-right font-medium">Vs. mediana</th>
                  <th className="px-3 py-2 text-right font-medium">Vs. último</th>
                  <th className="px-3 py-2 font-medium">Destino</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pag.itens.map((l) => {
                  const d = destinoUi(l.destino);
                  return (
                    <tr key={l.tituloId} className={l.fornecedorId === forn ? 'bg-accent-soft' : 'hover:bg-surface-2'}>
                      <td className="px-3 py-2"><Badge tom={CLASSES[l.classe].tom} title={l.motivos.join(' ')}>{CLASSES[l.classe].rotulo}</Badge></td>
                      <td className="px-3 py-2"><Link href={`/auditoria?t=${l.tituloId}`} className="font-mono text-xs text-accent hover:underline">{l.tituloId}</Link></td>
                      <td className="px-3 py-2"><Link href={`/pagamentos${qs({ f: l.fornecedorId })}`} className="hover:underline">{l.fornecedor}</Link></td>
                      <td className="tabular px-3 py-2 text-right">{brl(l.valor)}</td>
                      <td className="tabular px-3 py-2 text-right text-muted">{l.mediana != null ? brl(l.mediana) : '—'}</td>
                      <td className={`tabular px-3 py-2 text-right ${l.variacaoMediana != null && Math.abs(l.variacaoMediana) > FAIXA_ROTINA ? 'text-warn' : ''}`}>{l.variacaoMediana != null ? formatarVariacao(l.variacaoMediana) : '—'}</td>
                      <td className="tabular px-3 py-2 text-right text-muted">{l.variacaoUltimo != null ? formatarVariacao(l.variacaoUltimo) : '—'}</td>
                      <td className="px-3 py-2"><Badge tom={d.tom}>{d.rotulo}</Badge></td>
                    </tr>
                  );
                })}
                {!linhas.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">Nenhum título com esses filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginacao basePath="/pagamentos" params={sp} {...pag} />
        </Card>

        {forn && (
          <Card>
            <CardTitulo extra={<Link href={`/pagamentos${qs({ f: undefined })}`} className="text-xs text-muted hover:text-text">Fechar</Link>}>
              Histórico · {nomeFornecedor(p.hora, forn)}
            </CardTitulo>
            <div className="space-y-4 p-4">
              <Barras historico={hist.map((h) => h.valor)} atuais={selecionada.map((s) => s.valor)} mediana={selecionada[0]?.mediana ?? null} />
              {selecionada.map((s) => (
                <div key={s.tituloId} className="rounded-lg bg-surface-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{s.tituloId}</span>
                    <Badge tom={CLASSES[s.classe].tom}>{CLASSES[s.classe].rotulo}</Badge>
                    <span className="tabular ml-auto">{brl(s.valor)}</span>
                  </div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted">{s.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              ))}
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-medium">Data</th><th className="py-1 text-right font-medium">Valor pago</th><th className="py-1 text-right font-medium">Vs. anterior</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {histPag.itens.map((h) => (
                    <tr key={h.tituloId}>
                      <td className="py-1.5">{h.data.split('-').reverse().join('/')} <span className="font-mono text-xs text-muted">{h.tituloId}</span></td>
                      <td className="tabular py-1.5 text-right">{brl(h.valor)}</td>
                      <td className="tabular py-1.5 text-right text-muted">{h.variacaoAnterior != null ? formatarVariacao(h.variacaoAnterior) : '—'}</td>
                    </tr>
                  ))}
                  {!hist.length && <tr><td colSpan={3} className="py-4 text-center text-muted">Nenhum pagamento anterior.</td></tr>}
                </tbody>
              </table>
              <Paginacao basePath="/pagamentos" params={sp} param="ph" {...histPag} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Pagamentos anteriores (cinza), título(s) atuais (azul, rotulados "atual") e a mediana (linha tracejada). */
function Barras({ historico, atuais, mediana }: { historico: number[]; atuais: number[]; mediana: number | null }) {
  const barras = [...historico.slice(-12).map((v) => ({ v, atual: false })), ...atuais.map((v) => ({ v, atual: true }))];
  if (!barras.length) return null;
  const max = Math.max(...barras.map((b) => b.v), mediana ?? 0) * 1.1;
  const W = 480, H = 120, L = 8, B = 16, w = (W - L * 2) / barras.length;
  const y = (v: number) => H - B - (v / max) * (H - B - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Pagamentos anteriores e valor atual">
      {barras.map((b, i) => (
        <g key={i}>
          <rect x={L + i * w + 2} y={y(b.v)} width={Math.max(w - 4, 2)} height={H - B - y(b.v)} className={b.atual ? 'fill-accent' : 'fill-neutral-soft'} />
          {b.atual && <text x={L + i * w + w / 2} y={H - 3} textAnchor="middle" className="fill-text text-xs">atual</text>}
        </g>
      ))}
      {mediana != null && (
        <g>
          <line x1={L} x2={W - L} y1={y(mediana)} y2={y(mediana)} className="stroke-muted" strokeDasharray="4 3" />
          <text x={W - L} y={y(mediana) - 3} textAnchor="end" className="fill-muted text-xs">mediana {brl(mediana, true)}</text>
        </g>
      )}
    </svg>
  );
}
