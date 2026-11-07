/** Sorteio determinístico: mesma semente, mesma sequência. Sem Math.random em lugar nenhum do gerador. */
export interface Sorteio {
  /** [0, 1) */
  next(): number;
  int(min: number, max: number): number;
  pick<T>(itens: readonly T[]): T;
  chance(p: number): boolean;
}

function hash(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function sorteio(semente: string): Sorteio {
  let a = hash(semente);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (itens) => itens[Math.floor(next() * itens.length)]!,
    chance: (p) => next() < p,
  };
}
