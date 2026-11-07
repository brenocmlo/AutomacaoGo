import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarConfig } from '@/lib/config/config';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';
import { lerCsv } from '@/lib/data/csv';
import type { AnaliseContratos } from '@/lib/contratos/tipos';
import { avaliarComIndices, type AvaliacaoTitulo } from '@/lib/rules/motor';
import { montarDemo } from '../scripts/montar-demo';

/**
 * Roteiro da demo = teste do motor. Cada linha de data/cenarios/cenarios_esperados.csv
 * diz qual título deve disparar quais regras e qual destino deve ter. Linhas sem título
 * (cenários de contrato) verificam a competência do contrato.
 */
const RAIZ = path.resolve(__dirname, '..');
const CENARIOS = path.join(RAIZ, 'data', 'cenarios');
const esperados = lerCsv<Record<string, string>>(path.join(CENARIOS, 'cenarios_esperados.csv'));
const config = carregarConfig(path.join(RAIZ, 'config', 'goaudit.config.json'));

let base: BaseEntrada;
const porHora = new Map<string, { avaliacoes: Map<string, AvaliacaoTitulo>; contratos: AnaliseContratos }>();

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goaudit-demo-'));
  montarDemo(path.join(RAIZ, 'data', 'base'), dir, CENARIOS);
  base = carregarBase(dir);
  for (const hora of new Set(esperados.map((e) => e.hora_avaliacao!))) {
    const r = avaliarComIndices(base, config, hora);
    porHora.set(hora, { avaliacoes: new Map(r.avaliacoes.map((a) => [a.tituloId, a])), contratos: r.contratos });
  }
});

const lista = (s: string | undefined) => (s ?? '').split(/\s+/).filter(Boolean).sort();

describe.each(esperados.filter((e) => e.titulo_id).map((e) => [e.cenario_id, e.titulo_id, e] as const))('%s · %s', (_id, _titulo, e) => {
  it(`${e.descricao} → ${e.destino_esperado}`, () => {
    const av = porHora.get(e.hora_avaliacao!)!.avaliacoes.get(e.titulo_id!);
    expect(av, 'título não foi avaliado (fora da agenda ou do horário)').toBeDefined();
    const falhas = av!.resultados.filter((r) => !r.passou);
    const disparadas = falhas.filter((r) => r.severidade !== 'alerta').map((r) => r.codigo).sort();
    expect(disparadas, av!.decisao.motivo).toEqual(lista(e.regras_esperadas));
    expect(av!.decisao.destino, av!.decisao.motivo).toBe(e.destino_esperado);
    for (const p of lista(e.notificar_esperado)) expect(av!.decisao.notificar).toContain(p);

    // Desvios que só alertam e quem eles avisam
    const alertas = falhas.filter((r) => r.severidade === 'alerta' && /^D/.test(r.codigo));
    expect(alertas.map((r) => r.codigo).sort()).toEqual(lista(e.alertas_esperados));
    for (const p of lista(e.avisar_esperado)) expect(alertas.flatMap((r) => r.acionar ?? [])).toContain(p);

    // Vínculo com o contrato, selo e aprovador exigido
    if (e.contrato_id) {
      expect(av!.contrato?.contratoId).toBe(e.contrato_id);
      expect(av!.contrato?.competencia).toBe(e.competencia);
    }
    expect(av!.conformeContrato, 'selo "conforme contrato"').toBe(e.selo === 'conforme_contrato');
    for (const p of lista(e.aprovador_esperado)) expect(av!.decisao.aprovacao?.aprovadores ?? []).toContain(p);
  });
});

describe.each(esperados.filter((e) => !e.titulo_id).map((e) => [e.cenario_id, e.contrato_id, e] as const))('%s · contrato %s', (_id, _contrato, e) => {
  it(`${e.descricao} → ${e.alertas_esperados || 'sem desvio'}`, () => {
    const { contratos } = porHora.get(e.hora_avaliacao!)!;
    const desvios = contratos.desvios.filter((d) => d.contratoId === e.contrato_id && (d.competencia === e.competencia || d.competencia == null));
    const naCompetencia = desvios.filter((d) => d.competencia === e.competencia);
    expect(naCompetencia.map((d) => d.codigo).sort(), naCompetencia.map((d) => d.motivo).join(' | ')).toEqual(lista(e.alertas_esperados));
    for (const p of lista(e.avisar_esperado)) expect(naCompetencia.flatMap((d) => d.acionar)).toContain(p);
    const comp = contratos.competencias.find((c) => c.contratoId === e.contrato_id && c.competencia === e.competencia);
    expect(comp, 'competência não encontrada').toBeDefined();
    if (!e.alertas_esperados) expect(comp!.situacao).not.toBe('desvio');
  });
});

describe('legítimos não travam', () => {
  it('cenários de pagamento legítimo não geram notificação (sem custo de acionamento)', () => {
    for (const e of esperados.filter((x) => x.titulo_id && !x.regras_esperadas)) {
      const av = porHora.get(e.hora_avaliacao!)!.avaliacoes.get(e.titulo_id!)!;
      expect(av.decisao.notificar, e.cenario_id).toEqual([]);
    }
  });
});
