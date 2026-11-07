import { dataDe, diasEntre, paraMs, type CalendarioBancario, type HoraSimulada } from '@/lib/clock/relogio';
import type { ConfigGoAudit } from '@/lib/config/config';
import type { Indices } from '@/lib/data/indices';
import { centavos, numero } from '@/lib/data/normalizadores';
import type { Contrato, Titulo } from '@/lib/data/tipos';
import { pessoaPorNome, resolverAcionamento, type PessoasDoCaso } from '@/lib/rules/acionamento';
import { trocasBancariasRecentes } from '@/lib/rules/auxiliares';
import { brl } from '@/lib/rules/tipos';
import {
  competenciaDoVencimento, diasUteisAntes, diasUteisEntre, mesDe, proximoReajuste, somarMeses, ultimoDiaDoMes, vencimentoNominal,
} from './datas';
import { indiceParaCompetencia } from './indices';
import type { AnaliseContratos, ClasseContrato, CodigoDesvio, CompetenciaContrato, Desvio, InfoContratoTitulo, Vinculo } from './tipos';

export interface OpcoesAnalise {
  idx: Indices;
  cal: CalendarioBancario;
  config: ConfigGoAudit;
  agora: HoraSimulada;
  /** Títulos que o motor vai avaliar agora (agenda efetiva, lote aberto): só eles recebem desvios que retiram. */
  titulosAvaliados: Set<string>;
}

interface Faixa {
  esperado: number | null;
  min: number | null;
  max: number | null;
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const dataBR = (d: string) => d.split('-').reverse().join('/');
const RENOVA = /renova[çc][ãa]o autom[áa]tica/i;

export function classeDoContrato(categoria: string, config: ConfigGoAudit): ClasseContrato {
  return config.contratos.classe_por_categoria[categoria] ?? 'fixo';
}

/**
 * Vínculo título × contrato, valor esperado por competência e desvios D01–D10.
 * Função pura sobre os índices (CSV até a hora simulada): não toca no banco.
 */
export function analisarContratos(o: OpcoesAnalise): AnaliseContratos {
  const { idx, cal, config, agora, titulosAvaliados } = o;
  const cfg = config.contratos;
  const pol = idx.base.politicas;
  const hoje = dataDe(agora);
  const mesAtual = mesDe(hoje);
  const dispensaOc = pol.tresVias.dispensaOc;

  const contratos = idx.base.contratos;
  const classes = new Map<string, ClasseContrato>();
  for (const c of contratos) classes.set(c.contrato_id, classeDoContrato(idx.fornecedorPorId.get(c.fornecedor_id)?.categoria ?? '', config));

  const pessoasDe = (c: Contrato, t?: Titulo): PessoasDoCaso => {
    const f = idx.fornecedorPorId.get(c.fornecedor_id);
    const dono = c.gestor_pessoa_id || config.acionamento.dono_por_categoria[f?.categoria ?? ''] || null;
    const comprador = t?.oc_id ? idx.ocPorId.get(t.oc_id)?.comprador : undefined;
    const responsavel = pessoaPorNome(pol, comprador) ?? pessoaPorNome(pol, f?.responsavel_interno) ?? dono;
    return { gestor: c.gestor_pessoa_id || dono, dono, responsavel };
  };

  // ---------------------------------------------------------------- vínculo
  const competenciaDoTitulo = (c: Contrato, classe: ClasseContrato, t: Titulo): string => {
    const dia = Number(c.dia_vencimento);
    return classe === 'frete' || !(dia >= 1) ? mesDe(t.vencimento) : competenciaDoVencimento(cal, dia, t.vencimento);
  };

  const vincular = (t: Titulo): Vinculo | null => {
    if (t.status === 'cancelado') return null;
    const f = idx.fornecedorPorId.get(t.fornecedor_id);
    if (!f) return null;
    const base = { tituloId: t.titulo_id };

    const porOc = t.oc_id ? idx.contratoPorOc.get(t.oc_id) : undefined;
    if (porOc) {
      const classe = classes.get(porOc.contrato_id)!;
      return {
        ...base, contratoId: porOc.contrato_id, competencia: competenciaDoTitulo(porOc, classe, t), metodo: 'oc_contrato', confianca: 'alta',
        motivo: `A OC ${t.oc_id} é a OC do contrato.`,
      };
    }
    const c = f.contrato_id ? idx.contratoPorId.get(f.contrato_id) : undefined;
    if (!c) return null; // fornecedor sem contrato: nada a ligar
    const classe = classes.get(c.contrato_id)!;
    if (!t.oc_id && !c.oc_id && dispensaOc.includes(f.categoria)) {
      return {
        ...base, contratoId: c.contrato_id, competencia: competenciaDoTitulo(c, classe, t), metodo: 'fornecedor_sem_oc', confianca: 'alta',
        motivo: `Categoria ${f.categoria} não tem OC; vínculo pelo fornecedor.`,
      };
    }
    if (classe === 'frete' && t.origem_lancamento === cfg.origem_integracao_frete) {
      return {
        ...base, contratoId: c.contrato_id, competencia: competenciaDoTitulo(c, classe, t), metodo: 'frete_integracao', confianca: 'media',
        motivo: 'Frete lançado pela integração, no fornecedor com contrato de frete.',
      };
    }
    if (t.oc_id) {
      return {
        ...base, contratoId: null, competencia: null, metodo: 'oc_pontual', confianca: 'nenhuma',
        motivo: `Título de OC pontual (${t.oc_id}); não é do contrato ${c.contrato_id}. Segue as regras normais de 3 vias.`,
      };
    }
    return {
      ...base, contratoId: c.contrato_id, competencia: null, metodo: 'sem_vinculo', confianca: 'nenhuma',
      motivo: `Título sem OC de fornecedor com contrato ${c.contrato_id}, em categoria que exige OC.`,
    };
  };

  const vinculos = new Map<string, Vinculo>();
  const grupos = new Map<string, Titulo[]>(); // "contrato|competência" → títulos
  for (const t of idx.base.titulos) {
    const v = vincular(t);
    if (!v) continue;
    vinculos.set(t.titulo_id, v);
    if (v.contratoId && v.competencia) {
      const k = `${v.contratoId}|${v.competencia}`;
      grupos.set(k, [...(grupos.get(k) ?? []), t]);
    }
  }
  for (const l of grupos.values()) {
    l.sort((a, b) => paraMs(a.data_lancamento) - paraMs(b.data_lancamento) || a.titulo_id.localeCompare(b.titulo_id));
  }

  // ---------------------------------------------------------------- valor esperado
  const atrasoDe = (t: Titulo): number => {
    const pago = t.data_pagamento ? dataDe(t.data_pagamento) : (idx.agendaPorTitulo.get(t.titulo_id)?.data_prevista ?? null);
    return pago ? Math.max(0, diasEntre(t.vencimento, pago)) : 0;
  };
  const acrescimo = (dias: number) => (dias > 0 ? pol.atraso.multa + (pol.atraso.jurosMes * dias) / cfg.dias_por_mes_juros : 0);
  const tol = cfg.tolerancia_valor;
  const indiceDe = (c: Contrato, comp: string) =>
    c.indice_reajuste ? indiceParaCompetencia(idx.base.indicesReajuste, c.indice_reajuste, comp, cfg.reajuste.defasagem_indice_meses) : null;

  /** Fixo: valor vigente; no mês de reajuste, do valor vigente até o reajustado + folga. Atraso soma multa e juros pro rata. */
  const faixaFixo = (c: Contrato, comp: string, dias = 0) => {
    const m = numero(c.valor_mensal) ?? 0;
    const ehMesReajuste = Number(c.mes_reajuste) === Number(comp.slice(5, 7));
    const incorporado = !!c.data_ultimo_reajuste && mesDe(c.data_ultimo_reajuste) === comp;
    const reajusta = ehMesReajuste && !incorporado;
    const ind = indiceDe(c, comp);
    const teto = ind != null ? ind + cfg.reajuste.folga_pontos : cfg.reajuste.teto_sem_indice;
    const max0 = reajusta ? m * (1 + teto) : m + tol;
    const max = dias > 0 ? max0 * (1 + acrescimo(dias)) + tol : max0;
    return { esperado: centavos(m * (1 + (reajusta ? (ind ?? 0) : 0))), min: centavos(m - tol), max: centavos(max), reajusta, indice: ind, m };
  };

  const somaPorCompetencia = (c: Contrato, soPagos: boolean): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [k, ts] of grupos) {
      if (!k.startsWith(`${c.contrato_id}|`)) continue;
      const usados = soPagos ? ts.filter((t) => t.status === 'pago') : ts;
      if (!usados.length) continue;
      out.set(k.slice(c.contrato_id.length + 1), centavos(usados.reduce((s, t) => s + (numero(t.valor) ?? 0), 0)));
    }
    return out;
  };

  /** Utilidades: média das últimas N competências pagas antes desta; sem histórico, a estimativa do contrato. */
  const faixaUtilidade = (c: Contrato, comp: string, dias = 0): Faixa => {
    const pagas = [...somaPorCompetencia(c, true)]
      .filter(([k]) => k < comp)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, cfg.utilidade.competencias_media);
    const esperado = pagas.length ? pagas.reduce((s, [, v]) => s + v, 0) / pagas.length : (numero(c.valor_mensal) ?? null);
    if (esperado == null) return { esperado: null, min: null, max: null };
    return {
      esperado: centavos(esperado),
      min: centavos(esperado * (1 - cfg.utilidade.faixa)),
      max: centavos(esperado * (1 + cfg.utilidade.faixa) * (1 + acrescimo(dias))),
    };
  };

  /** Frete: estimativa mensal × fator sazonal, com faixa larga (varia com o volume). */
  const faixaFrete = (c: Contrato, comp: string): Faixa => {
    const m = numero(c.valor_mensal);
    if (m == null) return { esperado: null, min: null, max: null };
    const esperado = m * (cfg.frete.fator_sazonal[comp.slice(5, 7)] ?? 1);
    return {
      esperado: centavos(esperado),
      min: centavos(esperado * (1 - cfg.frete.faixa_abaixo)),
      max: centavos(esperado * (1 + cfg.frete.faixa_acima)),
    };
  };

  // ---------------------------------------------------------------- desvios
  const desvios: Desvio[] = [];
  const desviosPorTitulo = new Map<string, Desvio[]>();
  const atipicos = new Set<string>(); // títulos com qualquer desvio (mesmo os que só ficam registrados na competência)
  const faixaDoTitulo = new Map<string, Faixa>();

  const emitir = (
    c: Contrato, codigo: CodigoDesvio, retira: boolean, comp: string | null, titulo: Titulo | null, motivo: string, evidencias: string[],
    chaveExtra?: string,
  ) => {
    desvios.push({
      codigo,
      contratoId: c.contrato_id,
      competencia: comp,
      tituloId: titulo?.titulo_id ?? null,
      retira,
      motivo,
      evidencias: [...new Set([c.contrato_id, ...evidencias])],
      acionar: resolverAcionamento([codigo], pessoasDe(c, titulo ?? undefined), config),
      chave: chaveExtra ?? `${codigo}|${c.contrato_id}|${comp ?? '-'}|${titulo?.titulo_id ?? '-'}`,
    });
    if (titulo) desviosPorTitulo.set(titulo.titulo_id, [...(desviosPorTitulo.get(titulo.titulo_id) ?? []), desvios[desvios.length - 1]!]);
  };

  /** Texto do problema de vigência, ou null se a cobrança está dentro da vigência. */
  const foraDaVigencia = (c: Contrato, venc: string): string | null => {
    if (!/vigente/i.test(c.status)) return `o contrato ${c.contrato_id} está ${c.status}`;
    if (c.inicio_vigencia && venc < c.inicio_vigencia) return `o vencimento ${dataBR(venc)} é anterior ao início da vigência (${dataBR(c.inicio_vigencia)})`;
    if (c.fim_vigencia_atual && venc > c.fim_vigencia_atual && !RENOVA.test(c.prazo)) {
      return `o vencimento ${dataBR(venc)} é posterior ao fim da vigência (${dataBR(c.fim_vigencia_atual)}) e o contrato não renova sozinho`;
    }
    return null;
  };

  const competencias: CompetenciaContrato[] = [];

  for (const c of contratos) {
    const classe = classes.get(c.contrato_id)!;
    const f = idx.fornecedorPorId.get(c.fornecedor_id);
    if (!f) continue;
    const gestor = c.gestor_pessoa_id || config.acionamento.dono_por_categoria[f.categoria] || '';
    const comps = [...grupos.keys()]
      .filter((k) => k.startsWith(`${c.contrato_id}|`))
      .map((k) => k.slice(c.contrato_id.length + 1))
      .sort();
    const primeira = comps[0];
    const dia = Number(c.dia_vencimento);

    for (const comp of comps) {
      const ts = grupos.get(`${c.contrato_id}|${comp}`)!;
      const cobrado = centavos(ts.reduce((s, t) => s + (numero(t.valor) ?? 0), 0));
      const codigos = new Set<CodigoDesvio>();
      let faixa: Faixa = { esperado: null, min: null, max: null };
      const avaliado = (t: Titulo) => titulosAvaliados.has(t.titulo_id);

      if (classe === 'fixo') {
        ts.forEach((t, i) => {
          const dias = atrasoDe(t);
          const fx = faixaFixo(c, comp, dias);
          faixaDoTitulo.set(t.titulo_id, fx);
          if (i === 0) faixa = fx;
          const v = centavos(numero(t.valor) ?? 0);
          if (i > 0) {
            codigos.add('D03');
            atipicos.add(t.titulo_id);
            if (avaliado(t)) {
              emitir(c, 'D03', true, comp, t, `Já existe o título ${ts[0]!.titulo_id} na competência ${comp} deste contrato; este é excedente (${brl(v)}).`, [t.titulo_id, ts[0]!.titulo_id]);
            }
            return;
          }
          const fora = foraDaVigencia(c, t.vencimento);
          if (fora) {
            codigos.add('D06');
            atipicos.add(t.titulo_id);
            if (avaliado(t)) emitir(c, 'D06', true, comp, t, `Cobrança fora da vigência: ${fora}.`, [t.titulo_id]);
            return;
          }
          if (v > fx.max! + 0.005) {
            const r = v / fx.m - 1;
            atipicos.add(t.titulo_id);
            const ind = indiceDe(c, comp);
            if (fx.reajusta) {
              codigos.add('D05');
              if (avaliado(t)) {
                emitir(c, 'D05', true, comp, t, `Reajuste de ${pct(r)} no mês previsto, acima do índice ${c.indice_reajuste}${ind != null ? ` (${pct(ind)})` : ''}: ${brl(v)} contra no máximo ${brl(fx.max!)}.`, [t.titulo_id]);
              }
            } else if (ind != null && Math.abs(r - ind) <= cfg.reajuste.janela_reconhecimento_pontos) {
              codigos.add('D05');
              if (avaliado(t)) {
                emitir(c, 'D05', true, comp, t, `Reajuste de ${pct(r)} (parecido com o ${c.indice_reajuste}) fora do mês previsto (mês ${c.mes_reajuste}): ${brl(v)} contra ${brl(fx.m)} do contrato.`, [t.titulo_id]);
              }
            } else {
              codigos.add('D01');
              if (avaliado(t)) {
                emitir(c, 'D01', true, comp, t, `Valor ${brl(v)} está ${pct(r)} acima do contrato (${brl(fx.m)}${dias > 0 ? `; já considerados multa e juros de ${dias} dia(s) de atraso` : ''}).`, [t.titulo_id]);
              }
            }
          } else if (v < fx.min! - 0.005) {
            codigos.add('D02');
            atipicos.add(t.titulo_id);
            if (avaliado(t)) emitir(c, 'D02', false, comp, t, `Valor ${brl(v)} está abaixo do contrato (${brl(fx.m)}): possível erro de digitação.`, [t.titulo_id]);
          }
        });
      } else if (classe === 'utilidade') {
        const dias = Math.max(0, ...ts.map(atrasoDe));
        faixa = faixaUtilidade(c, comp, dias);
        for (const t of ts) faixaDoTitulo.set(t.titulo_id, faixa);
        const maior = [...ts].sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0))[0]!;
        if (faixa.esperado != null) {
          if (cobrado > faixa.max! + 0.005) {
            codigos.add('D09');
            ts.forEach((t) => atipicos.add(t.titulo_id));
            emitir(c, 'D09', false, comp, maior, `Consumo ${brl(cobrado)} está ${pct(cobrado / faixa.esperado - 1)} acima da média esperada (${brl(faixa.esperado)}; faixa de até ${brl(faixa.max!)}).`, ts.map((t) => t.titulo_id));
          } else if (cobrado < faixa.min! - 0.005) {
            const extremo = cobrado / faixa.esperado < cfg.utilidade.limite_erro_digitacao;
            const cod: CodigoDesvio = extremo ? 'D02' : 'D09';
            codigos.add(cod);
            ts.forEach((t) => atipicos.add(t.titulo_id));
            const texto = extremo
              ? `Valor ${brl(cobrado)} é ${(faixa.esperado / Math.max(cobrado, 0.01)).toFixed(1).replace('.', ',')} vezes menor que a média esperada (${brl(faixa.esperado)}): possível erro de digitação.`
              : `Consumo ${brl(cobrado)} está ${pct(1 - cobrado / faixa.esperado)} abaixo da média esperada (${brl(faixa.esperado)}).`;
            emitir(c, cod, false, comp, maior, texto, ts.map((t) => t.titulo_id));
          }
        }
      } else {
        faixa = faixaFrete(c, comp);
        for (const t of ts) faixaDoTitulo.set(t.titulo_id, faixa);
        if (faixa.esperado != null) {
          // Abaixo da faixa só vale para competência fechada e que não seja a primeira da série (mês incompleto).
          const fechada = ultimoDiaDoMes(comp) < hoje && comp !== primeira;
          const acima = cobrado > faixa.max! + 0.005;
          const abaixo = fechada && cobrado < faixa.min! - 0.005;
          if (acima || abaixo) {
            codigos.add('D09');
            ts.forEach((t) => atipicos.add(t.titulo_id));
            emitir(c, 'D09', false, comp, null, `Frete da competência ${comp}: ${brl(cobrado)} (${pct(cobrado / faixa.esperado - 1)} sobre a estimativa sazonal de ${brl(faixa.esperado)}); faixa de ${brl(faixa.min!)} a ${brl(faixa.max!)}.`, ts.map((t) => t.titulo_id));
          }
        }
      }

      // D08: forma de pagamento diferente da do contrato (só dos títulos que o motor vai avaliar)
      for (const t of ts) {
        if (!avaliado(t) || !c.forma_pagamento || t.forma_pagamento.toLowerCase() === c.forma_pagamento.toLowerCase()) continue;
        const trocou = trocasBancariasRecentes(idx, f, agora, config.regras.R07.janela_dias).length > 0;
        codigos.add('D08');
        atipicos.add(t.titulo_id);
        emitir(c, 'D08', trocou, comp, t, `Forma de pagamento ${t.forma_pagamento.toUpperCase()} difere da do contrato (${c.forma_pagamento.toUpperCase()})${trocou ? ' e os dados bancários do fornecedor mudaram há pouco: o destino também mudou.' : '.'}`, [t.titulo_id]);
      }

      competencias.push({
        contratoId: c.contrato_id, competencia: comp, classe, fornecedorId: c.fornecedor_id, gestorPessoaId: gestor,
        valorEsperado: faixa.esperado, faixaMin: faixa.min, faixaMax: faixa.max, valorCobrado: cobrado, qtdTitulos: ts.length,
        titulos: ts.map((t) => t.titulo_id),
        situacao: codigos.size ? 'desvio' : faixa.esperado == null ? 'sem_referencia' : 'conforme',
        desvios: [...codigos].sort(),
        vencimentoPrevisto: classe === 'frete' || !(dia >= 1) ? null : vencimentoNominal(cal, dia, comp),
      });
    }

    // D04: competência sem título perto do vencimento (competência atual e a seguinte)
    if (classe !== 'frete' && dia >= 1 && /vigente/i.test(c.status)) {
      for (const comp of [mesAtual, somarMeses(mesAtual, 1)]) {
        if (grupos.has(`${c.contrato_id}|${comp}`) || (c.inicio_vigencia && comp < mesDe(c.inicio_vigencia))) continue;
        const venc = vencimentoNominal(cal, dia, comp);
        if (foraDaVigencia(c, venc)) continue;
        const atingiu = hoje >= diasUteisAntes(cal, venc, cfg.alerta_sem_titulo_dias_uteis);
        const fx = classe === 'fixo' ? faixaFixo(c, comp) : faixaUtilidade(c, comp);
        if (atingiu) {
          const faltam = paraMs(venc) >= paraMs(hoje) ? diasUteisEntre(cal, hoje, venc) : -diasUteisEntre(cal, venc, hoje);
          emitir(c, 'D04', false, comp, null,
            faltam >= 0
              ? `Competência ${comp} ainda sem título: vencimento em ${dataBR(venc)} (faltam ${faltam} dia(s) útil(eis)). Risco de atraso.`
              : `Competência ${comp} ainda sem título e o vencimento (${dataBR(venc)}) passou há ${-faltam} dia(s) útil(eis). Risco de atraso.`,
            []);
        }
        competencias.push({
          contratoId: c.contrato_id, competencia: comp, classe, fornecedorId: c.fornecedor_id, gestorPessoaId: gestor,
          valorEsperado: fx.esperado, faixaMin: fx.min, faixaMax: fx.max, valorCobrado: 0, qtdTitulos: 0, titulos: [],
          situacao: atingiu ? 'sem_titulo' : 'aguardando', desvios: atingiu ? ['D04'] : [], vencimentoPrevisto: venc,
        });
      }
    }

    // D07: vigência acabando ou reajuste nos próximos N dias (só aviso)
    if (/vigente/i.test(c.status)) {
      const fim = c.fim_vigencia_atual;
      const dFim = fim ? diasEntre(hoje, fim) : -1;
      if (fim && dFim >= 0 && dFim <= cfg.aviso_proximos_dias) {
        emitir(c, 'D07', false, null, null, `A vigência do contrato termina em ${dataBR(fim)} (em ${dFim} dia(s))${RENOVA.test(c.prazo) ? ', com renovação automática' : ''}.`, [], `D07|${c.contrato_id}|vigencia|${fim}`);
      }
      const prox = proximoReajuste(c.mes_reajuste, c.data_ultimo_reajuste);
      const dProx = prox ? diasEntre(hoje, prox) : -1;
      if (prox && dProx >= 0 && dProx <= cfg.aviso_proximos_dias) {
        const ind = indiceDe(c, mesDe(prox));
        emitir(c, 'D07', false, null, null, `Reajuste do contrato em ${dataBR(prox)} (em ${dProx} dia(s)), pelo ${c.indice_reajuste}${ind != null ? ` (acumulado ${pct(ind)})` : ''}.`, [], `D07|${c.contrato_id}|reajuste|${prox}`);
      }
    }
  }

  // D10: título recorrente sem vínculo (só os que o motor vai avaliar)
  for (const v of vinculos.values()) {
    if (v.metodo !== 'sem_vinculo' || !v.contratoId || !titulosAvaliados.has(v.tituloId)) continue;
    const t = idx.tituloPorId.get(v.tituloId)!;
    const c = idx.contratoPorId.get(v.contratoId)!;
    atipicos.add(t.titulo_id);
    emitir(c, 'D10', true, null, t, `${v.motivo} Não dá para saber a que competência do contrato ele pertence.`, [t.titulo_id]);
  }

  competencias.sort((a, b) => a.contratoId.localeCompare(b.contratoId) || a.competencia.localeCompare(b.competencia));

  const infoDoTitulo = (tituloId: string): InfoContratoTitulo | null => {
    const v = vinculos.get(tituloId);
    if (!v) return null;
    const fx = faixaDoTitulo.get(tituloId);
    return {
      contratoId: v.contratoId,
      competencia: v.competencia,
      metodo: v.metodo,
      confianca: v.confianca,
      valorEsperado: fx?.esperado ?? null,
      faixaMin: fx?.min ?? null,
      faixaMax: fx?.max ?? null,
      rotinaContratual: v.confianca === 'alta' && !!v.contratoId && !atipicos.has(tituloId),
    };
  };

  return { contratos, classes, vinculos, competencias, desvios, desviosPorTitulo, infoDoTitulo };
}
