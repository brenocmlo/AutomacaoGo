import { numero } from '@/lib/data/normalizadores';
import { mediana } from './auxiliares';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R11 · Valor atípico ("zero a mais"). Valor acima de k × mediana histórica dos
 * títulos do fornecedor, a menos que a OC ou o contrato justifiquem o valor.
 */
export const r11ValorAtipico: Regra = (d, ctx) => {
  const cfg = ctx.config.regras.R11;
  const historico = (ctx.idx.titulosPorRaiz.get(d.raiz) ?? [])
    .filter((o) => o.titulo_id !== d.titulo.titulo_id && o.status === 'pago')
    .map((o) => numero(o.valor) ?? 0)
    .filter((v) => v > 0);
  if (historico.length < cfg.minimo_historico) return passou('R11', 'histórico insuficiente');
  const med = mediana(historico)!;
  if (d.valor <= cfg.multiplo_mediana * med) return passou('R11');

  // Justificativas: a OC (pontual) ou o contrato cobrem o valor.
  const tol = ctx.politicas.tresVias;
  const cobre = (ref: number | null) => ref != null && ref > 0 && d.valor <= ref + Math.max(ref * tol.ocToleranciaPct, tol.ocToleranciaAbs);
  const refOc = d.oc ? (d.oc.tipo === 'contrato' ? numero(d.oc.valor_mensal) : numero(d.oc.valor_total)) : null;
  const refContrato = numero(d.contrato?.valor_mensal);
  if (cobre(refOc) || cobre(refContrato)) return passou('R11', 'valor alto, mas coberto pela OC/contrato');

  return falhou(
    'R11',
    'conferencia',
    `Valor de ${brl(d.valor)} é ${(d.valor / med).toFixed(1).replace('.', ',')} vezes a mediana histórica do fornecedor (${brl(med)}).`,
    [d.titulo.titulo_id, ...(d.oc ? [d.oc.oc_id] : [])],
  );
};
