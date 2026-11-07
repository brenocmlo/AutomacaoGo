import { numero } from '@/lib/data/normalizadores';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R04 · OC × NF. A NF pode passar da OC em até max(% , R$) da política; a OC precisa
 * estar aprovada. Categorias dispensadas de OC passam. Na OC do próprio contrato, o valor
 * fica com o módulo de contratos (D01/D05); em outra OC do tipo contrato, a referência é o valor mensal.
 */
export const r04OcNf: Regra = (d, ctx) => {
  const t = d.titulo;
  const pol = ctx.politicas.tresVias;
  const categoria = d.fornecedor?.categoria ?? '';
  if (pol.dispensaOc.includes(categoria)) return passou('R04', `categoria ${categoria} dispensa OC`);
  if (!d.oc) return passou('R04', 'título sem OC (avaliado em R09)');

  const ev = [t.titulo_id, d.oc.oc_id];
  if (d.oc.status !== 'aprovada') {
    return falhou('R04', 'conferencia', `A OC ${d.oc.oc_id} está "${d.oc.status.replace('_', ' ')}", não aprovada para pagamento.`, ev);
  }
  if (!d.nf) return passou('R04', 'sem NF para comparar', ev);
  // Título na OC do próprio contrato: o valor é conferido por competência no módulo de contratos
  // (faixa com reajuste, multa e juros: desvios D01/D02/D05). Comparar aqui duplicaria o alerta.
  if (d.contrato && d.contrato.oc_id && d.contrato.oc_id === d.oc.oc_id) {
    return passou('R04', 'valor conferido pelo contrato, por competência', [...ev, d.contrato.contrato_id]);
  }
  ev.push(d.nf.chave_acesso);

  const ehContrato = d.oc.tipo === 'contrato' || !!d.contrato;
  const referencia = ehContrato
    ? numero(d.contrato?.valor_mensal) ?? numero(d.oc.valor_mensal) ?? numero(d.oc.valor_total) ?? 0
    : numero(d.oc.valor_total) ?? 0;
  if (d.contrato) ev.push(d.contrato.contrato_id);
  const valorNf = numero(d.nf.valor_total) ?? 0;
  const tolerancia = Math.max(referencia * pol.ocToleranciaPct, pol.ocToleranciaAbs);

  if (valorNf > referencia + tolerancia) {
    const pct = referencia > 0 ? ((valorNf / referencia - 1) * 100).toFixed(1).replace('.', ',') : '∞';
    return falhou(
      'R04',
      'conferencia',
      `NF de ${brl(valorNf)} está ${pct}% acima ${ehContrato ? 'do valor mensal do contrato' : 'da OC'} (${brl(referencia)}); a tolerância é ${brl(tolerancia)}.`,
      ev,
    );
  }
  return passou('R04', 'ok', ev);
};
