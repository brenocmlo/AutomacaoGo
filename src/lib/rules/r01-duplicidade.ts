import { diasEntre, paraMs } from '@/lib/clock/relogio';
import { centavos, nfNormalizada, numero, parcela } from '@/lib/data/normalizadores';
import type { Titulo } from '@/lib/data/tipos';
import { falhou, passou, type Regra } from './tipos';

/**
 * R01 · Duplicidade.
 * Outro título não cancelado do mesmo fornecedor (raiz do CNPJ) com:
 *  (a) mesma NF normalizada e mesma parcela; ou (b) mesma linha digitável; ou
 *  (c) mesmo valor e vencimento próximo.
 * Só a CÓPIA falha: a que foi lançada depois (ou qualquer uma, se a outra já foi paga).
 * Assim o título original segue e não gera atraso indevido.
 */
export const r01Duplicidade: Regra = (d, ctx) => {
  const t = d.titulo;
  const janela = ctx.config.regras.R01.janela_vencimento_dias;
  const meuValor = centavos(d.valor);
  const minhaParcela = d.parcela ? `${d.parcela.n}/${d.parcela.total}` : t.parcela;

  const ehCopia = (outro: Titulo) =>
    outro.status === 'pago' ||
    paraMs(outro.data_lancamento) < paraMs(t.data_lancamento) ||
    (outro.data_lancamento === t.data_lancamento && outro.titulo_id < t.titulo_id);

  const candidatos = (ctx.idx.titulosPorRaiz.get(d.raiz) ?? []).filter(
    (o) => o.titulo_id !== t.titulo_id && o.status !== 'cancelado',
  );

  for (const o of candidatos) {
    const p = parcela(o.parcela);
    const outraParcela = p ? `${p.n}/${p.total}` : o.parcela;
    let como: string | null = null;
    if (d.nfNumero && nfNormalizada(o.numero_nf_digitado) === d.nfNumero && outraParcela === minhaParcela) {
      como = `mesma NF ${d.nfNumero} e parcela ${minhaParcela}`;
    } else if (t.linha_digitavel && o.linha_digitavel === t.linha_digitavel) {
      como = 'mesma linha digitável';
    } else if (
      centavos(numero(o.valor) ?? -1) === meuValor &&
      Math.abs(diasEntre(o.vencimento, t.vencimento)) <= janela &&
      // Só quando a NF não distingue os títulos (um deles sem NF). Se ambos têm NF, ou são
      // compras diferentes (NFs diferentes) ou parcelas diferentes da mesma NF (fracionamento, R08).
      !(d.nfNumero && nfNormalizada(o.numero_nf_digitado))
    ) {
      como = 'mesmo valor e vencimento próximo';
    }
    if (como && ehCopia(o)) {
      return falhou('R01', 'critica', `Possível pagamento em duplicidade com o título ${o.titulo_id} (${como}).`, [
        t.titulo_id,
        o.titulo_id,
      ]);
    }
  }
  return passou('R01');
};
