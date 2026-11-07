'use client';

import { useActionState, useState } from 'react';
import { entrar, type EstadoLogin } from './acoes';

interface Conta {
  email: string;
  nome: string;
  rotulo: string;
}

export function FormularioLogin({ contas }: { contas: Conta[] }) {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, { erro: null });
  const [email, setEmail] = useState('');

  return (
    <div className="space-y-6">
      <form action={acao} className="space-y-3">
        <label className="block text-sm">
          <span className="text-muted">E-mail</span>
          <input name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 outline-none focus:border-accent" />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Senha</span>
          <input name="senha" type="password" required className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 outline-none focus:border-accent" />
        </label>
        {estado.erro && <p className="text-sm text-danger">{estado.erro}</p>}
        <button disabled={pendente} className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-60">
          {pendente ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      {contas.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contas de demonstração</p>
          <ul className="grid gap-1">
            {contas.map((c) => (
              <li key={c.email}>
                <button type="button" onClick={() => setEmail(c.email)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${email === c.email ? 'bg-accent-soft' : ''}`}>
                  <span className="truncate">{c.nome}</span>
                  <span className="shrink-0 text-muted">{c.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
