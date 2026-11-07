import fs from 'node:fs';
import path from 'node:path';
import { lerCsv, lerJsonl } from './csv';
import type {
  AgendaItem, AlteracaoCadastro, AprovacaoErp, BoletoDDA, Comunicacao, Contrato, Duplicata,
  ExtratoLitoral, ExtratoMeridiano, Feriado, Fornecedor, Lote, NotaFiscal, PedidoCompra,
  Recebimento, RetornoRemessa, Titulo, Usuario,
} from './tipos';
import { carregarPoliticas, type Politicas } from '@/lib/config/politicas';
import { dataBRparaISO } from './normalizadores';
import { paraMs, type HoraSimulada } from '@/lib/clock/relogio';

/** Toda a base de entrada, como está nos arquivos. Nunca é alterada. */
export interface BaseEntrada {
  dir: string;
  politicas: Politicas;
  fornecedores: Fornecedor[];
  alteracoes: AlteracaoCadastro[];
  pedidos: PedidoCompra[];
  contratos: Contrato[];
  notas: NotaFiscal[];
  duplicatas: Duplicata[];
  titulos: Titulo[];
  agenda: AgendaItem[];
  lotes: Lote[];
  recebimentos: Recebimento[];
  dda: BoletoDDA[];
  extratoMeridiano: ExtratoMeridiano[];
  extratoLitoral: ExtratoLitoral[];
  retorno: RetornoRemessa[];
  comunicacoes: Comunicacao[];
  usuarios: Usuario[];
  aprovacoesErp: AprovacaoErp[];
  feriados: Feriado[];
}

function arquivo(dir: string, nome: string): string {
  return path.join(dir, nome);
}

function opcional<T extends Record<string, string>>(dir: string, nome: string, delim = ','): T[] {
  const f = arquivo(dir, nome);
  return fs.existsSync(f) ? lerCsv<T>(f, delim) : [];
}

/** Comunicações: o dicionário fala em .jsonl, mas a base veio em .csv. Aceita os dois. */
function lerComunicacoes(dir: string): Comunicacao[] {
  const jsonl = arquivo(dir, 'comunicacoes_fornecedores.jsonl');
  const out: Comunicacao[] = [];
  if (fs.existsSync(jsonl)) out.push(...lerJsonl<Comunicacao>(jsonl));
  out.push(...opcional<Comunicacao>(dir, 'comunicacoes_fornecedores.csv'));
  return out;
}

export function carregarBase(dir: string): BaseEntrada {
  if (!fs.existsSync(dir)) throw new Error(`Pasta da base não encontrada: ${dir}`);
  const req = <T extends Record<string, string>>(nome: string, delim = ',') => lerCsv<T>(arquivo(dir, nome), delim);
  return {
    dir,
    politicas: carregarPoliticas(dir),
    fornecedores: req<Fornecedor>('fornecedores.csv'),
    alteracoes: opcional<AlteracaoCadastro>(dir, 'alteracoes_cadastro.csv'),
    pedidos: req<PedidoCompra>('pedidos_compra.csv'),
    contratos: opcional<Contrato>(dir, 'contratos_fornecedores.csv'),
    notas: req<NotaFiscal>('notas_fiscais.csv'),
    duplicatas: req<Duplicata>('nf_duplicatas.csv'),
    titulos: req<Titulo>('contas_a_pagar.csv'),
    agenda: req<AgendaItem>('agenda_remessa.csv'),
    lotes: opcional<Lote>(dir, 'lotes_remessa.csv'),
    recebimentos: opcional<Recebimento>(dir, 'recebimentos_mercadoria.csv'),
    dda: opcional<BoletoDDA>(dir, 'dda_boletos.csv'),
    extratoMeridiano: opcional<ExtratoMeridiano>(dir, 'extrato_banco_meridiano.csv'),
    extratoLitoral: opcional<ExtratoLitoral>(dir, 'extrato_banco_litoral.csv', ';'),
    retorno: opcional<RetornoRemessa>(dir, 'retorno_remessa.csv'),
    comunicacoes: lerComunicacoes(dir),
    usuarios: opcional<Usuario>(dir, 'usuarios_sistema.csv'),
    aprovacoesErp: opcional<AprovacaoErp>(dir, 'aprovacoes.csv'),
    feriados: opcional<Feriado>(dir, 'feriados_bancarios.csv'),
  };
}

/**
 * O que "já chegou" até a hora simulada. Cada arquivo tem o seu carimbo de tempo;
 * linhas sem carimbo (cadastros, OCs, contratos) entram sempre.
 * Extratos só têm data: a linha fica visível a partir de `horaExtrato` daquele dia.
 */
export function recortarAte(base: BaseEntrada, agora: HoraSimulada, horaExtrato: string): BaseEntrada {
  const limite = paraMs(agora);
  const ate = (s: string | undefined) => !s || paraMs(s) <= limite;
  const titulos = base.titulos.filter((t) => ate(t.data_lancamento));
  const idsTitulos = new Set(titulos.map((t) => t.titulo_id));
  const notas = base.notas.filter((n) => ate(n.data_recebimento_portal));
  const chaves = new Set(notas.map((n) => n.chave_acesso));
  return {
    ...base,
    titulos,
    agenda: base.agenda.filter((a) => idsTitulos.has(a.titulo_id)),
    notas,
    duplicatas: base.duplicatas.filter((d) => chaves.has(d.chave_acesso)),
    alteracoes: base.alteracoes.filter((a) => ate(a.data_hora)),
    recebimentos: base.recebimentos.filter((r) => ate(r.data_hora_recebimento)),
    dda: base.dda.filter((d) => ate(d.data_registro)),
    comunicacoes: base.comunicacoes.filter((c) => ate(c.data_hora)),
    extratoMeridiano: base.extratoMeridiano.filter((e) => ate(`${e.data}T${horaExtrato}`)),
    extratoLitoral: base.extratoLitoral.filter((e) => {
      const d = dataBRparaISO(e.Data);
      return !d || ate(`${d}T${horaExtrato}`);
    }),
    aprovacoesErp: base.aprovacoesErp.filter((a) => ate(a.data_hora)),
  };
}
