import { Bell, ClipboardList, FileSignature, Clock, FastForward, LayoutDashboard, LogOut, RotateCcw, ScrollText, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { NavLink } from '@/components/nav-link';
import { Badge, PAPEIS, horaBR } from '@/components/ui';
import { avancarRelogio, reiniciarRelogio, sair } from '@/app/acoes';
import { contexto, horaSimulada, periodo } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { TempoReal } from '@/components/tempo-real';
import { BotaoPendente } from '@/components/botao-pendente';
import { usuarioAtual } from '@/lib/supabase/servidor';

export default async function PainelLayout({ children }: LayoutProps<'/'>) {
  const hora = await horaSimulada();
  const { fim } = periodo();
  const local = !supabaseConfigurado();
  const usuario = await usuarioAtual();
  const podeRelogio = local || usuario?.papel === 'admin';
  const { usandoBaseOriginal } = contexto();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-3">
          <ShieldCheck className="size-5 text-accent" />
          <span className="font-semibold tracking-tight">GoAudit</span>
        </div>
        <nav className="flex flex-col gap-1">
          <NavLink href="/" icone={<LayoutDashboard className="size-4" />}>Visão geral</NavLink>
          <NavLink href="/auditoria" icone={<ClipboardList className="size-4" />}>Fila de auditoria</NavLink>
          <NavLink href="/pagamentos" icone={<TrendingUp className="size-4" />}>Rotina e variações</NavLink>
          <NavLink href="/contratos" icone={<FileSignature className="size-4" />}>Contratos</NavLink>
          <NavLink href="/alertas" icone={<Bell className="size-4" />} desabilitado={local}>Alertas e caixa</NavLink>
          <NavLink href="/log" icone={<ScrollText className="size-4" />} desabilitado={local}>Log e gargalos</NavLink>
          {usuario?.papel === 'admin' && <NavLink href="/equipe" icone={<Users className="size-4" />}>Equipe</NavLink>}
        </nav>
        <div className="mt-auto space-y-2 px-3 text-xs text-muted">
          {usuario ? (
            <>
              <p className="truncate" title={usuario.email}>{usuario.email}</p>
              <p>{PAPEIS[usuario.papel ?? ''] ?? 'Sem papel'}{usuario.pessoaId ? ` · ${usuario.pessoaId}` : ''}</p>
              <form action={sair}>
                <button className="flex items-center gap-1.5 hover:text-text"><LogOut className="size-3.5" />Sair</button>
              </form>
            </>
          ) : (
            <p>Modo local, sem login.</p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted" />
            <span className="text-xs text-muted">Hora simulada</span>
            <span className="tabular font-semibold">{horaBR(hora)}</span>
          </div>
          {podeRelogio && (
            <div className="flex items-center gap-1">
              {[1, 6, 24].map((p) => (
                <form key={p} action={avancarRelogio}>
                  <input type="hidden" name="passos" value={p} />
                  <BotaoPendente
                    disabled={hora >= fim}
                    icone={<FastForward className="size-3" />}
                    className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
                  >
                    +{p}h
                  </BotaoPendente>
                </form>
              ))}
              <form action={reiniciarRelogio}>
                <BotaoPendente
                  icone={<RotateCcw className="size-3" />}
                  pendente="Reiniciando..."
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
                  title={local ? 'Voltar ao início' : 'Encerra a simulação atual e começa outra em 02/11 08:00 (o histórico e o log ficam)'}
                >
                  {local ? 'Reiniciar' : 'Nova simulação'}
                </BotaoPendente>
              </form>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!local && usuario && <TempoReal />}
            {local && <Badge tom="warn" title="Sem Supabase: decisões recalculadas a cada hora, sem persistência nem login">Modo local</Badge>}
            {usandoBaseOriginal && <Badge tom="neutral" title="Rode npm run demo:montar para incluir os cenários">Base original</Badge>}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
