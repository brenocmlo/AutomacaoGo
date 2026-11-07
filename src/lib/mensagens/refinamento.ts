import type { Comunicacao } from '@/lib/data/tipos';
import type { UsoIA, BoletoIA } from '@/lib/ai/proxy';

/**
 * O que a IA acrescentou à leitura de uma mensagem. Fica num cache do processo: o leitor puro
 * consulta aqui, e sem entrada (IA desligada, falha, teste) cai nas regras. A IA só refina tipo e
 * sinais; nunca baixa um risco que as regras já viram.
 */
export interface Refinamento {
  tipo: string | null;
  tipoConfianca: number;
  /** A mensagem pede algo fora do processo? (null = sem resposta confiável) */
  foraDoProcesso: boolean | null;
  boletos: BoletoIA[];
  uso: UsoIA[];
}

export const chaveRefinamento = (c: Comunicacao) => `${c.comunicacao_id}|${c.assunto}|${c.texto.length}|${c.anexos.length}`;

/**
 * O cache vive no globalThis: sobrevive ao recarregamento de módulos do `next dev` e é um só entre
 * Server Actions e Route Handlers. É por ele que "Nova simulação" não chama a IA de novo: a chave é
 * o conteúdo da mensagem, não a simulação. A cópia em disco (src/lib/mensagens/ia.ts) cobre o reinício do servidor.
 */
const g = globalThis as typeof globalThis & { __goauditRefinamentos?: Map<string, Refinamento> };
export const refinamentos: Map<string, Refinamento> = (g.__goauditRefinamentos ??= new Map());
