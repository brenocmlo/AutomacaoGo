/**
 * Tipos das linhas da base de entrada. Os campos ficam como string (como no CSV);
 * a conversão acontece nos índices e nas regras, via normalizadores.
 * Só listamos os campos que o GoAudit usa; colunas extras são preservadas no objeto.
 */

type Linha<K extends string> = Record<K, string> & Record<string, string>;

export type Fornecedor = Linha<
  | 'fornecedor_id' | 'razao_social' | 'nome_fantasia' | 'cnpj' | 'categoria' | 'banco' | 'agencia'
  | 'conta' | 'chave_pix' | 'forma_pagamento_padrao' | 'email_cadastrado' | 'telefone_cadastrado'
  | 'contrato_id' | 'responsavel_interno' | 'status_cadastro'
>;

export type AlteracaoCadastro = Linha<
  | 'alteracao_id' | 'data_hora' | 'fornecedor_id' | 'campo' | 'valor_anterior' | 'valor_novo'
  | 'alterado_por' | 'origem' | 'confirmacao_registrada' | 'confirmacao_como'
>;

export type PedidoCompra = Linha<
  | 'oc_id' | 'cod_fornecedor_compras' | 'cnpj_fornecedor' | 'nome_fornecedor' | 'data_emissao' | 'tipo'
  | 'valor_total' | 'valor_mensal' | 'aprovado_por' | 'data_aprovacao' | 'status' | 'comprador' | 'quantidade'
>;

export type Contrato = Linha<
  | 'contrato_id' | 'fornecedor_id' | 'oc_id' | 'tipo' | 'objeto' | 'valor_mensal' | 'valor_variavel'
  | 'dia_vencimento' | 'forma_pagamento' | 'inicio_vigencia' | 'prazo' | 'fim_vigencia_atual'
  | 'indice_reajuste' | 'mes_reajuste' | 'data_ultimo_reajuste' | 'gestor_contrato' | 'gestor_pessoa_id' | 'status'
>;

/** Arquivo FICTÍCIO (a base do desafio não traz índices): IPCA/IGP-M acumulados em 12 meses. */
export type IndiceReajuste = Linha<'indice' | 'mes_referencia' | 'acumulado_12m' | 'ficticio'>;

export type NotaFiscal = Linha<
  | 'chave_acesso' | 'modelo' | 'numero_nf' | 'serie' | 'cnpj_emitente' | 'razao_social_emitente'
  | 'data_emissao' | 'valor_total' | 'oc_informada' | 'data_recebimento_portal' | 'situacao_sefaz'
>;

export type Duplicata = Linha<'chave_acesso' | 'n_dup' | 'vencimento' | 'valor'>;

export type Titulo = Linha<
  | 'titulo_id' | 'fornecedor_id' | 'numero_nf_digitado' | 'oc_id' | 'parcela' | 'valor' | 'vencimento'
  | 'forma_pagamento' | 'linha_digitavel' | 'cnpj_beneficiario_boleto' | 'origem_lancamento' | 'lancado_por'
  | 'data_lancamento' | 'status' | 'data_pagamento' | 'banco_pagador' | 'lote_remessa' | 'nivel_aprovacao'
  | 'aprovado_por' | 'data_aprovacao'
>;

export type AgendaItem = Linha<
  | 'lote_remessa' | 'banco_pagador' | 'data_prevista' | 'horario_fechamento' | 'titulo_id' | 'fornecedor_id'
  | 'valor' | 'vencimento' | 'forma_pagamento' | 'destino_pagamento'
>;

export type Lote = Linha<
  'lote_remessa' | 'banco_pagador' | 'data_pagamento' | 'horario_fechamento' | 'situacao'
>;

export type Recebimento = Linha<
  | 'recebimento_id' | 'data_hora_recebimento' | 'chave_acesso' | 'numero_nf' | 'cnpj_emitente' | 'oc_id'
  | 'quantidade_recebida' | 'situacao'
>;

export type BoletoDDA = Linha<
  | 'dda_id' | 'data_registro' | 'banco_cobrador' | 'beneficiario' | 'cnpj_beneficiario' | 'numero_documento'
  | 'nosso_numero' | 'valor' | 'vencimento' | 'linha_digitavel' | 'situacao' | 'data_situacao'
>;

export type ExtratoMeridiano = Linha<'data' | 'tipo' | 'descricao' | 'documento' | 'valor' | 'saldo'>;

export type ExtratoLitoral = Linha<'Data' | 'Histórico' | 'Docto' | 'Valor (R$)' | 'Saldo (R$)'>;

export type RetornoRemessa = Linha<
  | 'lote_remessa' | 'titulo_id' | 'favorecido' | 'forma_pagamento' | 'valor_nominal' | 'valor_pago'
  | 'data_pagamento' | 'codigo_ocorrencia'
>;

export type Comunicacao = Linha<
  'comunicacao_id' | 'data_hora' | 'canal' | 'remetente' | 'nome_remetente' | 'assunto' | 'texto' | 'anexos'
>;

export type Usuario = Linha<
  | 'login' | 'nome' | 'email' | 'sistema' | 'perfil' | 'alcada_rs' | 'data_admissao' | 'data_desligamento'
  | 'status' | 'pessoa_id'
>;

export type AprovacaoErp = Linha<
  'aprovacao_id' | 'titulo_id' | 'data_hora' | 'aprovador' | 'nivel_exigido' | 'valor_titulo' | 'decisao'
>;

export type Feriado = Linha<'data' | 'descricao' | 'sem_expediente_bancario' | 'afeta_remessa'>;

export type PoliticaLinha = Linha<'secao' | 'regra' | 'valor'>;

/** Pagamento já realizado, unificado entre extratos e retorno (para R02 e histórico). */
export interface PagamentoObservado {
  origem: 'extrato_meridiano' | 'extrato_litoral' | 'retorno_remessa';
  id: string;
  data: string;
  valor: number;
  tituloId: string | null;
  nome: string;
  bancoDestino: string | null;
  avulso: boolean;
}
