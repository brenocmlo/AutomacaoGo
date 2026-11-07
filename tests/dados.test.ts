import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarBase, recortarAte, type BaseEntrada } from '@/lib/data/base';
import { Indices } from '@/lib/data/indices';
import { CalendarioBancario, urgencia } from '@/lib/clock/relogio';

/**
 * Testes de integração sobre a base original (data/base). Não citam IDs da base:
 * verificam propriedades que qualquer cenário com a mesma estrutura deve ter.
 */
const DIR = path.resolve(__dirname, '..', 'data', 'base');
let base: BaseEntrada;
let idx: Indices;

beforeAll(() => {
  base = carregarBase(DIR);
  idx = new Indices(base);
});

describe('políticas', () => {
  it('extrai alçadas e tolerâncias do texto', () => {
    const p = base.politicas;
    expect(p.alcadas.analistaLiberarAte).toBeGreaterThan(0);
    expect(p.alcadas.aprovadorAte).toBeGreaterThan(p.alcadas.analistaLiberarAte);
    expect(p.tresVias.ocToleranciaPct).toBeGreaterThan(0);
    expect(p.tresVias.ocToleranciaAbs).toBeGreaterThan(0);
    expect(p.tresVias.tituloTolerancia).toBeGreaterThan(0);
    expect(p.bancos.length).toBe(2);
    expect(p.pessoas.length).toBeGreaterThan(0);
    expect(p.alcadas.coordenacaoPessoaId).toMatch(/\w+/);
  });
});

describe('ligação dos títulos da agenda', () => {
  it('liga ≥ 99% dos títulos à NF e à duplicata', () => {
    const dossies = base.agenda.map((a) => idx.dossie(a.titulo_id));
    const exigeNf = dossies.filter((d) => !base.politicas.tresVias.dispensaNf.includes(d.fornecedor?.categoria ?? ''));
    const ligados = exigeNf.filter((d) => d.nf && d.duplicata);
    expect(ligados.length / exigeNf.length).toBeGreaterThanOrEqual(0.99);
  });
  it('todo título da agenda tem fornecedor', () => {
    expect(base.agenda.every((a) => idx.dossie(a.titulo_id).fornecedor)).toBe(true);
  });
  it('linha digitável dos boletos decodifica com DV válido', () => {
    const bol = base.agenda.filter((a) => a.forma_pagamento === 'boleto').map((a) => idx.dossie(a.titulo_id));
    expect(bol.every((d) => d.boleto?.dvCamposOk)).toBe(true);
  });
});

describe('conciliação de extratos', () => {
  it('a maioria das linhas avulsas é explicada por títulos pagos', () => {
    const avulsos = idx.pagamentos.filter((p) => p.avulso && p.origem !== 'retorno_remessa');
    expect(idx.pagamentosAvulsosSemTitulo.length).toBeLessThan(avulsos.length * 0.2);
  });
});

describe('chegada e calendário', () => {
  it('recorte pela hora não traz nada lançado depois', () => {
    const r = recortarAte(base, '2026-10-01T00:00', '18:00');
    expect(r.titulos.every((t) => t.data_lancamento < '2026-10-01')).toBe(true);
    expect(r.titulos.length).toBeLessThan(base.titulos.length);
  });
  it('feriado e fim de semana não são dias úteis', () => {
    const cal = new CalendarioBancario(base.feriados);
    const feriado = base.feriados.find((f) => /^sim/.test(f.afeta_remessa))!;
    expect(cal.ehDiaUtil(feriado.data)).toBe(false);
    expect(cal.ehDiaUtil('2026-11-07')).toBe(false); // sábado
    expect(cal.proximoDiaUtil('2026-11-07')).toBe('2026-11-09');
  });
  it('urgência imediata a menos de 2h do fechamento', () => {
    expect(urgencia('2026-11-03T08:30', '2026-11-03T10:00', 2)).toBe('IMEDIATA');
    expect(urgencia('2026-11-03T07:00', '2026-11-03T10:00', 2)).toBe('HOJE');
    expect(urgencia('2026-11-02T08:00', '2026-11-03T10:00', 2)).toBe('NORMAL');
    expect(urgencia('2026-11-03T10:00', '2026-11-03T10:00', 2)).toBe('FECHADO');
  });
});
