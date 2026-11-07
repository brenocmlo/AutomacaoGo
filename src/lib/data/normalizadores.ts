/**
 * Normalizadores dos formatos "sujos" da base. Funções puras, sem estado.
 */

/** CNPJ só com dígitos (14). Aceita com ou sem pontuação. */
export function cnpjDigitos(cnpj: string | null | undefined): string {
  return (cnpj ?? '').replace(/\D/g, '');
}

/** Raiz do CNPJ: 8 primeiros dígitos. Matriz e filiais compartilham a raiz. */
export function raizCnpj(cnpj: string | null | undefined): string {
  return cnpjDigitos(cnpj).slice(0, 8);
}

/**
 * NF "como foi digitada" → número canônico (sem zeros à esquerda, sem série).
 * Exemplos: "000123" → "123"; "123-1" → "123"; "93833/1" → "93833"; "" → "".
 */
export function nfNormalizada(digitado: string | null | undefined): string {
  const s = (digitado ?? '').trim();
  if (!s) return '';
  const numero = s.split(/[-/]/)[0]!.replace(/\D/g, '');
  if (!numero) return '';
  return numero.replace(/^0+(?=\d)/, '');
}

/** "n/total" → { n, total }. */
export function parcela(p: string | null | undefined): { n: number; total: number } | null {
  const m = (p ?? '').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
}

/** Número em formato ISO (ponto decimal) → number. Vazio → null. */
export function numero(v: string | null | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Valor brasileiro "1.234,56" ou "-4.129,58" → number. */
export function valorBR(v: string | null | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Data "dd/mm/aaaa" → "aaaa-mm-dd". */
export function dataBRparaISO(d: string | null | undefined): string | null {
  const m = (d ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Arredonda para centavos (evita lixo de ponto flutuante nas comparações). */
export function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Linha digitável do boleto (47 dígitos)
// ---------------------------------------------------------------------------

/** Data-base do fator de vencimento usada pela base (fator 1000 = 22/02/2025). */
const FATOR_BASE_UTC = Date.UTC(2025, 1, 22);
const FATOR_BASE_VALOR = 1000;

export interface LinhaDigitavel {
  banco: string;
  moeda: string;
  agencia: string;
  conta: string;
  carteira: string;
  nossoNumero: string;
  fatorVencimento: number;
  vencimento: string | null;
  valor: number;
  dvCamposOk: boolean;
}

function mod10(campo: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = campo.length - 1; i >= 0; i--) {
    let p = Number(campo[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const r = soma % 10;
  return r === 0 ? 0 : 10 - r;
}

/**
 * Decodifica a linha digitável segundo o dicionário de dados:
 * 1-3 banco; 4 moeda; 34-37 fator de vencimento; 38-47 valor em centavos;
 * campo livre em 5-9, 11-20 e 22-31 (agência 4, conta 8, carteira 2, nosso número 11);
 * 10, 21 e 32 são DV módulo 10 dos campos.
 */
export function decodificarLinhaDigitavel(linha: string | null | undefined): LinhaDigitavel | null {
  const l = (linha ?? '').replace(/\D/g, '');
  if (l.length !== 47) return null;
  const at = (ini: number, fim: number) => l.slice(ini - 1, fim);
  const campoLivre = at(5, 9) + at(11, 20) + at(22, 31); // 25 dígitos
  const fator = Number(at(34, 37));
  const vencimento =
    fator > 0
      ? new Date(FATOR_BASE_UTC + (fator - FATOR_BASE_VALOR) * 86_400_000).toISOString().slice(0, 10)
      : null;
  const dvCamposOk =
    mod10(at(1, 9)) === Number(at(10, 10)) &&
    mod10(at(11, 20)) === Number(at(21, 21)) &&
    mod10(at(22, 31)) === Number(at(32, 32));
  return {
    banco: at(1, 3),
    moeda: at(4, 4),
    agencia: campoLivre.slice(0, 4),
    conta: campoLivre.slice(4, 12),
    carteira: campoLivre.slice(12, 14),
    nossoNumero: campoLivre.slice(14, 25),
    fatorVencimento: fator,
    vencimento,
    valor: Number(at(38, 47)) / 100,
    dvCamposOk,
  };
}

// ---------------------------------------------------------------------------
// Extrato do Banco Litoral (histórico em texto livre)
// ---------------------------------------------------------------------------

export type TipoLancamentoLitoral = 'PIX' | 'TED' | 'BOLETO' | 'TARIFA' | 'CREDITO' | 'OUTRO';

export interface HistoricoLitoral {
  tipo: TipoLancamentoLitoral;
  banco: string | null;
  nome: string;
}

/**
 * "PIX ENV 72428 YASMIN FEITOSA CRI" → { tipo: PIX, nome: "YASMIN FEITOSA CRI" }
 * "TED ENV 289 STUDIO CLARO FOTOG"   → { tipo: TED, banco: "289", nome: ... }
 * "PAG BOL 146 TAMPAS PIRES"         → { tipo: BOLETO, banco: "146", nome: ... }
 */
export function parseHistoricoLitoral(h: string): HistoricoLitoral {
  const s = h.trim().replace(/\s+/g, ' ');
  let m = s.match(/^PIX ENV \d+ (.+)$/);
  if (m) return { tipo: 'PIX', banco: null, nome: m[1]! };
  m = s.match(/^TED ENV (\d{3}) (.+)$/);
  if (m) return { tipo: 'TED', banco: m[1]!, nome: m[2]! };
  m = s.match(/^PAG BOL (\d{3}) (.+)$/);
  if (m) return { tipo: 'BOLETO', banco: m[1]!, nome: m[2]! };
  if (/^TAR/.test(s)) return { tipo: 'TARIFA', banco: null, nome: '' };
  if (/^CRED/.test(s)) return { tipo: 'CREDITO', banco: null, nome: s.replace(/^CRED \w+ /, '') };
  return { tipo: 'OUTRO', banco: null, nome: s };
}

/** Texto sem acento, maiúsculo, só letras/dígitos/espaço — para comparar nomes abreviados. */
export function nomeComparavel(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O nome abreviado do banco (truncado) bate com algum dos nomes do fornecedor?
 * Compara o prefixo: "STUDIO CLARO FOTOG" casa com "STUDIO CLARO FOTOGRAFIA LTDA".
 */
export function nomeAbreviadoCasa(abreviado: string, ...nomesCompletos: (string | null | undefined)[]): boolean {
  const a = nomeComparavel(abreviado);
  if (a.length < 4) return false;
  return nomesCompletos.some((n) => {
    const c = nomeComparavel(n);
    return c.length > 0 && (c.startsWith(a) || a.startsWith(c));
  });
}
