import { centavos, nfNormalizada, numero, raizCnpj } from '@/lib/data/normalizadores';
import { nivelMaior, nivelPorValor } from './auxiliares';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R08 · Alçada e fracionamento.
 *  - A alçada vale pela soma dos títulos do mesmo fornecedor e da mesma NF no mesmo
 *    dia de pagamento. Se a soma sobe de nível em relação ao título isolado, é
 *    fracionamento: exige aprovação no nível da soma.
 *  - Segregação: quem lançou não pode ser quem aprovou.
 *  - Se já houver aprovação de quem tem alçada para a soma, passa.
 */
export const r08Alcada: Regra = (d, ctx) => {
  const t = d.titulo;
  const pol = ctx.politicas;
  const aprovs = (ctx.aprovacoes.get(t.titulo_id) ?? []).filter((a) => a.decisao === 'aprovado');

  const autoaprovacao = aprovs.find((a) => a.aprovador === t.lancado_por) ??
    (t.aprovado_por && t.aprovado_por === t.lancado_por ? { aprovador: t.aprovado_por } : null);
  if (autoaprovacao) {
    return falhou('R08', 'aprovacao', `Quem lançou o título (${t.lancado_por}) também o aprovou: falta segregação.`, [t.titulo_id], {
      aprovacao: 'simples',
    });
  }

  if (!d.nfNumero || !d.agenda) return passou('R08');
  const dia = d.agenda.data_prevista;
  const grupo = ctx.agenda.filter((a) => {
    if (a.data_prevista !== dia) return false;
    const o = ctx.idx.tituloPorId.get(a.titulo_id);
    if (!o) return false;
    return raizCnpj(ctx.idx.fornecedorPorId.get(o.fornecedor_id)?.cnpj) === d.raiz && nfNormalizada(o.numero_nf_digitado) === d.nfNumero;
  });
  // Uma vez por parcela: cópias da mesma parcela são duplicidade (R01), não fracionamento.
  const porParcela = new Map<string, (typeof grupo)[number]>();
  for (const a of grupo) {
    const p = ctx.idx.tituloPorId.get(a.titulo_id)!.parcela;
    if (!porParcela.has(p) || a.titulo_id === t.titulo_id) porParcela.set(p, a);
  }
  if (porParcela.size <= 1) return passou('R08');

  const soma = centavos([...porParcela.values()].reduce((s, a) => s + (numero(a.valor) ?? 0), 0));
  const nivelSoma = nivelPorValor(soma, pol);
  if (!nivelMaior(nivelSoma, nivelPorValor(d.valor, pol))) return passou('R08', 'soma no mesmo nível do título');

  const coberto = aprovs.some((a) => a.alcada >= soma && a.aprovador !== t.lancado_por);
  if (coberto) return passou('R08', 'fracionamento aprovado por alçada suficiente');

  return falhou(
    'R08',
    'aprovacao',
    `Fracionamento: ${porParcela.size} títulos da NF ${d.nfNumero} no mesmo dia somam ${brl(soma)}, acima da alçada de ${brl(pol.alcadas.analistaLiberarAte)} do título isolado. Exige aprovação de ${nivelSoma}.`,
    [...porParcela.values()].map((a) => a.titulo_id),
    { aprovacao: 'alcada_superior', valorConsiderado: soma },
  );
};
