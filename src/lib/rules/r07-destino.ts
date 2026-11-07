import { trocasBancariasRecentes } from './auxiliares';
import { falhou, passou, type Regra } from './tipos';

/**
 * R07 · Destino TED/PIX. Dados bancários alterados há menos de N dias sem confirmação
 * válida (ligação para o telefone que estava no cadastro ANTES da alteração).
 */
export const r07Destino: Regra = (d, ctx) => {
  const t = d.titulo;
  if (!['ted', 'pix'].includes(t.forma_pagamento) || !d.fornecedor) return passou('R07', 'não usa dados bancários do cadastro');
  const trocas = trocasBancariasRecentes(ctx.idx, d.fornecedor, ctx.agora, ctx.config.regras.R07.janela_dias);
  const invalida = trocas.find((x) => !x.confirmacaoValida);
  if (!invalida) return passou('R07');
  return falhou(
    'R07',
    'critica',
    `Dados bancários do fornecedor alterados em ${invalida.data.slice(0, 10)} (origem: ${invalida.alteracoes[0]!.origem}); ${invalida.motivo}. O dinheiro pode ir para a conta errada.`,
    [t.titulo_id, ...invalida.alteracoes.map((a) => a.alteracao_id)],
  );
};
