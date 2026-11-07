import type { ConfigGoAudit } from '@/lib/config/config';
import type { Politicas } from '@/lib/config/politicas';
import type { CalendarioBancario, HoraSimulada } from '@/lib/clock/relogio';
import type { DossieTitulo, Indices } from '@/lib/data/indices';
import type { AgendaItem } from '@/lib/data/tipos';
import type { CodigoDesvio } from '@/lib/contratos/tipos';

export type CodigoRegra =
  | 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07'
  | 'R08' | 'R09' | 'R10' | 'R11' | 'R13' | 'R14'
  // Desvios contratuais (substituem a antiga R12): ver src/lib/contratos
  | CodigoDesvio;

/**
 * critica     → retira do lote e notifica na hora
 * conferencia → retira do lote e aciona o dono
 * aprovacao   → aguarda aprovação humana (retira se não vier até a margem)
 * alerta      → não muda o destino; abre alerta / aumenta o risco
 */
export type Severidade = 'critica' | 'conferencia' | 'aprovacao' | 'alerta';

export interface ResultadoRegra {
  codigo: CodigoRegra;
  passou: boolean;
  /** Severidade quando falha (irrelevante quando passa). */
  severidade: Severidade;
  /** IDs dos registros da base usados como prova. */
  evidencias: string[];
  /** Frase curta em linguagem de negócio. */
  motivo: string;
  /** Para R08/R09: que tipo de aprovação é exigida. */
  aprovacao?: 'simples' | 'dupla' | 'alcada_superior';
  /** Valor considerado (ex.: soma do fracionamento). */
  valorConsiderado?: number;
  /** Quem avisar, quando a própria regra sabe (desvios contratuais usam o gestor do contrato). */
  acionar?: string[];
}

/** Aprovação humana já dada (do ERP ou do GoAudit), usada por R08/R09. */
export interface AprovacaoConhecida {
  tituloId: string;
  aprovador: string; // login ou pessoa_id
  pessoaId: string | null;
  /** Alçada de quem aprovou (Infinity = sem limite). */
  alcada: number;
  decisao: 'aprovado' | 'reprovado';
}

export interface ContextoRegras {
  idx: Indices;
  politicas: Politicas;
  config: ConfigGoAudit;
  cal: CalendarioBancario;
  agora: HoraSimulada;
  /** Agenda efetiva (CSV − retiradas + devoluções). */
  agenda: AgendaItem[];
  /** Aprovações já existentes por título (ERP + sistema). */
  aprovacoes: Map<string, AprovacaoConhecida[]>;
}

export type Regra = (d: DossieTitulo, ctx: ContextoRegras) => ResultadoRegra;

export function passou(codigo: CodigoRegra, motivo = 'ok', evidencias: string[] = []): ResultadoRegra {
  return { codigo, passou: true, severidade: 'alerta', evidencias, motivo };
}

export function falhou(
  codigo: CodigoRegra,
  severidade: Severidade,
  motivo: string,
  evidencias: string[],
  extra: Partial<ResultadoRegra> = {},
): ResultadoRegra {
  return { codigo, passou: false, severidade, evidencias: [...new Set(evidencias.filter(Boolean))], motivo, ...extra };
}

export function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
