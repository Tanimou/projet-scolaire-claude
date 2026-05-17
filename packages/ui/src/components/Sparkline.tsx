import { cn } from '../lib/cn';

export interface SparklinePoint {
  x: string | number | Date;
  y: number;
}

export interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  /** Stroke color (CSS color, oklch, hex, var(--...)) */
  color?: string;
  /** Fill area below line */
  fill?: boolean;
  /** Thickness in px */
  strokeWidth?: number;
  /** Accessible label */
  ariaLabel?: string;
  className?: string;
}

/**
 * Sparkline — minimalist SVG inline trendline.
 * No deps, server-renderable. Uses `currentColor` for theme inheritance.
 */
export function Sparkline({
  data,
  width = 80,
  height = 28,
  color = 'currentColor',
  fill = false,
  strokeWidth = 1.5,
  ariaLabel = 'Tendance',
  className,
}: SparklineProps) {
  if (!data?.length) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className={cn('block', className)}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const ys = data.map((d) => d.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const isFlat = maxY === minY;
  const range = isFlat ? 1 : maxY - minY;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pad = 2;
  const inner = height - pad * 2;

  const points = data.map((d, i) => {
    const x = i * stepX;
    // For flat data (e.g. a KPI whose count didn't change) draw the line at
    // the vertical center instead of clamping to the top — otherwise the
    // filled area becomes an opaque rectangle that hides the value.
    const y = isFlat ? pad + inner / 2 : pad + ((maxY - d.y) / range) * inner;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`))
    .join(' ');

  // Skip the area fill on flat curves — otherwise a constant value renders as
  // a full opaque rectangle which is visually confusing.
  const effectiveFill = fill && !isFlat;
  const areaPath = effectiveFill
    ? `${linePath} L ${(points[points.length - 1]?.x ?? 0).toFixed(2)} ${height} L 0 ${height} Z`
    : '';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      className={cn('block', className)}
      style={{ color }}
    >
      {effectiveFill && <path d={areaPath} fill={color} fillOpacity={0.12} />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
