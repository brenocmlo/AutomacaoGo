import { falhou, passou, type Regra } from './tipos';

/** R10 · Recebimento. Título de mercadoria exige recebimento conferido da NF no WMS. */
export const r10Recebimento: Regra = (d, ctx) => {
  const categoria = d.fornecedor?.categoria ?? '';
  if (!ctx.config.categorias.mercadoria.includes(categoria)) return passou('R10', 'não é mercadoria');
  if (!d.nf) return passou('R10', 'sem NF (avaliado em R03/R09)');
  const ev = [d.titulo.titulo_id, d.nf.chave_acesso];
  if (d.recebimentos.length === 0) {
    return falhou('R10', 'conferencia', `Não há registro de entrada da mercadoria da NF ${d.nf.numero_nf} no CD.`, ev);
  }
  ev.push(...d.recebimentos.map((r) => r.recebimento_id));
  const naoConferido = d.recebimentos.find((r) => !/^conferido/i.test(r.situacao));
  if (naoConferido) {
    return falhou('R10', 'conferencia', `Recebimento da NF ${d.nf.numero_nf} está "${naoConferido.situacao}", não conferido.`, ev);
  }
  return passou('R10', 'ok', ev);
};
