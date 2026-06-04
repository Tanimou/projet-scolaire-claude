'use client';

import {
  AlertTriangle,
  Loader2,
  Send,
  UserRoundX,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';

import { Button, EmptyState, Label, SelectFilter } from '@pilotage/ui';

import {
  loadEligibleTeachersAction,
  sendFirstMessageAction,
  type EligibleTeacher,
} from './compose-actions';

/** A child the parent guards — the picker entry (and single-child static chip). */
export interface ComposeChild {
  id: string;
  name: string;
  classLabel: string | null;
}

interface ComposeFormProps {
  /** The parent's guarded children (named `students`, NOT `children`, to avoid
   *  colliding with React's reserved `children` prop — react/no-children-prop). */
  students: ComposeChild[];
  /** Pre-selected child id when the page is reached per-child (?studentId=). */
  initialStudentId?: string | null;
  /** Alert-seed (E1 CTA): when set, the create is forwarded `alertId` so the
   *  resulting thread is alert-seeded, and the body is pre-filled. */
  alertId?: string | null;
  /** Alert subject — forwarded as thread context alongside `alertId`. */
  subjectId?: string | null;
  /** Alert title — used to pre-fill a kind, editable opening message. */
  alertTitle?: string | null;
}

const MAX_BODY = 2000;

/** Kind, editable opening line for an alert-seeded compose (never auto-sent). */
function alertSeedBody(title: string | null): string {
  if (!title) return '';
  return `Bonjour, je vous écris au sujet de l’alerte « ${title} ». `;
}

/**
 * ComposeForm — the parent compose surface, now living at `/parent/messages/new`
 * (the inbox at `/parent/messages` is the thread list). It doubles as the
 * alert-seeded compose landing: when reached with `alertId`/`subjectId`/
 * `alertTitle` (the E1 `AlertNextSteps` CTA), it pre-fills a kind, editable body,
 * shows the read-only alert-context note, and forwards `alertId`/`subjectId` to
 * the create action so the resulting thread is alert-seeded. On success it
 * navigates the parent into the freshly created/reused thread.
 *
 * Flow: pick a child (skipped + shown as a static chip when the parent guards
 * exactly one) → the eligible-teacher list is lazily fetched from the
 * server-filtered `/messaging/eligible-teachers` endpoint (the picker can never
 * select an ineligible teacher) → type a message → submit POSTs to
 * `/api/v1/conversations` (idempotent create-or-reuse).
 *
 * Interaction grammar mirrors `recommendations/AlertNextSteps`: `useTransition`
 * for the submit, a single `aria-live="polite"` region for progress/success,
 * an emerald success card, and a rose fail-closed error card. Every ABAC
 * rejection (403 lapsed teaching / 404 cross-tenant / 400) surfaces as a kind
 * French message, never a raw status. WCAG 2.2 AA: labelled controls, 44px
 * targets, focus-visible rings, reduced-motion-safe hover.
 */
export function ComposeForm({
  students,
  initialStudentId = null,
  alertId = null,
  subjectId = null,
  alertTitle = null,
}: ComposeFormProps) {
  const router = useRouter();
  const singleChild = students.length === 1 ? students[0] : null;

  const [studentId, setStudentId] = useState<string>(
    singleChild?.id ?? (initialStudentId && students.some((c) => c.id === initialStudentId)
      ? initialStudentId
      : ''),
  );

  const [teachers, setTeachers] = useState<EligibleTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [teacherId, setTeacherId] = useState('');
  const [body, setBody] = useState(alertSeedBody(alertTitle));

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const teacherSelectId = useId();
  const bodyId = useId();
  const counterId = useId();

  // Lazily (re)load the server-filtered eligible-teacher list whenever the
  // selected child changes — one network call, no client-side roster.
  useEffect(() => {
    if (!studentId) {
      setTeachers([]);
      setTeacherId('');
      return;
    }
    let cancelled = false;
    setLoadingTeachers(true);
    setLoadError(null);
    setTeacherId('');
    loadEligibleTeachersAction(studentId).then((res) => {
      if (cancelled) return;
      setLoadingTeachers(false);
      if (res.ok) {
        setTeachers(res.data);
        // Deterministic alert-seed preselect (PM-5): when exactly one teacher is
        // eligible, preselect it so an alert-seeded compose lands on the right
        // person; an ambiguous list leaves the picker for the parent to choose.
        if (res.data.length === 1 && res.data[0]) setTeacherId(res.data[0].userProfileId);
      } else {
        setTeachers([]);
        setLoadError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const selectedTeacher = teachers.find((t) => t.userProfileId === teacherId) ?? null;
  const trimmedLen = body.trim().length;
  const remaining = MAX_BODY - body.length;
  const nearLimit = remaining <= MAX_BODY * 0.1;
  const noEligibleTeacher = !!studentId && !loadingTeachers && !loadError && teachers.length === 0;

  const canSubmit = !!studentId && !!teacherId && trimmedLen > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await sendFirstMessageAction({
        studentId,
        teacherId,
        body,
        ...(subjectId ? { subjectId } : {}),
        ...(alertId ? { alertId } : {}),
      });
      if (res.ok) {
        setAnnounce(`Message envoyé à ${res.data.teacherName}. Ouverture de la conversation…`);
        // Land the parent inside the (alert-seeded) thread they just opened —
        // the inbox + thread are now real surfaces (S2), so we navigate instead
        // of holding a static success card.
        router.push(`/parent/messages/${res.data.id}`);
      } else {
        setError(res.error);
        // Self-heal the picker: a lapsed teaching wall means the teacher list
        // may have changed, so refetch the server-filtered eligibility.
        if (studentId) {
          loadEligibleTeachersAction(studentId).then((r) => {
            if (r.ok) setTeachers(r.data);
          });
        }
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Alert-seeded context — the strict, read-only subset of the alert card so
          the parent sees what the teacher will see (never widens access). */}
      {alertId && alertTitle && (
        <section
          role="note"
          aria-label="Contexte de l'alerte à l'origine de ce message"
          className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-200/70 sm:p-4"
        >
          <div className="flex items-start gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                À propos d’une alerte
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{alertTitle}</p>
              <p className="mt-0.5 text-xs leading-snug text-slate-600">
                Votre message ouvrira une conversation reliée à cette alerte, pour que
                l’enseignant·e en connaisse le contexte.
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-6">
      <div className="flex flex-col gap-5">
        {/* (1) Child — static chip when there's exactly one, selector otherwise. */}
        {singleChild ? (
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Enfant
            </span>
            <p className="mt-1 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200/70">
              {singleChild.name}
              {singleChild.classLabel && (
                <span className="font-normal text-slate-500">· {singleChild.classLabel}</span>
              )}
            </p>
          </div>
        ) : (
          <SelectFilter
            label="Enfant concerné"
            placeholder="Choisir un enfant…"
            value={studentId}
            onChange={setStudentId}
            options={students.map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.classLabel ?? undefined,
            }))}
          />
        )}

        {/* (2) Teacher picker — server-filtered eligible list. */}
        {studentId && (
          <div>
            <Label htmlFor={teacherSelectId} className="mb-1 block">
              Enseignant·e
            </Label>
            {loadingTeachers ? (
              <p className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Chargement des enseignant·e·s…
              </p>
            ) : noEligibleTeacher ? (
              <EmptyState
                icon={UserRoundX}
                tone="slate"
                title="Aucun enseignant à contacter pour le moment"
                description="La messagerie s'ouvre avec les enseignant·e·s qui suivent actuellement votre enfant. Revenez après la prochaine mise à jour de l'emploi du temps."
              />
            ) : (
              <SelectFilter
                placeholder="Choisir un·e enseignant·e…"
                value={teacherId}
                onChange={setTeacherId}
                options={teachers.map((t) => ({
                  value: t.userProfileId,
                  label: t.displayName,
                  hint:
                    t.subjects.map((s) => s.name).join(', ') ||
                    (t.isMainTeacher ? 'Professeur·e principal·e' : undefined),
                }))}
              />
            )}
            {/* Hidden control id anchor for the Label (SelectFilter is a custom
                listbox button); keeps the label programmatically associated. */}
            <span id={teacherSelectId} className="sr-only">
              Sélection de l&apos;enseignant·e à contacter
            </span>
          </div>
        )}

        {/* (3) Message — only once a teacher can actually be picked. */}
        {studentId && !loadingTeachers && !noEligibleTeacher && (
          <div>
            <Label htmlFor={bodyId} className="mb-1 block">
              Votre message
            </Label>
            <textarea
              id={bodyId}
              rows={5}
              value={body}
              maxLength={MAX_BODY}
              onChange={(e) => setBody(e.target.value)}
              aria-describedby={counterId}
              placeholder="Bonjour, je vous écris au sujet de…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30"
            />
            <p
              id={counterId}
              className={`mt-1 text-right text-xs ${nearLimit ? 'font-semibold text-amber-700' : 'text-slate-400'}`}
            >
              {body.length}/{MAX_BODY}
            </p>
          </div>
        )}

        {/* Submit + status. */}
        {studentId && !loadingTeachers && !noEligibleTeacher && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!canSubmit}
                aria-busy={pending}
                onClick={submit}
                className="min-h-11"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                {pending ? 'Envoi en cours…' : 'Envoyer'}
              </Button>
            </div>

            {selectedTeacher?.existingConversationId && (
              <p className="text-xs text-slate-500">
                Vous avez déjà une conversation avec cet·te enseignant·e — votre message
                la prolongera.
              </p>
            )}
          </div>
        )}

        <p aria-live="polite" className="sr-only">
          {pending ? 'Envoi du message en cours…' : announce}
        </p>

        {(error || loadError) && (
          <p
            aria-live="polite"
            className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800"
          >
            {error ?? loadError}
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
