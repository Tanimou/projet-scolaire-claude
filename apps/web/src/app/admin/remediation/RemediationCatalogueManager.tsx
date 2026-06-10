'use client';

import {
  Archive,
  CalendarPlus,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Pencil,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

import {
  Badge,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  FormDrawer,
  RowActions,
  StatusBadge,
  SubjectChip,
  type ColumnDef,
} from '@pilotage/ui';
import type { AdminTutorDto } from '@pilotage/contracts';

import {
  createTutorAction,
  editSlotAction,
  publishSlotAction,
  publishTutorAction,
  updateTutorAction,
  type CreateTutorInput,
  type PublishSlotInput,
  type UpdateTutorInput,
} from './remediation-actions';
import { costKindLabel, tutorTypeLabel } from './slot-format';

interface SubjectOption {
  id: string;
  code: string | null;
  name: string;
}
interface TeacherOption {
  id: string;
  name: string;
}

const WEEKDAYS = [
  { value: 0, label: 'Lundi' },
  { value: 1, label: 'Mardi' },
  { value: 2, label: 'Mercredi' },
  { value: 3, label: 'Jeudi' },
  { value: 4, label: 'Vendredi' },
  { value: 5, label: 'Samedi' },
  { value: 6, label: 'Dimanche' },
] as const;

const COST_KINDS = [
  { value: 'free', label: 'Gratuit' },
  { value: 'volunteer', label: 'Bénévole' },
  { value: 'paid_offline', label: 'Sur place' },
] as const;

const TYPE_OPTIONS = [
  { value: 'teacher', label: 'Enseignant·e' },
  { value: 'external', label: 'Externe' },
  { value: 'peer', label: 'Pair' },
] as const;

type TutorType = 'teacher' | 'external' | 'peer';
type CostKind = 'free' | 'volunteer' | 'paid_offline';

/** Status label/tone for a tutor row (published vs retired) — icon+text, not colour-alone. */
function tutorStatusMeta(t: AdminTutorDto): { label: string; tone: 'success' | 'neutral' } {
  return t.published
    ? { label: 'Publié', tone: 'success' }
    : { label: 'Retiré', tone: 'neutral' };
}

/**
 * E7-S5 — the admin remediation catalogue manager (client island).
 *
 * Composes the @pilotage/ui FilterBar + DataTable + RowActions + FormDrawer +
 * ConfirmDialog over the server payload (no refetch / no client N+1 — filtering
 * is client-side over the already-loaded rows). Lets a school admin:
 *  - create a tutor (teacher-linked or external/peer-by-name);
 *  - edit / approve (publish) / retire (unpublish, history-preserving) a tutor;
 *  - publish an availability slot for ANY tutor (no subject-ownership wall).
 * Kind, non-stigmatising FR copy throughout; every status is icon+text.
 */
export function RemediationCatalogueManager({
  tutors,
  subjects,
  teachers,
}: {
  tutors: AdminTutorDto[];
  subjects: SubjectOption[];
  teachers: TeacherOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Filters (client-side over the loaded rows).
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'retired'>('all');

  // Tutor create/edit drawer.
  const [tutorDrawer, setTutorDrawer] = useState<{ mode: 'create' | 'edit'; tutor?: AdminTutorDto } | null>(
    null,
  );
  // Slot publish drawer.
  const [slotFor, setSlotFor] = useState<AdminTutorDto | null>(null);
  // Retire confirm.
  const [retireFor, setRetireFor] = useState<AdminTutorDto | null>(null);

  const subjectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subjects) m.set(s.id, s.name);
    return m;
  }, [subjects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tutors.filter((t) => {
      if (q && !t.displayName.toLowerCase().includes(q)) return false;
      if (subjectFilter && !t.subjectIds.includes(subjectFilter)) return false;
      if (statusFilter === 'published' && !t.published) return false;
      if (statusFilter === 'retired' && t.published) return false;
      return true;
    });
  }, [tutors, search, subjectFilter, statusFilter]);

  function runPublishToggle(t: AdminTutorDto, published: boolean) {
    setStatus(null);
    startTransition(async () => {
      const res = await publishTutorAction(t.id, published);
      if (res.ok) {
        setStatus({
          kind: 'ok',
          msg: published ? `${t.displayName} publié·e.` : `${t.displayName} retiré·e du catalogue.`,
        });
        setRetireFor(null);
      } else {
        setStatus({ kind: 'err', msg: res.error });
      }
    });
  }

  const columns: ColumnDef<AdminTutorDto>[] = [
    {
      key: 'name',
      header: 'Intervenant·e',
      sticky: true,
      cell: (t) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{t.displayName}</span>
            {t.type !== 'teacher' && (
              <Badge variant="outline" className="text-[10px]">
                {t.type === 'external' ? 'Externe' : 'Pair'}
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      hideOnMobile: true,
      cell: (t) => <StatusBadge label={tutorTypeLabel(t.type)} tone="neutral" size="sm" />,
    },
    {
      key: 'subjects',
      header: 'Matières',
      hideOnMobile: true,
      cell: (t) => (
        <div className="flex flex-wrap items-center gap-1">
          {t.subjectIds.slice(0, 3).map((sid) => (
            <SubjectChip
              key={sid}
              subjectCode={subjectName.get(sid) ?? '—'}
              label={subjectName.get(sid) ?? '—'}
              size="xs"
            />
          ))}
          {t.subjectIds.length > 3 && (
            <Badge variant="outline" className="text-[10px]">
              +{t.subjectIds.length - 3}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'Modalité',
      hideOnMobile: true,
      cell: (t) => (
        <Badge variant="outline" className="text-[11px]">
          {costKindLabel(t.costKind)}
        </Badge>
      ),
    },
    {
      key: 'slots',
      header: 'Créneaux',
      hideOnMobile: true,
      align: 'right',
      cell: (t) => (
        <span className="tabular-nums text-sm text-slate-700">
          {t.availabilityCount}
          {t.activeBookingCount > 0 && (
            <span className="text-slate-400"> · {t.activeBookingCount} rés.</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (t) => {
        const meta = tutorStatusMeta(t);
        return <StatusBadge label={meta.label} tone={meta.tone} size="sm" withDot />;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (t) => (
        <RowActions
          actions={[
            t.published
              ? {
                  id: 'retire',
                  icon: <Archive className="h-3.5 w-3.5" />,
                  label: `Retirer ${t.displayName} du catalogue`,
                  tone: 'rose',
                  onClick: () => {
                    setStatus(null);
                    setRetireFor(t);
                  },
                }
              : {
                  id: 'publish',
                  icon: <CheckCircle2 className="h-4 w-4" />,
                  label: `Publier ${t.displayName}`,
                  tone: 'emerald',
                  onClick: () => runPublishToggle(t, true),
                },
            {
              id: 'edit',
              icon: <Pencil className="h-3.5 w-3.5" />,
              label: `Modifier ${t.displayName}`,
              tone: 'cyan',
              onClick: () => {
                setStatus(null);
                setTutorDrawer({ mode: 'edit', tutor: t });
              },
            },
            {
              id: 'slot',
              icon: <CalendarPlus className="h-3.5 w-3.5" />,
              label: `Ajouter un créneau pour ${t.displayName}`,
              tone: 'violet',
              onClick: () => {
                setStatus(null);
                setSlotFor(t);
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Polite live region for action results (no focus theft). */}
      <p
        role="status"
        aria-live="polite"
        className={
          status
            ? `rounded-lg px-3 py-2 text-sm font-medium ${
                status.kind === 'ok'
                  ? 'bg-emerald-100/80 text-emerald-800'
                  : 'bg-rose-100/80 text-rose-800'
              }`
            : 'sr-only'
        }
      >
        {status?.msg ?? ''}
      </p>

      <FilterBar
        search={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un intervenant…"
            aria-label="Rechercher un intervenant"
            className="min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          />
        }
        filters={
          <>
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              aria-label="Filtrer par matière"
              className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <option value="">Toutes les matières</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'published' | 'retired')}
              aria-label="Filtrer par statut"
              className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <option value="all">Tous les statuts</option>
              <option value="published">Publié</option>
              <option value="retired">Retiré</option>
            </select>
          </>
        }
        primaryAction={
          <button
            type="button"
            onClick={() => {
              setStatus(null);
              setTutorDrawer({ mode: 'create' });
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Ajouter un intervenant
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={filtered}
        emptyState={
          <EmptyState
            icon={GraduationCap}
            tone="violet"
            title="Aucun intervenant dans le catalogue"
            description="Ajoutez un enseignant volontaire ou un intervenant externe pour proposer du soutien à vos familles."
          />
        }
      />

      {/* Tutor create / edit drawer. */}
      {tutorDrawer && (
        <TutorFormDrawer
          mode={tutorDrawer.mode}
          tutor={tutorDrawer.tutor}
          subjects={subjects}
          teachers={teachers}
          busy={pending}
          onClose={() => setTutorDrawer(null)}
          onDone={(msg) => {
            setTutorDrawer(null);
            setStatus({ kind: 'ok', msg });
          }}
          startTransition={startTransition}
        />
      )}

      {/* Publish-slot drawer. */}
      {slotFor && (
        <PublishSlotDrawer
          tutor={slotFor}
          busy={pending}
          onClose={() => setSlotFor(null)}
          onDone={(msg) => {
            setSlotFor(null);
            setStatus({ kind: 'ok', msg });
          }}
          startTransition={startTransition}
        />
      )}

      {/* Retire confirm. */}
      <ConfirmDialog
        open={retireFor != null}
        onClose={() => setRetireFor(null)}
        onConfirm={() => retireFor && runPublishToggle(retireFor, false)}
        title={retireFor ? `Retirer ${retireFor.displayName} du catalogue ?` : 'Retirer du catalogue ?'}
        description="Les familles ne pourront plus le réserver ; les séances déjà réservées et l’historique sont conservés."
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        busy={pending}
        tone="danger"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tutor create / edit FormDrawer
// ---------------------------------------------------------------------------

function TutorFormDrawer({
  mode,
  tutor,
  subjects,
  teachers,
  busy,
  onClose,
  onDone,
  startTransition,
}: {
  mode: 'create' | 'edit';
  tutor?: AdminTutorDto;
  subjects: SubjectOption[];
  teachers: TeacherOption[];
  busy: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  startTransition: (cb: () => void) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<TutorType>(tutor?.type ?? 'teacher');
  const [teacherProfileId, setTeacherProfileId] = useState(
    tutor?.teacherProfileId ?? teachers[0]?.id ?? '',
  );
  const [displayName, setDisplayName] = useState(tutor?.displayName ?? '');
  const [blurb, setBlurb] = useState(tutor?.blurb ?? '');
  const [costKind, setCostKind] = useState<CostKind>(tutor?.costKind ?? 'free');
  const [subjectIds, setSubjectIds] = useState<string[]>(tutor?.subjectIds ?? []);
  const [published, setPublished] = useState(tutor?.published ?? false);

  const isEdit = mode === 'edit';
  // type is immutable on edit; for teacher tutors the name auto-fills from the select.
  const selectedTeacherName = useMemo(
    () => teachers.find((t) => t.id === teacherProfileId)?.name ?? '',
    [teachers, teacherProfileId],
  );
  const effectiveName = !isEdit && type === 'teacher' ? selectedTeacherName : displayName;

  const valid =
    subjectIds.length >= 1 &&
    (type === 'teacher' ? (isEdit ? true : !!teacherProfileId) : effectiveName.trim().length > 0);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      if (isEdit && tutor) {
        const patch: UpdateTutorInput = {
          displayName: displayName.trim() || undefined,
          blurb: blurb.trim() ? blurb.trim() : null,
          costKind,
          subjectIds,
          published,
        };
        const res = await updateTutorAction(tutor.id, patch);
        if (res.ok) onDone(`${res.data.displayName} mis·e à jour.`);
        else setError(res.error);
      } else {
        const input: CreateTutorInput = {
          type,
          costKind,
          displayName: effectiveName.trim(),
          blurb: blurb.trim() || undefined,
          subjectIds,
          teacherProfileId: type === 'teacher' ? teacherProfileId : undefined,
          published,
        };
        const res = await createTutorAction(input);
        if (res.ok) onDone(`${res.data.displayName} ajouté·e au catalogue.`);
        else setError(res.error);
      }
    });
  }

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={isEdit ? "Modifier l'intervenant" : 'Ajouter un intervenant'}
      description="Constituez un catalogue d’intervenants de confiance pour vos familles."
      submitLabel={isEdit ? 'Enregistrer' : 'Ajouter au catalogue'}
      busy={busy}
      disabledSubmit={!valid}
      onSubmit={submit}
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800">
            {error}
          </p>
        )}

        {/* Type (immutable on edit). */}
        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Type d’intervenant</legend>
          <div className="mt-1.5 flex gap-2">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={type === opt.value}
                disabled={isEdit}
                onClick={() => setType(opt.value)}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                  type === opt.value
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {isEdit && (
            <p className="mt-1 text-xs text-slate-500">Le type est défini à la création et n’est pas modifiable.</p>
          )}
        </fieldset>

        {/* Teacher select (teacher type) OR free-text name (external/peer). */}
        {type === 'teacher' && !isEdit ? (
          <div>
            <label htmlFor="tutor-teacher" className="block text-sm font-semibold text-slate-700">
              Enseignant·e
            </label>
            <select
              id="tutor-teacher"
              value={teacherProfileId}
              onChange={(e) => setTeacherProfileId(e.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              {teachers.length === 0 && <option value="">Aucun enseignant disponible</option>}
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="tutor-name" className="block text-sm font-semibold text-slate-700">
              {type === 'teacher' ? "Nom affiché" : "Nom de l'intervenant"}
            </label>
            <input
              id="tutor-name"
              type="text"
              value={displayName}
              maxLength={160}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={type === 'peer' ? 'Ex. : Tutorat 3e — entraide maths' : 'Ex. : Association Coup de Pouce'}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            />
          </div>
        )}

        {/* Subjects multi-select. */}
        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Matières</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {subjects.map((s) => {
              const on = subjectIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSubject(s.id)}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    on
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          {subjectIds.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">Sélectionnez au moins une matière.</p>
          )}
        </fieldset>

        {/* Blurb. */}
        <div>
          <label htmlFor="tutor-blurb" className="block text-sm font-semibold text-slate-700">
            Présentation <span className="font-normal text-slate-400">(facultatif)</span>
          </label>
          <textarea
            id="tutor-blurb"
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ex. : aide aux devoirs en petit groupe, le mercredi après-midi."
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          />
        </div>

        {/* Cost modality — label only, never a price. */}
        <div>
          <label htmlFor="tutor-cost" className="block text-sm font-semibold text-slate-700">
            Modalité
          </label>
          <select
            id="tutor-cost"
            value={costKind}
            onChange={(e) => setCostKind(e.target.value as CostKind)}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            {COST_KINDS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Étiquette d’information ; le soutien scolaire reste sans frais sur la plateforme.
          </p>
        </div>

        {/* Published toggle. */}
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200/60">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-400"
          />
          <span className="text-sm">
            <span className="font-semibold text-slate-800">Publier dans le catalogue</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Une fois publié, l’intervenant est visible des familles concernées.
            </span>
          </span>
        </label>

        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Enregistrement en cours…
          </p>
        )}
      </div>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------------------
// Publish-slot FormDrawer (admin variant — any tutor, no ownership wall)
// ---------------------------------------------------------------------------

function PublishSlotDrawer({
  tutor,
  busy,
  onClose,
  onDone,
  startTransition,
}: {
  tutor: AdminTutorDto;
  busy: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  startTransition: (cb: () => void) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'recurring_weekly' | 'one_off'>('recurring_weekly');
  const [weekday, setWeekday] = useState<number>(1);
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('18:00');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState(1);

  const valid = capacity >= 1 && (kind === 'recurring_weekly' ? !!startTime : !!startsAt);

  function submit() {
    if (!valid) return;
    const input: PublishSlotInput =
      kind === 'recurring_weekly'
        ? { kind, weekday, startTime, endTime: endTime || null, capacity }
        : { kind, startsAt: new Date(startsAt).toISOString(), capacity };
    setError(null);
    startTransition(async () => {
      const res = await publishSlotAction(tutor.id, input);
      if (res.ok) onDone(`Créneau ajouté pour ${tutor.displayName}.`);
      else setError(res.error);
    });
  }

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={`Ajouter un créneau — ${tutor.displayName}`}
      description="Publiez un créneau de soutien que les familles pourront réserver."
      submitLabel="Publier le créneau"
      busy={busy}
      disabledSubmit={!valid}
      onSubmit={submit}
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800">
            {error}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Type de créneau</legend>
          <div className="mt-1.5 flex gap-2">
            {(
              [
                { v: 'recurring_weekly', label: 'Hebdomadaire' },
                { v: 'one_off', label: 'Ponctuel' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                aria-pressed={kind === opt.v}
                onClick={() => setKind(opt.v)}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  kind === opt.v
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {kind === 'recurring_weekly' ? (
          <>
            <div>
              <label htmlFor="admin-slot-weekday" className="block text-sm font-semibold text-slate-700">
                Jour
              </label>
              <select
                id="admin-slot-weekday"
                value={weekday}
                onChange={(e) => setWeekday(Number(e.target.value))}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="admin-slot-start" className="block text-sm font-semibold text-slate-700">
                  Début
                </label>
                <input
                  id="admin-slot-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                />
              </div>
              <div>
                <label htmlFor="admin-slot-end" className="block text-sm font-semibold text-slate-700">
                  Fin
                </label>
                <input
                  id="admin-slot-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                />
              </div>
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="admin-slot-datetime" className="block text-sm font-semibold text-slate-700">
              Date et heure
            </label>
            <input
              id="admin-slot-datetime"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            />
          </div>
        )}

        <div>
          <label htmlFor="admin-slot-capacity" className="block text-sm font-semibold text-slate-700">
            Nombre de places
          </label>
          <input
            id="admin-slot-capacity"
            type="number"
            min={1}
            max={50}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            className="mt-1.5 min-h-11 w-28 rounded-lg border border-slate-200 px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          />
          <p className="mt-1 text-xs text-slate-500">
            Le nombre d’élèves pouvant réserver ce créneau.
          </p>
        </div>

        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Publication en cours…
          </p>
        )}
      </div>
    </FormDrawer>
  );
}
