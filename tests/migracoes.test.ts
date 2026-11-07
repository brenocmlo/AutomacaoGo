/**
 * Validação offline das migrações e da RLS (PGlite = Postgres em WASM).
 * Sobe o stub do Supabase + todas as migrações num banco limpo e simula cada papel
 * com SET ROLE authenticated + request.jwt.claims, como o PostgREST faz.
 * A bateria contra o Supabase real fica em tests/rls (npm run test:rls).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const RAIZ = path.resolve(__dirname, '..');
const db = new PGlite();

const ids = {
  admin: '00000000-0000-0000-0000-00000000000a',
  op: '00000000-0000-0000-0000-0000000000a1',
  val: '00000000-0000-0000-0000-0000000000a2',
  leitor: '00000000-0000-0000-0000-0000000000a3',
  claudia: '00000000-0000-0000-0000-0000000000b1',
  renata: '00000000-0000-0000-0000-0000000000b2',
  helena: '00000000-0000-0000-0000-0000000000b3',
  marcos: '00000000-0000-0000-0000-0000000000c1',
  livia: '00000000-0000-0000-0000-0000000000c2',
};
type Quem = keyof typeof ids;
const perfis: Record<Quem, { papel: string; alcada: number | null; pessoa: string | null; login: string | null }> = {
  admin: { papel: 'admin', alcada: 0, pessoa: null, login: null },
  op: { papel: 'agente_operacao', alcada: 5000, pessoa: null, login: null },
  val: { papel: 'agente_validacao', alcada: 0, pessoa: null, login: null },
  leitor: { papel: 'agente_leitor', alcada: 0, pessoa: null, login: null },
  claudia: { papel: 'aprovador', alcada: 50000, pessoa: null, login: 'u12' },
  renata: { papel: 'aprovador', alcada: 50000, pessoa: 'PS01', login: 'u13' },
  helena: { papel: 'aprovador', alcada: null, pessoa: 'PS03', login: 'u15' },
  marcos: { papel: 'consulta', alcada: 0, pessoa: 'PS02', login: 'u14' },
  livia: { papel: 'consulta', alcada: 0, pessoa: 'PS08', login: null },
};

/** Executa SQL como o usuário (JWT simulado) numa transação; devolve linhas ou o erro. */
async function como<T = Record<string, unknown>>(quem: Quem | 'anon', sql: string, params: unknown[] = []): Promise<{ rows: T[]; erro: string | null }> {
  // Claims exatamente como o hook gera (lê da tabela perfis via função do banco).
  let claims: Record<string, unknown> = { role: 'anon' };
  if (quem !== 'anon') {
    const ev = await db.query<{ e: { claims: Record<string, unknown> } }>(
      `select public.custom_access_token_hook($1::jsonb) as e`,
      [JSON.stringify({ user_id: ids[quem], claims: { sub: ids[quem], role: 'authenticated' } })],
    );
    claims = ev.rows[0]!.e.claims;
  }
  try {
    await db.exec('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.exec(`set local role ${quem === 'anon' ? 'anon' : 'authenticated'}`);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return { rows: r.rows, erro: null };
  } catch (e) {
    await db.exec('rollback');
    return { rows: [], erro: e instanceof Error ? e.message : String(e) };
  }
}

let sim: string;
const H = '2026-11-02 08:00';
const F = '2026-11-04 10:00';

async function decisao(titulo: string, valor: number, destino: string) {
  return como('op', `insert into public.decisoes (simulacao_id, titulo_id, fornecedor_id, valor, lote, banco, fechamento, destino, hora_simulada)
    values ($1, $2, 'FX', $3, 'L1', 'B', $4, $5, $6)`, [sim, titulo, valor, F, destino, H]);
}
async function solicitacao(titulo: string, valor: number, tipo: string, exigidos: string[], lancadoPor: string | null = null) {
  await decisao(titulo, valor, 'AGUARDANDO_APROVACAO');
  const r = await como<{ id: string }>('op', `insert into public.solicitacoes_aprovacao
    (simulacao_id, titulo_id, valor, tipo, nivel, aprovadores_exigidos, lancado_por, motivo, hora_simulada)
    values ($1, $2, $3, $4, 'aprovador', $5, $6, 'teste', $7) returning id`, [sim, titulo, valor, tipo, exigidos, lancadoPor, H]);
  if (r.erro) throw new Error(r.erro);
  return r.rows[0]!.id;
}
const aprovar = (quem: Quem, sol: string) => como<{ r: string }>(quem, `select public.aprovar_solicitacao($1) as r`, [sol]);

beforeAll(async () => {
  await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase', 'tests', 'stub_supabase.sql'), 'utf8'));
  const dir = path.join(RAIZ, 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migração ${f} falhou: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const [k, id] of Object.entries(ids)) {
    const p = perfis[k as Quem];
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@example.com`]);
    await db.query(`insert into public.perfis (id, nome, email, papel, alcada, pessoa_id, login_origem) values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, k, `${k}@example.com`, p.papel, p.alcada, p.pessoa, p.login]);
  }
  const s = await como<{ id: string }>('admin', `insert into public.simulacoes (nome, cenario, inicio, fim, hora_simulada) values ('t', 'demo', $1, '2026-11-09 08:00', $1) returning id`, [H]);
  if (s.erro) throw new Error(s.erro);
  sim = s.rows[0]!.id;
}, 120_000);

describe('migrações', () => {
  it('sobem do zero e ligam RLS em todas as tabelas', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
    expect(r.rows.length).toBeGreaterThanOrEqual(12);
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([]);
  });
  it('hook grava papel, alçada e pessoa no token', async () => {
    const r = await db.query<{ e: { claims: Record<string, unknown> } }>(`select public.custom_access_token_hook($1::jsonb) as e`,
      [JSON.stringify({ user_id: ids.renata, claims: { sub: ids.renata } })]);
    expect(r.rows[0]!.e.claims).toMatchObject({ papel: 'aprovador', alcada: 50000, pessoa_id: 'PS01' });
  });
});

describe('RLS por papel', () => {
  it('anon não lê nada', async () => {
    expect((await como('anon', 'select * from public.decisoes')).erro).toMatch(/permission denied/);
  });
  it('operação grava decisão dentro da alçada; acima é recusado pelo banco', async () => {
    expect((await decisao('T-ok', 4999, 'LIBERADO_AUTOMATICO')).erro).toBeNull();
    expect((await decisao('T-acima', 5000.01, 'LIBERADO_AUTOMATICO')).erro).toMatch(/row-level security/);
    expect((await decisao('T-aprov', 10, 'APROVADO')).erro).toMatch(/row-level security/);
  });
  it('operação não insere aprovações', async () => {
    const sol = await solicitacao('T-op', 100, 'simples', ['aprovador']);
    const r = await como('op', `insert into public.aprovacoes (solicitacao_id, aprovador_id, decisao) values ($1, $2, 'aprovado')`, [sol, ids.op]);
    expect(r.erro).toMatch(/row-level security|permission denied/);
    expect((await aprovar('op', sol)).erro).toMatch(/Só aprovadores/);
  });
  it('leitor só insere mensagem; não lê decisões nem log', async () => {
    expect((await como('leitor', `insert into public.mensagens_processadas (simulacao_id, comunicacao_id, tipo, hora_simulada) values ($1, 'EM1', 'phishing', $2)`, [sim, H])).erro).toBeNull();
    expect((await como('leitor', 'select * from public.decisoes')).rows).toEqual([]);
    expect((await como('leitor', 'select * from public.log_auditoria')).rows).toEqual([]);
    expect((await como('leitor', `update public.decisoes set destino = 'LIBERADO_AUTOMATICO'`)).rows).toEqual([]);
  });
  it('validação devolve, mas não libera', async () => {
    await decisao('T-val', 300, 'RETIRADO');
    const ok = await como('val', `update public.decisoes set destino = 'DEVOLVIDO' where titulo_id = 'T-val' returning titulo_id`);
    expect(ok.rows).toHaveLength(1);
    const ruim = await como('val', `update public.decisoes set destino = 'LIBERADO_AUTOMATICO' where titulo_id = 'T-val'`);
    expect(ruim.erro).toMatch(/row-level security/);
  });
});

describe('log só de inclusão', () => {
  it('ator vem do JWT, não da aplicação', async () => {
    await como('op', `insert into public.log_auditoria (simulacao_id, ator_tipo, ator_papel, acao, entidade, entidade_id) values ($1, 'humano', 'aprovador', 'aprovou', 'titulo', 'T-fake')`, [sim]);
    const r = await como<{ ator_tipo: string; ator_papel: string; ator_id: string }>('admin', `select ator_tipo, ator_papel, ator_id from public.log_auditoria where entidade_id = 'T-fake'`);
    expect(r.rows[0]).toEqual({ ator_tipo: 'agente_operacao', ator_papel: 'agente_operacao', ator_id: ids.op });
  });
  it.each(['admin', 'claudia', 'op', 'val'] as const)('%s não altera nem apaga', async (q) => {
    expect((await como(q, `update public.log_auditoria set motivo = 'x'`)).erro).toMatch(/permission denied/);
    expect((await como(q, `delete from public.log_auditoria`)).erro).toMatch(/permission denied/);
  });
  it('nem o dono do banco altera (trigger)', async () => {
    await expect(db.exec(`update public.log_auditoria set motivo = 'x'`)).rejects.toThrow(/só de inclusão/);
    await expect(db.exec(`delete from public.log_auditoria`)).rejects.toThrow(/só de inclusão/);
  });
});

describe('funções de aprovação', () => {
  it('consulta não aprova', async () => {
    const sol = await solicitacao('T-cons', 100, 'simples', ['aprovador']);
    expect((await aprovar('marcos', sol)).erro).toMatch(/Só aprovadores/);
  });
  it('segregação: quem lançou não aprova', async () => {
    const sol = await solicitacao('T-seg', 100, 'simples', ['aprovador'], 'u12');
    expect((await aprovar('claudia', sol)).erro).toMatch(/Segregação/);
  });
  it('acima de R$ 50 mil só a diretoria', async () => {
    const sol = await solicitacao('T-60k', 60000, 'alcada_superior', ['PS03']);
    expect((await aprovar('claudia', sol)).erro).toMatch(/alçada/);
    expect((await aprovar('helena', sol)).rows[0]?.r).toBe('aprovada');
  });
  it('fracionamento aprovado: decisão vira APROVADO e log na mesma transação', async () => {
    const sol = await solicitacao('T-frac', 14700, 'alcada_superior', ['aprovador']);
    expect((await aprovar('claudia', sol)).rows[0]?.r).toBe('aprovada');
    const d = await como<{ destino: string }>('admin', `select destino from public.decisoes where titulo_id = 'T-frac'`);
    expect(d.rows[0]?.destino).toBe('APROVADO');
    const l = await como<{ ator_tipo: string; ator_id: string }>('admin', `select ator_tipo, ator_id from public.log_auditoria where entidade_id = 'T-frac' and acao = 'aprovou'`);
    expect(l.rows).toEqual([{ ator_tipo: 'humano', ator_id: ids.claudia }]);
  });
  it('aprovação dupla: duas pessoas diferentes, uma delas PS01', async () => {
    const sol = await solicitacao('T-dupla', 8000, 'dupla', ['aprovador', 'PS01']);
    expect((await aprovar('claudia', sol)).rows[0]?.r).toBe('pendente');
    expect((await aprovar('claudia', sol)).erro).toMatch(/já se manifestou/);
    expect((await aprovar('helena', sol)).erro).toMatch(/falta a aprovação de PS01/);
    expect((await aprovar('renata', sol)).rows[0]?.r).toBe('aprovada');
  });
  it('recusa exige motivo e retira do lote', async () => {
    const sol = await solicitacao('T-rec', 100, 'simples', ['aprovador']);
    expect((await como('claudia', `select public.recusar_solicitacao($1, ' ')`, [sol])).erro).toMatch(/obrigatório/);
    expect((await como('claudia', `select public.recusar_solicitacao($1, 'NF divergente')`, [sol])).erro).toBeNull();
    const m = await como<{ tipo: string }>('admin', `select tipo from public.movimentos_lote where titulo_id = 'T-rec'`);
    expect(m.rows).toEqual([{ tipo: 'retirada' }]);
  });
  it('devolver ao lote exige justificativa e alçada', async () => {
    await decisao('T-dev', 70000, 'RETIRADO');
    await como('op', `insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada) values ($1, 'T-dev', 'L1', 'retirada', 'R01', $2)`, [sim, H]);
    expect((await como('claudia', `select public.decisao_humana($1, 'T-dev', 'devolver_ao_lote', '')`, [sim])).erro).toMatch(/Justificativa/);
    expect((await como('claudia', `select public.decisao_humana($1, 'T-dev', 'devolver_ao_lote', 'falso positivo')`, [sim])).erro).toMatch(/alçada/);
    expect((await como('helena', `select public.decisao_humana($1, 'T-dev', 'devolver_ao_lote', 'falso positivo')`, [sim])).erro).toBeNull();
  });
});

describe('administração decide (migração 8)', () => {
  // Contas reais de admin têm alçada null (sem limite); a persona de teste nasce com 0, então iguala aqui.
  beforeAll(async () => {
    await db.query(`update public.perfis set alcada = null where id = $1`, [ids.admin]);
  });
  it('admin aprova solicitação acima de R$ 50 mil (aprovar / liberar um conferido aguardando aprovador)', async () => {
    const sol = await solicitacao('T-adm60k', 60000, 'alcada_superior', ['PS03']);
    expect((await aprovar('admin', sol)).rows[0]?.r).toBe('aprovada');
    const d = await como<{ destino: string }>('admin', `select destino from public.decisoes where titulo_id = 'T-adm60k'`);
    expect(d.rows[0]?.destino).toBe('APROVADO');
    const l = await como<{ ator_tipo: string; ator_id: string }>('admin', `select ator_tipo, ator_id from public.log_auditoria where entidade_id = 'T-adm60k' and acao = 'aprovou'`);
    expect(l.rows).toEqual([{ ator_tipo: 'humano', ator_id: ids.admin }]);
  });
  it('admin recusa com motivo, e o título sai do lote', async () => {
    const sol = await solicitacao('T-admrec', 100, 'simples', ['aprovador']);
    expect((await como('admin', `select public.recusar_solicitacao($1, ' ')`, [sol])).erro).toMatch(/obrigatório/);
    expect((await como('admin', `select public.recusar_solicitacao($1, 'NF divergente')`, [sol])).erro).toBeNull();
    const m = await como<{ tipo: string }>('admin', `select tipo from public.movimentos_lote where titulo_id = 'T-admrec'`);
    expect(m.rows).toEqual([{ tipo: 'retirada' }]);
  });
  it('admin devolve ao lote um título retirado (libera)', async () => {
    await decisao('T-admdev', 70000, 'RETIRADO');
    await como('op', `insert into public.movimentos_lote (simulacao_id, titulo_id, lote, tipo, motivo, hora_simulada) values ($1, 'T-admdev', 'L1', 'retirada', 'R01', $2)`, [sim, H]);
    expect((await como('admin', `select public.decisao_humana($1, 'T-admdev', 'devolver_ao_lote', 'falso positivo')`, [sim])).erro).toBeNull();
    const d = await como<{ destino: string }>('admin', `select destino from public.decisoes where titulo_id = 'T-admdev'`);
    expect(d.rows[0]?.destino).toBe('DEVOLVIDO');
  });
  it('aprovação dupla: admin vale como a segunda pessoa, mas a mesma pessoa não aprova duas vezes', async () => {
    const sol = await solicitacao('T-admdupla', 8000, 'dupla', ['aprovador', 'PS01']);
    expect((await aprovar('claudia', sol)).rows[0]?.r).toBe('pendente');
    expect((await aprovar('admin', sol)).rows[0]?.r).toBe('aprovada');
    const outra = await solicitacao('T-admdupla2', 8000, 'dupla', ['aprovador', 'PS01']);
    expect((await aprovar('admin', outra)).rows[0]?.r).toBe('pendente');
    expect((await aprovar('admin', outra)).erro).toMatch(/já se manifestou/);
  });
  it('segregação continua valendo para a administração: quem lançou não aprova', async () => {
    await db.query(`update public.perfis set login_origem = 'u99' where id = $1`, [ids.admin]);
    const sol = await solicitacao('T-admseg', 100, 'simples', ['aprovador'], 'u99');
    expect((await aprovar('admin', sol)).erro).toMatch(/Segregação/);
    await db.query(`update public.perfis set login_origem = null where id = $1`, [ids.admin]);
  });
});

describe('notificações e alertas', () => {
  it('cada um vê só a própria caixa; agentes não leem caixas', async () => {
    await como('op', `insert into public.notificacoes (simulacao_id, pessoa_id, assunto, mensagem, chave, hora_simulada) values ($1, 'PS02', 'a', 'm', 'k1', $2), ($1, 'PS08', 'b', 'm', 'k1', $2)`, [sim, H]);
    expect((await como<{ pessoa_id: string }>('marcos', `select pessoa_id from public.notificacoes`)).rows).toEqual([{ pessoa_id: 'PS02' }]);
    expect((await como('op', `select * from public.notificacoes`)).rows).toEqual([]);
  });
  it('consulta só encerra alerta próprio', async () => {
    await como('op', `insert into public.alertas (simulacao_id, tipo, dono_pessoa_id, mensagem, chave, hora_simulada) values ($1, 'golpe', 'PS08', 'm', 'a1', $2), ($1, 'golpe', 'PS02', 'm', 'a2', $2)`, [sim, H]);
    expect((await como('livia', `update public.alertas set situacao = 'encerrado' where chave = 'a1' returning id`)).rows).toHaveLength(1);
    expect((await como('livia', `update public.alertas set situacao = 'encerrado' where chave = 'a2' returning id`)).rows).toHaveLength(0);
  });
});

describe('contratos (RLS por gestor do contrato)', () => {
  const comp = (contrato: string, gestor: string) =>
    como('op', `insert into public.competencias_contrato (simulacao_id, contrato_id, competencia, classe, gestor_pessoa_id, valor_cobrado, situacao, hora_simulada)
      values ($1, $2, '2026-11', 'fixo', $3, 100, 'conforme', $4)`, [sim, contrato, gestor, H]);
  it('agentes de operação gravam vínculo e competência; consulta e leitor não', async () => {
    expect((await comp('CT-A', 'PS02')).erro).toBeNull();
    expect((await comp('CT-B', 'PS08')).erro).toBeNull();
    expect((await como('op', `insert into public.vinculos_contrato (simulacao_id, titulo_id, contrato_id, competencia, metodo, confianca, gestor_pessoa_id, hora_simulada)
      values ($1, 'T-ct', 'CT-A', '2026-11', 'oc_contrato', 'alta', 'PS02', $2)`, [sim, H])).erro).toBeNull();
    expect((await como('marcos', `insert into public.competencias_contrato (simulacao_id, contrato_id, competencia, classe, gestor_pessoa_id, situacao, hora_simulada)
      values ($1, 'CT-X', '2026-11', 'fixo', 'PS02', 'conforme', $2)`, [sim, H])).erro).toMatch(/row-level security|permission denied/);
    expect((await como('leitor', `insert into public.vinculos_contrato (simulacao_id, titulo_id, contrato_id, metodo, confianca, hora_simulada)
      values ($1, 'T-x', 'CT-A', 'oc_contrato', 'alta', $2)`, [sim, H])).erro).toMatch(/row-level security|permission denied/);
  });
  it('gestor de área vê só os próprios contratos; aprovador vê todos; leitor nada', async () => {
    const ver = (q: Quem) => como<{ contrato_id: string }>(q, `select contrato_id from public.competencias_contrato order by contrato_id`);
    expect((await ver('marcos')).rows).toEqual([{ contrato_id: 'CT-A' }]);
    expect((await ver('livia')).rows).toEqual([{ contrato_id: 'CT-B' }]);
    expect((await ver('renata')).rows.map((r) => r.contrato_id)).toEqual(['CT-A', 'CT-B']);
    expect((await ver('leitor')).rows).toEqual([]);
    expect((await como('livia', `select titulo_id from public.vinculos_contrato`)).rows).toEqual([]);
    expect((await como('marcos', `select titulo_id from public.vinculos_contrato`)).rows).toHaveLength(1);
  });
  it('consulta não altera competência, nem a própria', async () => {
    expect((await como('marcos', `update public.competencias_contrato set situacao = 'desvio' where contrato_id = 'CT-A' returning contrato_id`)).rows).toHaveLength(0);
  });
  it('alerta de contrato: só o gestor, quem foi avisado e quem vê tudo', async () => {
    await como('op', `insert into public.alertas (simulacao_id, tipo, contrato_id, gestor_pessoa_id, dono_pessoa_id, regras, mensagem, chave, hora_simulada)
      values ($1, 'contrato', 'CT-A', 'PS02', 'PS02', '{D01}', 'm', 'c1', $2), ($1, 'contrato', 'CT-B', 'PS08', 'PS01', '{D02}', 'm', 'c2', $2)`, [sim, H]);
    const chaves = async (q: Quem) => (await como<{ chave: string }>(q, `select chave from public.alertas where tipo = 'contrato' order by chave`)).rows.map((r) => r.chave);
    expect(await chaves('marcos')).toEqual(['c1']);
    expect(await chaves('livia')).toEqual(['c2']);
    expect(await chaves('renata')).toEqual(['c1', 'c2']);
    expect(await chaves('leitor')).toEqual([]);
  });
  it('ninguém apaga vínculo ou competência', async () => {
    expect((await como('op', `delete from public.competencias_contrato where contrato_id = 'CT-A'`)).erro).toMatch(/permission denied/);
  });
});
