'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/cn';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Strokes the line dashed (e.g. target value) */
  dashed?: boolean;
  /** Marker dot size (default 4) */
  dotRadius?: number;
}

export interface LineChartProps<T extends Record<string, unknown>> {
  data: T[];
  /** X-axis key (must be present on each datum) */
  xKey: keyof T;
  /** Series to plot */
  series: LineSeries[];
  /** Y-axis domain (default `[0, 20]` for grade-on-20) */
  yDomain?: [number | 'auto', number | 'auto'];
  /** Annotate values above data points */
  annotateValues?: boolean;
  /** Show legend at the bottom */
  showLegend?: boolean;
  height?: number;
  className?: string;
}

const TICK_STYLE = { fontSize: 12, fill: 'oklch(0.50 0.02 250)' };
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid oklch(0.92 0.01 250)',
  padding: 12,
  fontSize: 12,
  backgroundColor: 'white',
  boxShadow: '0 10px 28px -10px rgba(2, 6, 23, 0.22)',
};

export function LineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  yDomain = [0, 20],
  annotateValues = false,
  showLegend = true,
  height = 240,
  className,
}: LineChartProps<T>) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={data} margin={{ top: 24, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 250)" vertical={false} />
          <XAxis dataKey={xKey as string} tick={TICK_STYLE} axisLine={false} tickLine={false} />
          <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} domain={yDomain} width={32} />
          <Tooltip
            cursor={{ stroke: 'oklch(0.92 0.01 250)', strokeWidth: 1 }}
            contentStyle={TOOLTIP_STYLE}
          />
          {showLegend && (
            <Legend
              align="left"
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
            />
          )}
          {series.map((s, si) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '4 4' : undefined}
              dot={{ r: s.dotRadius ?? 4, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: (s.dotRadius ?? 4) + 2, stroke: '#fff', strokeWidth: 2 }}
              label={
                annotateValues
                  ? {
                      position: 'top',
                      fontSize: 11,
                      fill: 'oklch(0.30 0.03 250)',
                      offset: 8,
                    }
                  : false
              }
              isAnimationActive
              animationDuration={900}
              animationBegin={si * 120}
              animationEasing="ease-out"
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
