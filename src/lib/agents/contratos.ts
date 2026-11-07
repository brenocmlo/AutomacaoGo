import type { SupabaseClient } from '@supabase/supabase-js';
import type { HoraSimulada } from '@/lib/clock/relogio';
import { NOME_DESVIO, type AnaliseContratos, type CompetenciaContrato, type Desvio } from '@/lib/contratos/tipos';
import type { Indices } from '@/lib/data/indices';
import { todas } from './ciclo';

/**
 * Parte contratual do agente de operação: grava o vínculo título × contrato, o resumo de cada
 * competência (esperado × cobrado) e os alertas dos desvios D01–D10. Tudo com o JWT do agente;
 * só escreve o que mudou e usa chaves únicas (idempotente). Cada alerta novo vai ao log de auditoria.
 */

export interface ResultadoContratos {
  vinculos: number;
  competencias: number;
  alertas: number;
}

function partes<T>(itens: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n));
  return out;
}

async function gravar(cliente: SupabaseClient, tabela: string, linhas: Record<string, unknown>[], onConflict: string, ignorar: boolean) {
  for (const p of partes(linhas)) {
    const { error } = await cliente.from(tabela).upsert(p, { onConflict, ignoreDuplicates: ignorar });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

const assinaturaCompetencia = (c: {
  valor_esperado: number | string | null; faixa_min: number | string | null; faixa_max: number | string | null;
  valor_cobrado: number | string; qtd_titulos: number; situacao: string; desvios: string[];
}) =>
  [c.valor_esperado == null ? '' : Number(c.valor_esperado), c.faixa_min == null ? '' : Number(c.faixa_min), c.faixa_max == null ? '' : Number(c.faixa_max),
    Number(c.valor_cobrado), c.qtd_titulos, c.situacao, [...c.desvios].sort().join('+')].join('|');

function linhaCompetencia(sim: string, c: CompetenciaContrato, horaTs: string) {
  return {
    simulacao_id: sim,
    contrato_id: c.contratoId,
    competencia: c.competencia,
    classe: c.classe,
    fornecedor_id: c.fornecedorId,
    gestor_pessoa_id: c.gestorPessoaId,
    valor_esperado: c.valorEsperado,
    faixa_min: c.faixaMin,
    faixa_max: c.faixaMax,
    valor_cobrado: c.valorCobrado,
    qtd_titulos: c.qtdTitulos,
    titulos: c.titulos,
    situacao: c.situacao,
    desvios: c.desvios,
    vencimento_previsto: c.vencimentoPrevisto,
    hora_simulada: horaTs,
    atualizado_em: new Date().toISOString(),
  };
}

export async function registrarContratos(
  cliente: SupabaseClient,
  sim: string,
  hora: HoraSimulada,
  analise: AnaliseContratos,
  idx: Indices,
): Promise<ResultadoContratos> {
  const horaTs = `${hora}:00`;
  const r: ResultadoContratos = { vinculos: 0, competencias: 0, alertas: 0 };
  const contratoPorId = new Map(analise.contratos.map((c) => [c.contrato_id, c]));
  const gestorDe = (contratoId: string) => contratoPorId.get(contratoId)?.gestor_pessoa_id ?? '';

  // 1) Vínculos (só os que pertencem a contrato ou foram acusados como sem vínculo; OC pontual não é do contrato)
  const gravados = await todas<{ titulo_id: string; contrato_id: string; competencia: string | null; metodo: string; confianca: string }>((de, ate) =>
    cliente.from('vinculos_contrato').select('titulo_id, contrato_id, competencia, metodo, confianca').eq('simulacao_id', sim).order('titulo_id').range(de, ate),
  );
  const jaTem = new Map(gravados.map((v) => [v.titulo_id, `${v.contrato_id}|${v.competencia ?? ''}|${v.metodo}|${v.confianca}`]));
  const novos = [...analise.vinculos.values()]
    .filter((v) => v.contratoId && jaTem.get(v.tituloId) !== `${v.contratoId}|${v.competencia ?? ''}|${v.metodo}|${v.confianca}`)
    .map((v) => ({
      simulacao_id: sim,
      titulo_id: v.tituloId,
      contrato_id: v.contratoId!,
      competencia: v.competencia,
      metodo: v.metodo,
      confianca: v.confianca,
      fornecedor_id: idx.tituloPorId.get(v.tituloId)?.fornecedor_id ?? null,
      gestor_pessoa_id: gestorDe(v.contratoId!),
      motivo: v.motivo,
      hora_simulada: horaTs,
      atualizado_em: new Date().toISOString(),
    }));
  await gravar(cliente, 'vinculos_contrato', novos, 'simulacao_id,titulo_id', false);
  r.vinculos = novos.length;

  // 2) Competências (esperado × cobrado): só as que mudaram
  const atuais = await todas<Parameters<typeof assinaturaCompetencia>[0] & { contrato_id: string; competencia: string }>((de, ate) =>
    cliente.from('competencias_contrato')
      .select('contrato_id, competencia, valor_esperado, faixa_min, faixa_max, valor_cobrado, qtd_titulos, situacao, desvios')
      .eq('simulacao_id', sim).order('contrato_id').order('competencia').range(de, ate),
  );
  const assinaturas = new Map(atuais.map((c) => [`${c.contrato_id}|${c.competencia}`, assinaturaCompetencia(c)]));
  const mudaram = analise.competencias.filter((c) =>
    assinaturas.get(`${c.contratoId}|${c.competencia}`) !==
    assinaturaCompetencia({
      valor_esperado: c.valorEsperado, faixa_min: c.faixaMin, faixa_max: c.faixaMax, valor_cobrado: c.valorCobrado,
      qtd_titulos: c.qtdTitulos, situacao: c.situacao, desvios: c.desvios,
    }),
  );
  await gravar(cliente, 'competencias_contrato', mudaram.map((c) => linhaCompetencia(sim, c, horaTs)), 'simulacao_id,contrato_id,competencia', false);
  r.competencias = mudaram.length;

  // 3) Alertas: um por pessoa avisada. O código do desvio vai em `regras`; o tipo é sempre "contrato".
  const linhasAlerta: Record<string, unknown>[] = [];
  const linhasLog: Record<string, unknown>[] = [];
  for (const d of analise.desvios) {
    const titulo = d.tituloId ? idx.tituloPorId.get(d.tituloId) : undefined;
    const fornecedor = contratoPorId.get(d.contratoId)?.fornecedor_id ?? null;
    const donos = d.acionar.length ? d.acionar : [gestorDe(d.contratoId)].filter(Boolean);
    for (const dono of donos) {
      linhasAlerta.push({
        simulacao_id: sim,
        tipo: 'contrato',
        titulo_id: d.tituloId,
        fornecedor_id: titulo?.fornecedor_id ?? fornecedor,
        dono_pessoa_id: dono,
        regras: [d.codigo],
        mensagem: `${NOME_DESVIO[d.codigo]}. ${d.motivo}`,
        valor: titulo ? Number(titulo.valor) : null,
        contrato_id: d.contratoId,
        competencia: d.competencia,
        gestor_pessoa_id: gestorDe(d.contratoId),
        chave: `${d.chave}|${dono}`,
        hora_simulada: horaTs,
      });
    }
    linhasLog.push(logDesvio(sim, horaTs, d));
  }
  await gravar(cliente, 'alertas', linhasAlerta, 'simulacao_id,chave', true);
  r.alertas = linhasAlerta.length;

  // 4) Log de auditoria (idempotente pela chave): uma linha por desvio e uma de resumo por ciclo
  if (novos.length || mudaram.length) {
    linhasLog.push({
      simulacao_id: sim, data_hora_simulada: horaTs, ator_tipo: 'agente_operacao', acao: 'ligou títulos aos contratos',
      entidade: 'ciclo', entidade_id: hora,
      motivo: `${novos.length} vínculos novos ou alterados; ${mudaram.length} competências atualizadas`,
      chave: `contratos|${hora}`,
    });
  }
  await gravar(cliente, 'log_auditoria', linhasLog, 'simulacao_id,chave', true);
  return r;
}

function logDesvio(sim: string, horaTs: string, d: Desvio) {
  return {
    simulacao_id: sim,
    data_hora_simulada: horaTs,
    ator_tipo: 'agente_operacao',
    acao: d.retira ? 'acusou desvio contratual e retirou do lote' : 'alertou desvio contratual',
    entidade: 'contrato',
    entidade_id: d.contratoId,
    regras: [d.codigo],
    evidencias: d.evidencias.slice(0, 50),
    motivo: `${NOME_DESVIO[d.codigo]}. ${d.motivo}`.slice(0, 1000),
    chave: `desvio|${d.chave}`,
  };
}
