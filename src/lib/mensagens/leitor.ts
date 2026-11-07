import { nomeComparavel, raizCnpj, valorBR } from '@/lib/data/normalizadores';
import type { Indices } from '@/lib/data/indices';
import type { Comunicacao, Fornecedor } from '@/lib/data/tipos';
import { chaveRefinamento, refinamentos } from './refinamento';

/**
 * Leitor de mensagens, parte sem IA (seção 6.2: remetente, regex e uma classificação por regras).
 * Função pura: lê o texto como DADO e devolve só dados num formato fechado. Não chama ação nenhuma.
 * O texto nunca é obedecido: instruções escondidas nele viram apenas o sinal `instrucao_ao_agente`.
 */

export const TIPOS_MENSAGEM = [
  'boleto_novo', 'segunda_via', 'troca_dados_bancarios', 'cobranca_atraso',
  'reajuste', 'aviso_duplicidade', 'phishing', 'outro',
] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

export type SinalMensagem =
  | 'dominio_diferente' | 'remetente_desconhecido' | 'telefone_novo_citado'
  | 'beneficiario_diferente' | 'banco_fora_do_historico'
  | 'pede_troca_conta' | 'pagamento_urgente_fora_do_processo'
  | 'personificacao_executivo' | 'instrucao_ao_agente' | 'link_suspeito';

export interface BoletoExtraido {
  banco: string | null;
  beneficiario: string | null;
  cnpj: string | null;
  valor: number | null;
  vencimento: string | null;
  linha: string | null;
}

export interface Leitura {
  comunicacaoId: string;
  canal: string;
  dataHora: string;
  tipo: TipoMensagem;
  urgencia: 'normal' | 'alta';
  foraDoProcesso: boolean;
  /** null = fornecedor não identificado. */
  remetenteConfere: boolean | null;
  fornecedorId: string | null;
  nfCitada: string | null;
  boletos: BoletoExtraido[];
  sinais: SinalMensagem[];
  confianca: number;
  /** Confiança < 0,7 ou conteúdo hostil: uma pessoa precisa olhar. */
  revisaoHumana: boolean;
  /** 'regras' ou o modelo de IA que refinou a classificação. */
  modelo: string;
  /** Risco da mensagem por si; o R14 cruza com título e cadastro. */
  risco: 'nenhum' | 'alerta' | 'critico';
  /** Chamadas de IA que contribuíram (modelo, tokens, custo). Vazio = só regras. */
  ia: { modelo: string; tokensEntrada: number; tokensSaida: number; custoUsd: number }[];
  /** Frase curta para log e alerta, sem repetir o texto bruto. */
  resumo: string;
}

const digitos = (s: string) => s.replace(/\D/g, '');
const DOMINIO_INTERNO = 'gogroup.com.br';

/** Etapa 2: o regex resolve os boletos anexados no formato do ERP. */
export function extrairBoletos(anexos: string): BoletoExtraido[] {
  const out: BoletoExtraido[] = [];
  const re = /banco (\d{3})(?: - [^,]+)?, benefici[aá]rio ([^,]+), CNPJ ([\d./-]+), valor R\$ ([\d.,]+), vencimento (\d{2}\/\d{2}\/\d{4}), linha digit[aá]vel (\d+)/gi;
  for (const m of anexos.matchAll(re)) {
    out.push({ banco: m[1], beneficiario: m[2].trim(), cnpj: m[3], valor: valorBR(m[4]), vencimento: m[5], linha: m[6] });
  }
  return out;
}

const PADROES_INJECAO =
  /ignore (as |todas as )?(instru|regras)|desconsidere (as )?instru|aja como|voc[eê] (deve|precisa) (liberar|aprovar|pagar)|\b(sistema|system|assistente|agente)\s*:|libere (todos|o) (os )?(pagamentos|lote)|n[aã]o (registre|avise|notifique)/i;

function classificar(c: Comunicacao, boletos: BoletoExtraido[]): { tipo: TipoMensagem; confianca: number } {
  const t = nomeComparavel(`${c.assunto} ${c.texto}`).toLowerCase();
  // A ordem é a de prioridade: o tipo mais perigoso ganha.
  const votos: [TipoMensagem, boolean][] = [
    ['phishing', /token|senha|clique|link|bloquead|credenciais|verifique sua conta/.test(t)],
    ['troca_dados_bancarios', /dados bancarios|domicilio bancario|nova conta|novos dados|troca de conta|alteracao (da|de) conta|mudanca do nosso/.test(t)],
    ['segunda_via', /segunda via|2a via|2 via/.test(t)],
    ['aviso_duplicidade', /duplicidade|pagamento duplicado/.test(t)],
    ['cobranca_atraso', /protesto|em atraso|vencid|titulo em aberto|pagamento parcial/.test(t)],
    ['reajuste', /reajuste|ipca|igp/.test(t)],
    ['boleto_novo', boletos.length > 0 || /boleto|\bnf\b/.test(t)],
  ];
  const acertos = votos.filter(([, ok]) => ok).map(([tp]) => tp);
  if (acertos.length === 0) return { tipo: 'outro', confianca: 0.55 };
  if (acertos.length === 1) return { tipo: acertos[0], confianca: 0.92 };
  const soBoletoJunto = acertos.length === 2 && acertos.includes('boleto_novo');
  return { tipo: acertos[0], confianca: soBoletoJunto ? 0.85 : 0.75 };
}

function identificarFornecedor(c: Comunicacao, idx: Indices): { f: Fornecedor | null; confere: boolean | null; dominioDiferente: boolean } {
  const rem = c.remetente.toLowerCase().trim();
  const remDig = digitos(rem);
  const todos = idx.base.fornecedores;
  const oficial = todos.find((f) => f.email_cadastrado.toLowerCase() === rem || (remDig.length >= 8 && digitos(f.telefone_cadastrado) === remDig));
  if (oficial) return { f: oficial, confere: true, dominioDiferente: false };
  const dom = rem.split('@')[1] ?? '';
  const doDominio = dom ? todos.find((f) => f.email_cadastrado.toLowerCase().endsWith(`@${dom}`)) : undefined;
  if (doDominio) return { f: doDominio, confere: true, dominioDiferente: false };
  // Fora do cadastro: descobre de quem a mensagem diz ser (nome no remetente ou assunto, CNPJ do boleto).
  const texto = nomeComparavel(`${c.nome_remetente} ${c.assunto} ${c.texto}`);
  const raizes = new Set(extrairBoletos(c.anexos).map((b) => raizCnpj(b.cnpj)).filter(Boolean));
  const candidato =
    todos.find((f) => {
      const nome = nomeComparavel(f.nome_fantasia).split(' ')[0] ?? '';
      return nome.length >= 4 && texto.includes(nome);
    }) ?? todos.find((f) => raizes.has(raizCnpj(f.cnpj)));
  return candidato ? { f: candidato, confere: false, dominioDiferente: true } : { f: null, confere: null, dominioDiferente: false };
}

const PALAVRA_EXECUTIVO = /diretor(a)?\b|\bcfo\b|presidente|\bceo\b/i;

export function lerMensagem(c: Comunicacao, idx: Indices): Leitura {
  const ia = refinamentos.get(chaveRefinamento(c));
  const doRegex = extrairBoletos(c.anexos);
  const boletos = doRegex.length ? doRegex : (ia?.boletos ?? []);
  const { f, confere, dominioDiferente } = identificarFornecedor(c, idx);
  const porRegras = classificar(c, boletos);
  let { tipo, confianca: confBase } = porRegras;
  let divergencia = false;
  if (ia?.tipo) {
    const PERIGOSOS: string[] = ['phishing', 'troca_dados_bancarios', 'segunda_via'];
    if (ia.tipoConfianca >= 0.7) {
      // A IA nunca baixa o risco: se as regras viram um tipo perigoso e ela não, vale o das regras e uma pessoa confere.
      const remetenteOk = confere === true && !/https?:\/\/|www\./i.test(`${c.assunto} ${c.texto}`) && !PADROES_INJECAO.test(`${c.assunto} ${c.texto}`);
      if (PERIGOSOS.includes(porRegras.tipo) && !PERIGOSOS.includes(ia.tipo)) divergencia = true;
      // Sem sinal hostil, remetente do cadastro, a IA sozinha não promove a mensagem a phishing: uma pessoa confere.
      else if (ia.tipo === 'phishing' && remetenteOk) divergencia = true;
      else {
        tipo = ia.tipo as TipoMensagem;
        confBase = ia.tipoConfianca;
      }
    } else if (!(porRegras.tipo === 'boleto_novo' && confere === true)) {
      // Confiança baixa da IA pede revisão, exceto na rotina: boleto novo de remetente do cadastro.
      confBase = Math.min(confBase, ia.tipoConfianca);
    }
  }
  const sinais = new Set<SinalMensagem>();
  const textoTotal = `${c.assunto} ${c.texto}`;
  const tn = nomeComparavel(textoTotal).toLowerCase();
  const interno = c.remetente.toLowerCase().endsWith(`@${DOMINIO_INTERNO}`);

  if (dominioDiferente) sinais.add('dominio_diferente');
  if (!f && !interno) sinais.add('remetente_desconhecido');
  if (PADROES_INJECAO.test(textoTotal)) sinais.add('instrucao_ao_agente');
  if (/https?:\/\/|www\./i.test(textoTotal)) sinais.add('link_suspeito');

  // Telefone citado no corpo que não é o do cadastro.
  if (f) {
    const oficial = digitos(f.telefone_cadastrado);
    const citados = [...textoTotal.matchAll(/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g)].map((m) => digitos(m[0]));
    if (citados.some((t) => t.length >= 8 && !oficial.endsWith(t.slice(-8)))) sinais.add('telefone_novo_citado');
  }

  const pedeTroca = tipo === 'troca_dados_bancarios' || /nova conta|novos dados bancarios|trocar? (a )?conta/.test(tn);
  if (pedeTroca) sinais.add('pede_troca_conta');

  const urgente = /urgente|imediat|ainda hoje|com urgencia/.test(tn);
  const foraProc = /fora do (processo|fluxo)|sem (nota|nf)|nao (comente|avise)|sigilo|confidencial|transferencia|\bpix\b/.test(tn);
  const executivo = PALAVRA_EXECUTIVO.test(`${c.nome_remetente} ${c.texto.slice(-160)}`) && !interno;
  if (executivo) sinais.add('personificacao_executivo');
  if (urgente && (foraProc || executivo)) sinais.add('pagamento_urgente_fora_do_processo');
  if (ia?.foraDoProcesso) sinais.add('pagamento_urgente_fora_do_processo');

  if (f && boletos.length) {
    const hist = idx.bancosDeCobrancaHistoricos(raizCnpj(f.cnpj));
    if (boletos.some((b) => raizCnpj(b.cnpj) && raizCnpj(b.cnpj) !== raizCnpj(f.cnpj))) sinais.add('beneficiario_diferente');
    if (hist.size && boletos.some((b) => b.banco && !hist.has(b.banco) && b.banco !== f.banco)) sinais.add('banco_fora_do_historico');
  }

  const tipoFinal: TipoMensagem = sinais.has('instrucao_ao_agente') && tipo !== 'phishing' ? 'phishing' : tipo;
  const foraDoProcesso = sinais.has('pagamento_urgente_fora_do_processo') || sinais.has('instrucao_ao_agente');
  const canalEstranho = confere === false || sinais.has('remetente_desconhecido');
  const dadosDiferentes = sinais.has('beneficiario_diferente') || sinais.has('banco_fora_do_historico');

  let risco: Leitura['risco'] = 'nenhum';
  if (pedeTroca && (canalEstranho || sinais.has('telefone_novo_citado'))) risco = 'critico';
  else if ((tipoFinal === 'segunda_via' || tipoFinal === 'boleto_novo') && dadosDiferentes && canalEstranho) risco = 'critico';
  else if (foraDoProcesso || tipoFinal === 'phishing' || executivo) risco = 'alerta';
  else if (canalEstranho && (tipoFinal === 'segunda_via' || tipoFinal === 'boleto_novo')) risco = 'alerta';

  const confianca = sinais.has('instrucao_ao_agente') || divergencia ? Math.min(confBase, 0.6) : confBase;
  return {
    comunicacaoId: c.comunicacao_id,
    canal: c.canal,
    dataHora: c.data_hora,
    tipo: tipoFinal,
    urgencia: urgente ? 'alta' : 'normal',
    foraDoProcesso,
    remetenteConfere: confere,
    fornecedorId: f?.fornecedor_id ?? null,
    nfCitada: textoTotal.match(/\bNF\s*(?:n[ºo.]*\s*)?(\d{3,})/i)?.[1] ?? null,
    boletos,
    sinais: [...sinais],
    confianca,
    revisaoHumana: confianca < 0.7 || sinais.has('instrucao_ao_agente'),
    modelo: ia?.uso.length ? `${ia.uso[0].modelo}+regras` : 'regras',
    ia: ia?.uso ?? [],
    risco,
    resumo: `${tipoFinal.replace(/_/g, ' ')}${f ? ` · ${f.nome_fantasia}` : ''}${sinais.size ? ` · sinais: ${[...sinais].join(', ')}` : ''}`,
  };
}
