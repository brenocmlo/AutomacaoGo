import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CalendarioBancario } from '@/lib/clock/relogio';
import { carregarConfig } from '@/lib/config/config';
import { analisarContratos } from '@/lib/contratos/analise';
import { competenciaDoVencimento, diasUteisAntes, proximoReajuste, vencimentoNominal } from '@/lib/contratos/datas';
import type { AnaliseContratos } from '@/lib/contratos/tipos';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';
import { Indices } from '@/lib/data/indices';
import { numero } from '@/lib/data/normalizadores';
import { REGRAS } from '@/lib/rules';
import { avaliarComIndices, type AvaliacaoTitulo } from '@/lib/rules/motor';

/**
 * Critérios de pronto da integração com contratos, verificados na base original (sem IDs fixos).
 */
const RAIZ = path.resolve(__dirname, '..');
const config = carregarConfig(path.join(RAIZ, 'config', 'goaudit.config.json'));
let base: BaseEntrada;
let analise: AnaliseContratos;
let avaliacoes: AvaliacaoTitulo[];

beforeAll(() => {
  base = carregarBase(path.join(RAIZ, 'data', 'base'));
  const r = avaliarComIndices(base, config, base.politicas.periodo.inicio.slice(0, 16));
  analise = r.contratos;
  avaliacoes = r.avaliacoes;
});

describe('datas da competência', () => {
  const cal = new CalendarioBancario([{ data: '2026-10-12', descricao: 'feriado', sem_expediente_bancario: 'sim', afeta_remessa: 'sim' }]);
  it('vencimento no fim de semana ou feriado vai para o próximo dia útil e mantém a competência', () => {
    // dia 10/10/2026 é sábado e 12/10 é feriado → vence 13/10, competência 2026-10
    expect(vencimentoNominal(cal, 10, '2026-10')).toBe('2026-10-13');
    expect(competenciaDoVencimento(cal, 10, '2026-10-13')).toBe('2026-10');
    // pago adiantado no fim do mês anterior continua na competência certa
    expect(competenciaDoVencimento(cal, 5, '2026-10-30')).toBe('2026-11');
  });
  it('conta dias úteis para trás pulando fim de semana e feriado', () => {
    expect(diasUteisAntes(cal, '2026-10-16', 5)).toBe('2026-10-08');
  });
  it('próximo reajuste vem depois do último', () => {
    expect(proximoReajuste('12', '2025-12-01')).toBe('2026-12-01');
    expect(proximoReajuste('07', '2026-07-18')).toBe('2027-07-18');
  });
});

describe('vínculo título × contrato (base original)', () => {
  it('todo título lançado em OC de contrato fixo é vinculado com confiança alta', () => {
    const ocsFixas = new Set(base.contratos.filter((c) => c.oc_id && analise.classes.get(c.contrato_id) === 'fixo').map((c) => c.oc_id));
    const titulos = base.titulos.filter((t) => ocsFixas.has(t.oc_id) && t.status !== 'cancelado');
    expect(titulos.length).toBeGreaterThan(0);
    for (const t of titulos) {
      const v = analise.vinculos.get(t.titulo_id);
      expect(v?.confianca, t.titulo_id).toBe('alta');
      expect(v?.metodo).toBe('oc_contrato');
    }
  });

  it('nenhum título de campanha (OC pontual) de agência é vinculado ao fee', () => {
    const agencias = new Set(
      base.contratos.filter((c) => c.oc_id && base.fornecedores.find((f) => f.fornecedor_id === c.fornecedor_id)?.categoria === 'marketing_agencia').map((c) => c.fornecedor_id),
    );
    const contratoOc = new Set(base.contratos.map((c) => c.oc_id).filter(Boolean));
    const campanhas = base.titulos.filter((t) => agencias.has(t.fornecedor_id) && t.oc_id && !contratoOc.has(t.oc_id) && t.status !== 'cancelado');
    expect(campanhas.length).toBeGreaterThan(0);
    for (const t of campanhas) {
      const v = analise.vinculos.get(t.titulo_id);
      expect(v?.metodo, t.titulo_id).toBe('oc_pontual');
      expect(v?.contratoId).toBeNull();
    }
  });

  it('utilidades sem OC são vinculadas pelo fornecedor e frete pela integração (média)', () => {
    const metodos = new Set([...analise.vinculos.values()].map((v) => `${v.metodo}/${v.confianca}`));
    expect(metodos).toContain('fornecedor_sem_oc/alta');
    expect(metodos).toContain('frete_integracao/media');
  });
});

describe('desvios na base original', () => {
  it('o caso real de conta de consumo ~10 vezes menor que a média é acusado como D02', () => {
    const d02 = analise.desvios.filter((d) => d.codigo === 'D02' && analise.classes.get(d.contratoId) === 'utilidade');
    expect(d02.length).toBeGreaterThan(0);
    const comp = analise.competencias.find((c) => c.contratoId === d02[0]!.contratoId && c.competencia === d02[0]!.competencia)!;
    expect(comp.valorCobrado / comp.valorEsperado!).toBeLessThan(config.contratos.utilidade.limite_erro_digitacao);
  });

  it('mensalidades pagas com atraso e acréscimo de multa + juros não viram desvio', () => {
    const atrasadas = base.titulos.filter((t) => {
      const v = analise.vinculos.get(t.titulo_id);
      const c = v?.contratoId ? base.contratos.find((x) => x.contrato_id === v.contratoId) : null;
      return c && analise.classes.get(c.contrato_id) === 'fixo' && t.data_pagamento > t.vencimento && numero(t.valor)! > numero(c.valor_mensal)!;
    });
    expect(atrasadas.length).toBeGreaterThan(0);
    for (const t of atrasadas) {
      const v = analise.vinculos.get(t.titulo_id)!;
      const comp = analise.competencias.find((c) => c.contratoId === v.contratoId && c.competencia === v.competencia)!;
      expect(comp.situacao, t.titulo_id).toBe('conforme');
    }
  });

  it('frete com pico sazonal fica dentro da faixa (sem D09 nas competências fechadas)', () => {
    const fretes = analise.competencias.filter((c) => c.classe === 'frete' && c.qtdTitulos > 0);
    expect(fretes.length).toBeGreaterThan(0);
    expect(fretes.filter((c) => c.desvios.includes('D09'))).toEqual([]);
  });

  it('contratos que vencem em 30 dias geram aviso D07 ao gestor', () => {
    const d07 = analise.desvios.filter((d) => d.codigo === 'D07');
    expect(d07.length).toBeGreaterThan(0);
    for (const d of d07) expect(d.acionar).toContain(base.contratos.find((c) => c.contrato_id === d.contratoId)!.gestor_pessoa_id);
  });

  it('títulos de contrato fixo na agenda saem como rotina, sem retirada', () => {
    const fixos = avaliacoes.filter((a) => a.contrato?.confianca === 'alta' && analise.classes.get(a.contrato.contratoId ?? '') === 'fixo');
    expect(fixos.length).toBeGreaterThan(0);
    for (const a of fixos) {
      expect(a.decisao.destino, a.decisao.motivo).not.toBe('RETIRADO');
      // Único alerta tolerado: forma de pagamento diferente da do contrato (D08), que é dado real da base.
      const outros = a.resultados.filter((r) => !r.passou && r.codigo !== 'D08');
      expect(outros, a.tituloId).toEqual([]);
      if (!a.resultados.some((r) => !r.passou)) expect(a.conformeContrato, a.tituloId).toBe(true);
    }
  });
});

describe('R12 substituída', () => {
  it('a regra R12 não existe mais no motor nem na configuração', () => {
    expect(Object.keys(REGRAS)).not.toContain('R12');
    expect(JSON.stringify(config)).not.toMatch(/"R12"/);
  });
  it('desvios contratuais não geram alerta duplicado por título', () => {
    const chaves = analise.desvios.map((d) => d.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('sem IDs da base no código', () => {
  it('src/ não cita títulos, fornecedores, contratos ou OCs da base', () => {
    const arquivos: string[] = [];
    const varrer = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) varrer(p);
        else if (/\.(ts|tsx)$/.test(e.name)) arquivos.push(p);
      }
    };
    varrer(path.join(RAIZ, 'src'));
    for (const f of arquivos) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\b(TP\d{6}|FP\d{4}|CT-\d{4}|OC-\d{5})\b/);
  });
});

describe('análise é pura', () => {
  it('sem títulos avaliados, nenhum desvio que retira é emitido', () => {
    const idx = new Indices(base);
    const a = analisarContratos({ idx, cal: new CalendarioBancario(base.feriados), config, agora: base.politicas.periodo.inicio.slice(0, 16), titulosAvaliados: new Set() });
    expect(a.desvios.filter((d) => d.retira)).toEqual([]);
  });
});
