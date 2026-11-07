import { CalendarioBancario, dataDe, diasEntre, paraMs, somarDias } from '@/lib/clock/relogio';

/** Competência = mês de referência "AAAA-MM". */
export const mesDe = (data: string): string => dataDe(data).slice(0, 7);

export function somarMeses(ym: string, n: number): string {
  const a = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const ano = a + Math.floor(m / 12);
  const mes = ((m % 12) + 12) % 12;
  return `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

export function diasNoMes(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

/** Último dia da competência. */
export const ultimoDiaDoMes = (ym: string): string => `${ym}-${String(diasNoMes(ym)).padStart(2, '0')}`;

/**
 * Vencimento nominal de uma competência: o `dia_vencimento` do contrato naquele mês.
 * Fim de semana ou feriado vai para o próximo dia útil, mantendo a competência.
 */
export function vencimentoNominal(cal: CalendarioBancario, diaVencimento: number, ym: string): string {
  const dia = Math.min(Math.max(diaVencimento, 1), diasNoMes(ym));
  return cal.proximoDiaUtil(`${ym}-${String(dia).padStart(2, '0')}`);
}

/**
 * Competência do título: das competências vizinhas ao mês do vencimento, a que tem o vencimento
 * nominal mais próximo do vencimento do título. Empate → o mês do próprio vencimento.
 */
export function competenciaDoVencimento(cal: CalendarioBancario, diaVencimento: number, vencimento: string): string {
  const ym = mesDe(vencimento);
  let melhor = ym;
  let menor = Infinity;
  for (const cand of [ym, somarMeses(ym, -1), somarMeses(ym, 1)]) {
    const d = Math.abs(diasEntre(vencimentoNominal(cal, diaVencimento, cand), vencimento));
    if (d < menor) {
      menor = d;
      melhor = cand;
    }
  }
  return melhor;
}

/** Data `n` dias úteis antes de `data`. */
export function diasUteisAntes(cal: CalendarioBancario, data: string, n: number): string {
  let d = dataDe(data);
  let faltam = n;
  while (faltam > 0) {
    d = somarDias(d, -1);
    if (cal.ehDiaUtil(d)) faltam--;
  }
  return d;
}

export function diasUteisEntre(cal: CalendarioBancario, de: string, ate: string): number {
  let d = dataDe(de);
  const fim = paraMs(dataDe(ate));
  let n = 0;
  while (paraMs(d) < fim) {
    d = somarDias(d, 1);
    if (cal.ehDiaUtil(d)) n++;
  }
  return n;
}

/** Próxima data de reajuste: a primeira data depois do último reajuste que cai no mês de reajuste. */
export function proximoReajuste(mesReajuste: string, dataUltimoReajuste: string): string | null {
  const mes = Number(mesReajuste);
  if (!(mes >= 1 && mes <= 12)) return null;
  const ult = dataDe(dataUltimoReajuste || '1970-01-01');
  const dia = Number(ult.slice(8, 10)) || 1;
  for (let ano = Number(ult.slice(0, 4)); ano <= Number(ult.slice(0, 4)) + 2; ano++) {
    const ym = `${ano}-${String(mes).padStart(2, '0')}`;
    const cand = `${ym}-${String(Math.min(dia, diasNoMes(ym))).padStart(2, '0')}`;
    if (paraMs(cand) > paraMs(ult)) return cand;
  }
  return null;
}
