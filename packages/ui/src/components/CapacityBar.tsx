import { cn } from '../lib/cn';

export interface CapacityBarProps {
  /** Current value (e.g. number of enrolled students) */
  value: number;
  /** Max value (e.g. class capacity) */
  max: number;
  /** Width of the bar in pixels (default 120) */
  width?: number;
  /** Show numeric percentage label on the right */
  showPercent?: boolean;
  /** Show raw value/max instead of percentage */
  showAbsolute?: boolean;
  /** Explicitly mark this row as "full" (also auto-detected at 100%) */
  full?: boolean;
  /**
   * Ce que `value` compte, au pluriel — la **population** de la jauge.
   *
   * Une barre de progression n'expose que des nombres à une technologie
   * d'assistance : « Capacité 24 sur 30 » ne dit pas *24 quoi*. Le lecteur
   * voyant a le contexte de la colonne ; l'utilisateur de lecteur d'écran, non.
   * Nommer la population est donc la moitié de l'information, pas une
   * décoration — et c'est d'autant plus vrai ici que « combien d'élèves y a-t-il
   * dans cette classe » a plusieurs réponses selon les statuts comptés.
   *
   * Défaut aligné sur le seul usage du composant (l'effectif d'une classe face
   * à sa capacité — cf. la documentation de `value` et `max` ci-dessus). Un
   * appelant qui compte autre chose le dit ici.
   */
  populationLabel?: string;
  /** Ce que `max` compte, au pluriel. Cf. {@link CapacityBarProps.populationLabel}. */
  capacityLabel?: string;
  className?: string;
}

/**
 * CapacityBar — image-prescriptive horizontal capacity meter used in the
 * Classes table. Tonal vert <90%, ambre 90-99%, rouge à 100%.
 *
 *   ████████░░░░░  93%
 */
export function CapacityBar({
  value,
  max,
  width = 120,
  showPercent = true,
  showAbsolute,
  full,
  populationLabel = 'élèves inscrits',
  capacityLabel = 'places',
  className,
}: CapacityBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const isFull = full ?? pct >= 100;
  const isHigh = pct >= 90 && !isFull;
  const fillCls = isFull
    ? 'bg-rose-500'
    : isHigh
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  const trackCls = isFull ? 'bg-rose-100' : isHigh ? 'bg-amber-100' : 'bg-emerald-100';
  const labelCls = isFull ? 'text-rose-600' : isHigh ? 'text-amber-600' : 'text-emerald-600';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={`${value} ${populationLabel} sur ${max} ${capacityLabel}`}
        className={cn('h-1.5 overflow-hidden rounded-full', trackCls)}
        style={{ width }}
      >
        <div
          className={cn('h-full rounded-full transition-all', fillCls)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(showPercent || showAbsolute) && (
        <span className={cn('font-mono text-xs font-bold tabular-nums', labelCls)}>
          {showAbsolute ? `${value} / ${max}` : `${Math.round(pct)}%`}
        </span>
      )}
    </div>
  );
}
