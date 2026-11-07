import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Mail, MessageCircle, X, XCircle } from 'lucide-react';
import { Badge, Card, SEVERIDADES, URGENCIAS, brl, destinoUi, horaBR } from '@/components/ui';
import { AcoesTitulo } from '@/components/acoes-titulo';
import type { DetalheTitulo } from '@/lib/painel/dados';

const ATORES: Record<string, string> = {
  motor_regras: 'Motor de regras', agente_operacao: 'Agente de operação', agente_validacao: 'Agente de validação',
  leitor_mensagens: 'Leitor de mensagens', humano: 'Humano', sistema: 'Sistema',
};

const NOMES_REGRAS: Record<string, string> = {
  R01: 'Duplicidade', R02: 'Já pago por outro caminho', R03: 'NF × título', R04: 'OC × NF', R05: 'Fornecedor',
  R06: 'Boleto', R07: 'Destino TED/PIX', R08: 'Alçada e fracionamento', R09: 'Aprovação dupla', R10: 'Recebimento',
  R11: 'Valor atípico', R12: 'Variação mensal', R13: 'Lançador', R14: 'Mensagem de risco',
};

export function DetalhePainel({ det, fecharHref, simulacaoId, podeDecidir }: {
  det: DetalheTitulo;
  fecharHref: string;
  simulacaoId: string | null;
  podeDecidir: boolean;
}) {
  const { av } = det;
  const falhas = av.resultados.filter((r) => !r.passou);
  const passaram = av.resultados.filter((r) => r.passou);

  return (
    <Card className="self-start xl:sticky xl:top-20">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{av.tituloId} · {av.lote}</p>
          <h2 className="truncate text-base font-semibold">{det.fornecedorNome}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="tabular text-lg font-semibold">{brl(av.valor)}</span>
            <Badge tom={destinoUi(av.decisao.destino).tom}>{destinoUi(av.decisao.destino).rotulo}</Badge>
            <Badge tom={URGENCIAS[av.urgencia].tom}>{URGENCIAS[av.urgencia].rotulo}</Badge>
            <span className="text-xs text-muted">fecha {horaBR(av.fechamento)}</span>
          </div>
        </div>
        <Link href={fecharHref} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label="Fechar"><X className="size-4" /></Link>
      </div>

      <div className="max-h-[calc(100vh-11rem)] space-y-5 overflow-y-auto p-4">
        <section className={`rounded-lg p-3 text-sm ${falhas.length ? 'bg-warn-soft' : 'bg-ok-soft'}`}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Decisão e ação recomendada</p>
          <p>{av.decisao.motivo}</p>
          {av.decisao.notificar.length > 0 && <p className="mt-2 text-xs text-muted">Notificar: {av.decisao.notificar.join(', ')}</p>}
          {av.decisao.aprovacao && (
            <p className="mt-1 text-xs text-muted">
              Aprovação {av.decisao.aprovacao.tipo.replace('_', ' ')} de {brl(av.decisao.aprovacao.valor)} por {av.decisao.aprovacao.aprovadores.join(' + ')}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Comparação entre sistemas</h3>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {det.colunas.map((c) => (
              <div key={c.titulo} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">{c.titulo}</p>
                {c.id && <p className="truncate font-mono text-[10px] text-muted" title={c.id}>{c.id}</p>}
                <dl className="mt-2 space-y-1 text-xs">
                  {c.linhas.map((l) => (
                    <div key={l.rotulo} className="flex justify-between gap-2">
                      <dt className="shrink-0 text-muted">{l.rotulo}</dt>
                      <dd className={`tabular truncate text-right ${l.alerta ? 'font-semibold text-danger' : ''}`} title={l.valor}>{l.valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Regras ({falhas.length} disparadas)</h3>
          <ul className="space-y-2">
            {falhas.map((r) => (
              <li key={r.codigo} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  {r.severidade === 'alerta' ? <AlertTriangle className="size-4 text-warn" /> : <XCircle className="size-4 text-danger" />}
                  <span className="font-medium">{r.codigo} · {NOMES_REGRAS[r.codigo]}</span>
                  <Badge tom={SEVERIDADES[r.severidade]!.tom}>{SEVERIDADES[r.severidade]!.rotulo}</Badge>
                </div>
                <p className="mt-1">{r.motivo}</p>
                {r.evidencias.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.evidencias.map((e) =>
                      /^TP\d+$/.test(e) && e !== av.tituloId ? (
                        <Link key={e} href={`/auditoria?t=${e}`} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:underline">{e}</Link>
                      ) : (
                        <span key={e} className="max-w-full truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted" title={e}>{e}</span>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
            <CheckCircle2 className="size-3.5 text-ok" />Passou em {passaram.map((r) => r.codigo).join(', ') || 'nenhuma'}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Mensagens relacionadas</h3>
          {det.mensagens.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma mensagem do fornecedor ou citando a NF.</p>
          ) : (
            <ul className="space-y-1.5">
              {det.mensagens.map((m) => (
                <li key={m.id} className="flex items-start gap-2 text-xs">
                  {m.canal === 'whatsapp' ? <MessageCircle className="mt-0.5 size-3.5 text-muted" /> : <Mail className="mt-0.5 size-3.5 text-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.assunto || '(sem assunto)'}</p>
                    <p className="truncate text-muted">{m.data} · {m.remetente}</p>
                  </div>
                  {!m.confere && <Badge tom="danger" title="Remetente fora dos canais oficiais do cadastro">canal não oficial</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {simulacaoId && podeDecidir && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Ações</h3>
            {det.solicitacao && (
              <p className="mb-2 text-xs text-muted">
                Solicitação {det.solicitacao.tipo.replace('_', ' ')} de {brl(det.solicitacao.valor)} · exige {det.solicitacao.aprovadores_exigidos.join(' + ')}
                {det.solicitacao.aprovacoes > 0 && ` · ${det.solicitacao.aprovacoes} aprovação já registrada`}
              </p>
            )}
            <AcoesTitulo simulacaoId={simulacaoId} tituloId={av.tituloId} solicitacaoId={det.solicitacao?.id ?? null} retirado={det.retirado} />
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Linha do tempo</h3>
          {!simulacaoId ? (
            <p className="text-xs text-muted">O log de auditoria aparece quando o Supabase estiver conectado e a simulação iniciada.</p>
          ) : det.log.length === 0 ? (
            <p className="text-xs text-muted">Nenhum registro para este título ainda.</p>
          ) : (
            <ol className="space-y-2 border-l border-border pl-3">
              {det.log.map((l) => (
                <li key={l.log_id} className="text-xs">
                  <p>
                    <span className="font-medium">{ATORES[l.ator_tipo] ?? l.ator_tipo}</span> {l.acao}
                    <span className="text-muted"> · {l.data_hora_simulada ? horaBR(l.data_hora_simulada.slice(0, 16)) : ''}</span>
                  </p>
                  {l.motivo && <p className="text-muted">{l.motivo}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Card>
  );
}
