import {
  Calendar as CalendarIcon,
  ClipboardList,
  Flag,
  GraduationCap,
  PartyPopper,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { CalendarEventType, PortalCalendarEvent } from './PortalCalendarView';

/**
 * Shared presentation maps for school calendar event types.
 *
 * Single source of truth consumed by the parent & teacher dashboard
 * `SchoolEventsPanel`s so a new event type (or a palette tweak) only has to be
 * added in one place instead of drifting per-portal.
 */

/** Human-readable French label per event type. */
export const CALENDAR_TYPE_LABEL: Record<CalendarEventType, string> = {
  vacation_break: 'Vacances',
  public_holiday: 'Jour férié',
  exam_period: 'Examens',
  meeting: 'Réunion',
  ceremony: 'Cérémonie',
  pedagogical_day: 'Journée pédagogique',
  evaluation: 'Évaluation',
  custom: 'Événement',
};

/** Soft chip palette (background + text + border) per event type. */
export const CALENDAR_TYPE_TONE: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-50 text-amber-800 border-amber-200',
  public_holiday: 'bg-rose-50 text-rose-800 border-rose-200',
  exam_period: 'bg-violet-50 text-violet-800 border-violet-200',
  meeting: 'bg-blue-50 text-blue-800 border-blue-200',
  ceremony: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pedagogical_day: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  evaluation: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  custom: 'bg-slate-50 text-slate-800 border-slate-200',
};

/** Solid icon-badge background per event type. */
export const CALENDAR_TYPE_SOLID: Record<CalendarEventType, string> = {
  vacation_break: 'bg-amber-500',
  public_holiday: 'bg-rose-500',
  exam_period: 'bg-violet-500',
  meeting: 'bg-blue-500',
  ceremony: 'bg-emerald-500',
  pedagogical_day: 'bg-cyan-500',
  evaluation: 'bg-indigo-500',
  custom: 'bg-slate-500',
};

/** Lucide icon per event type. */
export const CALENDAR_TYPE_ICON: Record<CalendarEventType, LucideIcon> = {
  vacation_break: Sun,
  public_holiday: Flag,
  exam_period: ClipboardList,
  meeting: Users,
  ceremony: PartyPopper,
  pedagogical_day: Sparkles,
  evaluation: GraduationCap,
  custom: CalendarIcon,
};

/** Most-specific scope label for an event (class > level > cycle > school-wide). */
export function calendarScopeLabel(event: PortalCalendarEvent): string {
  if (event.classSection) return `Classe ${event.classSection.name}`;
  if (event.gradeLevel) return `Niveau ${event.gradeLevel.name}`;
  if (event.cycle) return `Cycle ${event.cycle.name}`;
  return "Toute l'école";
}
