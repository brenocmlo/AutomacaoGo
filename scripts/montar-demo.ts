/**
 * Monta a base da demo: copia a base original e acrescenta as linhas de cada cenário
 * (data/cenarios/<ID>/<arquivo>.csv) no fim dos arquivos correspondentes.
 * A base original nunca é alterada.
 *
 * Por padrão (npm run demo:montar) monta a base do PITCH de 5 minutos: só C01, C05, C09 e C12
 * (CENARIOS_PITCH). Com --todos-cenarios entram todos os cenários plantados; --completa mantém também
 * a base inteira (títulos de fundo). Também grava em <saida>/cenarios_esperados.csv só as linhas dos
 * cenários montados.
 *
 * A base enxuta tem só os cenários escolhidos, um exemplo de cada caso. Saem os
 * títulos de fundo da base original (os agendados nos lotes) e as mensagens e movimentos do período;
 * ficam os dados de apoio que as regras exigem (fornecedores, contratos, OCs, políticas, o histórico
 * de títulos pagos para a mediana da R11 e as competências anteriores dos contratos, NFs, DDA,
 * extratos, alterações de cadastro até o início da simulação). Com --completa, a base inteira.
 *
 * Uso: npx tsx scripts/montar-demo.ts [pasta_base] [pasta_saida] [cenarios: C01,C02,...] [--todos-cenarios] [--completa]
 */
import fs from 'node:fs';
import path from 'node:path';
import { raizProjeto } from '@/lib/config/config';
import { cabecalhoCsv, escreverCsv, lerCsv } from '@/lib/data/csv';
import { carregarBase } from '@/lib/data/base';

/** Cenários da base do pitch de 5 minutos: rotina (C09, C12), duplicidade com IA (C01) e golpe por mensagem (C05). */
export const CENARIOS_PITCH = ['C01', 'C05', 'C09', 'C12'];

/** Tira da cópia da base o que é "fundo" do período simulado, deixando o histórico e os dados de apoio. */
function enxugar(baseDir: string, saidaDir: string, cenariosDir: string, filtro?: string[]): void {
  const inicio = carregarBase(baseDir).politicas.periodo.inicio.slice(0, 16);
  const ate = (v: string | undefined) => !v || v.replace(' ', 'T').slice(0, 16) <= inicio;
  // Títulos reais da base que um cenário usa (ex.: C29) continuam; os demais agendados saem.
  const gabarito = gabaritoDos(cenariosDir, filtro);
  const manter = new Set(gabarito.map((l) => l.titulo_id).filter(Boolean));
  const filtrar = (arquivo: string, fn: (l: Record<string, string>) => boolean, delim = ',') => {
    const destino = path.join(saidaDir, arquivo);
    if (!fs.existsSync(destino)) return;
    const colunas = cabecalhoCsv(destino, delim);
    const linhas = lerCsv<Record<string, string>>(destino, delim).filter(fn);
    if (linhas.length) escreverCsv(destino, linhas, colunas, delim);
    else fs.writeFileSync(destino, `${colunas.join(delim)}
`); // só o cabeçalho: o arquivo continua existindo
  };
  // Contratos: só os do gabarito, mais o do C26 (prova que OC pontual de quem tem contrato não é do contrato).
  // Os demais, sem título no período, só gerariam alerta de "assinatura sem título" (D04) de fundo.
  const contratosUsados = new Set(gabarito.map((l) => l.contrato_id).filter(Boolean));
  const fornecedoresUsados = new Set<string>();
  for (const d of fs.readdirSync(cenariosDir, { withFileTypes: true }).filter((x) => x.isDirectory() && x.name === 'C26' && (!filtro || filtro.includes('C26')))) {
    const arq = path.join(cenariosDir, d.name, 'contas_a_pagar.csv');
    if (fs.existsSync(arq)) for (const l of lerCsv<Record<string, string>>(arq)) fornecedoresUsados.add(l.fornecedor_id!);
  }
  filtrar('contratos_fornecedores.csv', (l) => contratosUsados.has(l.contrato_id!) || fornecedoresUsados.has(l.fornecedor_id!));
  filtrar('agenda_remessa.csv', (l) => manter.has(l.titulo_id!));
  filtrar('contas_a_pagar.csv', (l) => l.status !== 'agendado' || manter.has(l.titulo_id!));
  filtrar('comunicacoes_fornecedores.csv', () => false);
  filtrar('alteracoes_cadastro.csv', (l) => ate(l.data_hora));
  filtrar('notas_fiscais.csv', (l) => ate(l.data_recebimento_portal));
  filtrar('dda_boletos.csv', (l) => ate(l.data_registro));
  filtrar('recebimentos_mercadoria.csv', (l) => ate(l.data_hora_recebimento));
  filtrar('aprovacoes.csv', (l) => ate(l.data_hora));
}

/** Linhas do gabarito (cenarios_esperados.csv) dos cenários escolhidos (sem filtro: todas, inclusive as de cenários sem pasta, como o C29, que usa título real da base). */
function gabaritoDos(cenariosDir: string, filtro?: string[]): Record<string, string>[] {
  const arq = path.join(cenariosDir, 'cenarios_esperados.csv');
  return fs.existsSync(arq) ? lerCsv<Record<string, string>>(arq).filter((l) => !filtro || filtro.includes(l.cenario_id!)) : [];
}

export function montarDemo(baseDir: string, saidaDir: string, cenariosDir: string, filtro?: string[], enxuta = true): string[] {
  fs.rmSync(saidaDir, { recursive: true, force: true });
  fs.mkdirSync(saidaDir, { recursive: true });
  for (const f of fs.readdirSync(baseDir)) fs.copyFileSync(path.join(baseDir, f), path.join(saidaDir, f));

  const ids = fs
    .readdirSync(cenariosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!filtro || filtro.includes(d.name)))
    .map((d) => d.name)
    .sort();
  if (enxuta) enxugar(baseDir, saidaDir, cenariosDir, filtro);

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
  // Gabarito só dos cenários montados: o placar e a conferência usam esta cópia, não o gabarito inteiro.
  const arqGab = path.join(cenariosDir, 'cenarios_esperados.csv');
  if (fs.existsSync(arqGab)) escreverCsv(path.join(saidaDir, 'cenarios_esperados.csv'), gabaritoDos(cenariosDir, filtro), cabecalhoCsv(arqGab));
  return ids;
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith('montar-demo')) {
  const raiz = raizProjeto();
  const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const baseDir = path.resolve(pos[0] ?? path.join(raiz, 'data', 'base'));
  const saida = path.resolve(pos[1] ?? path.join(raiz, 'data', 'demo'));
  const completa = process.argv.includes('--completa');
  const todos = completa || process.argv.includes('--todos-cenarios');
  const filtro = pos[2]?.split(',') ?? (todos ? undefined : CENARIOS_PITCH);
  const ids = montarDemo(baseDir, saida, path.join(raiz, 'data', 'cenarios'), filtro, !completa);
  const tipo = completa ? 'completa' : todos || pos[2] ? 'enxuta' : 'enxuta do pitch';
  console.log(`Base de demo ${tipo} montada em ${saida} com os cenários: ${ids.join(', ')}`);
}
