'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { cn } from '../lib/cn';

export interface DonutSegment {
  /** Display label */
  label: string;
  /** Numeric value (used to compute share) */
  value: number;
  /** CSS color (hex/oklch/var) */
  color: string;
  /** Optional secondary descriptor (e.g. "13 élèves") */
  hint?: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  /** Large number shown in donut center */
  centerLabel?: string;
  /** Small text under centerLabel */
  centerSubLabel?: string;
  /** Show legend on the right side (image 6) */
  legendPosition?: 'right' | 'bottom' | 'none';
  /** Inner radius percentage (0-1) */
  innerRatio?: number;
  /** Height in pixels (width is responsive) */
  height?: number;
  className?: string;
}

/**
 * DonutChart — wraps recharts PieChart with center label + legend.
 * "use client" because recharts uses refs/dimensions.
 */
export function DonutChart({
  segments,
  centerLabel,
  centerSubLabel,
  legendPosition = 'right',
  innerRatio = 0.65,
  height = 200,
  className,
}: DonutChartProps) {
  const total = segments.reduce((acc, s) => acc + (Number.isFinite(s.value) ? s.value : 0), 0);
  const data = segments.map((s) => ({ ...s, share: total > 0 ? s.value / total : 0 }));

  return (
    <div
      className={cn(
        'flex w-full',
        legendPosition === 'right' && 'flex-row items-center gap-6',
        legendPosition === 'bottom' && 'flex-col gap-4',
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={`${innerRatio * 50}%`}
              outerRadius="80%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              strokeWidth={2}
              stroke="#fff"
              isAnimationActive
              animationDuration={800}
              animationEasing="ease-out"
            >
              {data.map((seg, i) => (
                <Cell key={i} fill={seg.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel || centerSubLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerLabel && (
              <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
                {centerLabel}
              </span>
            )}
            {centerSubLabel && (
              <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {centerSubLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {legendPosition !== 'none' && (
        <ul
          className={cn(
            'flex',
            legendPosition === 'right' ? 'flex-1 flex-col gap-3' : 'flex-row flex-wrap gap-4',
          )}
        >
          {data.map((seg, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span
                aria-hidden
                className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: seg.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{seg.label}</div>
                <div className="text-[11px] text-slate-500">
                  {Math.round(seg.share * 100)}%
                  {seg.hint ? ` · ${seg.hint}` : ` · ${seg.value}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
