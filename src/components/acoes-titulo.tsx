'use client';

import { useActionState, useState } from 'react';
import { aprovar, decidir, recusar, type EstadoAcao } from '@/app/acoes';

const inicial: EstadoAcao = { ok: null, erro: null };

// Button do design system, tamanho pequeno: sólido para a decisão, outline para as alternativas.
const botao = 'rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50';
const solido = `${botao} border-transparent text-on-solid`;
const outline = `${botao} border-border hover:bg-surface-2`;
const campo = 'flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-xs focus:border-accent';

/**
 * Ações humanas no título. Só aparecem para aprovadores, mas quem garante a regra
 * (alçada, segregação, aprovação dupla) é a função do banco.
 */
export function AcoesTitulo({ simulacaoId, tituloId, solicitacaoId, retirado }: {
  simulacaoId: string;
  tituloId: string;
  solicitacaoId: string | null;
  retirado: boolean;
}) {
  const [eAprovar, fAprovar, pAprovar] = useActionState(aprovar, inicial);
  const [eRecusar, fRecusar, pRecusar] = useActionState(recusar, inicial);
  const [eDecidir, fDecidir, pDecidir] = useActionState(decidir, inicial);
  const [modo, setModo] = useState<null | 'recusar' | 'devolver_ao_lote' | 'manter_retido' | 'retirar_do_lote'>(null);
  const estados = [eAprovar, eRecusar, eDecidir];
  const ultimo = estados.find((e) => e.erro) ?? estados.find((e) => e.ok);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {solicitacaoId && (
          <form action={fAprovar}>
            <input type="hidden" name="solicitacao" value={solicitacaoId} />
            <button disabled={pAprovar} className={`${solido} bg-ok`}>Aprovar</button>
          </form>
        )}
        {solicitacaoId && <button onClick={() => setModo('recusar')} className={outline}>Recusar</button>}
        {retirado && <button onClick={() => setModo('devolver_ao_lote')} className={outline}>Devolver ao lote</button>}
        {retirado && <button onClick={() => setModo('manter_retido')} className={outline}>Manter retido</button>}
        {!retirado && !solicitacaoId && <button onClick={() => setModo('retirar_do_lote')} className={outline}>Retirar do lote</button>}
      </div>

      {modo === 'recusar' && solicitacaoId && (
        <form action={fRecusar} className="flex gap-2">
          <input type="hidden" name="solicitacao" value={solicitacaoId} />
          <input name="motivo" required placeholder="Motivo da recusa" className={campo} />
          <button disabled={pRecusar} className={`${solido} bg-danger`}>Confirmar</button>
        </form>
      )}
      {modo && modo !== 'recusar' && (
        <form action={fDecidir} className="flex gap-2">
          <input type="hidden" name="simulacao" value={simulacaoId} />
          <input type="hidden" name="titulo" value={tituloId} />
          <input type="hidden" name="acao" value={modo} />
          <input name="justificativa" required placeholder="Justificativa (obrigatória)" className={campo} />
          <button disabled={pDecidir} className={`${solido} bg-accent`}>Confirmar</button>
        </form>
      )}
      {ultimo?.erro && <p className="text-xs text-danger">{ultimo.erro}</p>}
      {ultimo?.ok && !ultimo.erro && <p className="text-xs text-ok">Feito: {ultimo.ok}.</p>}
    </div>
  );
}
