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

// ───────────────────────────────────────────────────────────────────────────
// LIBELLÉS DE PORTÉE — déclarés UNE fois, importés partout (S-E03-8 / PF-40).
//
// Précédent cicatriciel : `admin/enrollments/page.tsx` documente une chaîne de
// portée RECOPIÉE à la main qui avait divergé d'une apostrophe (`'` vs `’`)
// sous un docblock affirmant l'identité — `PF-371`. Une portée écrite deux fois
// est une portée qui divergera. Ces fonctions sont donc le seul endroit du
// dépôt où l'on rédige « ce que ce nombre compte ».
// ───────────────────────────────────────────────────────────────────────────

/** Noms de mois FR, indexés comme `Date.prototype.getMonth()` (0 = janvier). */
export const FR_MONTHS = [
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
] as const;

/** Noms de mois FR abrégés — pour les pastilles de date. */
export const FR_MONTHS_SHORT = [
  'janv',
  'févr',
  'mars',
  'avr',
  'mai',
  'juin',
  'juil',
  'août',
  'sept',
  'oct',
  'nov',
  'déc',
] as const;

/**
 * « Novembre 2026 ». Prend les composantes DÉRIVÉES de l'ancre serveur, jamais
 * une `Date` reformatée côté navigateur : `toLocaleDateString` sans `timeZone`
 * peut rendre un mois différent sur le serveur et dans le navigateur pour le
 * même instant, ce qui ferait revivre le défaut d'hydratation par le libellé.
 */
export function calendarMonthLabel(parts: { year: number; monthIndex: number }): string {
  return `${FR_MONTHS[parts.monthIndex] ?? ''} ${parts.year}`;
}

/** Le nom du filtre actif, ou la mention explicite « tous types ». */
export function calendarFilterLabel(activeTypeLabel: string | null): string {
  return activeTypeLabel ? `filtré sur « ${activeTypeLabel} »` : 'tous types confondus';
}

/** Portée de la carte « TOTAL / AFFICHÉS ». */
export function calendarTotalScope(activeTypeLabel: string | null): string {
  return `Calendrier visible pour vous — ${calendarFilterLabel(activeTypeLabel)}`;
}

/** Portée de la carte mensuelle. Dit « touchant », jamais « du mois » : sous le
 *  prédicat de CHEVAUCHEMENT, un congé à cheval compte dans les deux mois. */
export function calendarMonthScope(
  parts: { year: number; monthIndex: number },
  activeTypeLabel: string | null,
): string {
  return `${calendarMonthLabel(parts)} — événements touchant le mois, ${calendarFilterLabel(
    activeTypeLabel,
  )}`;
}

/** Portée de la carte hebdomadaire. Nomme la semaine ISO, pas « sous 7 jours ». */
export function calendarWeekScope(activeTypeLabel: string | null): string {
  return `Semaine ISO en cours (lundi → dimanche) — ${calendarFilterLabel(activeTypeLabel)}`;
}

/** Portée de la carte « PROCHAIN ». */
export function calendarNextScope(activeTypeLabel: string | null): string {
  return `Le plus proche non terminé — ${calendarFilterLabel(activeTypeLabel)}`;
}

/**
 * En-tête d'une liste plafonnée. Le vrai total est calculé AVANT la coupe, donc
 * ce libellé ne peut pas dire « 12 » quand il y en a 39 (`DNC-06`, classe PF-20).
 * `total === 0` rend `null` : un vide se raconte avec des mots, pas un `0` posé
 * dans une rangée de nombres.
 */
export function calendarCappedHeader(summary: {
  total: number;
  truncated: boolean;
  items: readonly unknown[];
}): string | null {
  if (summary.total === 0) return null;
  if (!summary.truncated) return `${summary.total} à venir`;
  return `${summary.items.length} affichés sur ${summary.total} à venir`;
}
