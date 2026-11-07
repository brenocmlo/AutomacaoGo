import { nfNormalizada, parcela } from '@/lib/data/normalizadores';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R02 · Já pago por outro caminho.
 * O título (ou a mesma duplicata) aparece como pago: extrato com o número do título,
 * retorno CNAB com ocorrência 00, boleto liquidado no DDA, outro título da mesma
 * duplicata já pago, ou pagamento avulso (PIX/TED manual) compatível no extrato.
 */
export const r02JaPago: Regra = (d, ctx) => {
  const t = d.titulo;
  const ev: string[] = [t.titulo_id];
  const motivos: string[] = [];

  const pagos = ctx.idx.pagamentosPorTitulo.get(t.titulo_id) ?? [];
  if (pagos.length) {
    motivos.push(`já consta pago em ${pagos[0]!.data} (${pagos[0]!.origem.replace('_', ' ')})`);
    ev.push(...pagos.map((p) => p.id));
  }

  if (d.dda && /liquidado/i.test(d.dda.situacao)) {
    motivos.push(`boleto liquidado no DDA em ${d.dda.data_situacao}`);
    ev.push(d.dda.dda_id);
  }

  if (d.nfNumero && d.parcela) {
    const mesmaDup = (ctx.idx.titulosPorRaiz.get(d.raiz) ?? []).find((o) => {
      const p = parcela(o.parcela);
      return (
        o.titulo_id !== t.titulo_id && o.status === 'pago' && nfNormalizada(o.numero_nf_digitado) === d.nfNumero &&
        p?.n === d.parcela!.n
      );
    });
    if (mesmaDup) {
      motivos.push(`a mesma duplicata já foi paga pelo título ${mesmaDup.titulo_id}`);
      ev.push(mesmaDup.titulo_id);
    }
  }

  const avulsos = ctx.idx.pagamentosAvulsosCompativeis(t);
  if (avulsos.length) {
    const a = avulsos[0]!;
    motivos.push(`pagamento manual de ${brl(a.valor)} em ${a.data} no ${a.origem === 'extrato_litoral' ? 'Banco Litoral' : 'Banco Meridiano'} ("${a.nome}")`);
    ev.push(...avulsos.map((p) => p.id));
  }

  if (motivos.length === 0) return passou('R02');
  return falhou('R02', 'critica', `Título já pago: ${motivos.join('; ')}.`, ev);
};
