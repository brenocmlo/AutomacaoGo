import { paraMs } from '@/lib/clock/relogio';
import { falhou, passou, type Regra } from './tipos';

/**
 * R14 · Mensagem de risco. Olha as mensagens recentes do fornecedor (ou em nome dele) que o leitor
 * marcou como perigosas. Troca de conta vinda de canal fora do cadastro, ou segunda via com
 * beneficiário/banco diferentes de canal estranho → crítica (retira). O resto vira alerta.
 * A regra só LÊ o resultado do leitor; nunca o texto bruto.
 */
export const r14Mensagem: Regra = (d, ctx) => {
  const f = d.fornecedor;
  if (!f) return passou('R14');
  const janelaMs = ctx.config.regras.R14.janela_dias * 86_400_000;
  const agora = paraMs(ctx.agora);
  const perigosas = ctx.idx.leiturasDoFornecedor(f.fornecedor_id).filter(
    (l) => l.risco !== 'nenhum' && agora - paraMs(l.dataHora) <= janelaMs,
  );
  // Mensagem sobre outra NF não vale para este título, exceto troca de conta (vale para o fornecedor todo).
  const nf = d.nfNumero.replace(/^0+/, '');
  const aplicaveis = perigosas.filter((l) => l.sinais.includes('pede_troca_conta') || !l.nfCitada || l.nfCitada.replace(/^0+/, '') === nf);
  if (!aplicaveis.length) return passou('R14');
  const ev = aplicaveis.map((l) => l.comunicacaoId);
  const critica = aplicaveis.find((l) => l.risco === 'critico');
  if (critica) return falhou('R14', 'critica', `Mensagem de risco em nome de ${f.nome_fantasia}: ${critica.resumo}.`, ev);
  return falhou('R14', 'alerta', `Mensagem suspeita em nome de ${f.nome_fantasia}: ${aplicaveis[0].resumo}.`, ev);
};
