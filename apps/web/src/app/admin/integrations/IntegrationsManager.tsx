'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { EmptyState, FormDrawer, StatusBadge } from '@pilotage/ui';

import { connectSourceAction, syncSourceAction } from './integrations-actions';
import type { OneRosterBundleInput, RosterSourceDto, RosterSourceKind, RosterSyncStatus } from './types';

const KIND_LABEL: Record<RosterSourceKind, string> = {
  oneroster_csv: 'OneRoster · Bundle CSV',
  oneroster_rest: 'OneRoster · API REST',
};

/** Status meta — text + tone (paired with the card's own icons, never colour-alone). */
function statusMeta(s: RosterSyncStatus): {
  label: string;
  tone: 'success' | 'info' | 'amber' | 'neutral';
} {
  switch (s) {
    case 'mapped':
      return { label: 'Synchronisé · à appliquer', tone: 'success' };
    case 'pulling':
      return { label: 'Synchronisation…', tone: 'info' };
    case 'failed':
      return { label: 'À vérifier', tone: 'amber' };
    case 'idle':
    default:
      return { label: 'Prête', tone: 'neutral' };
  }
}

/**
 * E11-S3 — the OneRoster integrations manager (client island).
 *
 * Composes @pilotage/ui FormDrawer + StatusBadge + EmptyState over the server
 * payload (no client refetch). Lets a school admin:
 *  - connect a roster source (a CSV bundle, or a REST base-url + key — REST is
 *    the recorded stretch, the form admits it without a rewrite);
 *  - "Synchroniser" a OneRoster CSV bundle → maps + validates server-side, then
 *    navigates to the produced batch's health/detail surface (S1/S2 reuse).
 *
 * Non-stigmatising, WCAG 2.2 AA: focus-trapped drawers (the hardened Drawer
 * primitive), `role=status` live regions on connect/sync feedback, status carries
 * text+icon (not colour alone), ≥44px controls, kind FR copy.
 */
export function IntegrationsManager({ sources }: { sources: RosterSourceDto[] }) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);
  const [syncSource, setSyncSource] = useState<RosterSourceDto | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Sources connectées
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {sources.length === 0
              ? 'Aucune source pour le moment.'
              : `${sources.length} source${sources.length > 1 ? 's' : ''} OneRoster.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Plus className="h-4 w-4" aria-hidden /> Connecter une source
        </button>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={Plug}
          tone="sky"
          title="Connectez votre première source OneRoster"
          description="Importez votre roster (élèves, classes, inscriptions) depuis votre SIG en un clic. Chaque synchronisation devient un import vérifié, réversible et auditable."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" role="list">
          {sources.map((src) => {
            const meta = statusMeta(src.status);
            return (
              <li
                key={src.id}
                className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-slate-900" title={src.label}>
                      {src.label}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">{KIND_LABEL[src.kind]}</p>
                  </div>
                  <StatusBadge
                    label={meta.label}
                    tone={meta.tone}
                    size="sm"
                    className="shrink-0"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  {src.lastSyncAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      Dernière synchro&nbsp;:{' '}
                      {new Date(src.lastSyncAt).toLocaleString('fr-FR', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  ) : (
                    <span className="italic text-slate-400">Jamais synchronisée</span>
                  )}
                  {src.hasCredential && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Identifiant sécurisé
                    </span>
                  )}
                </div>

                {src.status === 'failed' && src.lastError && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                    {src.lastError}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSyncSource(src)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden /> Synchroniser
                  </button>
                  {src.lastBatchId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/admin/imports/${src.lastBatchId}`)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <FileText className="h-4 w-4" aria-hidden /> Voir le dernier import
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConnectDrawer open={connectOpen} onClose={() => setConnectOpen(false)} />
      {syncSource && (
        <SyncDrawer source={syncSource} onClose={() => setSyncSource(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Connect drawer                                                            */
/* ------------------------------------------------------------------------- */

function ConnectDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<RosterSourceKind>('oneroster_csv');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errId = useId();

  const reset = () => {
    setKind('oneroster_csv');
    setLabel('');
    setBaseUrl('');
    setCredential('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    setError(null);
    if (!label.trim()) {
      setError('Donnez un nom à cette source (ex. « OneRoster Académie 2026 »).');
      return;
    }
    if (kind === 'oneroster_rest' && !baseUrl.trim()) {
      setError('Une URL de base est requise pour une source REST.');
      return;
    }
    startTransition(async () => {
      const res = await connectSourceAction({
        kind,
        label: label.trim(),
        baseUrl: baseUrl.trim() || undefined,
        credential: credential.trim() || undefined,
      });
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <FormDrawer
      open={open}
      onClose={close}
      title="Connecter une source OneRoster"
      description="Une source connectée peut être synchronisée à la demande. Vous garderez le contrôle : chaque synchronisation produit un import vérifié avant toute écriture."
      submitLabel="Connecter"
      onSubmit={submit}
      busy={pending}
      disabledSubmit={!label.trim()}
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold text-slate-700">Type de source</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['oneroster_csv', 'oneroster_rest'] as const).map((k) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={active}
                  className={`min-h-[44px] rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {KIND_LABEL[k]}
                  {k === 'oneroster_rest' && (
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                      Prochainement — l&apos;import de bundle CSV est disponible dès maintenant.
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="src-label" className="mb-1.5 block text-sm font-semibold text-slate-700">
            Nom de la source
          </label>
          <input
            id="src-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="OneRoster Académie 2026"
            className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {kind === 'oneroster_rest' && (
          <>
            <div>
              <label htmlFor="src-baseurl" className="mb-1.5 block text-sm font-semibold text-slate-700">
                URL de base de l&apos;API
              </label>
              <input
                id="src-baseurl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://sis.exemple.fr/ims/oneroster/v1p1"
                className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label htmlFor="src-cred" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Clé d&apos;accès <span className="font-normal text-slate-400">(optionnel)</span>
              </label>
              <input
                id="src-cred"
                type="password"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                autoComplete="off"
                placeholder="••••••••••••"
                className="block w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                Stockée de façon sécurisée côté serveur — jamais réaffichée.
              </p>
            </div>
          </>
        )}

        {error && (
          <p
            id={errId}
            role="status"
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200"
          >
            {error}
          </p>
        )}
      </div>
    </FormDrawer>
  );
}

/* ------------------------------------------------------------------------- */
/* Sync drawer                                                               */
/* ------------------------------------------------------------------------- */

const BUNDLE_FIELDS: { key: keyof OneRosterBundleInput; label: string; hint: string }[] = [
  { key: 'users', label: 'users.csv', hint: 'Élèves (role=student) — sourcedId, givenName, familyName, email…' },
  { key: 'classes', label: 'classes.csv', hint: 'Sections — sourcedId, title, grades…' },
  { key: 'enrollments', label: 'enrollments.csv', hint: 'Inscriptions élève↔classe — userSourcedId, classSourcedId, role…' },
];

function SyncDrawer({ source, onClose }: { source: RosterSourceDto; onClose: () => void }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<OneRosterBundleInput>({});
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const isRest = source.kind === 'oneroster_rest';
  const hasAny = Object.values(bundle).some((v) => (v ?? '').trim().length > 0);

  const setFile = async (key: keyof OneRosterBundleInput, file: File | null) => {
    if (!file) {
      setBundle((b) => ({ ...b, [key]: undefined }));
      return;
    }
    const text = await file.text();
    setBundle((b) => ({ ...b, [key]: text }));
  };

  const submit = () => {
    setError(null);
    setWarnings([]);
    if (isRest) {
      setError('La synchronisation REST en direct arrivera prochainement. Importez un bundle CSV pour le moment.');
      return;
    }
    if (!hasAny) {
      setError('Ajoutez au moins un fichier du bundle OneRoster (users.csv, classes.csv ou enrollments.csv).');
      return;
    }
    startTransition(async () => {
      const res = await syncSourceAction(source.id, bundle);
      if (res.ok) {
        if (res.data.warnings.length > 0) setWarnings(res.data.warnings);
        const target = res.data.primaryBatchId;
        if (target) {
          onClose();
          router.push(`/admin/imports/${target}`);
          return;
        }
        // No batch produced but no error — surface the warnings, keep the drawer.
        if (res.data.warnings.length === 0) {
          setError('La synchronisation n’a produit aucune donnée exploitable.');
        }
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={`Synchroniser · ${source.label}`}
      description="Importez les fichiers de votre bundle OneRoster v1.1. Ils seront mappés puis validés ligne par ligne — aucune donnée n’est écrite avant que vous appliquiez l’import."
      submitLabel="Lancer la synchronisation"
      onSubmit={submit}
      busy={pending}
      disabledSubmit={isRest || !hasAny}
      size="lg"
    >
      <div className="space-y-5">
        {isRest ? (
          <p role="status" className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-800 ring-1 ring-sky-200">
            La synchronisation REST en direct arrivera prochainement. Vous pouvez dès maintenant importer
            un bundle CSV OneRoster en créant une source de type « Bundle CSV ».
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Sélectionnez les fichiers <code className="rounded bg-slate-100 px-1 text-[11px]">.csv</code>{' '}
              de votre export OneRoster. Seules les données de roster (identité élève + inscriptions) sont
              lues — jamais de notes, d&apos;absences ni de données médicales.
            </p>

            {BUNDLE_FIELDS.map((f) => {
              const loaded = (bundle[f.key] ?? '').trim().length > 0;
              return (
                <div key={String(f.key)}>
                  <label
                    htmlFor={`bundle-${String(f.key)}`}
                    className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700"
                  >
                    {f.label}
                    {loaded && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> Chargé
                      </span>
                    )}
                  </label>
                  <input
                    id={`bundle-${String(f.key)}`}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => void setFile(f.key, e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer rounded-xl border border-slate-300 text-sm text-slate-600 shadow-sm file:mr-3 file:min-h-[44px] file:cursor-pointer file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">{f.hint}</p>
                </div>
              );
            })}
          </>
        )}

        {warnings.length > 0 && (
          <ul role="status" className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
            {error}
          </p>
        )}

        {pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Mappage et validation en cours…
          </p>
        )}
      </div>
    </FormDrawer>
  );
}
