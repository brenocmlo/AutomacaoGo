import Link from 'next/link';
import { Badge, Card, brl } from '@/components/ui';
import { painel } from '@/lib/painel/dados';
import { CLASSES, SITUACOES, listaContratos, type FiltrosContratos } from '@/lib/painel/contratos';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

export default async function Contratos({ searchParams }: PageProps<'/contratos'>) {
  const sp = await searchParams;
  const filtros: FiltrosContratos = { tipo: um(sp.tipo), gestor: um(sp.gestor), situacao: um(sp.situacao), janela: um(sp.janela) };
  const p = await painel();
  const { linhas, todas } = await listaContratos(p, filtros);

  const tipos = [...new Set(todas.map((l) => l.contrato.tipo))].sort();
  const gestores = [...new Map(todas.map((l) => [l.contrato.gestor_pessoa_id, l.contrato.gestor_contrato])).entries()].sort();
  const comDesvio = todas.filter((l) => l.situacao === 'desvio').length;
  const proximos = todas.filter((l) => l.venceOuReajustaEm30).length;
  const restrito = p.usuario?.papel === 'consulta';

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Contratos</h1>
        <p className="text-sm text-muted">
          Cada pagamento recorrente ligado ao contrato que o autoriza, com o valor esperado de cada mês.
          {restrito && ' Você vê só os contratos em que é gestor.'} {todas.length} contratos · {comDesvio} com desvio · {proximos} vencem ou reajustam em 30 dias.
        </p>
      </div>

      <Card className="p-3">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted">Tipo
            <select name="tipo" defaultValue={filtros.tipo ?? ''} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
              <option value="">Todos</option>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Gestor
            <select name="gestor" defaultValue={filtros.gestor ?? ''} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
              <option value="">Todos</option>
              {gestores.map(([id, nome]) => <option key={id} value={id}>{nome} ({id})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Situação
            <select name="situacao" defaultValue={filtros.situacao ?? ''} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text">
              <option value="">Todas</option>
              {Object.entries(SITUACOES).map(([k, s]) => <option key={k} value={k}>{s.rotulo}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
            <input type="checkbox" name="janela" value="30" defaultChecked={!!filtros.janela} />Vence ou reajusta em 30 dias
          </label>
          <button className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">Filtrar</button>
          {Object.values(filtros).some(Boolean) && <Link href="/contratos" className="text-xs text-muted hover:text-text">Limpar</Link>}
        </form>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Contrato</th>
              <th className="px-3 py-2 font-medium">Fornecedor</th>
              <th className="px-3 py-2 font-medium">Gestor</th>
              <th className="px-3 py-2 text-right font-medium">Valor mensal</th>
              <th className="px-3 py-2 font-medium">Competência</th>
              <th className="px-3 py-2 text-right font-medium">Esperado</th>
              <th className="px-3 py-2 text-right font-medium">Cobrado</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Reajuste</th>
              <th className="px-3 py-2 font-medium">Fim da vigência</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((l) => {
              const s = SITUACOES[l.situacao];
              return (
                <tr key={l.contrato.contrato_id} className="hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/contratos/${l.contrato.contrato_id}`} className="font-mono text-xs text-accent hover:underline">{l.contrato.contrato_id}</Link>
                    <p className="text-xs text-muted">{l.contrato.tipo} · {CLASSES[l.classe]}</p>
                  </td>
                  <td className="max-w-56 truncate px-3 py-2" title={l.fornecedorNome}>{l.fornecedorNome}</td>
                  <td className="px-3 py-2 text-xs">{l.contrato.gestor_contrato}<span className="text-muted"> · {l.contrato.gestor_pessoa_id}</span></td>
                  <td className="tabular px-3 py-2 text-right">{brl(l.valorMensal)}{l.classe !== 'fixo' && <span className="block text-[10px] text-muted">estimativa</span>}</td>
                  <td className="px-3 py-2 text-xs">{l.atual?.competencia ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-right">{brl(l.atual?.valorEsperado)}</td>
                  <td className="tabular px-3 py-2 text-right">{l.atual?.qtdTitulos ? brl(l.atual.valorCobrado) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tom={s.tom}>{s.rotulo}</Badge>
                      {[...new Set(l.competencias.flatMap((c) => c.desvios))].map((d) => <Badge key={d} tom="neutral">{d}</Badge>)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {dataBR(l.proximoReajuste)}
                    {l.diasParaReajuste != null && l.diasParaReajuste >= 0 && l.diasParaReajuste <= 30 && <Badge tom="warn">em {l.diasParaReajuste}d</Badge>}
                    <span className="block text-muted">{l.contrato.indice_reajuste}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {dataBR(l.contrato.fim_vigencia_atual)}
                    {l.diasParaFimVigencia != null && l.diasParaFimVigencia >= 0 && l.diasParaFimVigencia <= 30 && <Badge tom="warn">em {l.diasParaFimVigencia}d</Badge>}
                  </td>
                </tr>
              );
            })}
            {linhas.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted">Nenhum contrato com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
