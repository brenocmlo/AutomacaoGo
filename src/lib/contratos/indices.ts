import { somarMeses } from './datas';
import type { IndiceReajuste } from '@/lib/data/tipos';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Índice acumulado em 12 meses (fração) que vale para o reajuste de uma competência:
 * o do mês de referência = competência menos a defasagem. Se esse mês não existe no arquivo,
 * usa o último anterior. Sem o índice (ex.: tarifa regulada) devolve null.
 */
export function indiceParaCompetencia(
  indices: IndiceReajuste[],
  nomeIndice: string,
  competencia: string,
  defasagemMeses: number,
): number | null {
  const alvo = somarMeses(competencia, -defasagemMeses);
  const doIndice = indices.filter((i) => norm(i.indice) === norm(nomeIndice) && i.mes_referencia <= alvo);
  if (!doIndice.length) return null;
  const ultimo = doIndice.reduce((a, b) => (b.mes_referencia > a.mes_referencia ? b : a));
  const v = Number(ultimo.acumulado_12m);
  return Number.isFinite(v) ? v : null;
}
