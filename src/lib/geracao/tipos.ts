import type { HoraSimulada } from '@/lib/clock/relogio';

/** Arquivos da base de entrada que o gerador sabe preencher (mesmos nomes e colunas dos CSVs). */
export const ARQUIVOS_GERADOS = [
  'contas_a_pagar', 'agenda_remessa', 'notas_fiscais', 'nf_duplicatas', 'pedidos_compra',
  'dda_boletos', 'recebimentos_mercadoria', 'comunicacoes_fornecedores', 'alteracoes_cadastro',
] as const;
export type ArquivoGerado = (typeof ARQUIVOS_GERADOS)[number];

/** As três histórias do pitch, em versão leve: rotina, duplicidade e golpe/ruído por mensagem. */
export type Trilha = 'rotina' | 'duplicidade' | 'golpe' | 'ruido';
export const TRILHAS: Trilha[] = ['rotina', 'duplicidade', 'golpe', 'ruido'];

/** Quem escreveu o texto da mensagem: o modelo de IA ou o modelo fixo (fallback). */
export type OrigemTexto = 'ia' | 'template' | 'regra';

/** Uma linha de um arquivo da base, criada durante a simulação (tabela `eventos_gerados`). */
export interface EventoGerado {
  /** Idempotência: único por simulação. Mesma hora + mesmo evento + mesma linha = mesma chave. */
  chave: string;
  /** Agrupa as linhas do mesmo acontecimento (um título + NF + OC + agenda...). */
  evento: string;
  /** Hora simulada em que o evento chega (o ciclo desta hora é o primeiro a enxergá-lo). */
  hora: HoraSimulada;
  trilha: Trilha;
  arquivo: ArquivoGerado;
  linha: Record<string, string>;
  origem: OrigemTexto;
  modeloIa?: string | null;
  /** Fornecedor a que o evento se refere (nulo em phishing genérico). */
  fornecedorId?: string | null;
}

export type Intensidade = 'baixa' | 'media' | 'alta';

export function intensidadeConfigurada(): Intensidade {
  const v = (process.env.GOAUDIT_GERADOR_INTENSIDADE ?? '').toLowerCase();
  return v === 'media' || v === 'alta' ? v : 'baixa';
}

export const geradorLigado = () => (process.env.GOAUDIT_GERADOR ?? '').toLowerCase() !== 'desligado';
