import type { BaseEntrada } from './base';
import { lerMensagem, type Leitura } from '@/lib/mensagens/leitor';
import type {
  AgendaItem, AlteracaoCadastro, BoletoDDA, Contrato, Duplicata, Fornecedor, NotaFiscal,
  PagamentoObservado, PedidoCompra, Recebimento, Titulo, Usuario,
} from './tipos';
import {
  centavos, dataBRparaISO, decodificarLinhaDigitavel, nfNormalizada, nomeAbreviadoCasa, numero,
  parcela, parseHistoricoLitoral, raizCnpj, valorBR, type LinhaDigitavel,
} from './normalizadores';

function agrupar<T>(itens: T[], chave: (t: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of itens) {
    const k = chave(it);
    if (!k) continue;
    const l = m.get(k);
    if (l) l.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function porId<T>(itens: T[], chave: (t: T) => string): Map<string, T> {
  return new Map(itens.map((t) => [chave(t), t]));
}

/** Tudo o que se sabe sobre um título, ligado entre os sistemas. */
export interface DossieTitulo {
  titulo: Titulo;
  valor: number;
  fornecedor: Fornecedor | null;
  raiz: string;
  nfNumero: string;
  parcela: { n: number; total: number } | null;
  nf: NotaFiscal | null;
  duplicata: Duplicata | null;
  oc: PedidoCompra | null;
  contrato: Contrato | null;
  boleto: LinhaDigitavel | null;
  dda: BoletoDDA | null;
  recebimentos: Recebimento[];
  agenda: AgendaItem | null;
  lancador: Usuario | null;
  /** Ligações que não foram possíveis (vão para o relatório de não ligados). */
  pendencias: string[];
}

export class Indices {
  readonly fornecedorPorId: Map<string, Fornecedor>;
  readonly fornecedoresPorRaiz: Map<string, Fornecedor[]>;
  readonly tituloPorId: Map<string, Titulo>;
  readonly titulosPorRaiz: Map<string, Titulo[]>;
  readonly titulosPorLinha: Map<string, Titulo[]>;
  readonly nfPorChave: Map<string, NotaFiscal>;
  readonly nfPorRaizNumero: Map<string, NotaFiscal[]>;
  readonly duplicatasPorChave: Map<string, Duplicata[]>;
  readonly ocPorId: Map<string, PedidoCompra>;
  readonly contratoPorId: Map<string, Contrato>;
  readonly contratosPorFornecedor: Map<string, Contrato[]>;
  readonly contratoPorOc: Map<string, Contrato>;
  readonly recebimentosPorChave: Map<string, Recebimento[]>;
  readonly ddaPorLinha: Map<string, BoletoDDA>;
  readonly ddaPorRaiz: Map<string, BoletoDDA[]>;
  readonly alteracoesPorFornecedor: Map<string, AlteracaoCadastro[]>;
  readonly usuarioPorLogin: Map<string, Usuario>;
  readonly agendaPorTitulo: Map<string, AgendaItem>;
  readonly pagamentos: PagamentoObservado[];
  readonly pagamentosPorTitulo: Map<string, PagamentoObservado[]>;
  /** Pagamentos avulsos (sem título) que nenhum título pago explica. */
  readonly pagamentosAvulsosSemTitulo: PagamentoObservado[];
  private readonly bancosCobranca = new Map<string, Set<string>>();

  constructor(readonly base: BaseEntrada) {
    this.fornecedorPorId = porId(base.fornecedores, (f) => f.fornecedor_id);
    this.fornecedoresPorRaiz = agrupar(base.fornecedores, (f) => raizCnpj(f.cnpj));
    this.tituloPorId = porId(base.titulos, (t) => t.titulo_id);
    this.titulosPorRaiz = agrupar(base.titulos, (t) => raizCnpj(this.fornecedorPorId.get(t.fornecedor_id)?.cnpj));
    this.titulosPorLinha = agrupar(base.titulos, (t) => t.linha_digitavel || null);
    this.nfPorChave = porId(base.notas, (n) => n.chave_acesso);
    this.nfPorRaizNumero = agrupar(base.notas, (n) => `${raizCnpj(n.cnpj_emitente)}|${nfNormalizada(n.numero_nf)}`);
    this.duplicatasPorChave = agrupar(base.duplicatas, (d) => d.chave_acesso);
    this.ocPorId = porId(base.pedidos, (o) => o.oc_id);
    this.contratoPorId = porId(base.contratos, (c) => c.contrato_id);
    this.contratosPorFornecedor = agrupar(base.contratos, (c) => c.fornecedor_id);
    this.contratoPorOc = porId(base.contratos.filter((c) => c.oc_id), (c) => c.oc_id);
    this.recebimentosPorChave = agrupar(base.recebimentos, (r) => r.chave_acesso);
    this.ddaPorLinha = porId(base.dda.filter((d) => d.linha_digitavel), (d) => d.linha_digitavel);
    this.ddaPorRaiz = agrupar(base.dda, (d) => raizCnpj(d.cnpj_beneficiario));
    this.alteracoesPorFornecedor = agrupar(base.alteracoes, (a) => a.fornecedor_id);
    this.usuarioPorLogin = porId(base.usuarios, (u) => u.login);
    this.agendaPorTitulo = porId(base.agenda, (a) => a.titulo_id);

    // Banco de cobrança histórico: aprendido do DDA e dos boletos já pagos.
    for (const d of base.dda) this.addBanco(raizCnpj(d.cnpj_beneficiario), d.banco_cobrador);
    for (const t of base.titulos) {
      if (t.status !== 'pago' || !t.linha_digitavel) continue;
      this.addBanco(raizCnpj(this.fornecedorPorId.get(t.fornecedor_id)?.cnpj), t.linha_digitavel.slice(0, 3));
    }

    this.pagamentos = this.unificarPagamentos();
    this.pagamentosPorTitulo = agrupar(this.pagamentos, (p) => p.tituloId);
    this.pagamentosAvulsosSemTitulo = this.avulsosNaoExplicados();
  }

  private addBanco(raiz: string, banco: string | undefined): void {
    if (!raiz || !banco) return;
    const s = this.bancosCobranca.get(raiz) ?? new Set<string>();
    s.add(banco);
    this.bancosCobranca.set(raiz, s);
  }

  private _leituras: Leitura[] | null = null;
  private _leiturasPorFornecedor: Map<string, Leitura[]> | null = null;

  /** Resultado do leitor (sem IA) para todas as mensagens que já chegaram. Calculado sob demanda. */
  get leituras(): Leitura[] {
    return (this._leituras ??= this.base.comunicacoes.map((c) => lerMensagem(c, this)));
  }

  leiturasDoFornecedor(fornecedorId: string): Leitura[] {
    this._leiturasPorFornecedor ??= agrupar(this.leituras, (l) => l.fornecedorId);
    return this._leiturasPorFornecedor.get(fornecedorId) ?? [];
  }

  bancosDeCobrancaHistoricos(raiz: string): Set<string> {
    return this.bancosCobranca.get(raiz) ?? new Set();
  }

  /** Extratos (dois formatos) e retorno CNAB num formato único. */
  private unificarPagamentos(): PagamentoObservado[] {
    const out: PagamentoObservado[] = [];
    const b = this.base;
    b.extratoMeridiano.forEach((e, i) => {
      if (!/^PAGTO/.test(e.tipo)) return;
      const valor = Math.abs(numero(e.valor) ?? 0);
      const m = e.descricao.match(/^(BOLETO|TED|PIX)(?: AVULSA)?(?: (\d{3}))? (.+)$/);
      out.push({
        origem: 'extrato_meridiano',
        id: `MER#${i + 2}`,
        data: e.data,
        valor,
        tituloId: e.documento || null,
        nome: m?.[3] ?? e.descricao,
        bancoDestino: m?.[2] ?? null,
        avulso: e.tipo === 'PAGTO AVULSO' || !e.documento,
      });
    });
    b.extratoLitoral.forEach((e, i) => {
      const h = parseHistoricoLitoral(e['Histórico']);
      if (!['PIX', 'TED', 'BOLETO'].includes(h.tipo)) return;
      out.push({
        origem: 'extrato_litoral',
        id: `LIT#${i + 2}`,
        data: dataBRparaISO(e.Data) ?? e.Data,
        valor: Math.abs(valorBR(e['Valor (R$)']) ?? 0),
        tituloId: null,
        nome: h.nome,
        bancoDestino: h.banco,
        avulso: true, // o Litoral não traz o título; a conciliação decide
      });
    });
    b.retorno.forEach((r, i) => {
      if (r.codigo_ocorrencia !== '00') return;
      out.push({
        origem: 'retorno_remessa',
        id: `RET#${i + 2}`,
        data: r.data_pagamento,
        valor: numero(r.valor_pago) ?? 0,
        tituloId: r.titulo_id,
        nome: r.favorecido,
        bancoDestino: null,
        avulso: false,
      });
    });
    return out;
  }

  /** Nomes pelos quais o fornecedor aparece nos extratos. */
  nomesDoFornecedor(f: Fornecedor): string[] {
    const raiz = raizCnpj(f.cnpj);
    const doCompras = this.base.pedidos.filter((o) => raizCnpj(o.cnpj_fornecedor) === raiz).map((o) => o.nome_fornecedor);
    return [f.razao_social, f.nome_fantasia, ...new Set(doCompras)];
  }

  /**
   * Linhas do Litoral (sem título) e avulsos do Meridiano que não são explicados por
   * um título já pago com mesma data e valor (lote LIT conciliado pelo retorno, ou
   * pagamento manual já baixado no ERP).
   */
  private avulsosNaoExplicados(): PagamentoObservado[] {
    const pagosPorDataValor = new Map<string, number>();
    const chave = (data: string, valor: number) => `${data}|${centavos(valor).toFixed(2)}`;
    // Títulos cujo pagamento já está identificado pelo número no extrato não entram.
    const comDocumento = new Set(this.pagamentos.filter((p) => p.origem === 'extrato_meridiano' && p.tituloId).map((p) => p.tituloId!));
    for (const t of this.base.titulos) {
      if (t.status !== 'pago' || !t.data_pagamento || comDocumento.has(t.titulo_id)) continue;
      const k = chave(t.data_pagamento, numero(t.valor) ?? 0);
      pagosPorDataValor.set(k, (pagosPorDataValor.get(k) ?? 0) + 1);
    }
    const out: PagamentoObservado[] = [];
    for (const p of this.pagamentos) {
      if (!p.avulso || p.origem === 'retorno_remessa') continue;
      const k = chave(p.data, p.valor);
      const n = pagosPorDataValor.get(k) ?? 0;
      if (n > 0) pagosPorDataValor.set(k, n - 1);
      else out.push(p);
    }
    return out;
  }

  /** Pagamentos avulsos não explicados que casam com o título (nome, valor, data ≥ lançamento). */
  pagamentosAvulsosCompativeis(t: Titulo): PagamentoObservado[] {
    const f = this.fornecedorPorId.get(t.fornecedor_id);
    if (!f) return [];
    const nomes = this.nomesDoFornecedor(f);
    const valor = centavos(numero(t.valor) ?? 0);
    const desde = t.data_lancamento.slice(0, 10);
    return this.pagamentosAvulsosSemTitulo.filter(
      (p) => centavos(p.valor) === valor && p.data >= desde && nomeAbreviadoCasa(p.nome, ...nomes),
    );
  }

  /** NF do título: pela raiz do CNPJ do fornecedor + número normalizado. */
  nfDoTitulo(t: Titulo): NotaFiscal | null {
    const f = this.fornecedorPorId.get(t.fornecedor_id);
    const num = nfNormalizada(t.numero_nf_digitado);
    if (!num) return null;
    const porFornecedor = f ? this.nfPorRaizNumero.get(`${raizCnpj(f.cnpj)}|${num}`) : undefined;
    if (porFornecedor?.length) return porFornecedor[0]!;
    // Plano B: NF citada na OC do título (pega NF de outra raiz → R05 acusa).
    if (t.oc_id) {
      const pelaOc = this.base.notas.find((n) => n.oc_informada === t.oc_id && nfNormalizada(n.numero_nf) === num);
      if (pelaOc) return pelaOc;
    }
    return null;
  }

  dossie(tituloId: string): DossieTitulo {
    const titulo = this.tituloPorId.get(tituloId);
    if (!titulo) throw new Error(`Título não encontrado: ${tituloId}`);
    const pendencias: string[] = [];
    const fornecedor = this.fornecedorPorId.get(titulo.fornecedor_id) ?? null;
    if (!fornecedor) pendencias.push('fornecedor não cadastrado');
    const raiz = raizCnpj(fornecedor?.cnpj);
    const nfNumero = nfNormalizada(titulo.numero_nf_digitado);
    const par = parcela(titulo.parcela);
    const categoria = fornecedor?.categoria ?? '';
    const pol = this.base.politicas.tresVias;

    const nf = this.nfDoTitulo(titulo);
    if (!nf && !(nfNumero === '' && pol.dispensaNf.includes(categoria))) {
      pendencias.push(nfNumero ? `NF ${titulo.numero_nf_digitado} não encontrada no portal` : 'título sem NF');
    }
    let duplicata: Duplicata | null = null;
    if (nf) {
      const dups = this.duplicatasPorChave.get(nf.chave_acesso) ?? [];
      duplicata = (par && dups.find((d) => Number(d.n_dup) === par.n)) ?? (dups.length === 1 ? dups[0]! : null);
      if (!duplicata) pendencias.push(`duplicata ${titulo.parcela} não encontrada na NF`);
    }
    const oc = titulo.oc_id ? this.ocPorId.get(titulo.oc_id) ?? null : null;
    if (titulo.oc_id && !oc) pendencias.push(`OC ${titulo.oc_id} não encontrada em Compras`);
    if (!titulo.oc_id && !pol.dispensaOc.includes(categoria)) pendencias.push('título sem OC');

    // Contrato só vale como referência quando o título é do contrato: OC do contrato,
    // OC do tipo contrato, ou título sem OC de fornecedor com contrato (ex.: aluguel).
    // OC pontual (campanha, compra avulsa) NÃO herda o contrato do fornecedor.
    const contratoDoFornecedor = fornecedor?.contrato_id ? this.contratoPorId.get(fornecedor.contrato_id) ?? null : null;
    const contrato = oc
      ? this.contratoPorOc.get(oc.oc_id) ?? (oc.tipo === 'contrato' ? contratoDoFornecedor : null)
      : contratoDoFornecedor;

    const boleto = titulo.forma_pagamento === 'boleto' ? decodificarLinhaDigitavel(titulo.linha_digitavel) : null;
    if (titulo.forma_pagamento === 'boleto' && !boleto) pendencias.push('linha digitável inválida');
    const dda = titulo.linha_digitavel ? this.ddaPorLinha.get(titulo.linha_digitavel) ?? null : null;
    if (titulo.forma_pagamento === 'boleto' && !dda) pendencias.push('boleto não encontrado no DDA');

    return {
      titulo,
      valor: numero(titulo.valor) ?? 0,
      fornecedor,
      raiz,
      nfNumero,
      parcela: par,
      nf,
      duplicata,
      oc,
      contrato,
      boleto,
      dda,
      recebimentos: nf ? this.recebimentosPorChave.get(nf.chave_acesso) ?? [] : [],
      agenda: this.agendaPorTitulo.get(tituloId) ?? null,
      lancador: this.usuarioPorLogin.get(titulo.lancado_por) ?? null,
      pendencias,
    };
  }
}
