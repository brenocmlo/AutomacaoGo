/**
 * Gera os cenários plantados (seção 11) como fragmentos CSV em data/cenarios/<ID>/.
 * Ferramenta de autoria: escolhe entidades da base por critério (categoria, histórico,
 * sem troca bancária recente), sem IDs fixos. A saída (CSV) é versionada e é ela que
 * o montador (scripts/montar-demo.ts) usa. Rodar de novo regenera tudo.
 *
 * Uso: npx tsx scripts/gerar-cenarios.ts [pasta_base]
 */
import fs from 'node:fs';
import path from 'node:path';
import { carregarConfig, raizProjeto } from '@/lib/config/config';
import { analisarContratos } from '@/lib/contratos/analise';
import { competenciaDoVencimento, diasUteisAntes, mesDe, vencimentoNominal } from '@/lib/contratos/datas';
import { indiceParaCompetencia } from '@/lib/contratos/indices';
import { carregarBase } from '@/lib/data/base';
import { escreverCsv } from '@/lib/data/csv';
import { Indices } from '@/lib/data/indices';
import { centavos, cnpjDigitos, nomeComparavel, numero, raizCnpj } from '@/lib/data/normalizadores';
import type { Contrato, Fornecedor, PedidoCompra } from '@/lib/data/tipos';
import { CalendarioBancario, diasEntre, somarDias } from '@/lib/clock/relogio';
import { mediana, nivelPorValor } from '@/lib/rules/auxiliares';

const RAIZ = raizProjeto();
const BASE = path.resolve(process.argv[2] ?? path.join(RAIZ, 'data', 'base'));
const SAIDA = path.join(RAIZ, 'data', 'cenarios');
const base = carregarBase(BASE);
const idx = new Indices(base);
const cal = new CalendarioBancario(base.feriados);
const pol = base.politicas;
const INICIO = pol.periodo.inicio.slice(0, 16);
// Unidade da empresa que recebe as notas e é a pagadora no DDA (tirada da própria base).
const EMPRESA = { cnpj: base.notas[0]!.cnpj_destinatario, razao: base.notas[0]!.razao_social_destinatario };

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------
const fmt = (v: number) => centavos(v).toFixed(2);
const pad = (n: number | string, l: number) => String(n).padStart(l, '0');

function mod10(campo: string): number {
  let soma = 0, peso = 2;
  for (let i = campo.length - 1; i >= 0; i--) {
    let p = Number(campo[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function mod11(num: string, pesoMax = 9): number {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso;
    peso = peso === pesoMax ? 2 : peso + 1;
  }
  const r = 11 - (soma % 11);
  return r >= 10 ? 0 : r;
}

function linhaDigitavel(banco: string, vencimento: string, valor: number, agencia: string, conta: string, nossoNumero: string): string {
  const livre = pad(agencia, 4).slice(-4) + pad(conta.replace(/\D/g, ''), 8).slice(-8) + '09' + pad(nossoNumero, 11).slice(-11);
  const c1 = banco + '9' + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  const fator = 1000 + diasEntre('2025-02-22', vencimento);
  const valorStr = pad(Math.round(valor * 100), 10);
  const dvGeral = mod11(banco + '9' + pad(fator, 4) + valorStr + livre);
  return `${c1}${mod10(c1)}${c2}${mod10(c2)}${c3}${mod10(c3)}${dvGeral || 1}${pad(fator, 4)}${valorStr}`;
}

function chaveAcesso(cnpj: string, data: string, numeroNf: number, modelo = '55'): string {
  const aamm = data.slice(2, 4) + data.slice(5, 7);
  const sem = '23' + aamm + cnpjDigitos(cnpj) + modelo + '001' + pad(numeroNf, 9) + '1' + pad(numeroNf * 7919 % 1e8, 8);
  return sem + mod11(sem);
}

function cnpjFilial(cnpjMatriz: string, filial: number): string {
  const base12 = raizCnpj(cnpjMatriz) + pad(filial, 4);
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((a, c, i) => a + Number(c) * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  const d2 = dv(base12 + d1);
  const n = base12 + d1 + d2;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
}

// ---------------------------------------------------------------------------
// Escolha de entidades (por critério, nunca por ID)
// ---------------------------------------------------------------------------
const usados = new Set<string>();

function historico(f: Fornecedor): number[] {
  return (idx.titulosPorRaiz.get(raizCnpj(f.cnpj)) ?? []).filter((t) => t.status === 'pago').map((t) => numero(t.valor) ?? 0);
}

function semTrocaRecente(f: Fornecedor): boolean {
  return !(idx.alteracoesPorFornecedor.get(f.fornecedor_id) ?? []).some((a) => diasEntre(a.data_hora, INICIO) < 90);
}

function ocsDoFornecedor(f: Fornecedor): PedidoCompra[] {
  return base.pedidos.filter((o) => raizCnpj(o.cnpj_fornecedor) === raizCnpj(f.cnpj));
}

function escolherFornecedor(criterio: { categorias: string[]; forma?: string; valorMax?: number; medianaMax?: number; comContrato?: boolean }): Fornecedor {
  const cands = base.fornecedores
    .filter((f) => criterio.categorias.includes(f.categoria) && !usados.has(f.fornecedor_id))
    .filter((f) => !criterio.forma || f.forma_pagamento_padrao === criterio.forma)
    .filter((f) => !criterio.comContrato || !!f.contrato_id)
    .filter(semTrocaRecente)
    .filter((f) => /ativo/i.test(f.status_cadastro || 'ativo'))
    .filter((f) => ocsDoFornecedor(f).length > 0)
    .filter((f) => {
      const h = historico(f);
      if (h.length < 3) return false;
      const m = mediana(h)!;
      if (criterio.valorMax && m * 5 < criterio.valorMax) return false;
      if (criterio.medianaMax && m > criterio.medianaMax) return false;
      return true;
    })
    .sort((a, b) => a.fornecedor_id.localeCompare(b.fornecedor_id));
  const f = cands[0];
  if (!f) throw new Error(`Nenhum fornecedor atende ao critério ${JSON.stringify(criterio)}`);
  usados.add(f.fornecedor_id);
  return f;
}

const analistas = base.usuarios
  .filter((u) => u.perfil === 'analista_cp' && /ativo/i.test(u.status) && !u.data_desligamento)
  .sort((a, b) => a.data_admissao.localeCompare(b.data_admissao));
const LANCADOR = analistas[0]!.login;
const DESLIGADO = base.usuarios.find((u) => u.perfil === 'analista_cp' && u.data_desligamento)!;

// Lotes abertos no período: o segundo dia útil do período, nos dois bancos.
const dia1 = cal.proximoDiaUtil(somarDias(INICIO.slice(0, 10), 1));
const dia2 = cal.proximoDiaUtil(somarDias(dia1, 1));
const loteDe = (banco: string, dia: string) => {
  const l = base.lotes.find((x) => x.banco_pagador === banco && x.data_pagamento === dia);
  if (!l) throw new Error(`Lote não encontrado: ${banco} ${dia}`);
  return l;
};
const MER = pol.bancos.find((b) => b.codigo === '612') ?? pol.bancos[0]!;
const LIT = pol.bancos.find((b) => b !== MER)!;

// ---------------------------------------------------------------------------
// Fábrica de linhas
// ---------------------------------------------------------------------------
type Linhas = Record<string, Record<string, string>[]>;
let seq = 0;
const novoNum = () => ++seq;

function novaOc(f: Fornecedor, valor: number, opts: Partial<{ status: string; tipo: string; descricao: string }> = {}) {
  const modelo = ocsDoFornecedor(f).at(-1)!;
  const n = novoNum();
  return {
    ...modelo,
    oc_id: `OC-9${pad(n, 4)}`,
    data_emissao: '2026-10-05',
    descricao: opts.descricao ?? `Pedido de teste do cenário (${modelo.descricao})`,
    tipo: opts.tipo ?? 'pontual',
    valor_total: fmt(valor),
    valor_mensal: '',
    data_aprovacao: '2026-10-06',
    status: opts.status ?? 'aprovada',
    quantidade: '1000',
    valor_unitario: (valor / 1000).toFixed(4),
  } as Record<string, string>;
}

function novaNf(cnpjEmitente: string, razao: string, valor: number, oc: string, dups: { venc: string; valor: number }[], numeroNf?: number) {
  const num = numeroNf ?? 900000 + novoNum();
  const chave = chaveAcesso(cnpjEmitente, '2026-10-20', num);
  const nf = {
    chave_acesso: chave, modelo: '55', numero_nf: String(num), serie: '1', cnpj_emitente: cnpjDigitos(cnpjEmitente),
    razao_social_emitente: razao, data_emissao: '2026-10-20', valor_total: fmt(valor), oc_informada: oc,
    informacoes_complementares: `Pedido do cliente: ${oc}`, data_recebimento_portal: '2026-10-20 18:00:00',
    cnpj_destinatario: EMPRESA.cnpj, razao_social_destinatario: EMPRESA.razao,
    natureza_operacao: 'Venda de produção do estabelecimento', cfop: '6101', valor_produtos_servicos: fmt(valor),
    valor_ipi: '0.00', valor_icms: '0.00', valor_iss: '0.00', situacao_sefaz: 'autorizada',
    manifestacao_destinatario: 'confirmação da operação', data_manifestacao: '2026-10-21 10:00:00',
  };
  const duplicatas = dups.map((d, i) => ({ chave_acesso: chave, n_dup: pad(i + 1, 3), vencimento: d.venc, valor: fmt(d.valor) }));
  return { nf, duplicatas, num };
}

function novoRecebimento(nf: Record<string, string>, oc: string) {
  return {
    recebimento_id: `RC9${pad(novoNum(), 5)}`, data_hora_recebimento: '2026-10-22 10:00:00', local_recebimento: 'CD1 - Maracanaú/CE',
    cnpj_destinatario: nf.cnpj_destinatario!, chave_acesso: nf.chave_acesso!, numero_nf: nf.numero_nf!, cnpj_emitente: nf.cnpj_emitente!,
    oc_id: oc, descricao_item: 'Item do cenário', quantidade_recebida: '1000', unidade: 'un', volumes: '10',
    conferente: base.usuarios.find((u) => u.perfil === 'conferente')?.login ?? '', situacao: 'conferido', observacao: '',
    entrada_estoque: '2026-10-22 14:00:00',
  };
}

interface OpTitulo {
  f: Fornecedor; nfDigitado: string; oc: string; parcela: string; valor: number; vencimento: string;
  forma: 'ted' | 'pix' | 'boleto'; linha?: string; cnpjBenef?: string; origem?: string; lancadoPor?: string;
  lancamento: string; banco: typeof MER; dia: string; historico: string;
}

function novoTitulo(o: OpTitulo) {
  const id = `TP9${pad(novoNum(), 5)}`;
  const lote = loteDe(o.banco.nome, o.dia);
  const titulo = {
    titulo_id: id, fornecedor_id: o.f.fornecedor_id, numero_nf_digitado: o.nfDigitado, oc_id: o.oc, parcela: o.parcela,
    valor: fmt(o.valor), vencimento: o.vencimento, forma_pagamento: o.forma, linha_digitavel: o.linha ?? '',
    cnpj_beneficiario_boleto: o.cnpjBenef ?? '', origem_lancamento: o.origem ?? 'xml_portal', lancado_por: o.lancadoPor ?? LANCADOR,
    data_lancamento: o.lancamento, status: 'agendado', data_pagamento: '', banco_pagador: o.banco.nome, lote_remessa: lote.lote_remessa,
    historico: o.historico, nivel_aprovacao: nivelPorValor(o.valor, pol),
  };
  const destino =
    o.forma === 'boleto' ? `boleto banco ${o.linha!.slice(0, 3)}` :
    o.forma === 'pix' ? `pix ${o.f.chave_pix}` : `ted ${o.f.banco}/${o.f.agencia}/${o.f.conta}`;
  const agenda = {
    lote_remessa: lote.lote_remessa, banco_pagador: o.banco.nome, data_prevista: o.dia, horario_fechamento: lote.horario_fechamento,
    titulo_id: id, fornecedor_id: o.f.fornecedor_id, valor: fmt(o.valor), vencimento: o.vencimento, forma_pagamento: o.forma,
    destino_pagamento: destino,
  };
  return { id, titulo, agenda };
}

function novoBoletoDda(f: Fornecedor, banco: string, valor: number, venc: string, documento: string, benef?: { nome: string; cnpj: string }) {
  const linha = linhaDigitavel(banco, venc, valor, f.agencia || '1234', f.conta || '1234567', String(900000 + novoNum()));
  const dda = {
    dda_id: `DDA99${pad(novoNum(), 5)}`, data_registro: '2026-10-21 03:00:00', cnpj_pagador: EMPRESA.cnpj, banco_cobrador: banco,
    nome_banco_cobrador: '', beneficiario: benef?.nome ?? f.razao_social, cnpj_beneficiario: benef?.cnpj ?? f.cnpj,
    numero_documento: documento, nosso_numero: linha.slice(20, 31), valor: fmt(valor), vencimento: venc, linha_digitavel: linha,
    situacao: 'em aberto', data_situacao: '2026-10-21',
  };
  return { linha, dda };
}

/** Valor com centavos "estranhos" e único entre os títulos do fornecedor. */
function valorUnico(f: Fornecedor, aprox: number): number {
  const existentes = new Set(historico(f).map((v) => fmt(v)));
  let v = centavos(aprox + 0.37);
  while (existentes.has(fmt(v))) v = centavos(v + 1.11);
  return v;
}

// ---------------------------------------------------------------------------
// Cenários
// ---------------------------------------------------------------------------
interface Esperado {
  cenario_id: string; descricao: string; hora_avaliacao: string; titulo_id: string;
  regras_esperadas: string; destino_esperado: string; notificar_esperado: string;
  /** Desvios que só alertam (não retiram) e quem é avisado por eles. */
  alertas_esperados: string; avisar_esperado: string;
  /** Contrato e competência (cenários de contrato; sem título = verificação na competência). */
  contrato_id: string; competencia: string;
  /** "conforme_contrato" quando o título deve sair com o selo; aprovador exigido (ex.: diretoria). */
  selo: string; aprovador_esperado: string;
  /** Veredito do agente de validação sobre este título (devolver, manter ou retirar). */
  validacao_esperada: string;
}
const ESPERADO_VAZIO = { alertas_esperados: '', avisar_esperado: '', contrato_id: '', competencia: '', selo: '', aprovador_esperado: '', validacao_esperada: '' };
const cenarios: { id: string; linhas: Linhas; esperados: Esperado[] }[] = [];

type EsperadoParcial = Omit<Esperado, 'cenario_id' | 'descricao' | 'hora_avaliacao' | keyof typeof ESPERADO_VAZIO> & Partial<typeof ESPERADO_VAZIO>;

function cenario(id: string, descricao: string, montar: (add: (arquivo: string, ...l: Record<string, string>[]) => void, esp: (e: EsperadoParcial) => void) => void) {
  const linhas: Linhas = {};
  const esperados: Esperado[] = [];
  montar(
    (arquivo, ...l) => (linhas[arquivo] = [...(linhas[arquivo] ?? []), ...l]),
    (e) => esperados.push({ cenario_id: id, descricao, hora_avaliacao: INICIO, ...ESPERADO_VAZIO, ...e }),
  );
  cenarios.push({ id, linhas, esperados });
}

const VENC = dia2; // vencimento = dia do lote → sem atraso, sem antecipação
const LANC = '2026-10-29 10:00:00';
const mercadoria = ['produto', 'embalagens', 'insumos_capa'];

/** Título "padrão" por TED com OC + NF + duplicata única + recebimento (se mercadoria). */
function pacoteTed(add: (a: string, ...l: Record<string, string>[]) => void, f: Fornecedor, valor: number, extra: Partial<OpTitulo> & { valorNf?: number; valorOc?: number; cnpjNf?: string; razaoNf?: string } = {}) {
  const oc = novaOc(f, extra.valorOc ?? extra.valorNf ?? valor);
  const nf = novaNf(extra.cnpjNf ?? f.cnpj, extra.razaoNf ?? nomeComparavel(f.razao_social), extra.valorNf ?? valor, oc.oc_id!, [{ venc: VENC, valor: extra.valorNf ?? valor }]);
  add('pedidos_compra.csv', oc);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  if (mercadoria.includes(f.categoria)) add('recebimentos_mercadoria.csv', novoRecebimento(nf.nf, oc.oc_id!));
  const t = novoTitulo({
    f, nfDigitado: String(nf.num), oc: oc.oc_id!, parcela: '1/1', valor, vencimento: VENC, forma: 'ted', lancamento: LANC,
    banco: MER, dia: dia2, historico: `NF ${nf.num} parc 1/1 - ${f.nome_fantasia}`, ...extra,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  return { t, nf, oc };
}

// C01 · Duplicidade com NF digitada de dois jeitos
cenario('C01', 'Mesmo título lançado duas vezes, NF digitada com zeros à esquerda e com série', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['servicos', 'marketing_agencia', 'embalagens'], forma: 'ted', valorMax: 4000 });
  const valor = valorUnico(f, 3850);
  const orig = pacoteTed(add, f, valor);
  const num = orig.nf.num;
  // o original foi digitado com zeros à esquerda; a cópia, com a série
  orig.t.titulo.numero_nf_digitado = pad(num, 9);
  const copia = novoTitulo({
    f, nfDigitado: `${num}-1`, oc: orig.oc.oc_id!, parcela: '1/1', valor, vencimento: VENC, forma: 'ted', lancamento: '2026-10-30 15:20:00',
    banco: MER, dia: dia2, historico: `NF ${num}-1 parc 1/1 - ${f.nome_fantasia}`,
  });
  add('contas_a_pagar.csv', copia.titulo);
  add('agenda_remessa.csv', copia.agenda);
  esp({ titulo_id: orig.t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '' });
  esp({ titulo_id: copia.id, regras_esperadas: 'R01', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01' });
});

// C02 · Zero a mais
cenario('C02', 'Título com um zero a mais (10× a duplicata da NF)', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['embalagens', 'insumos_capa'], forma: 'ted', medianaMax: 9000, valorMax: 4800 });
  const certo = valorUnico(f, 4800);
  const { t } = pacoteTed(add, f, centavos(certo * 10), { valorNf: certo, valorOc: certo });
  esp({ titulo_id: t.id, regras_esperadas: 'R03 R11', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01' });
});

// C03 · Já pago por PIX manual no Litoral
cenario('C03', 'Título já pago por PIX manual (extrato do Litoral) e ainda agendado', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['influenciador'], forma: 'pix', valorMax: 4500 });
  const valor = valorUnico(f, 4350);
  const { t } = pacoteTed(add, f, valor, { forma: 'pix', banco: LIT });
  const nomeBanco = nomeComparavel(f.razao_social).slice(0, 18);
  add('extrato_banco_litoral.csv', {
    Data: somarDias(LANC.slice(0, 10), 1).split('-').reverse().join('/'),
    'Histórico': `PIX ENV 9${pad(novoNum(), 4)} ${nomeBanco}`,
    Docto: `99${pad(novoNum(), 4)}`,
    'Valor (R$)': '-' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
    'Saldo (R$)': '1.000.000,00',
  });
  esp({ titulo_id: t.id, regras_esperadas: 'R02', destino_esperado: 'RETIRADO', notificar_esperado: 'PS02' });
});

// C04 · Boleto de segunda via com beneficiário de outro CNPJ e banco fora do histórico
cenario('C04', 'Boleto de segunda via com beneficiário de outro CNPJ e banco diferente do histórico', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['embalagens', 'insumos_capa', 'produto'], forma: 'boleto', valorMax: 4000 });
  const valor = valorUnico(f, 3920);
  const historicos = idx.bancosDeCobrancaHistoricos(raizCnpj(f.cnpj));
  const bancoGolpe = ['905', '774', '146', '551', '368', '289', '823'].find((b) => !historicos.has(b) && b !== f.banco)!;
  const golpista = { nome: 'Soluções Financeiras Express Ltda', cnpj: cnpjFilial('19.876.543/0001-00', 1) };
  const oc = novaOc(f, valor);
  const nf = novaNf(f.cnpj, nomeComparavel(f.razao_social), valor, oc.oc_id!, [{ venc: VENC, valor }]);
  const bol = novoBoletoDda(f, bancoGolpe, valor, VENC, `${nf.num}/1`, golpista);
  add('pedidos_compra.csv', oc);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  if (mercadoria.includes(f.categoria)) add('recebimentos_mercadoria.csv', novoRecebimento(nf.nf, oc.oc_id!));
  add('dda_boletos.csv', bol.dda);
  const t = novoTitulo({
    f, nfDigitado: String(nf.num), oc: oc.oc_id!, parcela: '1/1', valor, vencimento: VENC, forma: 'boleto', linha: bol.linha,
    cnpjBenef: golpista.cnpj, origem: 'boleto_email', lancamento: LANC, banco: MER, dia: dia2,
    historico: `NF ${nf.num} parc 1/1 - ${f.nome_fantasia}`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  add('comunicacoes_fornecedores.csv', {
    comunicacao_id: `EM99${pad(novoNum(), 4)}`, data_hora: '2026-10-28 16:42:00', canal: 'email',
    remetente: `financeiro@${nomeComparavel(f.nome_fantasia).toLowerCase().replace(/ /g, '')}-cobranca.com`,
    nome_remetente: `Financeiro - ${f.nome_fantasia}`, destinatario: 'contasapagar@gogroup.com.br',
    assunto: `Segunda via atualizada - NF ${nf.num}`,
    texto: `Prezados, houve atualização no nosso banco de cobrança. Favor desconsiderar o boleto anterior e pagar a segunda via em anexo. Att.`,
    anexos: `boleto_2via_NF${nf.num}.pdf (banco ${bancoGolpe}, beneficiário ${golpista.nome}, CNPJ ${golpista.cnpj}, valor R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, vencimento ${VENC.split('-').reverse().join('/')}, linha digitável ${bol.linha})`,
  });
  esp({ titulo_id: t.id, regras_esperadas: 'R06 R14', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01 PS08' });
});

// C08 · NF 4% acima da OC de embalagem
cenario('C08', 'NF 4% acima da OC de embalagem', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['embalagens'], forma: 'ted', valorMax: 10500 });
  const oc = valorUnico(f, 10000);
  const nf = centavos(oc * 1.04);
  const { t } = pacoteTed(add, f, nf, { valorNf: nf, valorOc: oc });
  esp({ titulo_id: t.id, regras_esperadas: 'R04', destino_esperado: 'RETIRADO', notificar_esperado: 'PS04' });
});

// C09 · NF 1,5% acima da OC (dentro da tolerância)
cenario('C09', 'NF 1,5% acima da OC (dentro da tolerância)', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['embalagens', 'insumos_capa'], forma: 'ted', valorMax: 4200 });
  const oc = valorUnico(f, 4000);
  const nf = centavos(oc * 1.015);
  const { t } = pacoteTed(add, f, nf, { valorNf: nf, valorOc: oc });
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '' });
});

// C10 · Pago com 10 dias de atraso, multa e juros dentro do teto
cenario('C10', 'Título pago com 10 dias de atraso, com multa e juros dentro do teto', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['servicos', 'marketing_agencia', 'insumos_capa', 'embalagens'], forma: 'ted', valorMax: 3100 });
  const dup = valorUnico(f, 3000);
  const vencDup = somarDias(dia2, -10);
  const valor = centavos(dup * (1 + pol.atraso.multa + pol.atraso.jurosMes * (10 / 30)));
  const oc = novaOc(f, dup);
  const nf = novaNf(f.cnpj, nomeComparavel(f.razao_social), dup, oc.oc_id!, [{ venc: vencDup, valor: dup }]);
  add('pedidos_compra.csv', oc);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  if (mercadoria.includes(f.categoria)) add('recebimentos_mercadoria.csv', novoRecebimento(nf.nf, oc.oc_id!));
  const t = novoTitulo({
    f, nfDigitado: String(nf.num), oc: oc.oc_id!, parcela: '1/1', valor, vencimento: vencDup, forma: 'ted', lancamento: LANC,
    banco: MER, dia: dia2, historico: `NF ${nf.num} parc 1/1 - ${f.nome_fantasia} (com encargos)`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '' });
});

// C11 · Fracionamento: três títulos de R$ 4.900 da mesma NF no mesmo dia
cenario('C11', 'Três títulos de R$ 4.900 do mesmo fornecedor e NF no mesmo dia', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['servicos', 'insumos_capa', 'embalagens', 'produto'], forma: 'ted', valorMax: 4900 });
  const parcelaValor = 4900;
  const oc = novaOc(f, parcelaValor * 3);
  const nf = novaNf(f.cnpj, nomeComparavel(f.razao_social), parcelaValor * 3, oc.oc_id!, [1, 2, 3].map(() => ({ venc: VENC, valor: parcelaValor })));
  add('pedidos_compra.csv', oc);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  if (mercadoria.includes(f.categoria)) add('recebimentos_mercadoria.csv', novoRecebimento(nf.nf, oc.oc_id!));
  for (const p of [1, 2, 3]) {
    const t = novoTitulo({
      f, nfDigitado: String(nf.num), oc: oc.oc_id!, parcela: `${p}/3`, valor: parcelaValor, vencimento: VENC, forma: 'ted',
      lancamento: `2026-10-29 1${p}:00:00`, banco: MER, dia: dia2, historico: `NF ${nf.num} parc ${p}/3 - ${f.nome_fantasia}`,
    });
    add('contas_a_pagar.csv', t.titulo);
    add('agenda_remessa.csv', t.agenda);
    esp({ titulo_id: t.id, regras_esperadas: 'R08', destino_esperado: 'AGUARDANDO_APROVACAO', notificar_esperado: 'PS01' });
  }
});

// C12 · Aluguel sem NF igual ao contrato
cenario('C12', 'Aluguel sem NF, igual ao contrato', (add, esp) => {
  const aluguelCats = pol.tresVias.dispensaNf;
  const contrato = base.contratos.find((c) => {
    const f = idx.fornecedorPorId.get(c.fornecedor_id);
    if (!f || !aluguelCats.includes(f.categoria) || usados.has(f.fornecedor_id) || !semTrocaRecente(f)) return false;
    const temTituloAberto = (idx.titulosPorRaiz.get(raizCnpj(f.cnpj)) ?? []).some((t) => t.status !== 'pago' && t.status !== 'cancelado');
    return !temTituloAberto && c.oc_id && idx.ocPorId.get(c.oc_id)?.status === 'aprovada';
  });
  if (!contrato) throw new Error('C12: nenhum contrato de aluguel disponível');
  const f = idx.fornecedorPorId.get(contrato.fornecedor_id)!;
  usados.add(f.fornecedor_id);
  const valor = numero(contrato.valor_mensal)!;
  const bancoCobranca = [...idx.bancosDeCobrancaHistoricos(raizCnpj(f.cnpj))][0] ?? f.banco;
  const bol = novoBoletoDda(f, bancoCobranca, valor, VENC, `ALUGUEL-${VENC.slice(0, 7)}`);
  add('dda_boletos.csv', bol.dda);
  const t = novoTitulo({
    f, nfDigitado: '', oc: contrato.oc_id, parcela: '1/1', valor, vencimento: VENC, forma: 'boleto', linha: bol.linha, cnpjBenef: f.cnpj,
    origem: 'manual', lancamento: LANC, banco: MER, dia: dia2, historico: `Aluguel - competência ${VENC.slice(5, 7)}/${VENC.slice(0, 4)} - ${f.nome_fantasia}`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: valor > pol.alcadas.analistaLiberarAte ? 'CONFERIDO_AGUARDANDO_APROVADOR' : 'LIBERADO_AUTOMATICO', notificar_esperado: '',
    contrato_id: contrato.contrato_id, competencia: mesDe(VENC), selo: 'conforme_contrato' });
});

// C15 · Lançado por usuário desligado
cenario('C15', 'Título lançado por usuário já desligado', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['servicos', 'embalagens', 'insumos_capa'], forma: 'ted', valorMax: 3600 });
  const valor = valorUnico(f, 3500);
  const { t } = pacoteTed(add, f, valor, { lancadoPor: DESLIGADO.login });
  esp({ titulo_id: t.id, regras_esperadas: 'R13', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01' });
});

// C16 · NF emitida pela filial (mesma raiz, outra razão social)
cenario('C16', 'Filial com outra razão social na NF, mesma raiz de CNPJ', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['produto', 'embalagens', 'insumos_capa'], forma: 'ted', valorMax: 4300 });
  const valor = valorUnico(f, 4200);
  const { t } = pacoteTed(add, f, valor, { cnpjNf: cnpjFilial(f.cnpj, 7), razaoNf: `${nomeComparavel(f.razao_social)} FILIAL SUL` });
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '' });
});

// ---------------------------------------------------------------------------
// Contratos (C18–C29): vínculo título × contrato e desvios D01–D10
// ---------------------------------------------------------------------------
const config = carregarConfig(path.join(RAIZ, 'config', 'goaudit.config.json'));
const analise = analisarContratos({ idx, cal, config, agora: INICIO, titulosAvaliados: new Set() });
const COMP = mesDe(VENC); // competência dos títulos criados (vencimento = dia do lote)
const classe = (c: Contrato) => analise.classes.get(c.contrato_id)!;
const temTituloNa = (c: Contrato, comp: string) =>
  analise.competencias.some((x) => x.contratoId === c.contrato_id && x.competencia === comp && x.qtdTitulos > 0);
const competenciaDe = (c: Contrato, venc: string) => competenciaDoVencimento(cal, Number(c.dia_vencimento), venc);

const semTrocaBancariaRecente = (f: Fornecedor) =>
  !(idx.alteracoesPorFornecedor.get(f.fornecedor_id) ?? []).some((a) => ['banco', 'agencia', 'conta', 'chave_pix'].includes(a.campo) && diasEntre(a.data_hora, INICIO) < 90);

/** Contrato real da base que atende ao critério, ainda sem título na competência do cenário. */
function escolherContrato(filtro: (c: Contrato, f: Fornecedor) => boolean, rotulo: string): { c: Contrato; f: Fornecedor } {
  const achado = base.contratos
    .map((c) => ({ c, f: idx.fornecedorPorId.get(c.fornecedor_id)! }))
    .filter(({ c, f }) => f && !usados.has(f.fornecedor_id) && semTrocaBancariaRecente(f) && /vigente/i.test(c.status))
    .filter(({ c }) => !temTituloNa(c, COMP) && (classe(c) === 'frete' || competenciaDe(c, VENC) === COMP))
    .filter(({ c, f }) => filtro(c, f))
    .sort((a, b) => a.c.contrato_id.localeCompare(b.c.contrato_id))[0];
  if (!achado) throw new Error(`${rotulo}: nenhum contrato atende ao critério`);
  usados.add(achado.f.fornecedor_id);
  return achado;
}

/** Id novo que não existe na base. */
function idLivre(prefixo: string, existe: (id: string) => boolean): string {
  for (let n = 1; ; n++) {
    const id = `${prefixo}${pad(n, 2)}`;
    if (!existe(id) && !usados.has(id)) {
      usados.add(id);
      return id;
    }
  }
}

interface OpContrato {
  categoria: string;
  tipo: string;
  nome: string;
  fantasia: string;
  valorMensal: number;
  dia: number;
  mesReajuste: string;
  ultimoReajuste: string;
  indice?: string;
  inicio?: string;
  fim?: string;
  prazo?: string;
  status?: string;
}

/**
 * Fornecedor + contrato + OC do contrato, inventados para o cenário (quando a base não tem
 * um contrato na situação pedida, ex.: reajuste em novembro). Copiam a estrutura de um
 * contrato real do mesmo tipo, inclusive o gestor.
 */
function novoContratado(add: (a: string, ...l: Record<string, string>[]) => void, o: OpContrato) {
  const modeloC = base.contratos.find((c) => c.tipo === o.tipo);
  const modeloF = base.fornecedores.find((f) => f.categoria === o.categoria && f.contrato_id);
  const modeloOc = base.pedidos.find((p) => p.tipo === 'contrato');
  if (!modeloC || !modeloF || !modeloOc) throw new Error(`Sem modelo de contrato ${o.tipo}/${o.categoria}`);
  const fid = idLivre('FP99', (id) => idx.fornecedorPorId.has(id));
  const cid = idLivre('CT-99', (id) => idx.contratoPorId.has(id));
  const cnpj = cnpjFilial(`99${pad(fid.slice(-2), 6)}000100`, 1);
  const slug = nomeComparavel(o.fantasia).toLowerCase().replace(/ /g, '');
  const f = {
    ...modeloF, fornecedor_id: fid, razao_social: o.nome, nome_fantasia: o.fantasia, cnpj, categoria: o.categoria,
    forma_pagamento_padrao: 'ted', email_cadastrado: `financeiro@${slug}.com.br`, telefone_cadastrado: `(85) 3999-00${fid.slice(-2)}`,
    chave_pix: `financeiro@${slug}.com.br`, contrato_id: cid, data_cadastro: '2024-01-15', status_cadastro: 'ativo',
    data_ultima_alteracao: '2024-01-15 10:00:00', responsavel_interno: modeloC.gestor_contrato,
  } as Fornecedor;
  const oc = {
    ...modeloOc, oc_id: `OC-9${pad(novoNum(), 4)}`, cod_fornecedor_compras: `FC99${fid.slice(-2)}`, cnpj_fornecedor: cnpjDigitos(cnpj),
    nome_fornecedor: nomeComparavel(o.nome), data_emissao: '2025-10-20', descricao: `Contrato ${o.fantasia}`, tipo: 'contrato',
    valor_total: fmt(o.valorMensal * 12), valor_mensal: fmt(o.valorMensal), condicao_pagamento: `mensal dia ${o.dia}`,
    data_aprovacao: '2025-10-21', status: 'aprovada', quantidade: '12', unidade: 'mês', valor_unitario: o.valorMensal.toFixed(4),
  } as Record<string, string>;
  const c = {
    ...modeloC, contrato_id: cid, fornecedor_id: fid, oc_id: oc.oc_id!, objeto: `${o.tipo} ${o.fantasia}`, valor_mensal: fmt(o.valorMensal),
    valor_variavel: 'não', condicao_pagamento: `mensal dia ${o.dia}`, dia_vencimento: String(o.dia), forma_pagamento: 'ted',
    inicio_vigencia: o.inicio ?? '2024-11-01', prazo: o.prazo ?? modeloC.prazo, fim_vigencia_atual: o.fim ?? '2027-10-31',
    indice_reajuste: o.indice ?? 'IPCA', mes_reajuste: o.mesReajuste, data_ultimo_reajuste: o.ultimoReajuste, status: o.status ?? 'vigente',
  } as Contrato;
  add('fornecedores.csv', f);
  add('pedidos_compra.csv', oc);
  add('contratos_fornecedores.csv', c);
  return { f, c, oc };
}

/** Título de contrato com NF (OC do contrato). `valorNf` ≠ `valor` quando há multa e juros. */
function tituloDeContrato(
  add: (a: string, ...l: Record<string, string>[]) => void, f: Fornecedor, ocId: string, valor: number,
  o: { valorNf?: number; vencimento?: string; lancamento?: string } = {},
) {
  const venc = o.vencimento ?? VENC;
  const valorNf = o.valorNf ?? valor;
  const nf = novaNf(f.cnpj, nomeComparavel(f.razao_social), valorNf, ocId, [{ venc, valor: valorNf }]);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  const t = novoTitulo({
    f, nfDigitado: String(nf.num), oc: ocId, parcela: '1/1', valor, vencimento: venc, forma: 'ted', lancamento: o.lancamento ?? LANC,
    banco: MER, dia: dia2, historico: `NF ${nf.num} parc 1/1 - ${f.nome_fantasia} - mensalidade`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  return t;
}

/** Conta de consumo (sem OC) por boleto com NF, como as da base. */
function contaDeConsumo(add: (a: string, ...l: Record<string, string>[]) => void, f: Fornecedor, valor: number) {
  const nf = novaNf(f.cnpj, nomeComparavel(f.razao_social), valor, '', [{ venc: VENC, valor }]);
  nf.nf.informacoes_complementares = `Conta de consumo ${COMP}`;
  const banco = [...idx.bancosDeCobrancaHistoricos(raizCnpj(f.cnpj))][0] ?? f.banco;
  const bol = novoBoletoDda(f, banco, valor, VENC, `${nf.num}/1`);
  add('notas_fiscais.csv', nf.nf);
  add('nf_duplicatas.csv', ...nf.duplicatas);
  add('dda_boletos.csv', bol.dda);
  const t = novoTitulo({
    f, nfDigitado: String(nf.num), oc: '', parcela: '1/1', valor, vencimento: VENC, forma: 'boleto', linha: bol.linha, cnpjBenef: f.cnpj,
    origem: 'boleto_email', lancamento: LANC, banco: MER, dia: dia2, historico: `Conta de consumo ${COMP} - ${f.nome_fantasia}`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  return t;
}

/** Média das últimas competências pagas da conta de consumo, sem desvio no histórico. */
function utilidadeEstavel(c: Contrato): number | null {
  const hist = analise.competencias.filter((x) => x.contratoId === c.contrato_id && x.competencia < COMP && x.qtdTitulos > 0);
  if (hist.length < config.contratos.utilidade.competencias_media || hist.some((x) => x.situacao !== 'conforme')) return null;
  const ult = hist.slice(-config.contratos.utilidade.competencias_media);
  return ult.reduce((s, x) => s + x.valorCobrado, 0) / ult.length;
}

const indiceIpca = (comp: string) =>
  indiceParaCompetencia(base.indicesReajuste, 'IPCA', comp, config.contratos.reajuste.defasagem_indice_meses) ?? 0;
const mesNum = COMP.slice(5, 7);

// C17 · Falso positivo que a validação devolve: troca bancária confirmada por ligação ao telefone certo,
// só que escrito sem o DDD (a operação compara dígitos crus e retira; a validação lê o telefone)
cenario('C17', 'Troca bancária confirmada por ligação ao telefone certo (sem DDD): retirada é falso positivo e a validação devolve ao lote', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['servicos', 'embalagens', 'insumos_capa'], forma: 'ted', valorMax: 3500 });
  const valor = valorUnico(f, 3400);
  const { t } = pacoteTed(add, f, valor);
  const quando = '2026-10-28 10:00:00';
  const telSemDdd = f.telefone_cadastrado.replace(/^(d{2})s*/, '');
  const confirmacao = `ligação para o telefone do cadastro ${telSemDdd} em 28/10/2026; confirmado com o gerente financeiro`;
  const troca = (campo: string, anterior: string, novo: string) => ({
    alteracao_id: `AC9${pad(novoNum(), 5)}`, data_hora: quando, fornecedor_id: f.fornecedor_id, campo, valor_anterior: anterior, valor_novo: novo,
    alterado_por: LANCADOR, origem: 'email', confirmacao_registrada: 'sim', confirmacao_como: confirmacao,
  });
  add('alteracoes_cadastro.csv', troca('banco', f.banco === '905' ? '146' : '905', f.banco), troca('agencia', '0001', f.agencia), troca('conta', '0000001-0', f.conta));
  esp({ titulo_id: t.id, regras_esperadas: 'R07 R09', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01', validacao_esperada: 'devolver' });
});

// C18 · Fee de agência cobrado duas vezes na mesma competência
cenario('C18', 'Fee de agência cobrado duas vezes na mesma competência', (add, esp) => {
  const { c, f } = escolherContrato((c, f) => f.categoria === 'marketing_agencia' && classe(c) === 'fixo' && !!c.oc_id && c.forma_pagamento === 'ted', 'C18');
  const m = numero(c.valor_mensal)!;
  const t1 = tituloDeContrato(add, f, c.oc_id, m);
  const t2 = tituloDeContrato(add, f, c.oc_id, m, { lancamento: '2026-10-30 15:20:00' });
  const destino = m > pol.alcadas.analistaLiberarAte ? 'CONFERIDO_AGUARDANDO_APROVADOR' : 'LIBERADO_AUTOMATICO';
  esp({ titulo_id: t1.id, regras_esperadas: '', destino_esperado: destino, notificar_esperado: '', contrato_id: c.contrato_id, competencia: COMP, selo: 'conforme_contrato' });
  esp({ titulo_id: t2.id, regras_esperadas: 'D03', destino_esperado: 'RETIRADO', notificar_esperado: 'PS01', contrato_id: c.contrato_id, competencia: COMP });
});

// C19 · Aluguel 18% acima, fora do mês de reajuste
cenario('C19', 'Aluguel 18% acima do contrato fora do mês de reajuste', (add, esp) => {
  const { c, f } = escolherContrato(
    (c, f) => pol.tresVias.dispensaNf.includes(f.categoria) && !!c.oc_id && c.forma_pagamento === 'boleto' && c.mes_reajuste !== mesNum,
    'C19',
  );
  const valor = centavos(numero(c.valor_mensal)! * 1.18);
  const banco = [...idx.bancosDeCobrancaHistoricos(raizCnpj(f.cnpj))][0] ?? f.banco;
  const bol = novoBoletoDda(f, banco, valor, VENC, `ALUGUEL-${COMP}`);
  add('dda_boletos.csv', bol.dda);
  const t = novoTitulo({
    f, nfDigitado: '', oc: c.oc_id, parcela: '1/1', valor, vencimento: VENC, forma: 'boleto', linha: bol.linha, cnpjBenef: f.cnpj,
    origem: 'manual', lancamento: LANC, banco: MER, dia: dia2, historico: `Aluguel - competência ${COMP} - ${f.nome_fantasia}`,
  });
  add('contas_a_pagar.csv', t.titulo);
  add('agenda_remessa.csv', t.agenda);
  esp({ titulo_id: t.id, regras_esperadas: 'D01', destino_esperado: 'RETIRADO', notificar_esperado: `${c.gestor_pessoa_id} PS01`, contrato_id: c.contrato_id, competencia: COMP });
});

// C20 · Assinatura reajustada no mês certo, dentro do IPCA
cenario('C20', 'Assinatura reajustada no mês certo, dentro do IPCA', (add, esp) => {
  const m = 2400;
  const { f, c, oc } = novoContratado(add, {
    categoria: 'ti_saas', tipo: 'assinatura de software', nome: 'Nuvem Serena Software Ltda', fantasia: 'Nuvem Serena', valorMensal: m,
    dia: Number(VENC.slice(8, 10)), mesReajuste: mesNum, ultimoReajuste: `${Number(COMP.slice(0, 4)) - 1}-${mesNum}-01`,
  });
  const valor = centavos(m * (1 + indiceIpca(COMP)));
  const t = tituloDeContrato(add, f, oc.oc_id!, valor);
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: valor > pol.alcadas.analistaLiberarAte ? 'CONFERIDO_AGUARDANDO_APROVADOR' : 'LIBERADO_AUTOMATICO', notificar_esperado: '', contrato_id: c.contrato_id, competencia: COMP, selo: 'conforme_contrato' });
});

// C21 · Serviço reajustado no mês certo, 12 pontos acima do índice
cenario('C21', 'Serviço reajustado no mês certo, 12% acima do índice', (add, esp) => {
  const m = 3200;
  const { f, c, oc } = novoContratado(add, {
    categoria: 'servicos', tipo: 'prestação de serviço contínuo', nome: 'Zeladoria Horizonte Serviços Ltda', fantasia: 'Zeladoria Horizonte',
    valorMensal: m, dia: Number(VENC.slice(8, 10)), mesReajuste: mesNum, ultimoReajuste: `${Number(COMP.slice(0, 4)) - 1}-${mesNum}-01`,
  });
  const valor = centavos(m * (1 + indiceIpca(COMP) + 0.12));
  const t = tituloDeContrato(add, f, oc.oc_id!, valor);
  esp({ titulo_id: t.id, regras_esperadas: 'D05', destino_esperado: 'RETIRADO', notificar_esperado: c.gestor_pessoa_id, contrato_id: c.contrato_id, competencia: COMP });
});

// C22 · Conta de consumo 10 vezes menor que a média (erro de digitação)
cenario('C22', 'Conta de consumo 10 vezes menor que a média', (add, esp) => {
  const { c, f } = escolherContrato((c) => classe(c) === 'utilidade' && c.forma_pagamento === 'boleto' && utilidadeEstavel(c) != null, 'C22');
  const t = contaDeConsumo(add, f, centavos(utilidadeEstavel(c)! / 10));
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '', alertas_esperados: 'D02', avisar_esperado: 'PS01', contrato_id: c.contrato_id, competencia: COMP });
});

// C23 · Conta de consumo 60% acima da média
cenario('C23', 'Conta de consumo 60% acima da média', (add, esp) => {
  const { c, f } = escolherContrato((c) => classe(c) === 'utilidade' && c.forma_pagamento === 'boleto' && utilidadeEstavel(c) != null, 'C23');
  const valor = centavos(utilidadeEstavel(c)! * 1.6);
  const t = contaDeConsumo(add, f, valor);
  esp({
    titulo_id: t.id, regras_esperadas: '', destino_esperado: valor > pol.alcadas.analistaLiberarAte ? 'CONFERIDO_AGUARDANDO_APROVADOR' : 'LIBERADO_AUTOMATICO',
    notificar_esperado: '', alertas_esperados: 'D09', avisar_esperado: c.gestor_pessoa_id, contrato_id: c.contrato_id, competencia: COMP,
  });
});

// C24 · Assinatura sem título a 5 dias úteis do vencimento
cenario('C24', 'Assinatura sem título a 5 dias úteis do vencimento', (add, esp) => {
  // Primeiro dia de vencimento depois do lote cujo gatilho (5 dias úteis antes) já passou no início da simulação.
  const hoje = INICIO.slice(0, 10);
  let dia = Number(VENC.slice(8, 10)) + 1;
  while (diasUteisAntes(cal, vencimentoNominal(cal, dia, COMP), config.contratos.alerta_sem_titulo_dias_uteis) > hoje) dia--;
  const { c } = novoContratado(add, {
    categoria: 'ti_saas', tipo: 'assinatura de software', nome: 'Painel Vivo Tecnologia Ltda', fantasia: 'Painel Vivo', valorMensal: 1890,
    dia, mesReajuste: '03', ultimoReajuste: `${COMP.slice(0, 4)}-03-01`,
  });
  esp({ titulo_id: '', regras_esperadas: '', destino_esperado: '', notificar_esperado: '', alertas_esperados: 'D04', avisar_esperado: c.gestor_pessoa_id, contrato_id: c.contrato_id, competencia: COMP });
});

// C25 · Cobrança de contrato com vigência encerrada
cenario('C25', 'Cobrança de contrato com vigência encerrada', (add, esp) => {
  const { f, c, oc } = novoContratado(add, {
    categoria: 'servicos', tipo: 'prestação de serviço contínuo', nome: 'Jardim Pleno Paisagismo Ltda', fantasia: 'Jardim Pleno',
    valorMensal: 2750, dia: Number(VENC.slice(8, 10)), mesReajuste: '03', ultimoReajuste: '2025-03-01',
    inicio: '2024-10-01', fim: '2026-09-30', prazo: '24 meses', status: 'encerrado',
  });
  const t = tituloDeContrato(add, f, oc.oc_id!, 2750);
  esp({ titulo_id: t.id, regras_esperadas: 'D06', destino_esperado: 'RETIRADO', notificar_esperado: `${c.gestor_pessoa_id} PS01`, contrato_id: c.contrato_id, competencia: COMP });
});

// C26 · Campanha de agência em OC pontual aprovada (não é do fee)
cenario('C26', 'Campanha de agência em OC pontual aprovada', (add, esp) => {
  const f = escolherFornecedor({ categorias: ['marketing_agencia'], forma: 'ted', valorMax: 3900, comContrato: true });
  const valor = valorUnico(f, 3700);
  const { t } = pacoteTed(add, f, valor);
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '' });
});

// C27 · Frete de outubro ~55% acima da estimativa: dentro da faixa sazonal (dado real da base)
cenario('C27', 'Frete de outubro cerca de 55% acima da estimativa', (_add, esp) => {
  const outubro = analise.competencias
    .filter((x) => x.classe === 'frete' && x.competencia.endsWith('-10') && x.valorEsperado)
    .sort((a, b) => Math.abs(a.valorCobrado / a.valorEsperado! - 1.55) - Math.abs(b.valorCobrado / b.valorEsperado! - 1.55))[0];
  if (!outubro) throw new Error('C27: nenhum frete com competência de outubro');
  esp({ titulo_id: '', regras_esperadas: '', destino_esperado: '', notificar_esperado: '', contrato_id: outubro.contratoId, competencia: outubro.competencia });
});

// C28 · Mensalidade paga 9 dias atrasada com 2,3% a mais (multa 2% + juros 1% a.m. pro rata)
cenario('C28', 'Mensalidade paga 9 dias atrasada com 2,3% a mais', (add, esp) => {
  const vencAtrasado = somarDias(VENC, -9);
  const m = 3100;
  const { f, c, oc } = novoContratado(add, {
    categoria: 'ti_saas', tipo: 'assinatura de software', nome: 'Rota Clara Sistemas Ltda', fantasia: 'Rota Clara', valorMensal: m,
    dia: Number(vencAtrasado.slice(8, 10)), mesReajuste: '03', ultimoReajuste: `${COMP.slice(0, 4)}-03-01`,
  });
  const valor = centavos(m * (1 + pol.atraso.multa + pol.atraso.jurosMes * (9 / 30)));
  const t = tituloDeContrato(add, f, oc.oc_id!, valor, { valorNf: m, vencimento: vencAtrasado });
  esp({ titulo_id: t.id, regras_esperadas: '', destino_esperado: 'LIBERADO_AUTOMATICO', notificar_esperado: '', contrato_id: c.contrato_id, competencia: mesDe(vencAtrasado), selo: 'conforme_contrato' });
});

// C29 · Aluguel acima de R$ 50 mil no valor exato: conforme contrato, aguarda a diretoria (dado real da base)
cenario('C29', 'Aluguel acima de R$ 50 mil no valor exato do contrato', (_add, esp) => {
  const alvo = base.agenda
    .map((a) => ({ a, v: analise.vinculos.get(a.titulo_id) }))
    .filter(({ a, v }) => v?.contratoId && v.confianca === 'alta' && pol.tresVias.dispensaNf.includes(idx.fornecedorPorId.get(a.fornecedor_id)?.categoria ?? ''))
    .filter(({ a, v }) => {
      const c = idx.contratoPorId.get(v!.contratoId!)!;
      return numero(a.valor)! > pol.alcadas.aprovadorAte && centavos(numero(a.valor)!) === centavos(numero(c.valor_mensal)!) && a.data_prevista >= dia1;
    })
    .sort((x, y) => x.a.titulo_id.localeCompare(y.a.titulo_id))[0];
  if (!alvo) throw new Error('C29: nenhum aluguel acima da alçada do aprovador na agenda');
  esp({
    titulo_id: alvo.a.titulo_id, regras_esperadas: '', destino_esperado: 'CONFERIDO_AGUARDANDO_APROVADOR', notificar_esperado: '',
    contrato_id: alvo.v!.contratoId!, competencia: alvo.v!.competencia!, selo: 'conforme_contrato', aprovador_esperado: pol.alcadas.diretoriaPessoaId,
  });
});

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------
fs.rmSync(SAIDA, { recursive: true, force: true });
for (const c of cenarios) {
  for (const [arquivo, linhas] of Object.entries(c.linhas)) {
    if (linhas.length === 0) continue;
    const delim = arquivo === 'extrato_banco_litoral.csv' ? ';' : ',';
    escreverCsv(path.join(SAIDA, c.id, arquivo), linhas, undefined, delim);
  }
}
escreverCsv(path.join(SAIDA, 'cenarios_esperados.csv'), cenarios.flatMap((c) => c.esperados) as unknown as Record<string, string>[]);
console.log(`Cenários gerados em ${SAIDA}:`);
for (const c of cenarios) console.log(`  ${c.id}: ${c.esperados.map((e) => `${e.titulo_id}→${e.destino_esperado}`).join(', ')}`);
