import { dataDe, deMs, fechamentoDoLote, minutosEntre, paraMs, somarDias, type HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { BaseEntrada } from '@/lib/data/base';
import { centavos, cnpjDigitos, nomeComparavel, numero, raizCnpj } from '@/lib/data/normalizadores';
import type { Fornecedor, PedidoCompra } from '@/lib/data/tipos';
import { mediana, nivelPorValor } from '@/lib/rules/auxiliares';
import { chaveAcesso, fmt, pad } from './formato';
import { sorteio, type Sorteio } from './prng';
import type { ArquivoGerado, EventoGerado, Intensidade, Trilha } from './tipos';

/**
 * Gerador de eventos ao vivo: a cada hora simulada, 0 a 3 acontecimentos novos (título de fornecedor,
 * relançamento duplicado, mensagem suspeita ou rotineira), no formato dos CSVs da base e com a mesma
 * semente para a mesma (simulação, hora): rodar o ciclo duas vezes gera exatamente as mesmas linhas.
 * Função pura: não lê banco, não chama IA. Os textos saem dos modelos fixos; a IA reescreve por cima
 * (ver src/lib/agents/gerador.ts) usando o briefing devolvido junto.
 */

export interface PlanoHora {
  eventos: EventoGerado[];
}

const VAZIO: PlanoHora = { eventos: [] };

// ---------------------------------------------------------------------------
// Catálogo (calculado uma vez por base)
// ---------------------------------------------------------------------------

interface Candidato {
  f: Fornecedor;
  mediana: number;
  oc: PedidoCompra;
}

interface Catalogo {
  candidatos: Candidato[];
  fornecedores: Fornecedor[];
  lancador: string;
  conferente: string;
  empresa: { cnpj: string; razao: string };
  modelos: Partial<Record<ArquivoGerado, Record<string, string>>>;
  inicio: HoraSimulada;
}

const catalogos = new WeakMap<BaseEntrada, Catalogo>();

/** Rotina: valor dentro de ±15% da mediana do histórico, e o teto abaixo da alçada do analista (o motor libera sozinho). */
export const VARIACAO_ROTINA = 0.15;

function catalogo(base: BaseEntrada, config: ConfigGoAudit): Catalogo {
  const hit = catalogos.get(base);
  if (hit) return hit;
  const inicio = base.politicas.periodo.inicio.slice(0, 16);
  const raizDe = new Map(base.fornecedores.map((f) => [f.fornecedor_id, raizCnpj(f.cnpj)]));
  // Fornecedores dos cenários plantados ficam de fora: a história deles já está contada.
  const reservados = new Set(base.agenda.map((a) => raizDe.get(a.fornecedor_id) ?? ''));
  const historico = new Map<string, number[]>();
  for (const t of base.titulos) {
    if (t.status !== 'pago') continue;
    const r = raizDe.get(t.fornecedor_id) ?? '';
    historico.set(r, [...(historico.get(r) ?? []), numero(t.valor) ?? 0]);
  }
  const trocaRecente = new Set(
    base.alteracoes.filter((a) => paraMs(inicio) - paraMs(a.data_hora) < 90 * 86_400_000).map((a) => a.fornecedor_id),
  );
  const categoriasRotina = ['produto', 'embalagens', 'insumos_capa', 'servicos', 'marketing_agencia', 'influenciador'];
  const teto = base.politicas.alcadas.analistaLiberarAte * 0.98;
  const candidatos: Candidato[] = [];
  for (const f of [...base.fornecedores].sort((a, b) => a.fornecedor_id.localeCompare(b.fornecedor_id))) {
    if (!categoriasRotina.includes(f.categoria) || f.contrato_id || !/ativo/i.test(f.status_cadastro || 'ativo')) continue;
    if (!['ted', 'pix'].includes(f.forma_pagamento_padrao) || reservados.has(raizCnpj(f.cnpj)) || trocaRecente.has(f.fornecedor_id)) continue;
    const h = historico.get(raizCnpj(f.cnpj)) ?? [];
    if (h.length < Math.max(3, config.regras.R11.minimo_historico)) continue;
    const m = mediana(h)!;
    if (m < 300 || m * (1 + VARIACAO_ROTINA) > teto) continue;
    const oc = base.pedidos.filter((o) => raizCnpj(o.cnpj_fornecedor) === raizCnpj(f.cnpj)).at(-1);
    if (!oc) continue;
    candidatos.push({ f, mediana: m, oc });
  }
  const analista = base.usuarios
    .filter((u) => u.perfil === 'analista_cp' && /ativo/i.test(u.status) && !u.data_desligamento)
    .sort((a, b) => a.data_admissao.localeCompare(b.data_admissao))[0];
  const n0 = base.notas[0];
  const cat: Catalogo = {
    candidatos,
    fornecedores: [...base.fornecedores].filter((f) => /ativo/i.test(f.status_cadastro || 'ativo')).sort((a, b) => a.fornecedor_id.localeCompare(b.fornecedor_id)),
    lancador: analista?.login ?? 'usuario_03',
    conferente: base.usuarios.find((u) => u.perfil === 'conferente')?.login ?? '',
    empresa: { cnpj: n0?.cnpj_destinatario ?? '', razao: n0?.razao_social_destinatario ?? '' },
    modelos: {
      contas_a_pagar: base.titulos[0], agenda_remessa: base.agenda[0], notas_fiscais: base.notas[0], nf_duplicatas: base.duplicatas[0],
      pedidos_compra: base.pedidos[0], dda_boletos: base.dda[0], recebimentos_mercadoria: base.recebimentos[0],
      comunicacoes_fornecedores: base.comunicacoes[0], alteracoes_cadastro: base.alteracoes[0],
    },
    inicio,
  };
  catalogos.set(base, cat);
  return cat;
}

/** Colunas dos CSVs, na ordem do arquivo (usadas quando a base não tem nenhuma linha do arquivo para servir de modelo). */
export const COLUNAS_PADRAO: Partial<Record<ArquivoGerado, string[]>> = {
  comunicacoes_fornecedores: ['comunicacao_id', 'data_hora', 'canal', 'remetente', 'nome_remetente', 'destinatario', 'assunto', 'texto', 'anexos'],
  alteracoes_cadastro: ['alteracao_id', 'data_hora', 'fornecedor_id', 'campo', 'valor_anterior', 'valor_novo', 'alterado_por', 'origem', 'confirmacao_registrada', 'confirmacao_como'],
};

/** Completa a linha com todas as colunas do CSV; coluna desconhecida é erro (pega nome de campo trocado). */
function completar(cat: Catalogo, arquivo: ArquivoGerado, parcial: Record<string, string>): Record<string, string> {
  const modelo = cat.modelos[arquivo];
  const colunas = modelo ? Object.keys(modelo) : (COLUNAS_PADRAO[arquivo] ?? []);
  if (!colunas.length) return { ...parcial };
  for (const k of Object.keys(parcial)) if (!colunas.includes(k)) throw new Error(`Gerador: coluna "${k}" não existe em ${arquivo}.csv`);
  return Object.fromEntries(colunas.map((c) => [c, parcial[c] ?? '']));
}

// ---------------------------------------------------------------------------
// Utilidades de hora
// ---------------------------------------------------------------------------

const carimbo = (ms: number) => `${deMs(ms).replace('T', ' ')}:00`;
const MIN = 60_000;
const tagDe = (hora: HoraSimulada) => `${hora.slice(5, 7)}${hora.slice(8, 10)}${hora.slice(11, 13)}`;

export const TAXAS: Record<Intensidade, number> = { baixa: 1, media: 2, alta: 3.5 };
export const MAX_EVENTOS_POR_HORA = 3;

// ---------------------------------------------------------------------------
// Planejamento da hora
// ---------------------------------------------------------------------------

export interface ParamsHora {
  sim: string;
  hora: HoraSimulada;
  intensidade: Intensidade;
  /** Tudo o que a simulação já gerou ANTES desta hora (a duplicidade e o golpe se apoiam em títulos reais). */
  anteriores: readonly EventoGerado[];
}

interface Lote {
  lote_remessa: string;
  banco_pagador: string;
  data_pagamento: string;
  horario_fechamento: string;
}

function proximoLote(base: BaseEntrada, hora: HoraSimulada, folgaMin: number, rng: Sorteio): Lote | null {
  const abertos = base.lotes
    .filter((l) => minutosEntre(hora, fechamentoDoLote(l.data_pagamento, l.horario_fechamento)) >= folgaMin)
    .sort((a, b) => fechamentoDoLote(a.data_pagamento, a.horario_fechamento).localeCompare(fechamentoDoLote(b.data_pagamento, b.horario_fechamento)) || a.lote_remessa.localeCompare(b.lote_remessa))
    .slice(0, 3);
  return abertos.length ? rng.pick(abertos) : null;
}

/** Títulos de rotina gerados antes, ainda sem cópia e em lote aberto, com a linha da agenda correspondente. */
function titulosGeradosAbertos(anteriores: readonly EventoGerado[], hora: HoraSimulada, folgaMin: number) {
  const agenda = new Map(anteriores.filter((e) => e.arquivo === 'agenda_remessa').map((e) => [e.linha.titulo_id!, e.linha]));
  const porOc = new Map<string, number>();
  const titulos = anteriores.filter((e) => e.arquivo === 'contas_a_pagar');
  for (const t of titulos) porOc.set(t.linha.oc_id!, (porOc.get(t.linha.oc_id!) ?? 0) + 1);
  return titulos
    .filter((t) => t.trilha === 'rotina' && porOc.get(t.linha.oc_id!) === 1)
    .map((t) => ({ t, ag: agenda.get(t.linha.titulo_id!) }))
    .filter((x) => x.ag && minutosEntre(hora, fechamentoDoLote(x.ag.data_prevista!, x.ag.horario_fechamento!)) >= folgaMin)
    .sort((a, b) => a.t.chave.localeCompare(b.t.chave));
}

export function planejarHora(base: BaseEntrada, config: ConfigGoAudit, p: ParamsHora): PlanoHora {
  const cat = catalogo(base, config);
  if (paraMs(p.hora) <= paraMs(cat.inicio)) return VAZIO; // a hora inicial é a base como veio (cenários plantados intactos)
  const rng = sorteio(`${p.sim}|${p.hora}`);
  const k = TAXAS[p.intensidade];
  const h = Number(p.hora.slice(11, 13));
  // A equipe lança títulos de segunda a sexta, das 8h às 18h (feriado bancário não impede o lançamento no ERP, só a remessa).
  const diaSemana = new Date(paraMs(p.hora)).getUTCDay();
  const expediente = diaSemana >= 1 && diaSemana <= 5 && h >= 9 && h <= 18;

  // Os sorteios de decisão saem sempre, na mesma ordem: a sequência não depende do que for possível.
  const sorteios = { rotina: rng.next(), dup: rng.next() };
  const quer: Trilha[] = [];
  if (expediente && sorteios.rotina < 0.26 * k) quer.push('rotina');
  if (expediente && sorteios.dup < 0.1 * k) quer.push('duplicidade');

  const plano: PlanoHora = { eventos: [] };
  const usadosAqui = new Set<string>();
  const forn = (id: string) => base.fornecedores.find((f) => f.fornecedor_id === id);
  // Quem já teve título ou golpe gerado não volta a ser sorteado: cada história fica limpa e isolada.
  const comTitulo = new Set(p.anteriores.filter((e) => e.arquivo === 'contas_a_pagar').map((e) => e.fornecedorId).filter(Boolean) as string[]);
  const golpeados = new Set(p.anteriores.filter((e) => e.trilha === 'golpe').map((e) => e.fornecedorId).filter(Boolean) as string[]);
  let n = 0;

  const novo = (trilha: Trilha, fornecedorId: string | null) => {
    n++;
    const evento = `EVG${tagDe(p.hora)}${n}`;
    let i = 0;
    return {
      evento,
      id: `${tagDe(p.hora)}${n}`,
      add(arquivo: ArquivoGerado, linha: Record<string, string>, origem: EventoGerado['origem'] = 'regra') {
        const chave = `${p.hora}|${evento}|${arquivo}|${i++}`;
        plano.eventos.push({ chave, evento, hora: p.hora, trilha, arquivo, linha: completar(cat, arquivo, linha), origem, fornecedorId });
        return chave;
      },
    };
  };

  const dataLanc = () => {
    const ms = paraMs(p.hora) - rng.int(0, 54) * MIN; // dentro da última hora: o ciclo desta hora é o primeiro a ver
    return { ms, ts: carimbo(ms) };
  };

  const agendaLinha = (f: Fornecedor, tituloId: string, valor: number, venc: string, lote: Lote, forma: string) => ({
    lote_remessa: lote.lote_remessa, banco_pagador: lote.banco_pagador, data_prevista: lote.data_pagamento, horario_fechamento: lote.horario_fechamento,
    titulo_id: tituloId, fornecedor_id: f.fornecedor_id, valor: fmt(valor), vencimento: venc, forma_pagamento: forma,
    destino_pagamento: forma === 'pix' ? `pix ${f.chave_pix}` : `ted ${f.banco}/${f.agencia}/${f.conta}`,
  });

  /** Título completo e coerente (OC + NF + duplicata + recebimento + título + agenda). */
  const rotina = () => {
    const livres = cat.candidatos.filter((c) => !comTitulo.has(c.f.fornecedor_id) && !golpeados.has(c.f.fornecedor_id) && !usadosAqui.has(c.f.fornecedor_id));
    const lote = proximoLote(base, p.hora, 180, rng);
    const delta = (rng.next() * 2 - 1) * VARIACAO_ROTINA;
    const escolhido = livres.length ? rng.pick(livres) : null;
    const l = dataLanc();
    if (!escolhido || !lote) return;
    const { f, mediana: m, oc: modelo } = escolhido;
    usadosAqui.add(f.fornecedor_id);
    const valor = centavos(m * (1 + delta));
    const ev = novo('rotina', f.fornecedor_id);
    const numNf = 800_000_000 + Number(tagDe(p.hora)) * 10 + n;
    const dataEmissao = somarDias(dataDe(p.hora), -1);
    const recebPortal = carimbo(l.ms - rng.int(120, 360) * MIN);
    const venc = lote.data_pagamento;
    const ocId = `OC-G${ev.id}`;
    ev.add('pedidos_compra', {
      ...modelo, oc_id: ocId, data_emissao: somarDias(dataEmissao, -2), descricao: `Pedido de rotina (${modelo.descricao})`, tipo: 'pontual',
      valor_total: fmt(valor), valor_mensal: '', data_aprovacao: somarDias(dataEmissao, -1), status: 'aprovada', quantidade: '1000',
      valor_unitario: (valor / 1000).toFixed(4),
    } as Record<string, string>);
    const chave = chaveAcesso(f.cnpj, dataEmissao, numNf);
    ev.add('notas_fiscais', {
      chave_acesso: chave, modelo: '55', numero_nf: String(numNf), serie: '1', cnpj_emitente: cnpjDigitos(f.cnpj), razao_social_emitente: nomeComparavel(f.razao_social),
      data_emissao: dataEmissao, valor_total: fmt(valor), oc_informada: ocId, informacoes_complementares: `Pedido do cliente: ${ocId}`,
      data_recebimento_portal: recebPortal, cnpj_destinatario: cat.empresa.cnpj, razao_social_destinatario: cat.empresa.razao,
      natureza_operacao: 'Venda de produção do estabelecimento', cfop: '6101', valor_produtos_servicos: fmt(valor), valor_ipi: '0.00',
      valor_icms: '0.00', valor_iss: '0.00', situacao_sefaz: 'autorizada', manifestacao_destinatario: 'confirmação da operação',
      data_manifestacao: recebPortal,
    });
    ev.add('nf_duplicatas', { chave_acesso: chave, n_dup: '001', vencimento: venc, valor: fmt(valor) });
    if (config.categorias.mercadoria.includes(f.categoria)) {
      ev.add('recebimentos_mercadoria', {
        recebimento_id: `RCG${ev.id}`, data_hora_recebimento: carimbo(l.ms - 90 * MIN), local_recebimento: 'CD1 - Maracanaú/CE',
        cnpj_destinatario: cat.empresa.cnpj, chave_acesso: chave, numero_nf: String(numNf), cnpj_emitente: cnpjDigitos(f.cnpj), oc_id: ocId,
        descricao_item: 'Item de rotina', quantidade_recebida: '1000', unidade: 'un', volumes: '10', conferente: cat.conferente,
        situacao: 'conferido', observacao: '', entrada_estoque: carimbo(l.ms - 30 * MIN),
      });
    }
    const tituloId = `TPG${ev.id}`;
    ev.add('contas_a_pagar', {
      titulo_id: tituloId, fornecedor_id: f.fornecedor_id, numero_nf_digitado: String(numNf), oc_id: ocId, parcela: '1/1', valor: fmt(valor),
      vencimento: venc, forma_pagamento: f.forma_pagamento_padrao, origem_lancamento: 'xml_portal', lancado_por: cat.lancador,
      data_lancamento: l.ts, status: 'agendado', banco_pagador: lote.banco_pagador, lote_remessa: lote.lote_remessa,
      historico: `NF ${numNf} parc 1/1 - ${f.nome_fantasia}`, nivel_aprovacao: nivelPorValor(valor, base.politicas),
    });
    ev.add('agenda_remessa', agendaLinha(f, tituloId, valor, venc, lote, f.forma_pagamento_padrao));
  };

  /** Relança um título gerado antes, com a NF digitada de outro jeito (zeros à esquerda, série): a R01 deve pegar. */
  const duplicidade = () => {
    const abertos = titulosGeradosAbertos(p.anteriores, p.hora, 90).filter((x) => minutosEntre(x.t.hora, p.hora) >= 120);
    const variante = rng.int(0, 2);
    const alvo = abertos.length ? rng.pick(abertos) : null;
    const l = dataLanc();
    if (!alvo) return;
    const o = alvo.t.linha;
    const f = forn(o.fornecedor_id!);
    if (!f) return;
    const num = o.numero_nf_digitado!;
    const digitado = variante === 0 ? pad(num, 9) : variante === 1 ? `${num}-1` : `${num}/1`;
    const ev = novo('duplicidade', f.fornecedor_id);
    const tituloId = `TPG${ev.id}`;
    ev.add('contas_a_pagar', { ...o, titulo_id: tituloId, numero_nf_digitado: digitado, data_lancamento: l.ts, historico: `NF ${digitado} parc 1/1 - ${f.nome_fantasia}` });
    ev.add('agenda_remessa', { ...alvo.ag!, titulo_id: tituloId });
  };

  for (const t of quer.slice(0, MAX_EVENTOS_POR_HORA)) {
    if (t === 'rotina') rotina();
    if (t === 'duplicidade') duplicidade();
  }
  return plano;
}
