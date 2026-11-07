import type { ConfigGoAudit } from '@/lib/config/config';
import type { Politicas } from '@/lib/config/politicas';
import { nomeComparavel } from '@/lib/data/normalizadores';

/** Pessoas que os tokens do acionamento (config) representam num caso concreto. */
export interface PessoasDoCaso {
  /** @gestor: gestor_pessoa_id do contrato. */
  gestor: string | null;
  /** @dono: gestor do contrato ou dono da categoria. */
  dono: string | null;
  /** @responsavel: comprador da OC ou responsável interno do fornecedor. */
  responsavel: string | null;
}

/** Lista de pessoas a avisar para os códigos (R01…, D01…), resolvendo os tokens @dono/@gestor/@responsavel. */
export function resolverAcionamento(codigos: string[], p: PessoasDoCaso, config: ConfigGoAudit): string[] {
  const out = new Set<string>();
  for (const c of codigos) {
    for (const alvo of config.acionamento.por_regra[c] ?? []) {
      const pessoa =
        alvo === '@dono' ? p.dono : alvo === '@gestor' ? (p.gestor ?? p.dono) : alvo === '@responsavel' ? (p.responsavel ?? p.dono) : alvo;
      if (pessoa) out.add(pessoa);
    }
  }
  return [...out];
}

/** pessoa_id pelo nome (política de acionamento), ou null. */
export function pessoaPorNome(pol: Politicas, nome: string | null | undefined): string | null {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  return pol.pessoas.find((p) => nomeComparavel(p.nome) === alvo)?.pessoaId ?? null;
}
