'use client';

import { BarChart, type BarSeries } from './BarChart';
import { cn } from '../lib/cn';

export interface GroupedBarChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T;
  /** Multi-series with a shared gradient hue (clair → foncé) — image 7 */
  series: BarSeries[];
  yDomain?: [number | 'auto', number | 'auto'];
  annotateValues?: boolean;
  showLegend?: boolean;
  height?: number;
  className?: string;
}

/**
 * GroupedBarChart — image 7 "Évolution par matière (moyennes par trimestre)".
 * Same as BarChart but with explicit grouped layout. Provided as a named API
 * so consumers can intent-document the chart type.
 */
export function GroupedBarChart<T extends Record<string, unknown>>({
  className,
  ...props
}: GroupedBarChartProps<T>) {
  return <BarChart {...props} className={cn(className)} />;
}
