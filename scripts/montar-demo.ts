/**
 * Monta a base da demo: copia a base original e acrescenta as linhas de cada cenário
 * (data/cenarios/<ID>/<arquivo>.csv) no fim dos arquivos correspondentes.
 * A base original nunca é alterada.
 *
 * Uso: npx tsx scripts/montar-demo.ts [pasta_base] [pasta_saida] [cenarios: C01,C02,...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { raizProjeto } from '@/lib/config/config';
import { cabecalhoCsv, escreverCsv, lerCsv } from '@/lib/data/csv';

export function montarDemo(baseDir: string, saidaDir: string, cenariosDir: string, filtro?: string[]): string[] {
  fs.rmSync(saidaDir, { recursive: true, force: true });
  fs.mkdirSync(saidaDir, { recursive: true });
  for (const f of fs.readdirSync(baseDir)) fs.copyFileSync(path.join(baseDir, f), path.join(saidaDir, f));

  const ids = fs
    .readdirSync(cenariosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!filtro || filtro.includes(d.name)))
    .map((d) => d.name)
    .sort();

  for (const id of ids) {
    for (const arquivo of fs.readdirSync(path.join(cenariosDir, id)).sort()) {
      const destino = path.join(saidaDir, arquivo);
      if (!fs.existsSync(destino)) throw new Error(`Cenário ${id}: arquivo ${arquivo} não existe na base`);
      const delim = arquivo === 'extrato_banco_litoral.csv' ? ';' : ',';
      const colunas = cabecalhoCsv(destino, delim);
      const novas = lerCsv(path.join(cenariosDir, id, arquivo), delim);
      for (const l of novas) {
        const extra = Object.keys(l).filter((k) => !colunas.includes(k));
        if (extra.length) throw new Error(`Cenário ${id}/${arquivo}: colunas desconhecidas: ${extra.join(', ')}`);
      }
      const existentes = lerCsv(destino, delim);
      const completas = novas.map((l) => Object.fromEntries(colunas.map((c) => [c, l[c] ?? ''])));
      escreverCsv(destino, [...existentes, ...completas], colunas, delim);
    }
  }
  return ids;
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith('montar-demo')) {
  const raiz = raizProjeto();
  const baseDir = path.resolve(process.argv[2] ?? path.join(raiz, 'data', 'base'));
  const saida = path.resolve(process.argv[3] ?? path.join(raiz, 'data', 'demo'));
  const filtro = process.argv[4]?.split(',');
  const ids = montarDemo(baseDir, saida, path.join(raiz, 'data', 'cenarios'), filtro);
  console.log(`Base de demo montada em ${saida} com os cenários: ${ids.join(', ')}`);
}
