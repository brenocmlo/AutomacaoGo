import { diasEntre, paraMs } from '@/lib/clock/relogio';
import type { Politicas } from '@/lib/config/politicas';
import type { Indices } from '@/lib/data/indices';
import type { AlteracaoCadastro, Fornecedor } from '@/lib/data/tipos';

export type NivelAlcada = 'analista' | 'aprovador' | 'diretoria';
const ORDEM: Record<NivelAlcada, number> = { analista: 0, aprovador: 1, diretoria: 2 };

export function nivelPorValor(valor: number, p: Politicas): NivelAlcada {
  if (valor <= p.alcadas.analistaLiberarAte) return 'analista';
  if (valor <= p.alcadas.aprovadorAte) return 'aprovador';
  return 'diretoria';
}

export function nivelMaior(a: NivelAlcada, b: NivelAlcada): boolean {
  return ORDEM[a] > ORDEM[b];
}

const CAMPOS_BANCARIOS = new Set(['banco', 'agencia', 'conta', 'chave_pix']);

/**
 * Telefone que estava no cadastro ANTES de qualquer alteração recente:
 * parte do telefone atual e desfaz as trocas de telefone feitas nos `janelaDias`
 * anteriores à alteração bancária (e todas as posteriores a ela).
 */
export function telefoneAnterior(
  f: Fornecedor,
  alteracoes: AlteracaoCadastro[],
  dataAlteracaoBancaria: string,
  janelaDias: number,
): string {
  let tel = f.telefone_cadastrado;
  const trocas = alteracoes
    .filter((a) => a.campo === 'telefone')
    .sort((a, b) => paraMs(b.data_hora) - paraMs(a.data_hora));
  for (const t of trocas) {
    const dias = diasEntre(t.data_hora, dataAlteracaoBancaria);
    if (dias < janelaDias) tel = t.valor_anterior; // recente (ou posterior) → desfaz
  }
  return tel;
}

function digitos(s: string): string {
  return s.replace(/\D/g, '');
}

export interface TrocaBancaria {
  data: string;
  alteracoes: AlteracaoCadastro[];
  confirmacaoValida: boolean;
  motivo: string;
}

/**
 * Trocas de dados bancários do fornecedor nos últimos `janelaDias` até `agora`,
 * com a validação da confirmação (ligação para o telefone anterior à alteração).
 */
export function trocasBancariasRecentes(idx: Indices, f: Fornecedor, agora: string, janelaDias: number): TrocaBancaria[] {
  const todas = idx.alteracoesPorFornecedor.get(f.fornecedor_id) ?? [];
  const bancarias = todas.filter(
    (a) => CAMPOS_BANCARIOS.has(a.campo) && paraMs(a.data_hora) <= paraMs(agora) && diasEntre(a.data_hora, agora) < janelaDias,
  );
  const porMomento = new Map<string, AlteracaoCadastro[]>();
  for (const a of bancarias) porMomento.set(a.data_hora, [...(porMomento.get(a.data_hora) ?? []), a]);

  return [...porMomento.entries()].map(([data, alts]) => {
    const conf = alts.find((a) => /^sim/i.test(a.confirmacao_registrada)) ?? null;
    if (!conf) return { data, alteracoes: alts, confirmacaoValida: false, motivo: 'troca bancária sem confirmação registrada' };
    const como = conf.confirmacao_como ?? '';
    if (!/liga[çc][ãa]o|telefone/i.test(como)) {
      return { data, alteracoes: alts, confirmacaoValida: false, motivo: 'confirmação não foi por ligação telefônica' };
    }
    const telValido = digitos(telefoneAnterior(f, todas, data, janelaDias));
    const ok = telValido.length >= 8 && digitos(como).includes(telValido);
    return {
      data,
      alteracoes: alts,
      confirmacaoValida: ok,
      motivo: ok ? 'confirmada no telefone anterior' : 'confirmação feita em telefone diferente do cadastro anterior',
    };
  });
}

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}
