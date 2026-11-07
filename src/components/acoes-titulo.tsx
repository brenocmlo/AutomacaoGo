'use client';

import { useActionState, useState } from 'react';
import { aprovar, decidir, recusar, type EstadoAcao } from '@/app/acoes';

const inicial: EstadoAcao = { ok: null, erro: null };

const botao = 'rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50';

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
            <button disabled={pAprovar} className={`${botao} bg-ok text-white`}>Aprovar</button>
          </form>
        )}
        {solicitacaoId && <button onClick={() => setModo('recusar')} className={`${botao} border border-border`}>Recusar</button>}
        {retirado && <button onClick={() => setModo('devolver_ao_lote')} className={`${botao} border border-border`}>Devolver ao lote</button>}
        {retirado && <button onClick={() => setModo('manter_retido')} className={`${botao} border border-border`}>Manter retido</button>}
        {!retirado && !solicitacaoId && <button onClick={() => setModo('retirar_do_lote')} className={`${botao} border border-border`}>Retirar do lote</button>}
      </div>

      {modo === 'recusar' && solicitacaoId && (
        <form action={fRecusar} className="flex gap-2">
          <input type="hidden" name="solicitacao" value={solicitacaoId} />
          <input name="motivo" required placeholder="Motivo da recusa" className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs" />
          <button disabled={pRecusar} className={`${botao} bg-danger text-white`}>Confirmar</button>
        </form>
      )}
      {modo && modo !== 'recusar' && (
        <form action={fDecidir} className="flex gap-2">
          <input type="hidden" name="simulacao" value={simulacaoId} />
          <input type="hidden" name="titulo" value={tituloId} />
          <input type="hidden" name="acao" value={modo} />
          <input name="justificativa" required placeholder="Justificativa (obrigatória)" className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs" />
          <button disabled={pDecidir} className={`${botao} bg-accent text-white`}>Confirmar</button>
        </form>
      )}
      {ultimo?.erro && <p className="text-xs text-danger">{ultimo.erro}</p>}
      {ultimo?.ok && !ultimo.erro && <p className="text-xs text-ok">Feito: {ultimo.ok}.</p>}
    </div>
  );
}
