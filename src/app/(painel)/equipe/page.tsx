import { notFound } from 'next/navigation';
import { Badge, Card, CardTitulo, PAPEIS, brl } from '@/components/ui';
import { contexto } from '@/lib/painel/dados';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { supabaseServidor, usuarioAtual } from '@/lib/supabase/servidor';
import { criarUsuario, removerUsuario } from './acoes';

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const campo = 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text focus:border-accent';

interface Perfil {
  id: string;
  nome: string;
  email: string;
  papel: string;
  alcada: number | null;
  pessoa_id: string | null;
  ativo: boolean;
}

const HUMANOS = ['aprovador', 'consulta', 'admin'];

export default async function Equipe({ searchParams }: PageProps<'/equipe'>) {
  const usuario = await usuarioAtual();
  if (!supabaseConfigurado() || usuario?.papel !== 'admin') notFound();
  const sp = await searchParams;
  const ok = um(sp.ok);
  const erro = um(sp.erro);

  const supa = await supabaseServidor();
  const { data } = await supa.from('perfis').select('id, nome, email, papel, alcada, pessoa_id, ativo').order('papel').order('nome');
  const perfis = ((data ?? []) as (Omit<Perfil, 'alcada'> & { alcada: number | string | null })[]).map((p) => ({ ...p, alcada: p.alcada == null ? null : Number(p.alcada) }));
  const pessoas = contexto().base.politicas.pessoas;
  const ocupadas = new Set(perfis.map((p) => p.pessoa_id).filter(Boolean));
  const livres = pessoas.filter((p) => !ocupadas.has(p.pessoaId));
  const nomePessoa = new Map(pessoas.map((p) => [p.pessoaId, p.nome]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Equipe</h1>
        <p className="text-sm text-muted">
          Quem acessa o GoAudit e com qual função. Só a administração vê esta tela. As contas dos agentes vêm do ambiente e não se alteram aqui.
        </p>
      </div>

      {ok && <p role="status" className="rounded-lg border border-border bg-ok-soft px-3 py-2 text-sm text-ok">{ok}</p>}
      {erro && <p role="alert" className="rounded-lg border border-border bg-danger-soft px-3 py-2 text-sm text-danger">{erro}</p>}

      <Card>
        <CardTitulo>Adicionar pessoa</CardTitulo>
        <form action={criarUsuario} className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">Nome completo
            <input name="nome" required minLength={3} autoComplete="off" className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">E-mail
            <input name="email" type="email" required autoComplete="off" className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Senha inicial (mín. 8 caracteres)
            <input name="senha" type="password" required minLength={8} autoComplete="new-password" className={campo} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Função
            <select name="papel" required defaultValue="consulta" className={campo}>
              <option value="aprovador">Aprovador: aprova e recusa dentro da alçada</option>
              <option value="consulta">Consulta: gestor de contrato, só lê o que é dele</option>
              <option value="admin">Administração: conduz a simulação e gerencia a equipe</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Alçada em R$ (só aprovador; vazio = sem limite)
            <input name="alcada" inputMode="decimal" placeholder="ex.: 50000" className={`${campo} tabular`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Pessoa na política (PS)
            <select name="pessoa_id" defaultValue="" className={campo}>
              <option value="">Nenhuma</option>
              {livres.map((p) => <option key={p.pessoaId} value={p.pessoaId}>{p.pessoaId} · {p.nome}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-solid hover:opacity-90">Criar acesso</button>
            <span className="ml-3 text-xs text-muted">O gestor de contrato só vê os contratos em que é gestor se estiver ligado à pessoa (PS) dele.</span>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitulo extra={<span className="text-xs text-muted">{perfis.length} contas</span>}>Contas</CardTitulo>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">E-mail</th>
                <th className="px-3 py-2 font-medium">Função</th>
                <th className="px-3 py-2 text-right font-medium">Alçada</th>
                <th className="px-3 py-2 font-medium">Pessoa (PS)</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {perfis.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">{p.nome}</td>
                  <td className="px-3 py-2 text-muted">{p.email}</td>
                  <td className="px-3 py-2">{PAPEIS[p.papel] ?? p.papel}</td>
                  <td className="tabular px-3 py-2 text-right">{p.papel === 'aprovador' ? (p.alcada == null ? 'Sem limite' : brl(p.alcada)) : '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">{p.pessoa_id ? `${p.pessoa_id} · ${nomePessoa.get(p.pessoa_id) ?? ''}` : '—'}</td>
                  <td className="px-3 py-2">{p.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge tom="neutral">Desativado</Badge>}</td>
                  <td className="px-3 py-2 text-right">
                    {HUMANOS.includes(p.papel) && p.id !== usuario?.id ? (
                      <form action={removerUsuario}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-xs text-danger hover:underline">Remover</button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted">{p.id === usuario?.id ? 'Você' : 'Agente'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
