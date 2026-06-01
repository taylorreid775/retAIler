import { fromMinor } from '@retailer/schema';
import type { PricePoint } from '@/lib/catalog';

/** Dependency-free SVG sparkline of the daily minimum price. */
export function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">Not enough price history yet.</p>
    );
  }

  const width = 600;
  const height = 160;
  const pad = 24;
  const values = points.map((p) => p.minPriceMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const x = (i: number) => pad + (i / (points.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - 2 * pad);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.minPriceMinor).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Price history">
        <path d={path} fill="none" stroke="var(--color-brand-600)" strokeWidth={2} />
        <circle
          cx={x(points.length - 1)}
          cy={y(values[values.length - 1]!)}
          r={3}
          fill="var(--color-brand-600)"
        />
      </svg>
      <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
        <span>Low ${fromMinor(min).toFixed(2)}</span>
        <span>High ${fromMinor(max).toFixed(2)}</span>
      </div>
    </div>
  );
}
