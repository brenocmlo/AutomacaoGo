import { raizCnpj } from '@/lib/data/normalizadores';
import { falhou, passou, type Regra } from './tipos';

/**
 * R05 · Fornecedor. A raiz do CNPJ da NF e da OC deve ser a do fornecedor do título.
 * Filial (mesma raiz, outra razão social) é o mesmo fornecedor e passa.
 */
export const r05Fornecedor: Regra = (d) => {
  const problemas: string[] = [];
  const ev: string[] = [d.titulo.titulo_id];
  if (d.nf && raizCnpj(d.nf.cnpj_emitente) !== d.raiz) {
    problemas.push(`a NF ${d.nf.numero_nf} foi emitida por outro CNPJ (${d.nf.razao_social_emitente})`);
    ev.push(d.nf.chave_acesso);
  }
  if (d.oc && raizCnpj(d.oc.cnpj_fornecedor) !== d.raiz) {
    problemas.push(`a OC ${d.oc.oc_id} é de outro fornecedor (${d.oc.nome_fornecedor})`);
    ev.push(d.oc.oc_id);
  }
  if (problemas.length === 0) return passou('R05');
  return falhou('R05', 'critica', `Fornecedor do título não confere: ${problemas.join('; ')}.`, ev);
};
