import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarConfig } from '@/lib/config/config';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';
import { lerCsv } from '@/lib/data/csv';
import { avaliarAgenda, type AvaliacaoTitulo } from '@/lib/rules/motor';
import { montarDemo } from '../scripts/montar-demo';

/**
 * Roteiro da demo = teste do motor. Cada linha de data/cenarios/cenarios_esperados.csv
 * diz qual título deve disparar quais regras e qual destino deve ter.
 */
const RAIZ = path.resolve(__dirname, '..');
const CENARIOS = path.join(RAIZ, 'data', 'cenarios');
const esperados = lerCsv<Record<string, string>>(path.join(CENARIOS, 'cenarios_esperados.csv'));
const config = carregarConfig(path.join(RAIZ, 'config', 'goaudit.config.json'));

let base: BaseEntrada;
const porHora = new Map<string, Map<string, AvaliacaoTitulo>>();

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goaudit-demo-'));
  montarDemo(path.join(RAIZ, 'data', 'base'), dir, CENARIOS);
  base = carregarBase(dir);
  for (const hora of new Set(esperados.map((e) => e.hora_avaliacao!))) {
    porHora.set(hora, new Map(avaliarAgenda(base, config, hora).map((a) => [a.tituloId, a])));
  }
});

const lista = (s: string | undefined) => (s ?? '').split(/\s+/).filter(Boolean).sort();

describe.each(esperados.map((e) => [e.cenario_id, e.titulo_id, e] as const))('%s · %s', (_id, _titulo, e) => {
  it(`${e.descricao} → ${e.destino_esperado}`, () => {
    const av = porHora.get(e.hora_avaliacao!)!.get(e.titulo_id!);
    expect(av, 'título não foi avaliado (fora da agenda ou do horário)').toBeDefined();
    const disparadas = av!.resultados.filter((r) => !r.passou && r.severidade !== 'alerta').map((r) => r.codigo).sort();
    expect(disparadas, av!.decisao.motivo).toEqual(lista(e.regras_esperadas));
    expect(av!.decisao.destino, av!.decisao.motivo).toBe(e.destino_esperado);
    for (const p of lista(e.notificar_esperado)) expect(av!.decisao.notificar).toContain(p);
  });
});

describe('legítimos não travam', () => {
  it('cenários de pagamento legítimo não geram notificação (sem custo de acionamento)', () => {
    for (const e of esperados.filter((x) => !x.regras_esperadas)) {
      const av = porHora.get(e.hora_avaliacao!)!.get(e.titulo_id!)!;
      expect(av.decisao.notificar, e.cenario_id).toEqual([]);
    }
  });
});
