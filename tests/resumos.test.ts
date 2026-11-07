import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { carregarConfig } from '@/lib/config/config';
import { carregarBase } from '@/lib/data/base';
import { avaliarComIndices, type AvaliacaoTitulo } from '@/lib/rules/motor';
import type { Indices } from '@/lib/data/indices';
import type { UsoIA } from '@/lib/ai/proxy';
import { limparResumo } from '@/lib/ai/proxy';
import { chaveResumo, gerarResumos, montarDossie, produzirResumos, type Dossie, type GeradorResumo, type ResumoCache } from '@/lib/agents/resumos';
import { CENARIOS_PITCH, montarDemo } from '../scripts/montar-demo';

/**
 * Resumo da IA (seção 6.3, item 4). A chamada à IA é sempre injetada (gerador falso): estes testes
 * não tocam o AI Proxy. A base é a do pitch, montada em pasta temporária.
 */
const RAIZ = path.resolve(__dirname, '..');
const config = carregarConfig(path.join(RAIZ, 'config', 'goaudit.config.json'));
let avaliacoes: AvaliacaoTitulo[];
let idx: Indices;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goaudit-resumo-'));
  montarDemo(path.join(RAIZ, 'data', 'base'), dir, path.join(RAIZ, 'data', 'cenarios'), CENARIOS_PITCH);
  const r = avaliarComIndices(carregarBase(dir), config, '2026-11-02T15:00');
  avaliacoes = r.avaliacoes;
  idx = r.idx;
});

const uso = (): UsoIA => ({ modelo: 'falso', tokensEntrada: 100, tokensSaida: 40, custoUsd: 0.001 });
const doTitulo = (id: string) => avaliacoes.find((a) => a.tituloId === id)!;

describe('dossiê estruturado', () => {
  it('C01: a cópia traz o original, as duas NFs digitadas e a NF normalizada igual', () => {
    const d = montarDossie(doTitulo('TP900004'), idx);
    expect(d.decisao).toBe('retirado do lote');
    expect(d.regras.map((r) => r.codigo)).toContain('R01');
    expect(d.nf_digitada).toBe('900002-1');
    expect(d.nf_normalizada).toBe('900002');
    const orig = d.titulos_relacionados.find((t) => t.titulo === 'TP900003')!;
    expect(orig.nf_digitada).toBe('000900002');
    expect(orig.nf_normalizada).toBe(d.nf_normalizada);
    expect(orig.valor).toBe(d.valor);
    expect(orig.vencimento).toBe(d.vencimento);
  });

  it('C05: mensagens entram só como campos fechados do leitor, nunca o texto', () => {
    const d = montarDossie(doTitulo('TP900089'), idx);
    expect(d.mensagens.length).toBeGreaterThan(0);
    for (const m of d.mensagens) expect(Object.keys(m).sort()).toEqual(['canal', 'remetente_no_cadastro', 'risco', 'sinais', 'tipo']);
    const msg = idx.base.comunicacoes.find((c) => c.comunicacao_id === 'WA990093')!;
    expect(JSON.stringify(d)).not.toContain(msg.texto.slice(0, 40));
    expect(d.regras.map((r) => r.codigo)).toEqual(expect.arrayContaining(['R07', 'R14']));
  });
});

describe('produzirResumos', () => {
  const dossie = () => montarDossie(doTitulo('TP900004'), idx);

  it('chama a IA uma vez e reaproveita o cache (com o uso contado) na segunda vez', async () => {
    const cache = new Map<string, ResumoCache>();
    let chamadas = 0;
    const gerar: GeradorResumo = async (d) => { chamadas++; return { texto: `Resumo de ${d.titulo}`, uso: uso() }; };
    const a = await produzirResumos([dossie()], gerar, cache);
    expect(chamadas).toBe(1);
    expect(a.textos.get('TP900004')).toBe('Resumo de TP900004');
    expect(a.r).toMatchObject({ aplicados: 1, chamadas: 1, falhas: 0, tokensEntrada: 100 });
    const b = await produzirResumos([dossie()], gerar, cache);
    expect(chamadas).toBe(1); // cache
    expect(b.textos.get('TP900004')).toBe('Resumo de TP900004');
    expect(b.r).toMatchObject({ aplicados: 1, chamadas: 0, tokensEntrada: 100 });
  });

  it('mudou a decisão ou as regras: nova chave, nova chamada', () => {
    const d1 = dossie();
    const d2: Dossie = { ...d1, decisao: 'aguardando aprovação' };
    expect(chaveResumo(d1)).not.toBe(chaveResumo(d2));
    expect(chaveResumo(d1)).toBe(chaveResumo(dossie()));
  });

  it('falha da IA não lança: segue sem resumo', async () => {
    const r = await produzirResumos([dossie()], async () => { throw new Error('AI Proxy: HTTP 503'); }, new Map());
    expect(r.textos.size).toBe(0);
    expect(r.r.falhas).toBe(1);
  });

  it('timeout não trava: o prazo total corta a espera', async () => {
    const t0 = Date.now();
    const r = await produzirResumos([dossie()], () => new Promise(() => {}), new Map(), { prazoMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.textos.size).toBe(0);
    expect(r.r.falhas).toBe(1);
  });

  it('respeita o limite por ciclo', async () => {
    const ds = [doTitulo('TP900004'), doTitulo('TP900089'), doTitulo('TP900092')].map((a) => montarDossie(a, idx));
    let chamadas = 0;
    await produzirResumos(ds, async () => { chamadas++; return { texto: 'x', uso: uso() }; }, new Map(), { max: 2 });
    expect(chamadas).toBe(2);
  });
});

describe('limparResumo', () => {
  it('tira markdown e pensamento, e corta em ~60 palavras', () => {
    expect(limparResumo('<think>raciocínio</think>**Duplicidade** do título.')).toBe('Duplicidade do título.');
    expect(limparResumo('   ')).toBeNull();
    const longo = Array.from({ length: 200 }, (_, i) => `p${i}`).join(' ');
    expect(limparResumo(longo)!.split(' ').length).toBeLessThanOrEqual(61);
  });
});

/** Cliente Supabase falso: guarda decisoes em memória e registra updates e logs. */
function clienteFalso(linhas: { titulo_id: string; destino: string; resumo_ia: string | null }[]) {
  const updates: { valores: Record<string, unknown>; filtros: Record<string, unknown> }[] = [];
  const logs: Record<string, unknown>[] = [];
  const cliente = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      let valores: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        update: (v: Record<string, unknown>) => { valores = v; return q; },
        upsert: (v: Record<string, unknown>) => { if (tabela === 'log_auditoria') logs.push(v); return Promise.resolve({ error: null }); },
        eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
        in: (c: string, v: string[]) => { filtros[c] = v; return Promise.resolve({ data: linhas.filter((l) => v.includes(l.titulo_id)), error: null }); },
        is: (c: string, v: unknown) => {
          filtros[c] = v;
          updates.push({ valores: valores!, filtros: { ...filtros } });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, updates, logs };
}

describe('gerarResumos (agente de operação)', () => {
  const retirados = () => ['TP900004', 'TP900089', 'TP900092'].map((id) => ({ titulo_id: id, destino: 'RETIRADO', resumo_ia: null as string | null }));

  it('grava resumo_ia só nas decisões novas, com o mesmo destino, e registra o custo no log', async () => {
    const f = clienteFalso([...retirados(), { titulo_id: 'TP900040', destino: 'CONFERIDO_AGUARDANDO_APROVADOR', resumo_ia: null }]);
    const chamados: string[] = [];
    const r = await gerarResumos(f.cliente, 'sim-1', '2026-11-02T15:00', avaliacoes, idx, {
      ativo: true, cache: new Map(), gerador: async (d) => { chamados.push(d.titulo); return { texto: `Resumo ${d.titulo}`, uso: uso() }; },
    });
    expect(chamados.sort()).toEqual(['TP900004', 'TP900089', 'TP900092']); // liberado e conferido são triviais: sem IA
    expect(r.aplicados).toBe(3);
    expect(f.updates).toHaveLength(3);
    for (const u of f.updates) expect(u.filtros).toMatchObject({ simulacao_id: 'sim-1', destino: 'RETIRADO', resumo_ia: null });
    expect(f.logs[0]).toMatchObject({ acao: 'chamou o AI Proxy', ator_tipo: 'agente_operacao', chave: 'resumo-ia|2026-11-02T15:00', tokens_entrada: 300 });
  });

  it('não repete: decisão que já tem resumo fica como está, e sem IA (ou com falha) o ciclo segue', async () => {
    const f = clienteFalso(retirados().map((l) => ({ ...l, resumo_ia: 'já tem' })));
    let chamadas = 0;
    const gerador: GeradorResumo = async () => { chamadas++; return { texto: 'x', uso: uso() }; };
    expect((await gerarResumos(f.cliente, 's', '2026-11-02T15:00', avaliacoes, idx, { ativo: true, cache: new Map(), gerador })).aplicados).toBe(0);
    expect(chamadas).toBe(0);

    const g = clienteFalso(retirados());
    expect((await gerarResumos(g.cliente, 's', '2026-11-02T15:00', avaliacoes, idx, { ativo: false, cache: new Map(), gerador })).aplicados).toBe(0);
    expect(chamadas).toBe(0);
    const falha = await gerarResumos(g.cliente, 's', '2026-11-02T15:00', avaliacoes, idx, {
      ativo: true, cache: new Map(), gerador: async () => { throw new Error('timeout'); },
    });
    expect(falha).toMatchObject({ aplicados: 0, falhas: 3 });
    expect(g.updates).toHaveLength(0);
  });
});
