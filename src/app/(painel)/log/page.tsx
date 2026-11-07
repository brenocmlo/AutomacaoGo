import Link from 'next/link';
import { Download, X } from 'lucide-react';
import { Badge, Card, CardTitulo, Stat, brl, duracao } from '@/components/ui';
import { Paginacao, paginar } from '@/components/paginacao';
import { custoIA, gargalos, paginaDeLogs, usd, type FiltrosLog } from '@/lib/painel/log';
import { painel } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const ATORES: Record<string, string> = {
  motor_regras: 'Motor de regras', agente_operacao: 'Agente de operação', agente_validacao: 'Agente de validação',
  leitor_mensagens: 'Leitor de mensagens', gerador_eventos: 'Gerador de eventos', humano: 'Humano', sistema: 'Sistema',
};
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const num = (v: number) => v.toLocaleString('pt-BR');

export default async function LogEGargalos({ searchParams }: PageProps<'/log'>) {
  const sp = await searchParams;
  const filtros: FiltrosLog = { ator: um(sp.ator), entidade: um(sp.entidade), busca: um(sp.busca), acao: um(sp.acao) };
  const p = await painel();

  if (!supabaseConfigurado() || !p.sim) {
    return <Card className="mx-auto max-w-lg p-6 text-center text-sm text-muted">O log e os gargalos dependem de uma simulação ativa no Supabase.</Card>;
  }

  const POR_PAGINA_LOG = 25;
  const pedida = Number(um(sp.pagina));
  const [pag, ia, g] = await Promise.all([paginaDeLogs(p, filtros, Number.isFinite(pedida) && pedida >= 1 ? Math.floor(pedida) : 1, POR_PAGINA_LOG), custoIA(p), gargalos(p)]);
  const linhas = pag.linhas;
  const paginasLog = Math.max(1, Math.ceil(pag.total / POR_PAGINA_LOG));
  const paginaLog = Math.min(Math.max(1, Math.floor(pedida) || 1), paginasLog);
  const diasIa = paginar(ia.porDia, sp.pdia, 10);
  const exportar = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v) as [string, string][]).toString();
  const filtrosAtivos = Object.values(filtros).some(Boolean);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Log e gargalos</h1>
          <p className="text-sm text-muted">Toda ação de agente, humano ou motor fica registrada, só de inclusão.</p>
        </div>
        <a href={`/log/exportar${exportar ? `?${exportar}` : ''}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2">
          <Download className="size-4" />Exportar CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat rotulo="Retiradas desfeitas" valor={pct(g.falsoPositivo.taxa)}
          detalhe={`${g.falsoPositivo.desfeitasValidacao} pela validação, ${g.falsoPositivo.desfeitasHumanos} por humanos, de ${g.falsoPositivo.retiradas} retiradas`} tom="info" />
        <Stat rotulo="Tempo do alerta à ação humana" valor={g.tempoAteAcao.medianaMin == null ? '—' : g.tempoAteAcao.medianaMin === 0 ? '0 min' : duracao(g.tempoAteAcao.medianaMin)}
          detalhe={`mediana de ${g.tempoAteAcao.acoes} alertas atendidos · ${g.tempoAteAcao.semAcao} abertos sem ação`} tom={g.tempoAteAcao.semAcao > 0 ? 'warn' : undefined} />
        <Stat rotulo="Parados perto do fechamento" valor={g.paradosPerto.length}
          detalhe="aguardando aprovação a menos de 3 h do lote fechar" tom={g.paradosPerto.length ? 'danger' : 'ok'} />
        <Stat rotulo="Avisos ativos" valor={num(g.avisos.ativos)} detalhe={`${g.avisos.consolidados} consolidados e ${g.avisos.descartados} descartados pela validação`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitulo>Fila por aprovador</CardTitulo>
          <ul className="divide-y divide-border">
            {g.filaPorAprovador.map((a) => (
              <li key={a.aprovador} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge>{a.aprovador}</Badge>
                <span className="tabular flex-1 text-muted">{a.qtd} {a.qtd === 1 ? 'solicitação' : 'solicitações'}</span>
                <span className="tabular font-medium">{brl(a.valor, true)}</span>
              </li>
            ))}
            {g.filaPorAprovador.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhuma solicitação pendente.</li>}
          </ul>
        </Card>
        <Card>
          <CardTitulo>Parados perto do fechamento</CardTitulo>
          <ul className="divide-y divide-border">
            {g.paradosPerto.slice(0, 8).map((t) => (
              <li key={t.tituloId}>
                <Link href={`/auditoria?t=${t.tituloId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                  <span className="font-mono text-xs text-muted">{t.tituloId}</span>
                  <span className="flex flex-1 gap-1">{t.exigidos.map((e) => <Badge key={e}>{e}</Badge>)}</span>
                  <span className="tabular">{brl(t.valor)}</span>
                  <Badge tom={t.minutos <= 60 ? 'danger' : 'warn'}>fecha em {duracao(t.minutos)}</Badge>
                </Link>
              </li>
            ))}
            {g.paradosPerto.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nada parado perto do fechamento.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitulo extra={ia.modelos.length ? <span className="text-xs text-muted">{ia.modelos.join(', ')}</span> : undefined}>Custo de IA por dia simulado</CardTitulo>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Dia</th>
                <th className="px-4 py-2 text-right font-medium">Chamadas</th>
                <th className="px-4 py-2 text-right font-medium">Falhas</th>
                <th className="px-4 py-2 text-right font-medium">Tokens (entrada / saída)</th>
                <th className="px-4 py-2 text-right font-medium">Custo estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {diasIa.itens.map((d) => (
                <tr key={d.dia} className="tabular">
                  <td className="px-4 py-2">{d.dia.split('-').reverse().slice(0, 2).join('/')}</td>
                  <td className="px-4 py-2 text-right">{num(d.chamadas)}</td>
                  <td className="px-4 py-2 text-right">{num(d.falhas)}</td>
                  <td className="px-4 py-2 text-right">{num(d.tokensEntrada)} / {num(d.tokensSaida)}</td>
                  <td className="px-4 py-2 text-right">{usd(d.custoUsd)}</td>
                </tr>
              ))}
              {ia.porDia.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Nenhuma chamada de IA nesta simulação. As regras rodam sem IA.</td></tr>}
            </tbody>
            {ia.porDia.length > 0 && (
              <tfoot className="tabular border-t border-border font-medium">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{num(ia.total.chamadas)}</td>
                  <td className="px-4 py-2 text-right">{num(ia.total.falhas)}</td>
                  <td className="px-4 py-2 text-right">{num(ia.total.tokensEntrada)} / {num(ia.total.tokensSaida)}</td>
                  <td className="px-4 py-2 text-right">{usd(ia.total.custoUsd)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Paginacao basePath="/log" params={sp} param="pdia" {...diasIa} />
      </Card>

      <Card>
        <CardTitulo>Log de auditoria</CardTitulo>
        <form className="flex flex-wrap items-center gap-2 border-b border-border p-3 text-sm">
          <input name="busca" defaultValue={filtros.busca} placeholder="Título, ação ou motivo" className="min-w-48 flex-1 rounded-md border border-border bg-bg px-2 py-1.5" />
          <select name="ator" defaultValue={filtros.ator ?? ''} className="rounded-md border border-border bg-bg px-2 py-1.5">
            <option value="">Todos os atores</option>
            {Object.entries(ATORES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="entidade" defaultValue={filtros.entidade ?? ''} className="rounded-md border border-border bg-bg px-2 py-1.5">
            <option value="">Todas as entidades</option>
            {['titulo', 'lote', 'ciclo', 'mensagem', 'alerta', 'contrato'].map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <button className="rounded-md bg-accent px-4 py-1.5 font-medium text-on-solid">Filtrar</button>
          {filtrosAtivos && <Link href="/log" className="flex items-center gap-1 text-xs text-muted hover:text-text"><X className="size-3" />Limpar</Link>}
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Hora simulada</th>
                <th className="px-4 py-2 font-medium">Ator</th>
                <th className="px-4 py-2 font-medium">Ação</th>
                <th className="px-4 py-2 font-medium">Entidade</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
                <th className="px-4 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {linhas.map((l) => (
                <tr key={l.log_id} className="align-top">
                  <td className="tabular px-4 py-2 text-muted">{l.log_id}</td>
                  <td className="tabular whitespace-nowrap px-4 py-2">{l.data_hora_simulada ? l.data_hora_simulada.slice(5, 16).replace('T', ' ') : '—'}</td>
                  <td className="px-4 py-2"><Badge tom={l.ator_tipo === 'humano' ? 'info' : 'neutral'}>{ATORES[l.ator_tipo] ?? l.ator_tipo}</Badge></td>
                  <td className="px-4 py-2">{l.acao}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {l.entidade_id && l.entidade === 'titulo' ? <Link className="hover:underline" href={`/auditoria?t=${l.entidade_id}`}>{l.entidade_id}</Link> : (l.entidade_id ?? l.entidade)}
                  </td>
                  <td className="max-w-md px-4 py-2 text-muted">{l.motivo}</td>
                  <td className="tabular px-4 py-2 text-right">{l.valor_em_jogo != null ? brl(l.valor_em_jogo) : ''}</td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">Nenhum registro com estes filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacao basePath="/log" params={sp} pagina={paginaLog} paginas={paginasLog} total={pag.total} de={(paginaLog - 1) * POR_PAGINA_LOG} ate={Math.min(paginaLog * POR_PAGINA_LOG, pag.total)} />
        <p className="px-4 pb-2 text-xs text-muted">A exportação traz todos os registros com os filtros aplicados.</p>
      </Card>
    </div>
  );
}
