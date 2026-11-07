import { trocasBancariasRecentes } from './auxiliares';
import { falhou, passou, type Regra } from './tipos';

/**
 * R09 · Aprovação dupla. Casos da política: sem NF (exceto categorias dispensadas),
 * sem OC aprovada (exceto dispensadas), antecipação, troca bancária recente sem
 * confirmação válida. Passa se já houver duas aprovações de pessoas diferentes,
 * uma delas da coordenação (ou da diretoria, acima da alçada do aprovador).
 */
export const r09AprovacaoDupla: Regra = (d, ctx) => {
  const t = d.titulo;
  const pol = ctx.politicas;
  const categoria = d.fornecedor?.categoria ?? '';
  const motivos: string[] = [];
  const ev = [t.titulo_id];

  if (!d.nfNumero && !pol.tresVias.dispensaNf.includes(categoria)) motivos.push('pagamento sem NF');
  if (!pol.tresVias.dispensaOc.includes(categoria) && (!d.oc || d.oc.status !== 'aprovada')) {
    motivos.push(d.oc ? `OC ${d.oc.oc_id} não aprovada` : 'pagamento sem OC');
    if (d.oc) ev.push(d.oc.oc_id);
  }
  if (d.agenda && d.agenda.data_prevista < ctx.cal.proximoDiaUtil(t.vencimento) && d.agenda.data_prevista < t.vencimento) {
    motivos.push(`antecipação (vence em ${t.vencimento}, sai em ${d.agenda.data_prevista})`);
  }
  if (d.fornecedor) {
    const trocas = trocasBancariasRecentes(ctx.idx, d.fornecedor, ctx.agora, ctx.config.regras.R07.janela_dias);
    const ruim = trocas.find((x) => !x.confirmacaoValida);
    if (ruim) {
      motivos.push('fornecedor com troca bancária recente sem confirmação válida');
      ev.push(...ruim.alteracoes.map((a) => a.alteracao_id));
    }
  }
  if (motivos.length === 0) return passou('R09');

  const aprovs = (ctx.aprovacoes.get(t.titulo_id) ?? []).filter((a) => a.decisao === 'aprovado' && a.aprovador !== t.lancado_por);
  const pessoas = new Set(aprovs.map((a) => a.pessoaId ?? a.aprovador));
  const segunda = d.valor > pol.alcadas.aprovadorAte ? pol.alcadas.diretoriaPessoaId : pol.alcadas.coordenacaoPessoaId;
  const temSegunda = aprovs.some((a) => a.pessoaId === segunda || a.pessoaId === pol.alcadas.diretoriaPessoaId);
  if (pessoas.size >= 2 && temSegunda) return passou('R09', 'aprovação dupla registrada', ev);

  return falhou('R09', 'aprovacao', `Exige aprovação dupla: ${motivos.join('; ')}.`, ev, { aprovacao: 'dupla' });
};
