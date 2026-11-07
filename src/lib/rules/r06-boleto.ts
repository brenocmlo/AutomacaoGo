import { centavos, numero, raizCnpj } from '@/lib/data/normalizadores';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R06 · Boleto. Banco, valor e CNPJ do beneficiário, lidos da linha digitável e do DDA,
 * devem bater com o fornecedor e com o banco de cobrança que ele sempre usou.
 */
export const r06Boleto: Regra = (d, ctx) => {
  const t = d.titulo;
  if (t.forma_pagamento !== 'boleto') return passou('R06', 'não é boleto');
  const ev = [t.titulo_id];
  const problemas: string[] = [];
  const b = d.boleto;
  if (!b) return falhou('R06', 'critica', 'Linha digitável do boleto inválida ou ausente.', ev);
  if (!b.dvCamposOk) problemas.push('dígitos verificadores da linha digitável não conferem');

  // Bancos aceitos: o do cadastro + os de cobrança históricos (DDA e boletos pagos), sem contar este boleto.
  const historicos = new Set<string>();
  for (const x of ctx.idx.ddaPorRaiz.get(d.raiz) ?? []) if (x.linha_digitavel !== t.linha_digitavel) historicos.add(x.banco_cobrador);
  for (const o of ctx.idx.titulosPorRaiz.get(d.raiz) ?? []) {
    if (o.status === 'pago' && o.linha_digitavel && o.titulo_id !== t.titulo_id) historicos.add(o.linha_digitavel.slice(0, 3));
  }
  if (d.fornecedor?.banco) historicos.add(d.fornecedor.banco);
  if (!historicos.has(b.banco)) {
    problemas.push(`banco ${b.banco} do boleto nunca foi usado por este fornecedor (usa ${[...historicos].sort().join(', ') || 'nenhum'})`);
  }

  if (t.cnpj_beneficiario_boleto && raizCnpj(t.cnpj_beneficiario_boleto) !== d.raiz) {
    problemas.push(`beneficiário do boleto tem outro CNPJ (${t.cnpj_beneficiario_boleto})`);
  }

  if (!d.dda) {
    problemas.push('boleto não está registrado no DDA contra o CNPJ da empresa');
  } else {
    ev.push(d.dda.dda_id);
    if (raizCnpj(d.dda.cnpj_beneficiario) !== d.raiz) {
      problemas.push(`no DDA o beneficiário é ${d.dda.beneficiario} (${d.dda.cnpj_beneficiario})`);
    }
    const valorDda = numero(d.dda.valor) ?? 0;
    if (centavos(valorDda) !== centavos(b.valor)) {
      problemas.push(`valor da linha digitável (${brl(b.valor)}) difere do registrado no DDA (${brl(valorDda)})`);
    }
    if (/baixado/i.test(d.dda.situacao)) problemas.push('boleto baixado pelo beneficiário no DDA');
  }

  if (problemas.length === 0) return passou('R06', 'ok', ev);
  return falhou('R06', 'critica', `Boleto suspeito: ${problemas.join('; ')}.`, ev);
};
