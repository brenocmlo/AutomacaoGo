import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarConfig } from '@/lib/config/config';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';
import { lerCsv } from '@/lib/data/csv';
import type { AnaliseContratos } from '@/lib/contratos/tipos';
import type { Indices } from '@/lib/data/indices';
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
const porHora = new Map<string, { avaliacoes: Map<string, AvaliacaoTitulo>; contratos: AnaliseContratos; idx: Indices }>();

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goaudit-demo-'));
  montarDemo(path.join(RAIZ, 'data', 'base'), dir, CENARIOS);
  base = carregarBase(dir);
  for (const hora of new Set(esperados.map((e) => e.hora_avaliacao!))) {
    const r = avaliarComIndices(base, config, hora);
    porHora.set(hora, { avaliacoes: new Map(r.avaliacoes.map((a) => [a.tituloId, a])), contratos: r.contratos, idx: r.idx });
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

describe.each(esperados.filter((e) => !e.titulo_id && !e.comunicacao_id).map((e) => [e.cenario_id, e.contrato_id, e] as const))('%s · contrato %s', (_id, _contrato, e) => {
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

/**
 * Mensagens (C05–C07): o leitor (sem IA) classifica, levanta os sinais e dispara o alerta de golpe
 * para quem a configuração manda; nenhuma avaliação de título nasce do texto da mensagem em C06/C07.
 */
describe.each(esperados.filter((e) => e.comunicacao_id).map((e) => [e.cenario_id, e.comunicacao_id, e] as const))('%s · mensagem %s', (_id, _msg, e) => {
  const leitura = () => porHora.get(e.hora_avaliacao!)!.idx.leituras.find((l) => l.comunicacaoId === e.comunicacao_id)!;

  it(`${e.descricao} → ${e.tipo_esperado}, risco ${e.risco_esperado}`, () => {
    const l = leitura();
    expect(l, 'mensagem não chegou até a hora de avaliação').toBeDefined();
    expect(l.tipo).toBe(e.tipo_esperado);
    expect(l.risco).toBe(e.risco_esperado);
    for (const s of lista(e.sinais_esperados)) expect(l.sinais).toContain(s);
  });

  it('só avisa quem a configuração manda (alerta de golpe)', () => {
    const l = leitura();
    const r14 = (config.acionamento.por_regra.R14 ?? []).filter((p) => !p.startsWith('@'));
    const alvo = l.sinais.includes('personificacao_executivo') ? (config.acionamento.golpe_executivo ?? ['PS03', 'PS08']) : r14;
    const gera = l.risco === 'critico' || l.sinais.includes('personificacao_executivo');
    expect(gera ? [...alvo].sort() : []).toEqual(lista(e.golpe_para));
  });

  it('antes de a mensagem chegar, o leitor não a vê', () => {
    const antes = avaliarComIndices(base, config, '2026-11-02T08:00');
    expect(antes.idx.leituras.some((l) => l.comunicacaoId === e.comunicacao_id)).toBe(false);
  });
});

describe('C05 · troca de conta por WhatsApp tira todos os títulos do fornecedor', () => {
  const c05 = esperados.filter((e) => e.cenario_id === 'C05' && e.titulo_id);
  const msg = esperados.find((e) => e.cenario_id === 'C05' && e.comunicacao_id)!;

  it('o canal é WhatsApp (fictício) e o remetente não é o do cadastro', () => {
    const c = base.comunicacoes.find((x) => x.comunicacao_id === msg.comunicacao_id)!;
    expect(c.canal).toBe('whatsapp');
    const l = porHora.get(msg.hora_avaliacao!)!.idx.leituras.find((x) => x.comunicacaoId === msg.comunicacao_id)!;
    expect(l.remetenteConfere).toBe(false);
    expect(l.sinais).toContain('telefone_novo_citado');
  });

  it('antes da mensagem e da alteração os títulos seguem liberados; depois, todos saem do lote', () => {
    const antes = avaliarComIndices(base, config, '2026-11-02T08:00');
    for (const e of c05) {
      expect(antes.avaliacoes.find((a) => a.tituloId === e.titulo_id)?.decisao.destino, e.titulo_id).toBe('LIBERADO_AUTOMATICO');
      expect(porHora.get(e.hora_avaliacao!)!.avaliacoes.get(e.titulo_id!)?.decisao.destino, e.titulo_id).toBe('RETIRADO');
    }
    expect(c05.length).toBeGreaterThan(1);
  });
});

describe('C06 e C07 · mensagens hostis não viram ação sobre títulos', () => {
  for (const id of ['C06', 'C07']) {
    it(`${id}: nenhuma avaliação de título usa a mensagem como evidência`, () => {
      const e = esperados.find((x) => x.cenario_id === id && x.comunicacao_id)!;
      const { avaliacoes } = porHora.get(e.hora_avaliacao!)!;
      const citam = [...avaliacoes.values()].filter((a) => a.resultados.some((r) => !r.passou && (r.evidencias ?? []).includes(e.comunicacao_id!)));
      expect(citam.map((a) => a.tituloId)).toEqual([]);
    });
  }
});

describe('legítimos não travam', () => {
  it('cenários de pagamento legítimo não geram notificação (sem custo de acionamento)', () => {
    for (const e of esperados.filter((x) => x.titulo_id && !x.regras_esperadas)) {
      const av = porHora.get(e.hora_avaliacao!)!.avaliacoes.get(e.titulo_id!)!;
      expect(av.decisao.notificar, e.cenario_id).toEqual([]);
    }
  });
});
