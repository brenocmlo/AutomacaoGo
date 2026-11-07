import { dataDe, diasEntre } from '@/lib/clock/relogio';
import { centavos, numero } from '@/lib/data/normalizadores';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R03 · NF × título. O valor do título deve ser o da duplicata (tolerância de arredondamento).
 * Se o pagamento sai depois do vencimento (além do próximo dia útil), aceita até
 * duplicata + multa + juros pro rata.
 */
export const r03NfTitulo: Regra = (d, ctx) => {
  const t = d.titulo;
  const pol = ctx.politicas;
  if (!d.nfNumero) return passou('R03', 'título sem NF (avaliado em R09)');
  if (!d.nf) return falhou('R03', 'conferencia', `NF ${t.numero_nf_digitado} informada no título não foi encontrada no portal NF-e.`, [t.titulo_id]);
  if (!d.duplicata) {
    return falhou('R03', 'conferencia', `A NF ${d.nf.numero_nf} não tem a parcela ${t.parcela} informada no título.`, [t.titulo_id, d.nf.chave_acesso]);
  }

  const dup = numero(d.duplicata.valor) ?? 0;
  const tol = pol.tresVias.tituloTolerancia;
  const ev = [t.titulo_id, d.nf.chave_acesso, `${d.duplicata.chave_acesso}#${d.duplicata.n_dup}`];
  const dataPagamento = d.agenda?.data_prevista ?? dataDe(ctx.agora);
  const limiteSemEncargo = ctx.cal.proximoDiaUtil(d.duplicata.vencimento);
  const atrasado = dataPagamento > limiteSemEncargo;

  let teto = dup + tol;
  let detalheTeto = '';
  if (atrasado) {
    const dias = diasEntre(d.duplicata.vencimento, dataPagamento);
    const encargos = dup * pol.atraso.multa + dup * pol.atraso.jurosMes * (dias / 30);
    teto = centavos(dup + encargos) + tol;
    detalheTeto = ` (com ${dias} dias de atraso o teto com multa e juros é ${brl(teto - tol)})`;
  }

  if (d.valor < dup - tol) {
    return falhou('R03', 'conferencia', `Valor do título (${brl(d.valor)}) é menor que a duplicata da NF (${brl(dup)}).`, ev);
  }
  if (d.valor > teto) {
    const vezes = dup > 0 ? d.valor / dup : 0;
    const dica = vezes >= 9.5 && vezes <= 10.5 ? ' Parece um zero a mais.' : '';
    return falhou('R03', 'conferencia', `Valor do título (${brl(d.valor)}) passa da duplicata da NF (${brl(dup)})${detalheTeto}.${dica}`, ev);
  }
  return passou('R03', atrasado ? `dentro do teto com encargos${detalheTeto}` : 'ok', ev);
};
