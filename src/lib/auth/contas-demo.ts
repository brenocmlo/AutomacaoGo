import type { BaseEntrada } from '@/lib/data/base';
import { nomeComparavel } from '@/lib/data/normalizadores';

export type PapelHumano = 'aprovador' | 'consulta' | 'admin';

export interface ContaDemo {
  email: string;
  nome: string;
  papel: PapelHumano;
  alcada: number | null; // null = sem limite
  pessoa_id: string | null;
  login_origem: string | null;
}

export const emailDemo = (nome: string) =>
  `${nomeComparavel(nome).toLowerCase().split(' ').filter(Boolean).join('.')}@example.com`;

/** Gestor de contrato (papel consulta) mantido na demo: PS10 (22 contratos). */
export const PESSOAS_CONSULTA_DEMO = ['PS10'];

/** Login ERP do único aprovador humano da demo (Cláudia Ferraz, até R$ 50 mil). */
export const LOGIN_APROVADOR_DEMO = 'usuario_12';

export const EMAIL_ADMIN_PADRAO = 'admin.simulacao@example.com';

/**
 * Contas humanas de demonstração, uma por função (derivadas da base):
 *  - aprovador: Cláudia Ferraz (LOGIN_APROVADOR_DEMO), alçada do ERP
 *  - consulta : gestor de contrato PS10
 *  - admin    : conduz a simulação, decide por todos (representa PS01/PS03) e vê tudo
 */
export function contasDemoHumanas(base: BaseEntrada, emailAdmin = EMAIL_ADMIN_PADRAO): ContaDemo[] {
  const out: ContaDemo[] = [];
  const pessoas = new Set<string>();
  const u = base.usuarios.find((x) => x.sistema === 'ERP' && x.login === LOGIN_APROVADOR_DEMO && /ativo/i.test(x.status) && !x.data_desligamento);
  if (u) {
    const alcada = /sem limite/i.test(u.alcada_rs) ? null : Number(u.alcada_rs);
    out.push({ email: emailDemo(u.nome), nome: u.nome, papel: 'aprovador', alcada, pessoa_id: u.pessoa_id || null, login_origem: u.login });
    if (u.pessoa_id) pessoas.add(u.pessoa_id);
  }
  for (const p of base.politicas.pessoas) {
    if (pessoas.has(p.pessoaId) || !PESSOAS_CONSULTA_DEMO.includes(p.pessoaId)) continue;
    const u = base.usuarios.find((x) => x.pessoa_id === p.pessoaId);
    out.push({ email: emailDemo(p.nome), nome: p.nome, papel: 'consulta', alcada: 0, pessoa_id: p.pessoaId, login_origem: u?.login ?? null });
    pessoas.add(p.pessoaId);
  }
  out.push({ email: emailAdmin, nome: 'Administração da simulação', papel: 'admin', alcada: null, pessoa_id: null, login_origem: null });
  return out;
}
