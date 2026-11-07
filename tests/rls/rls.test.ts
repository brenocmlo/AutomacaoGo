/**
 * Bateria de RLS (B3): entra no Supabase com cada papel (JWT próprio) e tenta
 * operações permitidas e proibidas. Roda contra o projeto do .env.local, depois de
 * `npm run db:push` e `npm run seed:usuarios`.
 *
 * Uso: npm run test:rls
 */
import { config as dotenv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { usuariosDemo, type UsuarioDemo } from '../../scripts/carregar-usuarios';

dotenv({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;

async function entrar(u: UsuarioDemo): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.senha });
  if (error) throw new Error(`login ${u.email}: ${error.message}`);
  return c;
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
}

const usuarios = usuariosDemo();
const um = (f: (u: UsuarioDemo) => boolean) => {
  const u = usuarios.find(f);
  if (!u) throw new Error('usuário de demo não encontrado');
  return u;
};
const U = {
  admin: um((u) => u.papel === 'admin'),
  operacao: um((u) => u.papel === 'agente_operacao'),
  validacao: um((u) => u.papel === 'agente_validacao'),
  leitor: um((u) => u.papel === 'agente_leitor'),
  aprovadorSemPessoa: um((u) => u.papel === 'aprovador' && !u.pessoa_id),
  coordenacao: um((u) => u.papel === 'aprovador' && u.alcada !== null && !!u.pessoa_id),
  diretoria: um((u) => u.papel === 'aprovador' && u.alcada === null),
  consulta: um((u) => u.papel === 'consulta'),
  consulta2: usuarios.filter((u) => u.papel === 'consulta')[1]!,
};

const c = {} as Record<keyof typeof U, SupabaseClient>;
let sim: string;
const HORA = '2026-11-02T08:00:00';
const FECHA = '2026-11-04T10:00:00';
const tid = (s: string) => `RLS-${Date.now()}-${s}`;

beforeAll(async () => {
  for (const k of Object.keys(U) as (keyof typeof U)[]) c[k] = await entrar(U[k]);
  const { data, error } = await c.admin
    .from('simulacoes')
    .insert({ nome: `teste-rls ${new Date().toISOString()}`, cenario: 'teste', inicio: HORA, fim: '2026-11-09T08:00:00', hora_simulada: HORA })
    .select('id')
    .single();
  if (error) throw error;
  sim = data.id;
});

async function novaDecisao(titulo: string, valor: number, destino = 'AGUARDANDO_APROVACAO') {
  return c.operacao.from('decisoes').insert({
    simulacao_id: sim, titulo_id: titulo, fornecedor_id: 'FX', valor, lote: 'L-TESTE', banco: 'Banco Teste',
    fechamento: FECHA, destino, hora_simulada: HORA,
  });
}

async function novaSolicitacao(titulo: string, valor: number, tipo: string, exigidos: string[], lancadoPor: string | null = null) {
  await novaDecisao(titulo, valor);
  const { data, error } = await c.operacao
    .from('solicitacoes_aprovacao')
    .insert({ simulacao_id: sim, titulo_id: titulo, valor, tipo, nivel: 'aprovador', aprovadores_exigidos: exigidos, lancado_por: lancadoPor, motivo: 'teste', hora_simulada: HORA })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

describe('JWT com claims gravadas pelo servidor', () => {
  it.each(Object.keys(U) as (keyof typeof U)[])('%s recebe papel, alçada e pessoa_id', async (k) => {
    const { data } = await c[k].auth.getSession();
    const cl = claims(data.session!.access_token);
    expect(cl.papel).toBe(U[k].papel);
    expect(cl.alcada ?? null).toBe(U[k].alcada);
    expect(cl.pessoa_id ?? null).toBe(U[k].pessoa_id);
  });
});

describe('anon e sem sessão', () => {
  it('anon não lê nada', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    for (const t of ['decisoes', 'log_auditoria', 'perfis', 'notificacoes']) {
      const { data } = await anon.from(t).select('*').limit(1);
      expect(data ?? [], t).toHaveLength(0);
    }
  });
});

describe('agente de operação', () => {
  it('grava decisão e log', async () => {
    const t = tid('op');
    expect((await novaDecisao(t, 100, 'LIBERADO_AUTOMATICO')).error).toBeNull();
    const { error } = await c.operacao.from('log_auditoria').insert({ simulacao_id: sim, ator_tipo: 'agente_operacao', acao: 'liberou', entidade: 'titulo', entidade_id: t });
    expect(error).toBeNull();
  });
  it('NÃO libera acima da alçada do próprio JWT', async () => {
    const { error } = await novaDecisao(tid('acima'), U.operacao.alcada! + 0.01, 'LIBERADO_AUTOMATICO');
    expect(error).not.toBeNull();
  });
  it('NÃO grava destino APROVADO', async () => {
    const { error } = await novaDecisao(tid('aprov'), 10, 'APROVADO');
    expect(error).not.toBeNull();
  });
  it('NÃO insere em aprovacoes', async () => {
    const sol = await novaSolicitacao(tid('op-aprova'), 100, 'simples', ['aprovador']);
    const { data: me } = await c.operacao.auth.getUser();
    const { error } = await c.operacao.from('aprovacoes').insert({ solicitacao_id: sol, aprovador_id: me.user!.id, decisao: 'aprovado' });
    expect(error).not.toBeNull();
  });
  it('NÃO aprova pela função', async () => {
    const sol = await novaSolicitacao(tid('op-rpc'), 100, 'simples', ['aprovador']);
    const { error } = await c.operacao.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(error?.message).toMatch(/aprovadores/i);
  });
  it('não se passa por humano no log (ator vem do JWT)', async () => {
    const t = tid('fingir');
    await c.operacao.from('log_auditoria').insert({ simulacao_id: sim, ator_tipo: 'humano', ator_papel: 'aprovador', acao: 'aprovou', entidade: 'titulo', entidade_id: t });
    const { data } = await c.admin.from('log_auditoria').select('ator_tipo, ator_papel').eq('entidade_id', t).single();
    expect(data).toEqual({ ator_tipo: 'agente_operacao', ator_papel: 'agente_operacao' });
  });
});

describe('leitor de mensagens', () => {
  it('insere mensagem processada', async () => {
    const { error } = await c.leitor.from('mensagens_processadas').insert({ simulacao_id: sim, comunicacao_id: tid('em'), tipo: 'phishing', hora_simulada: HORA });
    expect(error).toBeNull();
  });
  it('NÃO lê decisões nem log', async () => {
    await novaDecisao(tid('leitor'), 50, 'RETIRADO');
    for (const t of ['decisoes', 'log_auditoria', 'solicitacoes_aprovacao']) {
      const { data } = await c.leitor.from(t).select('*').eq('simulacao_id', sim);
      expect(data ?? [], t).toHaveLength(0);
    }
  });
  it('NÃO altera decisões nem lotes', async () => {
    const r1 = await c.leitor.from('decisoes').insert({ simulacao_id: sim, titulo_id: tid('x'), fornecedor_id: 'F', valor: 1, lote: 'L', banco: 'B', fechamento: FECHA, destino: 'LIBERADO_AUTOMATICO', hora_simulada: HORA });
    const r2 = await c.leitor.from('movimentos_lote').insert({ simulacao_id: sim, titulo_id: 'x', lote: 'L', tipo: 'devolucao', motivo: 'm', hora_simulada: HORA });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
  });
});

describe('agente de validação', () => {
  it('devolve ao lote, mas NÃO libera', async () => {
    const t = tid('val');
    await novaDecisao(t, 300, 'RETIRADO');
    const ok = await c.validacao.from('decisoes').update({ destino: 'DEVOLVIDO' }).eq('simulacao_id', sim).eq('titulo_id', t).select();
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
    const ruim = await c.validacao.from('decisoes').update({ destino: 'LIBERADO_AUTOMATICO' }).eq('simulacao_id', sim).eq('titulo_id', t).select();
    expect(ruim.error).not.toBeNull();
  });
});

describe('log só de inclusão', () => {
  it.each(['admin', 'aprovadorSemPessoa', 'operacao', 'validacao'] as const)('%s não altera nem apaga o log', async (k) => {
    const t = tid(`log-${k}`);
    await c.operacao.from('log_auditoria').insert({ simulacao_id: sim, ator_tipo: 'agente_operacao', acao: 'retirou do lote', entidade: 'titulo', entidade_id: t });
    const upd = await c[k].from('log_auditoria').update({ motivo: 'adulterado' }).eq('entidade_id', t).select();
    const del = await c[k].from('log_auditoria').delete().eq('entidade_id', t).select();
    expect(upd.error ?? (upd.data?.length === 0 ? 'nenhuma linha' : null)).not.toBeNull();
    expect(del.error ?? (del.data?.length === 0 ? 'nenhuma linha' : null)).not.toBeNull();
    const { data } = await c.admin.from('log_auditoria').select('motivo').eq('entidade_id', t).single();
    expect(data?.motivo).toBeNull();
  });
});

describe('aprovação (função do banco)', () => {
  it('consulta NÃO aprova', async () => {
    const sol = await novaSolicitacao(tid('cons'), 100, 'simples', ['aprovador']);
    const { error } = await c.consulta.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(error).not.toBeNull();
  });
  it('quem lançou o título NÃO aprova (segregação)', async () => {
    const sol = await novaSolicitacao(tid('seg'), 100, 'simples', ['aprovador'], U.aprovadorSemPessoa.login_origem);
    const { error } = await c.aprovadorSemPessoa.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(error?.message).toMatch(/Segregação/);
  });
  it('acima da alçada do aprovador só a diretoria aprova', async () => {
    const valor = U.aprovadorSemPessoa.alcada! + 10_000;
    const sol = await novaSolicitacao(tid('alcada'), valor, 'alcada_superior', [U.diretoria.pessoa_id!]);
    const r1 = await c.aprovadorSemPessoa.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r1.error?.message).toMatch(/alçada/);
    const r2 = await c.diretoria.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r2.error).toBeNull();
    expect(r2.data).toBe('aprovada');
  });
  it('fracionamento (soma) dentro da alçada: aprovador aprova e o log registra na mesma transação', async () => {
    const t = tid('frac');
    const sol = await novaSolicitacao(t, 14_700, 'alcada_superior', ['aprovador']);
    const r = await c.aprovadorSemPessoa.rpc('aprovar_solicitacao', { p_solicitacao: sol, p_comentario: 'ok' });
    expect(r.data).toBe('aprovada');
    const { data: dec } = await c.admin.from('decisoes').select('destino').eq('simulacao_id', sim).eq('titulo_id', t).single();
    expect(dec?.destino).toBe('APROVADO');
    const { data: log } = await c.admin.from('log_auditoria').select('acao, ator_tipo').eq('entidade_id', t).eq('acao', 'aprovou');
    expect(log).toEqual([{ acao: 'aprovou', ator_tipo: 'humano' }]);
  });
  it('aprovação dupla exige duas pessoas diferentes, uma delas a coordenação', async () => {
    const sol = await novaSolicitacao(tid('dupla'), 8_000, 'dupla', ['aprovador', U.coordenacao.pessoa_id!]);
    const r1 = await c.aprovadorSemPessoa.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r1.data).toBe('pendente');
    const r2 = await c.aprovadorSemPessoa.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r2.error?.message).toMatch(/duas pessoas|já se manifestou/);
    const r3 = await c.diretoria.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r3.error?.message).toMatch(/falta a aprovação/);
    const r4 = await c.coordenacao.rpc('aprovar_solicitacao', { p_solicitacao: sol });
    expect(r4.data).toBe('aprovada');
  });
  it('recusa exige motivo', async () => {
    const sol = await novaSolicitacao(tid('rec'), 100, 'simples', ['aprovador']);
    const r1 = await c.aprovadorSemPessoa.rpc('recusar_solicitacao', { p_solicitacao: sol, p_motivo: ' ' });
    expect(r1.error).not.toBeNull();
    const r2 = await c.aprovadorSemPessoa.rpc('recusar_solicitacao', { p_solicitacao: sol, p_motivo: 'NF divergente' });
    expect(r2.data).toBe('recusada');
  });
});

describe('notificações e alertas', () => {
  it('cada pessoa vê só a própria caixa de entrada', async () => {
    const chave = tid('notif');
    const { error } = await c.operacao.from('notificacoes').insert([
      { simulacao_id: sim, pessoa_id: U.consulta.pessoa_id, assunto: 'a', mensagem: 'm', chave, hora_simulada: HORA },
      { simulacao_id: sim, pessoa_id: U.consulta2.pessoa_id, assunto: 'b', mensagem: 'm', chave, hora_simulada: HORA },
    ]);
    expect(error).toBeNull();
    const { data } = await c.consulta.from('notificacoes').select('pessoa_id').eq('chave', chave);
    expect(data).toEqual([{ pessoa_id: U.consulta.pessoa_id }]);
    const upd = await c.consulta.from('notificacoes').update({ lida: true }).eq('chave', chave).select();
    expect(upd.data).toHaveLength(1);
  });
  it('agente NÃO lê caixas de entrada', async () => {
    const { data } = await c.operacao.from('notificacoes').select('*').eq('simulacao_id', sim);
    expect(data ?? []).toHaveLength(0);
  });
  it('consulta só encerra alertas em que é dono', async () => {
    const chave = tid('alerta');
    await c.operacao.from('alertas').insert([
      { simulacao_id: sim, tipo: 'variacao_mensal', dono_pessoa_id: U.consulta.pessoa_id, mensagem: 'm', chave: `${chave}-1`, hora_simulada: HORA },
      { simulacao_id: sim, tipo: 'variacao_mensal', dono_pessoa_id: U.consulta2.pessoa_id, mensagem: 'm', chave: `${chave}-2`, hora_simulada: HORA },
    ]);
    const proprio = await c.consulta.from('alertas').update({ situacao: 'encerrado' }).eq('chave', `${chave}-1`).select();
    const alheio = await c.consulta.from('alertas').update({ situacao: 'encerrado' }).eq('chave', `${chave}-2`).select();
    expect(proprio.data).toHaveLength(1);
    expect(alheio.data ?? []).toHaveLength(0);
  });
});

describe('contratos (gestor vê só os próprios)', () => {
  it('operação grava competências; gestor de área vê só as dele; aprovador vê todas; leitor nada', async () => {
    const ct = tid('CT');
    const { error } = await c.operacao.from('competencias_contrato').insert([
      { simulacao_id: sim, contrato_id: `${ct}-1`, competencia: '2026-11', classe: 'fixo', gestor_pessoa_id: U.consulta.pessoa_id, situacao: 'conforme', hora_simulada: HORA },
      { simulacao_id: sim, contrato_id: `${ct}-2`, competencia: '2026-11', classe: 'fixo', gestor_pessoa_id: U.consulta2.pessoa_id, situacao: 'conforme', hora_simulada: HORA },
    ]);
    expect(error).toBeNull();
    const ver = async (cli: SupabaseClient) => ((await cli.from('competencias_contrato').select('contrato_id').eq('simulacao_id', sim).order('contrato_id')).data ?? []).map((r) => r.contrato_id);
    expect(await ver(c.consulta)).toEqual([`${ct}-1`]);
    expect(await ver(c.consulta2)).toEqual([`${ct}-2`]);
    expect(await ver(c.coordenacao)).toEqual([`${ct}-1`, `${ct}-2`]);
    expect(await ver(c.leitor)).toEqual([]);
  });
  it('gestor de área NÃO grava competência nem vínculo', async () => {
    const r1 = await c.consulta.from('competencias_contrato').insert({ simulacao_id: sim, contrato_id: tid('X'), competencia: '2026-11', classe: 'fixo', gestor_pessoa_id: U.consulta.pessoa_id, situacao: 'conforme', hora_simulada: HORA });
    const r2 = await c.leitor.from('vinculos_contrato').insert({ simulacao_id: sim, titulo_id: tid('T'), contrato_id: 'X', metodo: 'oc_contrato', confianca: 'alta', hora_simulada: HORA });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
  });
  it('alerta de contrato aparece só para o gestor do contrato (e para quem vê tudo)', async () => {
    const chave = tid('alerta-ct');
    const { error } = await c.operacao.from('alertas').insert([
      { simulacao_id: sim, tipo: 'contrato', contrato_id: 'CT-A', gestor_pessoa_id: U.consulta.pessoa_id, dono_pessoa_id: U.consulta.pessoa_id, regras: ['D01'], mensagem: 'm', chave: `${chave}-1`, hora_simulada: HORA },
      { simulacao_id: sim, tipo: 'contrato', contrato_id: 'CT-B', gestor_pessoa_id: U.consulta2.pessoa_id, dono_pessoa_id: U.consulta2.pessoa_id, regras: ['D09'], mensagem: 'm', chave: `${chave}-2`, hora_simulada: HORA },
    ]);
    expect(error).toBeNull();
    const ver = async (cli: SupabaseClient) => ((await cli.from('alertas').select('chave').like('chave', `${chave}%`).order('chave')).data ?? []).map((r) => r.chave);
    expect(await ver(c.consulta)).toEqual([`${chave}-1`]);
    expect(await ver(c.coordenacao)).toEqual([`${chave}-1`, `${chave}-2`]);
  });
});
