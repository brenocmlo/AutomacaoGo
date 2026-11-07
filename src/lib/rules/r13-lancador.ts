import { diasEntre, paraMs } from '@/lib/clock/relogio';
import { brl, falhou, passou, type Regra } from './tipos';

/**
 * R13 · Lançador. Título lançado por usuário desligado/inativo → retirar.
 * Valor alto lançado por usuário admitido há pouco → só alerta (aumenta o risco).
 */
export const r13Lancador: Regra = (d, ctx) => {
  const t = d.titulo;
  const u = d.lancador;
  if (!u) return passou('R13', 'lançador não está em usuarios_sistema');
  const ev = [t.titulo_id, u.login];
  if (u.data_desligamento && paraMs(u.data_desligamento) <= paraMs(t.data_lancamento)) {
    return falhou('R13', 'conferencia', `Título lançado em ${t.data_lancamento.slice(0, 10)} por ${u.nome}, desligado(a) em ${u.data_desligamento}.`, ev);
  }
  if (/inativo/i.test(u.status) && !u.data_desligamento) {
    return falhou('R13', 'conferencia', `Título lançado por usuário inativo (${u.nome}).`, ev);
  }
  const cfg = ctx.config.regras.R13;
  if (u.data_admissao && diasEntre(u.data_admissao, t.data_lancamento) < cfg.dias_admissao_recente && d.valor >= cfg.valor_alto) {
    return falhou('R13', 'alerta', `Valor alto (${brl(d.valor)}) lançado por ${u.nome}, admitido(a) em ${u.data_admissao}.`, ev);
  }
  return passou('R13');
};
