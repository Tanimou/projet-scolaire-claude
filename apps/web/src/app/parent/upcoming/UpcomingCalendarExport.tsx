'use client';

import { CalendarCheck2, CalendarPlus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { buildCalendarIcs, type IcsEvent } from '@/lib/ics';

/**
 * Client-side iCalendar export for the parent "Évaluations à venir" page.
 *
 * Reuses the shared {@link buildCalendarIcs} serialiser (same one powering the
 * school calendar export) so the produced `.ics` imports cleanly into Google
 * Agenda, Apple Calendrier and Outlook. Two entry points:
 *
 *  - {@link ExportEvaluationsButton} — bulk export of the currently visible
 *    (filtered) evaluations, surfaced in the page header.
 *  - {@link AddEvaluationToCalendarButton} — single-evaluation export, shown
 *    inline on each row so a parent can add just the one that matters.
 *
 * The mapping from evaluation → {@link IcsEvent} happens server-side in the
 * page; this component only handles the browser download.
 */

function downloadIcs(events: IcsEvent[], calendarName: string, fileNameStem: string): void {
  const ics = buildCalendarIcs(events, { calendarName });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${fileNameStem}-${stamp}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportEvaluationsButton({
  events,
  childName,
}: {
  events: IcsEvent[];
  childName: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || events.length === 0;

  const handleExport = useCallback(() => {
    if (events.length === 0) return;
    setBusy(true);
    try {
      downloadIcs(
        events,
        childName ? `Évaluations — ${childName}` : 'Évaluations à venir',
        'evaluations-a-venir',
      );
    } finally {
      setBusy(false);
    }
  }, [events, childName]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled}
      title={
        events.length === 0
          ? 'Aucune évaluation à exporter'
          : 'Ajouter ces évaluations à votre agenda (.ics) — Google Agenda, Apple Calendrier, Outlook…'
      }
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
    >
      <CalendarPlus className="h-3.5 w-3.5 text-blue-600" />
      {busy
        ? 'Génération…'
        : events.length > 0
          ? `Ajouter à mon agenda (${events.length})`
          : 'Ajouter à mon agenda'}
    </button>
  );
}

export function AddEvaluationToCalendarButton({ event }: { event: IcsEvent }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAdd = useCallback(() => {
    downloadIcs([event], event.title, `evaluation-${event.id}`);
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 2200);
  }, [event]);

  return (
    <button
      type="button"
      onClick={handleAdd}
      title="Ajouter cette évaluation à votre agenda (.ics)"
      aria-label={`Ajouter « ${event.title} » à mon agenda`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 transition-all hover:-translate-y-px ${
        done
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-blue-700 hover:ring-blue-200'
      }`}
    >
      {done ? (
        <>
          <CalendarCheck2 className="h-3 w-3" />
          Ajouté
        </>
      ) : (
        <>
          <CalendarPlus className="h-3 w-3" />
          Agenda
        </>
      )}
    </button>
  );
}
