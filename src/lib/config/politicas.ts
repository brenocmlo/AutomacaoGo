import path from 'node:path';
import { lerCsv } from '@/lib/data/csv';
import type { PoliticaLinha } from '@/lib/data/tipos';
import { valorBR } from '@/lib/data/normalizadores';

/**
 * politicas.csv vem "achatado" (secao, regra, valor), com chaves como
 * `bancos_pagadores.Banco Meridiano.codigo` e `pessoas[3].nome`.
 * Aqui montamos um objeto tipado. Valores em texto livre (tolerâncias de 3 vias)
 * são extraídos por expressão regular; se a política mudar de forma, falha alto.
 */

export interface BancoPagador {
  nome: string;
  codigo: string;
  fechamento: string; // "HH:MM"
}

export interface PessoaAcionavel {
  pessoaId: string;
  nome: string;
  cargo: string;
  acionarQuando: string;
}

export interface Politicas {
  dataReferencia: string;
  periodo: { inicio: string; fim: string };
  bancos: BancoPagador[];
  alcadas: {
    analistaLiberarAte: number;
    analistaCancelarAte: number;
    aprovadorAte: number;
    diretoriaAcimaDe: number;
    diretoriaPessoaId: string;
    coordenacaoPessoaId: string;
  };
  tresVias: {
    ocToleranciaPct: number;
    ocToleranciaAbs: number;
    tituloTolerancia: number;
    dispensaOc: string[];
    dispensaNf: string[];
  };
  atraso: {
    multa: number;
    jurosMes: number;
    custoRelacionamento: Record<string, number>;
  };
  custoAcionamentoDesnecessario: number;
  pessoas: PessoaAcionavel[];
  bruto: Record<string, string>;
}

function exigir(bruto: Record<string, string>, chave: string): string {
  const v = bruto[chave];
  if (v === undefined || v === '') throw new Error(`politicas.csv: chave obrigatória ausente: ${chave}`);
  return v;
}

function num(bruto: Record<string, string>, chave: string): number {
  const n = Number(exigir(bruto, chave));
  if (!Number.isFinite(n)) throw new Error(`politicas.csv: valor não numérico em ${chave}`);
  return n;
}

function lista(v: string | undefined): string[] {
  return (v ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

function extrair(texto: string, re: RegExp, chave: string): string {
  const m = texto.match(re);
  if (!m?.[1]) throw new Error(`politicas.csv: não consegui extrair parâmetro de ${chave}: "${texto}"`);
  return m[1];
}

export function interpretarPoliticas(linhas: PoliticaLinha[]): Politicas {
  const bruto: Record<string, string> = {};
  for (const l of linhas) {
    const chave = l.secao === l.regra ? l.secao : `${l.secao}.${l.regra}`;
    bruto[chave] = l.valor;
  }

  // Bancos pagadores: remessa.bancos_pagadores.<Nome>.<campo>
  const bancosMap = new Map<string, Partial<BancoPagador>>();
  for (const [k, v] of Object.entries(bruto)) {
    const m = k.match(/^remessa\.bancos_pagadores\.(.+)\.(codigo|fechamento_do_lote)$/);
    if (!m) continue;
    const b = bancosMap.get(m[1]!) ?? { nome: m[1]! };
    if (m[2] === 'codigo') b.codigo = v;
    else b.fechamento = v;
    bancosMap.set(m[1]!, b);
  }
  const bancos = [...bancosMap.values()].map((b) => {
    if (!b.codigo || !b.fechamento) throw new Error(`politicas.csv: banco pagador incompleto: ${b.nome}`);
    return b as BancoPagador;
  });

  // Pessoas: acionamento_humano.pessoas[i].<campo>
  const pessoasMap = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(bruto)) {
    const m = k.match(/^acionamento_humano\.pessoas\[(\d+)\]\.(.+)$/);
    if (!m) continue;
    const p = pessoasMap.get(m[1]!) ?? {};
    p[m[2]!] = v;
    pessoasMap.set(m[1]!, p);
  }
  const pessoas: PessoaAcionavel[] = [...pessoasMap.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, p]) => ({
      pessoaId: p.pessoa_id ?? '',
      nome: p.nome ?? '',
      cargo: p.cargo ?? '',
      acionarQuando: p.acionar_quando ?? '',
    }));

  // Custo de relacionamento: atraso.custo_de_relacionamento_por_titulo_atrasado.<categoria>
  const custoRelacionamento: Record<string, number> = {};
  for (const [k, v] of Object.entries(bruto)) {
    const m = k.match(/^atraso\.custo_de_relacionamento_por_titulo_atrasado\.(.+)$/);
    if (m) custoRelacionamento[m[1]!] = Number(v);
  }

  // Tolerâncias de 3 vias (texto livre).
  const nfOc = exigir(bruto, 'tres_vias.nf_x_oc');
  const titDup = exigir(bruto, 'tres_vias.titulo_x_duplicata');
  const ocToleranciaPct = Number(extrair(nfOc, /(\d+(?:[.,]\d+)?)\s*%/, 'tres_vias.nf_x_oc').replace(',', '.')) / 100;
  const ocToleranciaAbs = valorBR(extrair(nfOc, /R\$\s*([\d.]+,\d{2})/, 'tres_vias.nf_x_oc'))!;
  const tituloTolerancia = valorBR(extrair(titDup, /R\$\s*([\d.]+,\d{2})/, 'tres_vias.titulo_x_duplicata'))!;

  // Coordenação de CP: a pessoa acionada para "segunda aprovação".
  const coord = pessoas.find((p) => /segunda aprova/i.test(p.acionarQuando));
  if (!coord) throw new Error('politicas.csv: não encontrei a pessoa da segunda aprovação (aprovação dupla)');

  return {
    dataReferencia: exigir(bruto, 'data_referencia'),
    periodo: { inicio: exigir(bruto, 'periodo_simulado.inicio'), fim: exigir(bruto, 'periodo_simulado.fim') },
    bancos,
    alcadas: {
      analistaLiberarAte: num(bruto, 'alcadas.analista_cp.liberar_ou_agendar_ate'),
      analistaCancelarAte: num(bruto, 'alcadas.analista_cp.cancelar_ate'),
      aprovadorAte: num(bruto, 'alcadas.aprovador.aprova_ate'),
      diretoriaAcimaDe: num(bruto, 'alcadas.diretora_financeira.aprova_acima_de'),
      diretoriaPessoaId: exigir(bruto, 'alcadas.diretora_financeira.pessoa_id'),
      coordenacaoPessoaId: coord.pessoaId,
    },
    tresVias: {
      ocToleranciaPct,
      ocToleranciaAbs,
      tituloTolerancia,
      dispensaOc: lista(bruto['tres_vias.dispensas.oc']),
      dispensaNf: lista(bruto['tres_vias.dispensas.nf']),
    },
    atraso: {
      multa: num(bruto, 'atraso.multa'),
      jurosMes: num(bruto, 'atraso.juros_ao_mes'),
      custoRelacionamento,
    },
    custoAcionamentoDesnecessario: num(bruto, 'acionamento_humano.custo_por_acionamento_desnecessario'),
    pessoas,
    bruto,
  };
}

export function carregarPoliticas(baseDir: string): Politicas {
  return interpretarPoliticas(lerCsv<PoliticaLinha>(path.join(baseDir, 'politicas.csv')));
}
