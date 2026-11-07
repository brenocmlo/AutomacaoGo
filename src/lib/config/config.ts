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
    R13: { dias_admissao_recente: number; valor_alto: number };
    R14: { janela_dias: number };
  };
  contratos: {
    classe_por_categoria: Record<string, 'utilidade' | 'frete'>;
    origem_integracao_frete: string;
    tolerancia_valor: number;
    dias_por_mes_juros: number;
    reajuste: { defasagem_indice_meses: number; folga_pontos: number; teto_sem_indice: number; janela_reconhecimento_pontos: number };
    utilidade: { faixa: number; competencias_media: number; limite_erro_digitacao: number };
    frete: { faixa_abaixo: number; faixa_acima: number; fator_sazonal: Record<string, number> };
    alerta_sem_titulo_dias_uteis: number;
    aviso_proximos_dias: number;
  };
  acionamento: {
    dono_por_categoria: Record<string, string>;
    por_regra: Record<string, string[]>;
    /** Quem recebe o alerta quando a mensagem se passa por executivo (C06). */
    golpe_executivo?: string[];
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
