'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '../lib/cn';

export interface CalendarEventDot {
  /** Day number within the displayed month */
  day: number;
  /** Optional ISO date for precise tooltip (useful for cross-month displays) */
  date?: string;
  /** Dot color (CSS color/oklch/var) */
  color: string;
  /** Optional subject/event code for accessibility */
  subjectCode?: string;
  /** Optional event title for tooltip */
  title?: string;
}

export interface LegendItem {
  label: string;
  color: string;
}

export interface MiniCalendarProps {
  /** Initial month to display */
  month: Date;
  /** Days highlighted with a filled circle (selected) */
  selected?: number[];
  /** Event dot indicators below day numbers */
  events?: CalendarEventDot[];
  /** Legend rows below the calendar */
  legend?: LegendItem[];
  /** Called when user clicks a day (1-31) */
  onSelectDay?: (day: number, isoDate: string) => void;
  /** Optional weekday labels (default: Lun Mar Mer Jeu Ven Sam Dim) */
  weekdayLabels?: [string, string, string, string, string, string, string];
  /** Hide the prev/next chevrons */
  staticMonth?: boolean;
  className?: string;
}

const DEFAULT_WEEKDAYS: [string, string, string, string, string, string, string] = [
  'Lun',
  'Mar',
  'Mer',
  'Jeu',
  'Ven',
  'Sam',
  'Dim',
];

const FR_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Returns 0-6 with Monday = 0 */
function isoDayOfWeek(d: Date): number {
  const js = d.getDay(); // 0=Sun..6=Sat
  return (js + 6) % 7;
}

function buildCells(month: Date): Array<{ day: number; outside: boolean; date: Date }> {
  const first = startOfMonth(month);
  const firstDow = isoDayOfWeek(first);
  const total = daysInMonth(month);
  const cells: Array<{ day: number; outside: boolean; date: Date }> = [];

  // Leading outside days
  const prevMonthLast = new Date(month.getFullYear(), month.getMonth(), 0);
  const prevDays = prevMonthLast.getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    const day = prevDays - i;
    cells.push({
      day,
      outside: true,
      date: new Date(prevMonthLast.getFullYear(), prevMonthLast.getMonth(), day),
    });
  }

  // Current month days
  for (let day = 1; day <= total; day++) {
    cells.push({
      day,
      outside: false,
      date: new Date(month.getFullYear(), month.getMonth(), day),
    });
  }

  // Trailing outside days to complete a 6-row grid (42 cells)
  while (cells.length < 42) {
    const idx = cells.length - (firstDow + total);
    const day = idx + 1;
    cells.push({
      day,
      outside: true,
      date: new Date(month.getFullYear(), month.getMonth() + 1, day),
    });
  }

  return cells.slice(0, 42);
}

/**
 * MiniCalendar — images 6 & 7 calendar widget.
 * Renders a 7×6 grid with optional event dots and a legend.
 */
export function MiniCalendar({
  month: initialMonth,
  selected = [],
  events = [],
  legend,
  onSelectDay,
  weekdayLabels = DEFAULT_WEEKDAYS,
  staticMonth,
  className,
}: MiniCalendarProps) {
  const [month, setMonth] = useState<Date>(initialMonth);
  const cells = useMemo(() => buildCells(month), [month]);
  const monthLabel = `${FR_MONTHS[month.getMonth()]} ${month.getFullYear()}`;

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEventDot[]>();
    events.forEach((e) => {
      const k = e.day;
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    });
    return map;
  }, [events]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function shiftMonth(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">{monthLabel}</h3>
        {!staticMonth && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Mois précédent"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Mois suivant"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      <div role="grid" aria-label={`Calendrier ${monthLabel}`} className="grid grid-cols-7 gap-1">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            role="columnheader"
            className="py-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400"
          >
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const inMonth = !c.outside;
          const dayEvents = inMonth ? eventsByDay.get(c.day) ?? [] : [];
          const isSelected = inMonth && selectedSet.has(c.day);
          const iso = c.date.toISOString().slice(0, 10);
          return (
            <button
              type="button"
              key={i}
              role="gridcell"
              disabled={!inMonth || !onSelectDay}
              aria-current={isSelected ? 'date' : undefined}
              aria-label={`${c.day} ${FR_MONTHS[c.date.getMonth()]} ${c.date.getFullYear()}`}
              onClick={() => onSelectDay?.(c.day, iso)}
              className={cn(
                'relative aspect-square rounded-full text-xs font-semibold transition-colors',
                inMonth ? 'text-slate-700' : 'text-slate-300',
                isSelected && 'bg-violet-500 text-white shadow-sm',
                !isSelected && inMonth && onSelectDay && 'hover:bg-slate-100',
                !inMonth && 'cursor-default',
              )}
            >
              {c.day}
              {dayEvents.length > 0 && !isSelected && (
                <span className="pointer-events-none absolute inset-x-0 -bottom-0.5 flex justify-center gap-0.5">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <span
                      key={j}
                      className="block h-1 w-1 rounded-full"
                      style={{ background: e.color }}
                      title={e.title}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {legend && legend.length > 0 && (
        <ul className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-500">
          {legend.map((l, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
