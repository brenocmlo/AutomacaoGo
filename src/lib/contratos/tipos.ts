import type { Contrato } from '@/lib/data/tipos';

/** Como o contrato cobra: valor fixo, consumo (utilidades) ou variável por volume (frete). */
export type ClasseContrato = 'fixo' | 'utilidade' | 'frete';

/**
 * Como o título foi ligado ao contrato (seção 1 do prompt de integração):
 *  oc_contrato        → a OC do título é a OC do contrato                       (alta)
 *  fornecedor_sem_oc  → categoria dispensada de OC (utilidades), vínculo pelo fornecedor (alta)
 *  frete_integracao   → contrato de frete e origem da integração de frete       (média)
 *  oc_pontual         → fornecedor com contrato, mas o título é de OC pontual: NÃO é do contrato
 *  sem_vinculo        → fornecedor com contrato, título sem OC em categoria que exige OC (D10)
 */
export type MetodoVinculo = 'oc_contrato' | 'fornecedor_sem_oc' | 'frete_integracao' | 'oc_pontual' | 'sem_vinculo';
export type Confianca = 'alta' | 'media' | 'nenhuma';

export const CODIGOS_DESVIO = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10'] as const;
export type CodigoDesvio = (typeof CODIGOS_DESVIO)[number];

export const NOME_DESVIO: Record<CodigoDesvio, string> = {
  D01: 'Valor acima da faixa do contrato',
  D02: 'Valor abaixo da faixa (possível erro de digitação)',
  D03: 'Mais de um título na mesma competência',
  D04: 'Competência sem título perto do vencimento',
  D05: 'Reajuste fora do previsto',
  D06: 'Cobrança fora da vigência',
  D07: 'Vencimento ou reajuste do contrato se aproximando',
  D08: 'Forma de pagamento diferente da do contrato',
  D09: 'Consumo ou frete fora da faixa',
  D10: 'Título recorrente sem vínculo com contrato',
};

/** Desvios que o agente de validação revisa antes do fechamento do lote. */
export const DESVIOS_REVISADOS_PELA_VALIDACAO: CodigoDesvio[] = ['D01', 'D03', 'D05', 'D06', 'D10'];

export interface Vinculo {
  tituloId: string;
  contratoId: string | null;
  competencia: string | null; // "AAAA-MM"
  metodo: MetodoVinculo;
  confianca: Confianca;
  motivo: string;
}

export interface Desvio {
  codigo: CodigoDesvio;
  contratoId: string;
  competencia: string | null;
  tituloId: string | null;
  /** true = falha de conferência (retira do lote); false = só alerta. */
  retira: boolean;
  motivo: string;
  evidencias: string[];
  /** pessoa_id de quem é avisado. */
  acionar: string[];
  /** Chave estável para não repetir o mesmo alerta a cada ciclo. */
  chave: string;
}

export type SituacaoCompetencia = 'conforme' | 'desvio' | 'aguardando' | 'sem_titulo' | 'sem_referencia';

export interface CompetenciaContrato {
  contratoId: string;
  competencia: string;
  classe: ClasseContrato;
  fornecedorId: string;
  gestorPessoaId: string;
  valorEsperado: number | null;
  faixaMin: number | null;
  faixaMax: number | null;
  valorCobrado: number;
  qtdTitulos: number;
  titulos: string[];
  situacao: SituacaoCompetencia;
  desvios: CodigoDesvio[];
  vencimentoPrevisto: string | null;
}

/** O que o motor e a tela precisam saber de um título ligado a contrato. */
export interface InfoContratoTitulo {
  /** null quando o título é de OC pontual (não é do contrato). */
  contratoId: string | null;
  competencia: string | null;
  metodo: MetodoVinculo;
  confianca: Confianca;
  valorEsperado: number | null;
  faixaMin: number | null;
  faixaMax: number | null;
  /** Vínculo alto, valor na faixa, único na competência e contrato vigente (R06/R07/R14 o motor confere). */
  rotinaContratual: boolean;
}

export interface AnaliseContratos {
  contratos: Contrato[];
  classes: Map<string, ClasseContrato>;
  vinculos: Map<string, Vinculo>;
  competencias: CompetenciaContrato[];
  desvios: Desvio[];
  desviosPorTitulo: Map<string, Desvio[]>;
  infoDoTitulo(tituloId: string): InfoContratoTitulo | null;
}
