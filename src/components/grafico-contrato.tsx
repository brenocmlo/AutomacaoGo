import { brl } from '@/components/ui';
import type { CompetenciaVista } from '@/lib/painel/contratos';

/**
 * Esperado × cobrado por competência. Uma série (cobrado, barra) sobre a faixa esperada
 * (retângulo cinza) com um traço no valor esperado. Fora da faixa: barra na cor de status
 * de perigo, sempre acompanhada do rótulo "fora da faixa" na tabela abaixo (cor nunca sozinha).
 * Tooltip nativo (<title>) em cada coluna; a tabela de competências é a visão em tabela.
 */
export function GraficoContrato({ competencias }: { competencias: CompetenciaVista[] }) {
  const comps = competencias.slice(-12);
  if (comps.length === 0) return <p className="text-sm text-muted">Nenhuma competência registrada ainda.</p>;

  const L = 72, R = 12, T = 20, B = 28;
  const coluna = 56;
  const W = L + R + comps.length * coluna;
  const H = 220;
  const alturaUtil = H - T - B;
  const maximo = Math.max(1, ...comps.flatMap((c) => [c.valorCobrado, c.faixaMax ?? 0, c.valorEsperado ?? 0])) * 1.08;
  const y = (v: number) => T + alturaUtil - (v / maximo) * alturaUtil;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maximo * f);
  const barra = 18;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Valor esperado e cobrado por competência" className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={12} fill="var(--muted)" className="tabular">{brl(v, true)}</text>
          </g>
        ))}
        {comps.map((c, i) => {
          const cx = L + i * coluna + coluna / 2;
          const fora = c.desvios.length > 0 && c.qtdTitulos > 0;
          const dica = [
            `Competência ${c.competencia}`,
            `Cobrado: ${brl(c.valorCobrado)} (${c.qtdTitulos} título${c.qtdTitulos === 1 ? '' : 's'})`,
            `Esperado: ${brl(c.valorEsperado)}`,
            c.faixaMin != null ? `Faixa: ${brl(c.faixaMin)} a ${brl(c.faixaMax)}` : 'Sem faixa',
            c.desvios.length ? `Desvios: ${c.desvios.join(', ')}` : '',
          ].filter(Boolean).join('\n');
          return (
            <g key={c.competencia}>
              <title>{dica}</title>
              {/* área de hover maior que a marca */}
              <rect x={cx - coluna / 2} y={T} width={coluna} height={alturaUtil} fill="transparent" />
              {c.faixaMin != null && c.faixaMax != null && (
                <rect x={cx - barra / 2 - 6} y={y(c.faixaMax)} width={barra + 12} height={Math.max(2, y(c.faixaMin) - y(c.faixaMax))}
                  fill="var(--neutral-soft)" stroke="var(--border)" strokeWidth={1} rx={3} />
              )}
              {c.valorCobrado > 0 && (
                <path
                  d={`M${cx - barra / 2},${y(0)} V${y(c.valorCobrado) + 4} q0,-4 4,-4 h${barra - 8} q4,0 4,4 V${y(0)} Z`}
                  fill={fora ? 'var(--danger)' : 'var(--accent)'}
                />
              )}
              {c.valorEsperado != null && (
                <line x1={cx - barra / 2 - 8} x2={cx + barra / 2 + 8} y1={y(c.valorEsperado)} y2={y(c.valorEsperado)} stroke="var(--text)" strokeWidth={2} />
              )}
              {fora && c.valorCobrado > 0 && (
                <text x={cx} y={y(c.valorCobrado) - 4} textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--danger)">fora</text>
              )}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={12} fill="var(--muted)" className="tabular">{c.competencia.slice(5)}/{c.competencia.slice(2, 4)}</text>
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} />
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-accent" />Cobrado</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-danger" />Cobrado fora da faixa</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm border border-border bg-neutral-soft" />Faixa esperada</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-text" />Valor esperado</span>
      </div>
    </div>
  );
}
