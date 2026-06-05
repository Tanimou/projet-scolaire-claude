'use client';

import { Check, Download, FileSpreadsheet, Loader2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createGradeGridAction,
  fetchGradeGridUrlAction,
  latestGradeGridJobAction,
  type TeacherExportJob,
  type TeacherExportStatus,
} from './actions';

/**
 * Teacher "Exporter la grille" button (E4-S3). A self-contained enqueue → poll →
 * signed-download widget over the teacher-permitted exports surface
 * (`exports.execute.teacher`), reusing the existing async ExportJob engine.
 *
 * Flow:
 *   1. click → POST /teacher/exports/grade-grid ({ teachingAssignmentId }); the
 *      API re-checks teaching ownership + derives classSectionId server-side.
 *   2. while pending/running, poll GET /teacher/exports?classSectionId=… every
 *      ~2.5 s (own jobs only) until the job reaches succeeded|failed. Polling is
 *      paused while the tab is hidden and self-terminates on a terminal status.
 *   3. succeeded → "Télécharger" resolves a fresh 1 h signed URL on click and
 *      opens the XLSX (URLs are never baked into the HTML — they expire).
 *
 * `classSectionId` is needed ONLY to scope the status poll to this class's jobs;
 * it is never sent on enqueue (the server derives it from the owned assignment).
 */
export function GradeGridExportButton({
  teachingAssignmentId,
  classSectionId,
  className,
}: {
  teachingAssignmentId: string;
  classSectionId: string;
  className?: string;
}) {
  const [status, setStatus] = useState<TeacherExportStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(true);

  const isInflight = status === 'pending' || status === 'running';

  useEffect(() => {
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Poll the latest own-job for this class while a generation is in-flight.
  useEffect(() => {
    if (!isInflight) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (!visibleRef.current) return;
      const res = await latestGradeGridJobAction(classSectionId);
      if (cancelled || !res.ok) return;
      const job: TeacherExportJob | null = res.job;
      if (job) {
        setJobId(job.id);
        setStatus(job.status);
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isInflight, classSectionId]);

  const enqueue = useCallback(async () => {
    setError(null);
    setBusy(true);
    // optimistic: flip to pending immediately so the poller activates
    setStatus('pending');
    const res = await createGradeGridAction(teachingAssignmentId);
    setBusy(false);
    if (!res.ok) {
      setStatus(null);
      setError(res.error);
      return;
    }
    setJobId(res.data.id);
    setStatus('pending');
  }, [teachingAssignmentId]);

  const download = useCallback(async () => {
    if (!jobId) return;
    setError(null);
    setBusy(true);
    const res = await fetchGradeGridUrlAction(jobId);
    setBusy(false);
    if (res.ok) {
      window.open(res.url, '_blank', 'noopener');
    } else {
      setError("Le lien n'a pas pu être généré. Réessayez dans un instant.");
    }
  }, [jobId]);

  const base =
    'inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none';

  return (
    <div className={`flex flex-col items-stretch gap-1 sm:items-end ${className ?? ''}`}>
      <div aria-live="polite" className="flex items-center gap-2">
        {status === 'succeeded' ? (
          <>
            <button
              type="button"
              onClick={download}
              disabled={busy}
              aria-label="Télécharger la grille de notes (XLSX)"
              className={`${base} bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-500/70`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              Télécharger la grille
            </button>
            <button
              type="button"
              onClick={enqueue}
              disabled={busy}
              aria-label="Régénérer la grille de notes"
              title="Régénérer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:opacity-60"
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : isInflight ? (
          <span
            className={`${base} cursor-wait bg-blue-50 text-blue-700`}
            role="status"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            {status === 'running' ? 'Génération…' : 'En file…'}
          </span>
        ) : status === 'failed' ? (
          <button
            type="button"
            onClick={enqueue}
            disabled={busy}
            aria-label="Réessayer l'export de la grille de notes"
            className={`${base} bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/70`}
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            Réessayer l&apos;export
          </button>
        ) : (
          <button
            type="button"
            onClick={enqueue}
            disabled={busy}
            aria-label="Exporter la grille de notes au format XLSX"
            className={`${base} bg-gradient-to-br from-teal-700 to-emerald-700 text-white hover:brightness-110 focus-visible:ring-emerald-500/70`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            )}
            Exporter la grille
          </button>
        )}
        {status === 'succeeded' && (
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        )}
      </div>
      {error && (
        <span role="alert" className="text-[11px] font-medium text-rose-600">
          {error}
        </span>
      )}
    </div>
  );
}
