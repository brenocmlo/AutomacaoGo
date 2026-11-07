'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { contexto } from '@/lib/painel/dados';
import { clienteAdmin } from '@/lib/supabase/admin';
import { supabaseConfigurado } from '@/lib/supabase/config';
import { usuarioAtual } from '@/lib/supabase/servidor';

/** Papéis que uma pessoa pode ter. As contas dos agentes não se criam aqui: vêm do .env. */
const PAPEIS_HUMANOS = ['aprovador', 'consulta', 'admin'] as const;
type PapelHumano = (typeof PAPEIS_HUMANOS)[number];

async function exigirAdmin() {
  if (!supabaseConfigurado()) throw new Error('A gestão de equipe exige o Supabase configurado.');
  const u = await usuarioAtual();
  if (u?.papel !== 'admin') throw new Error('Só a administração gerencia a equipe.');
  return u;
}

const voltar = (tipo: 'ok' | 'erro', msg: string): never => redirect(`/equipe?${tipo}=${encodeURIComponent(msg)}`);

export async function criarUsuario(formData: FormData) {
  await exigirAdmin();
  const nome = String(formData.get('nome') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const senha = String(formData.get('senha') ?? '');
  const papel = String(formData.get('papel') ?? '') as PapelHumano;
  const pessoaId = String(formData.get('pessoa_id') ?? '').trim() || null;
  const alcadaTxt = String(formData.get('alcada') ?? '').trim().replace(/\./g, '').replace(',', '.');

  if (nome.length < 3) return voltar('erro', 'Informe o nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return voltar('erro', 'E-mail inválido.');
  if (senha.length < 8) return voltar('erro', 'A senha precisa de pelo menos 8 caracteres.');
  if (!PAPEIS_HUMANOS.includes(papel)) return voltar('erro', 'Escolha uma função.');
  if (pessoaId && !contexto().base.politicas.pessoas.some((p) => p.pessoaId === pessoaId)) return voltar('erro', 'Pessoa da política não encontrada.');

  // aprovador: alçada em reais (vazio = sem limite); demais papéis não aprovam
  let alcada: number | null = 0;
  if (papel === 'admin') alcada = null; // administração: sem limite de alçada
  if (papel === 'aprovador') {
    alcada = alcadaTxt === '' ? null : Number(alcadaTxt);
    if (alcada !== null && (!Number.isFinite(alcada) || alcada < 0)) return voltar('erro', 'Alçada inválida.');
  }

  const supa = clienteAdmin();
  const { data, error } = await supa.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) return voltar('erro', /already|registered/i.test(error.message) ? 'Já existe um login com esse e-mail.' : 'Não foi possível criar o login.');

  const { error: errPerfil } = await supa.from('perfis').insert({ id: data.user.id, nome, email, papel, alcada, pessoa_id: pessoaId, ativo: true });
  if (errPerfil) {
    await supa.auth.admin.deleteUser(data.user.id); // não deixa login sem perfil
    return voltar('erro', errPerfil.code === '23505' ? 'Essa pessoa da política já tem um login.' : 'Não foi possível gravar o perfil.');
  }
  revalidatePath('/equipe');
  return voltar('ok', `${nome} agora tem acesso como ${papel}.`);
}

export async function removerUsuario(formData: FormData) {
  const eu = await exigirAdmin();
  const id = String(formData.get('id') ?? '');
  if (id === eu.id) return voltar('erro', 'Você não pode remover o próprio acesso.');
  const supa = clienteAdmin();
  const { data: perfil } = await supa.from('perfis').select('papel, nome').eq('id', id).maybeSingle();
  if (!perfil) return voltar('erro', 'Usuário não encontrado.');
  if (!(PAPEIS_HUMANOS as readonly string[]).includes(perfil.papel)) return voltar('erro', 'As contas dos agentes não se removem pela tela.');

  const { error } = await supa.auth.admin.deleteUser(id);
  if (error) {
    // Já deixou rastro (aprovações, log): não apaga, só tira o acesso.
    await supa.from('perfis').update({ ativo: false }).eq('id', id);
    await supa.auth.admin.updateUserById(id, { ban_duration: '876000h' });
    revalidatePath('/equipe');
    return voltar('ok', `${perfil.nome} tem histórico e foi apenas desativado(a).`);
  }
  revalidatePath('/equipe');
  return voltar('ok', `${perfil.nome} foi removido(a).`);
}
