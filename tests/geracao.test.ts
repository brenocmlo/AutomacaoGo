import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { somarMinutos } from '@/lib/clock/relogio';
import { carregarConfig, pastaBase } from '@/lib/config/config';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';
import { planejarHora } from '@/lib/geracao/eventos';
import { baseComEventos } from '@/lib/geracao/injetar';
import type { EventoGerado } from '@/lib/geracao/tipos';
import { avaliarComIndices } from '@/lib/rules/motor';

/** Gerador de eventos (rotina e duplicidade), tudo em memória sobre a base da demo. */
const config = carregarConfig(path.resolve(__dirname, '..', 'config', 'goaudit.config.json'));
let base: BaseEntrada;

beforeAll(() => {
  base = carregarBase(pastaBase(config));
});

function simular(sim: string, ate: string): EventoGerado[] {
  const inicio = base.politicas.periodo.inicio.slice(0, 16);
  const eventos: EventoGerado[] = [];
  for (let h = somarMinutos(inicio, 60); h <= ate; h = somarMinutos(h, 60)) {
    eventos.push(...planejarHora(base, config, { sim, hora: h, intensidade: 'alta', anteriores: eventos.filter((e) => e.hora < h) }).eventos);
  }
  return eventos;
}

describe('gerador de eventos', () => {
  it('é determinístico por (simulação, hora) e as chaves são únicas (idempotência)', () => {
    const a = simular('sim-1', '2026-11-05T18:00');
    expect(simular('sim-1', '2026-11-05T18:00')).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    expect(new Set(a.map((e) => e.chave)).size).toBe(a.length);
    expect(simular('sim-2', '2026-11-05T18:00').map((e) => e.chave)).not.toEqual(a.map((e) => e.chave));
  });

  it('duplicidade dispara R01 e a rotina não dispara regra', () => {
    const ev = simular('sim-1', '2026-11-05T18:00');
    const dup = ev.find((e) => e.arquivo === 'contas_a_pagar' && e.trilha === 'duplicidade')!;
    const rotina = ev.find((e) => e.arquivo === 'contas_a_pagar' && e.trilha === 'rotina')!;
    expect(dup).toBeDefined();
    const r = avaliarComIndices(baseComEventos(base, ev, dup.hora), config, dup.hora);
    const copia = r.avaliacoes.find((a) => a.tituloId === dup.linha.titulo_id)!;
    expect(copia.regrasDisparadas).toContain('R01');
    expect(copia.decisao.destino).toBe('RETIRADO');
    const rr = avaliarComIndices(baseComEventos(base, ev, rotina.hora), config, rotina.hora);
    expect(rr.avaliacoes.find((a) => a.tituloId === rotina.linha.titulo_id)!.regrasDisparadas).toEqual([]);
  });

  it('baseComEventos só soma o que já chegou e não altera a base original', () => {
    const ev = simular('sim-1', '2026-11-05T18:00');
    const n = base.titulos.length;
    const meio = baseComEventos(base, ev, '2026-11-03T12:00');
    expect(meio.titulos.length).toBe(n + ev.filter((e) => e.arquivo === 'contas_a_pagar' && e.hora <= '2026-11-03T12:00').length);
    expect(base.titulos.length).toBe(n);
  });
});
