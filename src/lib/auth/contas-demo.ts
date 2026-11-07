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

/**
 * Gestores de contrato (papel consulta) mantidos na demo: PS10 (22 contratos) e PS11 (15).
 * Dois, para a bateria de RLS provar que um gestor não vê os contratos do outro.
 */
export const PESSOAS_CONSULTA_DEMO = ['PS10', 'PS11'];

export const EMAIL_ADMIN_PADRAO = 'admin.simulacao@example.com';

/**
 * Contas humanas de demonstração, derivadas da base (sem lista fixa):
 *  - aprovador: usuários ativos do ERP com perfil aprovador/diretoria
 *  - consulta : gestores de contrato listados em PESSOAS_CONSULTA_DEMO
 *  - admin    : conduz a simulação
 */
export function contasDemoHumanas(base: BaseEntrada, emailAdmin = EMAIL_ADMIN_PADRAO): ContaDemo[] {
  const out: ContaDemo[] = [];
  const pessoas = new Set<string>();
  for (const u of base.usuarios) {
    if (u.sistema !== 'ERP' || !/^(aprovador|diretoria)$/.test(u.perfil) || !/ativo/i.test(u.status) || u.data_desligamento) continue;
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
