'use client';

import { CalendarRange, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { StatusBadge, formatRelativeTime } from '@pilotage/ui';

import { createBulletinAction, type ParentExportStatus } from './actions';
import { ParentBulletinDownloadButton } from './ParentBulletinDownloadButton';
import { ParentExportsRefresher } from './ParentExportsRefresher';

export interface BulletinTerm {
  id: string;
  name: string;
}

export interface BulletinJobView {
  id: string;
  status: ParentExportStatus;
  fileSizeBytes: number | null;
  createdAt: string;
  finishedAt: string | null;
}

const STATUS_LABEL: Record<ParentExportStatus, string> = {
  pending: 'En file',
  running: 'En cours…',
  succeeded: 'Prêt',
  failed: 'Échec',
};

const STATUS_TONE: Record<ParentExportStatus, 'neutral' | 'sky' | 'success' | 'danger'> = {
  pending: 'neutral',
  running: 'sky',
  succeeded: 'success',
  failed: 'danger',
};

function formatBytes(n: number | null): string {
  if (n == null) return 'PDF';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One term-row in the parent bulletin panel. Each `{ studentId, termId }` has
 * an independent job state, so each row owns its own optimistic transition.
 */
function TermRow({
  studentId,
  firstName,
  term,
  job,
  now,
}: {
  studentId: string;
  firstName: string;
  term: BulletinTerm;
  job: BulletinJobView | null;
  now: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistically flip to "pending" the instant the parent clicks, before the
  // server round-trip resolves — the polling refresher takes over from there.
  const [optimistic, setOptimistic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once a NEWER job than the one present at click-time arrives from the server,
  // drop the optimistic mask so the real status (running → succeeded/failed)
  // drives the row. Without this, the optimistic 'pending' would hide success.
  const jobAtClickRef = useRef<string | null>(null);
  useEffect(() => {
    if (optimistic && job && job.id !== jobAtClickRef.current) {
      setOptimistic(false);
    }
  }, [optimistic, job]);

  const status: ParentExportStatus | null = optimistic ? 'pending' : (job?.status ?? null);
  const isInflight = status === 'pending' || status === 'running';

  function enqueue() {
    setError(null);
    jobAtClickRef.current = job?.id ?? null;
    setOptimistic(true);
    startTransition(async () => {
      const res = await createBulletinAction(studentId, term.id);
      if (!res.ok) {
        setOptimistic(false);
        setError(res.error ?? 'La génération n’a pas pu être lancée.');
        return;
      }
      // Re-render the server component so the freshly-created job appears and
      // the page-level polling refresher activates.
      router.refresh();
    });
  }

  const generateLabel = `Générer le bulletin du ${term.name} pour ${firstName}`;
  const downloadLabel = `Télécharger le bulletin du ${term.name} pour ${firstName}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5">
        <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">{term.name}</p>
          <p className="text-xs text-slate-500">Synthèse PDF des moyennes par matière</p>
        </div>
      </div>

      {/* aria-live region announces the ready/failed transition to SR users. */}
      <div
        className="flex flex-col items-stretch gap-1 sm:items-end"
        aria-live="polite"
      >
        {status === 'succeeded' && job ? (
          <>
            <ParentBulletinDownloadButton id={job.id} label={downloadLabel} />
            <p className="text-[11px] text-slate-500">
              Généré {formatRelativeTime(job.finishedAt ?? job.createdAt, new Date(now))} ·{' '}
              {formatBytes(job.fileSizeBytes)}
            </p>
            <button
              type="button"
              onClick={enqueue}
              disabled={pending}
              className="text-[11px] font-medium text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 disabled:opacity-60 motion-reduce:transition-none"
            >
              Régénérer
            </button>
          </>
        ) : isInflight ? (
          <>
            <StatusBadge
              label={STATUS_LABEL[status]}
              tone={STATUS_TONE[status]}
              size="sm"
              withDot
              className="self-start sm:self-end [&>span:first-child]:animate-pulse motion-reduce:[&>span:first-child]:animate-none"
            />
            <p className="text-[11px] text-slate-500">
              Génération en cours, quelques secondes…
            </p>
          </>
        ) : status === 'failed' ? (
          <>
            <StatusBadge
              label={STATUS_LABEL.failed}
              tone="danger"
              size="sm"
              withDot
              className="self-start sm:self-end"
            />
            <p className="text-[11px] text-slate-500">
              La génération n’a pas abouti. Réessayez dans un instant.
            </p>
            <button
              type="button"
              onClick={enqueue}
              disabled={pending}
              aria-label={`Réessayer la génération du bulletin du ${term.name} pour ${firstName}`}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 disabled:opacity-60 motion-reduce:transition-none sm:text-xs"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Réessayer
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={enqueue}
              disabled={pending}
              aria-label={generateLabel}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:text-xs"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              {pending ? 'Mise en file…' : 'Générer le bulletin'}
            </button>
            {error && (
              <span role="alert" className="text-[11px] font-medium text-rose-600">
                {error}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Parent self-service bulletin panel (E4-S2). Renders one state-aware row per
 * term that has published grades for the active child, reusing the admin exports
 * machinery (StatusBadge tones + signed-URL-on-click download + polling
 * refresher) but parent-scoped & guardianship-checked. The whole panel is always
 * scoped to the active child (`studentId`); switching child re-scopes it.
 */
export function BulletinLauncher({
  studentId,
  firstName,
  terms,
  jobsByTerm,
  hasInflight,
}: {
  studentId: string;
  firstName: string;
  terms: BulletinTerm[];
  jobsByTerm: Record<string, BulletinJobView | null>;
  hasInflight: boolean;
}) {
  const now = Date.now();

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 sm:p-6">
      <header className="flex items-start gap-3">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
          aria-hidden
        >
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Bulletins de {firstName}</h2>
          <p className="text-xs text-slate-500">
            Synthèse PDF des moyennes par matière, par trimestre — générée à la demande.
          </p>
        </div>
      </header>

      {terms.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Les bulletins seront disponibles dès la publication des premières notes du trimestre.
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {terms.map((term) => (
            <TermRow
              // Composite key: terms are academic-year-global, so sibling
              // children share term ids. Keying by studentId+term.id remounts
              // each row when the active child changes, resetting its
              // optimistic/error/jobAtClick state instead of bleeding it across
              // children.
              key={`${studentId}-${term.id}`}
              studentId={studentId}
              firstName={firstName}
              term={term}
              job={jobsByTerm[term.id] ?? null}
              now={now}
            />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        Bulletin généré à votre demande, accessible à vous seul·e via un lien sécurisé temporaire
        (1&nbsp;h). Chaque génération est journalisée.
      </p>

      {/* Poll every 3 s while any of this child's bulletins is in-flight. */}
      <ParentExportsRefresher hasInflight={hasInflight} />
    </section>
  );
}
