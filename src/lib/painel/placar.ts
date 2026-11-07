import path from 'node:path';
import fs from 'node:fs';
import { lerCsv } from '@/lib/data/csv';
import { raizProjeto } from '@/lib/config/config';
import { contexto } from '@/lib/contexto';
import { todas } from '@/lib/supabase/paginacao';
import { supabaseServidor } from '@/lib/supabase/servidor';
import type { Painel } from './dados';

/**
 * Placar estimado (seção 9). O gabarito considerado é o da base montada (data/demo/cenarios_esperados.csv,
 * só os cenários presentes na base); sem ele, cai no gabarito inteiro de data/cenarios.
 *   placar = -(dinheiro que saiu indevidamente + custo de atrasar pagamento legítimo + acionamentos desnecessários)
 * "Indevido" vem do gabarito dos cenários plantados (data/cenarios/cenarios_esperados.csv): títulos
 * esperados como RETIRADO, exceto os que a validação deve devolver (falso positivo, C17). Títulos
 * fora do gabarito contam como legítimos. É uma estimativa para a demo, não uma apuração contábil.
 */

export interface LinhaPlacar {
  rotulo: string;
  valor: number;
  detalhe: string;
}

export interface Cenario {
  indevidoSaiu: number;
  atraso: number;
  acionamentos: number;
  total: number; // negativo
  linhas: LinhaPlacar[];
}

export interface Placar {
  disponivel: boolean;
  motivo?: string;
  com: Cenario;
  sem: Cenario;
  protegido: number;
  indevidosTotal: number;
  indevidosJaFechados: number;
  indevidosAindaEmRisco: number;
}

let gabarito: Set<string> | null | undefined;

/** Títulos que não deveriam ser pagos. null se o arquivo de gabarito não existe. */
function titulosIndevidos(): Set<string> | null {
  if (gabarito !== undefined) return gabarito;
  const arq = [path.join(contexto().baseDir, 'cenarios_esperados.csv'), path.join(raizProjeto(), 'data', 'cenarios', 'cenarios_esperados.csv')].find((a) => fs.existsSync(a));
  if (!arq) return (gabarito = null);
  const linhas = lerCsv<Record<string, string>>(arq);
  return (gabarito = new Set(
    linhas.filter((l) => l.titulo_id && l.destino_esperado === 'RETIRADO' && l.validacao_esperada !== 'devolver').map((l) => l.titulo_id!),
  ));
}

interface Linha {
  titulo_id: string;
  categoria: string | null;
  valor: number | string;
  destino: string;
  fechamento: string;
}

const ZERO: Cenario = { indevidoSaiu: 0, atraso: 0, acionamentos: 0, total: 0, linhas: [] };

export async function calcularPlacar(p: Painel): Promise<Placar> {
  const vazio = (motivo: string): Placar => ({ disponivel: false, motivo, com: ZERO, sem: ZERO, protegido: 0, indevidosTotal: 0, indevidosJaFechados: 0, indevidosAindaEmRisco: 0 });
  if (!p.sim) return vazio('O placar usa as decisões gravadas no Supabase; no modo local não há histórico.');
  const ruins = titulosIndevidos();
  if (!ruins) return vazio('Gabarito dos cenários ausente (rode npm run demo:montar).');

  const cliente = await supabaseServidor();
  const sim = p.sim.id;
  const linhas = await todas<Linha>((de, ate) =>
    cliente.from('decisoes').select('titulo_id, categoria, valor, destino, fechamento').eq('simulacao_id', sim).order('titulo_id').range(de, ate),
  );
  const { atraso, custoAcionamentoDesnecessario } = contexto().base.politicas;
  const fator = atraso.multa + atraso.jurosMes * (7 / 30); // um atraso conta como 7 dias corridos

  let saiuCom = 0, saiuSem = 0, protegido = 0, emRisco = 0, atrasoCom = 0, acion = 0;
  let nAtrasados = 0, nAcion = 0, nRuinsFechados = 0, nRuins = 0;
  for (const l of linhas) {
    const v = Number(l.valor);
    const fechado = l.fechamento.slice(0, 16).replace(' ', 'T') <= p.hora;
    const retido = l.destino === 'RETIRADO' || l.destino === 'RECUSADO';
    if (ruins.has(l.titulo_id)) {
      nRuins++;
      if (fechado) {
        nRuinsFechados++;
        saiuSem += v;
        if (l.destino === 'ENVIADO') saiuCom += v;
        else if (retido) protegido += v;
      } else if (!retido) emRisco += v;
      else protegido += v;
    } else if (retido) {
      acion += custoAcionamentoDesnecessario;
      nAcion++;
      if (fechado) {
        atrasoCom += v * fator + (atraso.custoRelacionamento[l.categoria ?? ''] ?? 0);
        nAtrasados++;
      }
    }
  }

  const cenario = (saiu: number, atr: number, ac: number, nAtr: number, nAc: number): Cenario => ({
    indevidoSaiu: saiu, atraso: atr, acionamentos: ac, total: -(saiu + atr + ac),
    linhas: [
      { rotulo: 'Dinheiro que saiu indevidamente', valor: saiu, detalhe: 'títulos do gabarito enviados ao banco' },
      { rotulo: 'Atraso de pagamento legítimo', valor: atr, detalhe: `${nAtr} títulos retidos após o fechamento` },
      { rotulo: 'Acionamentos desnecessários', valor: ac, detalhe: `${nAc} retenções de título legítimo` },
    ],
  });
  return {
    disponivel: true,
    com: cenario(saiuCom, atrasoCom, acion, nAtrasados, nAcion),
    sem: cenario(saiuSem, 0, 0, 0, 0),
    protegido,
    indevidosTotal: nRuins,
    indevidosJaFechados: nRuinsFechados,
    indevidosAindaEmRisco: emRisco,
  };
}
