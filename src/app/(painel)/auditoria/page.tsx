import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { Badge, Card, URGENCIAS, brl, destinoUi } from '@/components/ui';
import { DetalhePainel } from '@/components/detalhe-titulo';
import { GRUPOS_REGRAS, TODOS_DESTINOS, detalhe, fila, gruposDe, nomeFornecedor, painel, type FiltrosFila } from '@/lib/painel/dados';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function FilaAuditoria({ searchParams }: PageProps<'/auditoria'>) {
  const sp = await searchParams;
  const filtros: FiltrosFila = {
    destino: um(sp.destino), urgencia: um(sp.urgencia), banco: um(sp.banco),
    lote: um(sp.lote), grupo: um(sp.grupo), busca: um(sp.busca),
  };
  const selecionado = um(sp.t);
  const p = await painel();
  const hora = p.hora;
  const todas = p.avaliacoes;
  const linhas = fila(p, filtros);
  const det = selecionado ? await detalhe(p, selecionado) : null;

  const bancos = [...new Set(todas.map((a) => a.banco))].sort();
  const lotes = [...new Set(todas.map((a) => a.lote))].sort();
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filtros, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const filtrosAtivos = Object.values(filtros).some(Boolean);
  const MAX = 300;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Fila de auditoria</h1>
          <p className="text-sm text-muted">Ordenada por urgência, risco e valor. {linhas.length.toLocaleString('pt-BR')} de {todas.length.toLocaleString('pt-BR')} títulos.</p>
        </div>
      </div>

      <Card className="p-3">
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-2 focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <Search className="size-4 text-muted" />
            <input name="busca" defaultValue={filtros.busca} placeholder="Título, código ou nome do fornecedor" className="w-full bg-transparent py-1.5 outline-none" />
          </div>
          <Select nome="destino" valor={filtros.destino} vazio="Todos os destinos" opcoes={TODOS_DESTINOS.filter((d) => d !== 'ENVIADO').map((d) => [d, destinoUi(d).rotulo])} />
          <Select nome="urgencia" valor={filtros.urgencia} vazio="Qualquer urgência" opcoes={(['IMEDIATA', 'HOJE', 'NORMAL'] as const).map((k) => [k, URGENCIAS[k].rotulo])} />
          <Select nome="grupo" valor={filtros.grupo} vazio="Todas as regras" opcoes={Object.entries(GRUPOS_REGRAS).map(([k, v]) => [k, v.rotulo])} />
          <Select nome="banco" valor={filtros.banco} vazio="Todos os bancos" opcoes={bancos.map((b) => [b, b])} />
          <Select nome="lote" valor={filtros.lote} vazio="Todos os lotes" opcoes={lotes.map((l) => [l, l])} />
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-on-solid">Filtrar</button>
          {filtrosAtivos && <Link href="/auditoria" className="flex items-center gap-1 text-xs text-muted hover:text-text"><X className="size-3" />Limpar</Link>}
        </form>
      </Card>

      <div className={`grid gap-4 ${det ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : ''}`}>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Urgência</th>
                  <th className="px-3 py-2 font-medium">Título</th>
                  <th className="px-3 py-2 font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Lote</th>
                  <th className="px-3 py-2 font-medium">Regras</th>
                  <th className="px-3 py-2 font-medium">Destino</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linhas.slice(0, MAX).map((a) => {
                  const ativo = a.tituloId === selecionado;
                  const href = `/auditoria${qs({ t: a.tituloId })}`;
                  const falhas: string[] = a.resultados.filter((r) => !r.passou).map((r) => r.codigo);
                  return (
                    <tr key={a.tituloId} className={ativo ? 'bg-accent-soft' : 'hover:bg-surface-2'}>
                      <td className="px-3 py-2"><Badge tom={URGENCIAS[a.urgencia].tom}>{URGENCIAS[a.urgencia].rotulo}</Badge></td>
                      <td className="px-3 py-2 font-mono text-xs"><Link href={href} className="hover:underline">{a.tituloId}</Link></td>
                      <td className="max-w-56 truncate px-3 py-2"><Link href={href}>{nomeFornecedor(hora, a.fornecedorId)}</Link></td>
                      <td className="tabular px-3 py-2 text-right">{brl(a.valor)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{a.lote}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {gruposDe(falhas).map((g) => <Badge key={g} tom="neutral" title={GRUPOS_REGRAS[g]!.regras.filter((r) => falhas.includes(r)).join(', ')}>{GRUPOS_REGRAS[g]!.rotulo}</Badge>)}
                        </div>
                      </td>
                      <td className="px-3 py-2"><Badge tom={destinoUi(a.decisao.destino).tom}>{destinoUi(a.decisao.destino).rotulo}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {linhas.length > MAX && <p className="border-t border-border px-3 py-2 text-xs text-muted">Mostrando {MAX} de {linhas.length}. Use os filtros para refinar.</p>}
          {linhas.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Nenhum título com esses filtros.</p>}
        </Card>

        {det && (
          <DetalhePainel
            det={det}
            fecharHref={`/auditoria${qs({ t: undefined })}`}
            simulacaoId={p.sim?.id ?? null}
            podeDecidir={p.usuario?.papel === 'aprovador'}
          />
        )}
        {selecionado && !det && (
          <Card className="p-6 text-sm text-muted">O título {selecionado} não está em nenhum lote aberto nesta hora simulada.</Card>
        )}
      </div>
    </div>
  );
}

function Select({ nome, valor, vazio, opcoes }: { nome: string; valor?: string; vazio: string; opcoes: [string, string][] }) {
  return (
    <select name={nome} defaultValue={valor ?? ''} className="rounded-md border border-border bg-bg px-2 py-1.5 focus:border-accent">
      <option value="">{vazio}</option>
      {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
    </select>
  );
}
