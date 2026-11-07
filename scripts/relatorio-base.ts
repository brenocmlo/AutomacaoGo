/**
 * Roda o motor de regras sobre uma base e gera:
 *  - resumo no terminal (destinos, regras disparadas, títulos não ligados);
 *  - relatorios/avaliacao_<hora>.csv com uma linha por título.
 * Uso: npx tsx scripts/relatorio-base.ts [pasta_base] [hora_simulada]
 */
import path from 'node:path';
import { carregarConfig, raizProjeto } from '@/lib/config/config';
import { carregarBase } from '@/lib/data/base';
import { escreverCsv } from '@/lib/data/csv';
import { avaliarAgenda } from '@/lib/rules/motor';

const dir = path.resolve(process.argv[2] ?? path.join(raizProjeto(), 'data', 'base'));
const config = carregarConfig();
const base = carregarBase(dir);
const agora = process.argv[3] ?? base.politicas.periodo.inicio.slice(0, 16);

const t0 = Date.now();
const av = avaliarAgenda(base, config, agora);
const ms = Date.now() - t0;

const contar = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).sort();
console.log(`Base: ${dir}\nHora simulada: ${agora}\nTítulos avaliados: ${av.length} em ${ms} ms\n`);
console.log('Destinos:', Object.fromEntries(contar(av.map((a) => a.decisao.destino))));
console.log('Regras que falharam:', Object.fromEntries(contar(av.flatMap((a) => a.resultados.filter((r) => !r.passou).map((r) => `${r.codigo}/${r.severidade}`)))));

const naoLigados = av.filter((a) => a.pendenciasLigacao.length);
console.log(`\nTítulos com pendência de ligação: ${naoLigados.length}`);
for (const a of naoLigados) console.log(`  ${a.tituloId}: ${a.pendenciasLigacao.join('; ')}`);

const filtro = process.env.REGRA;
console.log(`\nFalhas${filtro ? ` de ${filtro}` : ''}:`);
for (const a of av) {
  for (const r of a.resultados) {
    if (!r.passou && (!filtro || r.codigo === filtro)) console.log(`  ${a.tituloId} ${r.codigo} [${r.severidade}] ${r.motivo}`);
  }
}

const saida = path.join(raizProjeto(), 'relatorios', `avaliacao_${agora.replace(/[:T]/g, '')}.csv`);
escreverCsv(
  saida,
  av.map((a) => ({
    titulo_id: a.tituloId,
    fornecedor_id: a.fornecedorId,
    categoria: a.categoria,
    valor: a.valor.toFixed(2),
    lote: a.lote,
    urgencia: a.urgencia,
    destino: a.decisao.destino,
    risco: String(a.decisao.risco),
    regras: a.regrasDisparadas.join(' '),
    notificar: a.decisao.notificar.join(' '),
    motivo: a.decisao.motivo,
    pendencias: a.pendenciasLigacao.join('; '),
  })),
);
console.log(`\nCSV: ${saida}`);
