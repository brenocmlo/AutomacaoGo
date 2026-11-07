import { r01Duplicidade } from './r01-duplicidade';
import { r02JaPago } from './r02-ja-pago';
import { r03NfTitulo } from './r03-nf-titulo';
import { r04OcNf } from './r04-oc-nf';
import { r05Fornecedor } from './r05-fornecedor';
import { r06Boleto } from './r06-boleto';
import { r07Destino } from './r07-destino';
import { r08Alcada } from './r08-alcada';
import { r09AprovacaoDupla } from './r09-aprovacao-dupla';
import { r10Recebimento } from './r10-recebimento';
import { r11ValorAtipico } from './r11-valor-atipico';
import { r13Lancador } from './r13-lancador';
import type { CodigoDesvio } from '@/lib/contratos/tipos';
import type { CodigoRegra, Regra } from './tipos';

/**
 * Regras por título implementadas. R14 (mensagem) entra com o leitor. A antiga R12 (variação mensal)
 * foi substituída pelos desvios contratuais D01–D10, calculados por competência em src/lib/contratos.
 */
export const REGRAS: Record<
  Exclude<CodigoRegra, 'R14' | CodigoDesvio>,
  Regra
> = {
  R01: r01Duplicidade,
  R02: r02JaPago,
  R03: r03NfTitulo,
  R04: r04OcNf,
  R05: r05Fornecedor,
  R06: r06Boleto,
  R07: r07Destino,
  R08: r08Alcada,
  R09: r09AprovacaoDupla,
  R10: r10Recebimento,
  R11: r11ValorAtipico,
  R13: r13Lancador,
};

export * from './tipos';
