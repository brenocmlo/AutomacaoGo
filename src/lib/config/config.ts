import fs from 'node:fs';
import path from 'node:path';

/** Parâmetros que não estão em politicas.csv (config/goaudit.config.json). */
export interface ConfigGoAudit {
  base_dir_padrao: string;
  relogio: { passo_minutos: number };
  chegada: { extrato_hora_disponivel: string };
  urgencia: { imediata_horas_antes_fechamento: number };
  aprovacao: { margem_antes_fechamento_min: number };
  validacao: { valor_corte_liberacao: number; margem_revisao_min: number };
  categorias: { mercadoria: string[]; contrato_fixo: string[] };
  regras: {
    R01: { janela_vencimento_dias: number };
    R03: { tolerancia_arredondamento: number };
    R07: { janela_dias: number };
    R11: { multiplo_mediana: number; minimo_historico: number };
    R12: { faixa_contrato_fixo: number; faixa_utilidades: number; meses_media_utilidades: number };
    R13: { dias_admissao_recente: number; valor_alto: number };
  };
  acionamento: {
    dono_por_categoria: Record<string, string>;
    por_regra: Record<string, string[]>;
  };
}

export function raizProjeto(): string {
  return process.env.GOAUDIT_ROOT ?? process.cwd();
}

export function carregarConfig(arquivo = path.join(raizProjeto(), 'config', 'goaudit.config.json')): ConfigGoAudit {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as ConfigGoAudit;
}

/** Pasta da base de entrada: GOAUDIT_BASE_DIR ou o padrão da configuração. */
export function pastaBase(config: ConfigGoAudit): string {
  const dir = process.env.GOAUDIT_BASE_DIR ?? config.base_dir_padrao;
  return path.isAbsolute(dir) ? dir : path.join(raizProjeto(), dir);
}
