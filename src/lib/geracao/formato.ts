/**
 * Helpers de formato dos arquivos da base (linha digitável, chave de acesso, CNPJ de filial...).
 * Extraídos de scripts/gerar-cenarios.ts para serem reaproveitados pelo gerador de eventos ao vivo;
 * o script continua importando daqui, com a mesma saída (os IDs dos cenários plantados não mudam).
 */
import { centavos, cnpjDigitos, raizCnpj } from '@/lib/data/normalizadores';
import { diasEntre } from '@/lib/clock/relogio';

export const fmt = (v: number) => centavos(v).toFixed(2);
export const pad = (n: number | string, l: number) => String(n).padStart(l, '0');

export function mod10(campo: string): number {
  let soma = 0, peso = 2;
  for (let i = campo.length - 1; i >= 0; i--) {
    let p = Number(campo[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

export function mod11(num: string, pesoMax = 9): number {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === pesoMax ? 2 : peso + 1;
  }
  const r = 11 - (soma % 11);
  return r >= 10 ? 0 : r;
}

export function linhaDigitavel(banco: string, vencimento: string, valor: number, agencia: string, conta: string, nossoNumero: string): string {
  const livre = pad(agencia, 4).slice(-4) + pad(conta.replace(/\D/g, ''), 8).slice(-8) + '09' + pad(nossoNumero, 11).slice(-11);
  const c1 = banco + '9' + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  const fator = 1000 + diasEntre('2025-02-22', vencimento);
  const valorStr = pad(Math.round(valor * 100), 10);
  const dvGeral = mod11(banco + '9' + pad(fator, 4) + valorStr + livre);
  return `${c1}${mod10(c1)}${c2}${mod10(c2)}${c3}${mod10(c3)}${dvGeral || 1}${pad(fator, 4)}${valorStr}`;
}

export function chaveAcesso(cnpj: string, data: string, numeroNf: number, modelo = '55'): string {
  const aamm = data.slice(2, 4) + data.slice(5, 7);
  const sem = '23' + aamm + cnpjDigitos(cnpj) + modelo + '001' + pad(numeroNf, 9) + '1' + pad(numeroNf * 7919 % 1e8, 8);
  return sem + mod11(sem);
}

export function cnpjFilial(cnpjMatriz: string, filial: number): string {
  const base12 = raizCnpj(cnpjMatriz) + pad(filial, 4);
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((a, c, i) => a + Number(c) * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  const d2 = dv(base12 + d1);
  const n = base12 + d1 + d2;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

