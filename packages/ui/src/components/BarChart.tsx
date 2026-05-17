'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  BarChart as RBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/cn';

export interface BarSeries {
  key: string;
  label: string;
  /** Either a single color (one color for all bars) or per-row colors from datum */
  color: string;
  /** Stack id (to stack bars together) */
  stackId?: string;
}

export interface BarChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T;
  series: BarSeries[];
  yDomain?: [number | 'auto', number | 'auto'];
  showLegend?: boolean;
  /** If true, draws annotations above bars with the numeric value */
  annotateValues?: boolean;
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  /** Custom per-bar color override resolver — receives the datum and series, returns CSS color */
  perBarColor?: (datum: T, series: BarSeries) => string | undefined;
  className?: string;
}

const TICK_STYLE = { fontSize: 12, fill: 'oklch(0.50 0.02 250)' };

/**
 * BarChart — single- and multi-series bar chart.
 * Set `orientation="horizontal"` to swap axes.
 */
export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  yDomain = [0, 20],
  showLegend = false,
  annotateValues = false,
  height = 240,
  orientation = 'vertical',
  perBarColor,
  className,
}: BarChartProps<T>) {
  const isVertical = orientation === 'vertical';
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={data}
          margin={{ top: 24, right: 16, bottom: 8, left: 0 }}
          layout={isVertical ? 'horizontal' : 'vertical'}
          barCategoryGap="18%"
          barGap={4}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.01 250)" vertical={!isVertical} horizontal={isVertical} />
          {isVertical ? (
            <>
              <XAxis dataKey={xKey as string} tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis tick={TICK_STYLE} axisLine={false} tickLine={false} domain={yDomain} width={32} />
            </>
          ) : (
            <>
              <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} domain={yDomain} />
              <YAxis dataKey={xKey as string} type="category" tick={TICK_STYLE} axisLine={false} tickLine={false} width={120} />
            </>
          )}
          <Tooltip
            cursor={{ fill: 'oklch(0.96 0.01 250)' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid oklch(0.92 0.01 250)',
              padding: 12,
              fontSize: 12,
            }}
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
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={s.stackId}
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
              label={
                annotateValues
                  ? {
                      position: isVertical ? 'top' : 'right',
                      fontSize: 11,
                      fill: 'oklch(0.30 0.03 250)',
                    }
                  : false
              }
            >
              {perBarColor &&
                data.map((d, i) => <Cell key={i} fill={perBarColor(d, s) ?? s.color} />)}
            </Bar>
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}
