import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

/** Lê um CSV com cabeçalho. Remove BOM. Detecta ';' quando pedido. */
export function lerCsv<T extends Record<string, string>>(arquivo: string, delimitador = ','): T[] {
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '');
  const r = Papa.parse<T>(texto, {
    header: true,
    skipEmptyLines: true,
    delimiter: delimitador,
    transformHeader: (h) => h.trim(),
  });
  if (r.errors.length > 0) {
    const e = r.errors[0]!;
    throw new Error(`Erro ao ler ${path.basename(arquivo)} (linha ${e.row ?? '?'}): ${e.message}`);
  }
  return r.data;
}

/** Lê um JSON-lines (um objeto por linha). Valores não-string viram string. */
export function lerJsonl<T extends Record<string, string>>(arquivo: string): T[] {
  return fs
    .readFileSync(arquivo, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const o = JSON.parse(l) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        out[k] = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
      }
      return out as T;
    });
}

/** Escreve linhas como CSV (usado pelo montador da base de demo e pelos relatórios). */
export function escreverCsv(arquivo: string, linhas: Record<string, string>[], colunas?: string[], delimitador = ','): void {
  const csv = Papa.unparse(linhas, { columns: colunas, delimiter: delimitador, newline: '\n' });
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, csv + '\n', 'utf8');
}

/** Lê só o cabeçalho de um CSV. */
export function cabecalhoCsv(arquivo: string, delimitador = ','): string[] {
  const primeira = fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  return (Papa.parse<string[]>(primeira, { delimiter: delimitador }).data[0] ?? []).map((h) => h.trim());
}
