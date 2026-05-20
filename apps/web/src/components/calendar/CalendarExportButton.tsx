'use client';

import { CalendarPlus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { buildCalendarIcs, type IcsEvent } from '@/lib/ics';

interface Props {
  events: IcsEvent[];
  calendarName: string;
  /** File name stem, e.g. 'calendrier-scolaire-parent'. */
  fileNameStem: string;
}

export function CalendarExportButton({ events, calendarName, fileNameStem }: Props) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || events.length === 0;

  const handleExport = useCallback(() => {
    if (events.length === 0) return;
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  }, [events, calendarName, fileNameStem]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled}
      title={
        events.length === 0
          ? 'Aucun événement à exporter'
          : 'Exporter au format iCalendar (.ics) — importable dans Google Agenda, Apple Calendrier, Outlook…'
      }
      className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
    >
      <CalendarPlus className="h-3.5 w-3.5 text-blue-600" />
      {busy ? 'Génération…' : 'Exporter (.ics)'}
    </button>
  );
}
