/**
 * Relógio simulado e calendário bancário.
 * Datas/horas são "ingênuas" (horário local da operação, sem fuso), representadas
 * como "AAAA-MM-DDTHH:MM" e convertidas para milissegundos tratando-as como UTC.
 */
import type { Feriado } from '@/lib/data/tipos';

export type HoraSimulada = string; // "2026-11-02T08:00"

const MIN = 60_000;
const DIA = 86_400_000;

/** Aceita "2026-11-02", "2026-11-02 08:00:00", "2026-11-02T08:00". */
export function paraMs(dataHora: string): number {
  const s = dataHora.trim().replace(' ', 'T');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error(`Data/hora inválida: "${dataHora}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}

export function deMs(ms: number): HoraSimulada {
  return new Date(ms).toISOString().slice(0, 16);
}

export function dataDe(h: string): string {
  return deMs(paraMs(h)).slice(0, 10);
}

export function somarMinutos(h: string, minutos: number): HoraSimulada {
  return deMs(paraMs(h) + minutos * MIN);
}

export function somarDias(data: string, dias: number): string {
  return deMs(paraMs(data) + dias * DIA).slice(0, 10);
}

/** Diferença em dias corridos (b − a), pelas datas. */
export function diasEntre(a: string, b: string): number {
  return Math.round((paraMs(dataDe(b)) - paraMs(dataDe(a))) / DIA);
}

export function minutosEntre(a: string, b: string): number {
  return Math.round((paraMs(b) - paraMs(a)) / MIN);
}

export class CalendarioBancario {
  private readonly semRemessa: Set<string>;

  constructor(feriados: Feriado[]) {
    this.semRemessa = new Set(
      feriados.filter((f) => /^sim/i.test(f.afeta_remessa ?? '')).map((f) => f.data),
    );
  }

  ehDiaUtil(data: string): boolean {
    const d = dataDe(data);
    const dow = new Date(paraMs(d)).getUTCDay();
    return dow !== 0 && dow !== 6 && !this.semRemessa.has(d);
  }

  /** A própria data, se útil, ou o próximo dia útil. */
  proximoDiaUtil(data: string): string {
    let d = dataDe(data);
    while (!this.ehDiaUtil(d)) d = somarDias(d, 1);
    return d;
  }
}

/** Fechamento do lote: data prevista + horário de fechamento. */
export function fechamentoDoLote(dataPrevista: string, horario: string): HoraSimulada {
  return `${dataPrevista}T${horario.slice(0, 5)}`;
}

export type Urgencia = 'IMEDIATA' | 'HOJE' | 'NORMAL' | 'FECHADO';

export function urgencia(agora: HoraSimulada, fechamento: HoraSimulada, horasImediata: number): Urgencia {
  const min = minutosEntre(agora, fechamento);
  if (min <= 0) return 'FECHADO';
  if (min < horasImediata * 60) return 'IMEDIATA';
  if (dataDe(agora) === dataDe(fechamento)) return 'HOJE';
  return 'NORMAL';
}
