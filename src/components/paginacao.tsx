import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const POR_PAGINA = 25;

type Params = Record<string, string | string[] | undefined>;

/** Fatia uma lista para a página pedida (?pagina=N, a partir de 1). Página fora do intervalo vira a mais próxima. */
export function paginar<T>(itens: T[], pedida: string | string[] | undefined, porPagina = POR_PAGINA) {
  const total = itens.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const n = Number(Array.isArray(pedida) ? pedida[0] : pedida);
  const pagina = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), paginas) : 1;
  const de = (pagina - 1) * porPagina;
  return { itens: itens.slice(de, de + porPagina), pagina, paginas, total, de, ate: Math.min(de + porPagina, total) };
}

/**
 * Rodapé de tabela: "26–50 de 312" e páginas anterior/próxima. Mantém os demais parâmetros da URL
 * (filtros, título selecionado). Use `param` diferente quando houver mais de uma tabela na página.
 */
export function Paginacao({ pagina, paginas, total, de, ate, params, param = 'pagina', basePath }: {
  pagina: number;
  paginas: number;
  total: number;
  de: number;
  ate: number;
  params: Params;
  param?: string;
  basePath: string;
}) {
  if (total === 0) return null;
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val && k !== param) q.set(k, val);
    }
    if (n > 1) q.set(param, String(n));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  // janela de números: primeira, última e vizinhas da atual
  const numeros = [...new Set([1, pagina - 1, pagina, pagina + 1, paginas])].filter((n) => n >= 1 && n <= paginas).sort((a, b) => a - b);
  const botao = 'flex h-7 min-w-7 items-center justify-center rounded-md border border-border px-2 text-xs';
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
      <p className="tabular text-xs text-muted">{de + 1}–{ate} de {total.toLocaleString('pt-BR')}</p>
      {paginas > 1 && (
        <div className="flex items-center gap-1">
          {pagina > 1 ? (
            <Link href={href(pagina - 1)} aria-label="Página anterior" className={`${botao} hover:bg-surface-2`}><ChevronLeft className="size-3.5" /></Link>
          ) : (
            <span aria-hidden className={`${botao} opacity-40`}><ChevronLeft className="size-3.5" /></span>
          )}
          {numeros.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - numeros[i - 1] > 1 && <span className="text-xs text-muted">…</span>}
              {n === pagina ? (
                <span aria-current="page" className={`${botao} tabular border-accent bg-accent-soft font-medium text-accent`}>{n}</span>
              ) : (
                <Link href={href(n)} className={`${botao} tabular hover:bg-surface-2`}>{n}</Link>
              )}
            </span>
          ))}
          {pagina < paginas ? (
            <Link href={href(pagina + 1)} aria-label="Próxima página" className={`${botao} hover:bg-surface-2`}><ChevronRight className="size-3.5" /></Link>
          ) : (
            <span aria-hidden className={`${botao} opacity-40`}><ChevronRight className="size-3.5" /></span>
          )}
        </div>
      )}
    </nav>
  );
}
