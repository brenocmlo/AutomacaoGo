import fs from 'node:fs';
import path from 'node:path';
import { carregarConfig, pastaBase, raizProjeto, type ConfigGoAudit } from '@/lib/config/config';
import { carregarBase, type BaseEntrada } from '@/lib/data/base';

/** Base de entrada (CSV) e configuração, carregadas uma vez por processo do servidor. */
export interface Contexto {
  config: ConfigGoAudit;
  base: BaseEntrada;
  baseDir: string;
  usandoBaseOriginal: boolean;
}

let cache: Contexto | null = null;

export function contexto(): Contexto {
  if (cache) return cache;
  const config = carregarConfig();
  let baseDir = pastaBase(config);
  let usandoBaseOriginal = false;
  if (!fs.existsSync(baseDir)) {
    baseDir = path.join(raizProjeto(), 'data', 'base');
    usandoBaseOriginal = true;
  }
  cache = { config, base: carregarBase(baseDir), baseDir, usandoBaseOriginal };
  return cache;
}

/** Nome da base usada (para registrar na simulação). */
export function nomeCenario(): string {
  return path.relative(raizProjeto(), contexto().baseDir).replace(/\\/g, '/');
}
