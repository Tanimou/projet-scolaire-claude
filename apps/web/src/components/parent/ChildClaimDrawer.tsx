'use client';

import { AlertCircle, ArrowRight, MailCheck, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useId, useMemo, useState, useTransition } from 'react';

import { submitChildClaimAction } from '@/app/parent/children/claim-actions';
import {
  CHILD_CLAIM_RELATIONSHIP,
  type ChildClaimRelationship,
} from '@/app/parent/children/claim-types';
import { FormDrawer, Input, Label } from '@pilotage/ui';

/** FR labels for the relationship select (mirrors the contract enum order). */
const RELATIONSHIP_LABEL: Record<ChildClaimRelationship, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Représentant·e légal·e',
  grandparent: 'Grand-parent',
  sibling: 'Frère / sœur',
  other: 'Autre',
};

/**
 * The IDENTICAL calm acknowledgement copy shown for BOTH a confident match AND a
 * no-match (FR-3/AC-2 no-leak wall). The parent must NOT be able to tell a match
 * from a non-match — same copy, icon, tone, layout. Never `role=alert`/danger.
 */
const SUBMITTED_COPY =
  'Demande envoyée — l’établissement va la vérifier et vous serez notifié·e dès qu’elle sera validée.';
const ALREADY_LINKED_COPY = 'Vous êtes déjà rattaché·e à cet enfant.';
const RATE_LIMIT_COPY = 'Trop de tentatives — réessayez dans quelques minutes.';

type Result =
  | { kind: 'submitted' }
  | { kind: 'already_linked'; studentId: string }
  | { kind: 'error'; message: string };

interface FormState {
  firstName: string;
  lastName: string;
  birthDate: string;
  externalRef: string;
  relationship: ChildClaimRelationship | '';
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  birthDate: '',
  externalRef: '',
  relationship: '',
};

export interface ChildClaimDrawerProps {
  /** When false, the form renders a graceful disabled state (backend not migrated). */
  available?: boolean;
  /** Optional pre-fill (e.g. "Renvoyer une demande" from a rejected row). */
  initial?: Partial<FormState>;
  /** Render-prop trigger receives an `open` callback. Defaults to a header button. */
  triggerLabel?: string;
}

/**
 * "Rattacher mon enfant" claim drawer (E9-S1).
 *
 * Reuses the `@pilotage/ui` FormDrawer (hardened focus-trap + restore-to-trigger).
 * On submit it posts via the `submitChildClaimAction` server action and renders a
 * NO-LEAK acknowledgement: matched and no-match are byte-identical. It echoes ONLY
 * the parent's own typed input — never a roster-resolved child name.
 */
export function ChildClaimDrawer({
  available = true,
  initial,
  triggerLabel = 'Rattacher mon enfant',
}: ChildClaimDrawerProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial });
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const baseId = useId();

  // Client validation mirrors the matcher's "name needs a corroborating factor"
  // rule — guides without blocking (the server is the authority).
  const nameValid = form.firstName.trim().length > 0 && form.lastName.trim().length > 0;
  const relationshipValid = form.relationship !== '';
  const hasCorroborating = form.birthDate.trim() !== '' || form.externalRef.trim() !== '';
  const canSubmit = nameValid && relationshipValid && !pending;

  const corroboratingHint = useMemo(
    () =>
      !hasCorroborating
        ? 'Ajoutez une date de naissance ou une référence pour nous aider à retrouver votre enfant.'
        : null,
    [hasCorroborating],
  );

  function openDrawer() {
    setForm({ ...EMPTY_FORM, ...initial });
    setResult(null);
    setOpen(true);
  }

  function closeDrawer() {
    setOpen(false);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!canSubmit || form.relationship === '') return;
    setResult(null);
    startTransition(async () => {
      const res = await submitChildClaimAction({
        firstName: form.firstName,
        lastName: form.lastName,
        birthDate: form.birthDate || undefined,
        externalRef: form.externalRef || undefined,
        relationship: form.relationship as ChildClaimRelationship,
      });

      if ('unavailable' in res) {
        setResult({ kind: 'error', message: res.error });
        return;
      }
      if (!res.ok) {
        // 429 surfaces calm copy that does NOT hint at anti-enumeration intent.
        const isRate = /429|trop de tentatives|too many/i.test(res.error);
        setResult({ kind: 'error', message: isRate ? RATE_LIMIT_COPY : res.error });
        return;
      }
      if (res.data.outcome === 'already_linked') {
        setResult({ kind: 'already_linked', studentId: res.data.studentId });
        return;
      }
      // outcome === 'received' — byte-identical for matched / no-match / ambiguous.
      setResult({ kind: 'submitted' });
    });
  }

  const statusId = `${baseId}-status`;

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {triggerLabel}
      </button>

      <FormDrawer
        open={open}
        onClose={closeDrawer}
        title="Rattacher mon enfant"
        description="Indiquez les informations de votre enfant. L’établissement validera la demande avant de vous donner accès au dossier."
        submitLabel="Envoyer la demande"
        cancelLabel={result ? 'Fermer' : 'Annuler'}
        onSubmit={result ? undefined : submit}
        busy={pending}
        disabledSubmit={!canSubmit || !available || result !== null}
        size="md"
      >
        {/* Single polite live region announces every result (never role=alert). */}
        <div id={statusId} role="status" aria-live="polite" className="space-y-5">
          {!available ? (
            <UnavailablePanel />
          ) : result ? (
            <ResultPanel result={result} form={form} onReset={openDrawer} />
          ) : (
            <ClaimForm
              form={form}
              set={set}
              pending={pending}
              baseId={baseId}
              nameValid={nameValid}
              corroboratingHint={corroboratingHint}
            />
          )}
        </div>
      </FormDrawer>
    </>
  );
}

/* ────────────────────────── sub-components ────────────────────────── */

function ClaimForm({
  form,
  set,
  pending,
  baseId,
  nameValid,
  corroboratingHint,
}: {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  pending: boolean;
  baseId: string;
  nameValid: boolean;
  corroboratingHint: string | null;
}) {
  const firstId = `${baseId}-first`;
  const lastId = `${baseId}-last`;
  const dobId = `${baseId}-dob`;
  const refId = `${baseId}-ref`;
  const relId = `${baseId}-rel`;
  const corrId = `${baseId}-corr`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={firstId}>
          Prénom <span className="text-rose-600">*</span>
        </Label>
        <Input
          id={firstId}
          value={form.firstName}
          onChange={(e) => set('firstName', e.target.value)}
          disabled={pending}
          aria-required
          autoComplete="off"
          maxLength={120}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={lastId}>
          Nom <span className="text-rose-600">*</span>
        </Label>
        <Input
          id={lastId}
          value={form.lastName}
          onChange={(e) => set('lastName', e.target.value)}
          disabled={pending}
          aria-required
          autoComplete="off"
          maxLength={120}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={dobId}>Date de naissance</Label>
        <Input
          id={dobId}
          type="date"
          value={form.birthDate}
          onChange={(e) => set('birthDate', e.target.value)}
          disabled={pending}
          aria-describedby={corroboratingHint ? corrId : `${dobId}-hint`}
        />
        <p id={`${dobId}-hint`} className="text-xs text-slate-500">
          Recommandé pour retrouver votre enfant.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor={refId}>Référence élève</Label>
        <Input
          id={refId}
          value={form.externalRef}
          onChange={(e) => set('externalRef', e.target.value)}
          disabled={pending}
          autoComplete="off"
          maxLength={120}
          aria-describedby={corroboratingHint ? corrId : `${refId}-hint`}
        />
        <p id={`${refId}-hint`} className="text-xs text-slate-500">
          Figure sur les documents de l’établissement (facultatif).
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor={relId}>
          Lien de parenté <span className="text-rose-600">*</span>
        </Label>
        <select
          id={relId}
          value={form.relationship}
          onChange={(e) => set('relationship', e.target.value as FormState['relationship'])}
          disabled={pending}
          aria-required
          className="flex h-10 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="" disabled>
            Sélectionnez…
          </option>
          {CHILD_CLAIM_RELATIONSHIP.map((rel) => (
            <option key={rel} value={rel}>
              {RELATIONSHIP_LABEL[rel]}
            </option>
          ))}
        </select>
      </div>

      {/* Soft, non-blocking corroborating-factor hint (mirrors the matcher rule). */}
      {nameValid && corroboratingHint && (
        <p id={corrId} className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {corroboratingHint}
        </p>
      )}

      {/* Reassurance line — info tone, never alarming. */}
      <p className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-blue-800 ring-1 ring-blue-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        L’établissement validera votre demande avant de vous donner accès au dossier.
      </p>
    </div>
  );
}

/**
 * The result acknowledgement. Both `submitted` (matched OR no-match) render the
 * IDENTICAL neutral/success panel — never a danger/`role=alert` styling, never
 * an echo of any roster-resolved child name. We echo back ONLY the parent's own
 * typed input.
 */
function ResultPanel({
  result,
  form,
  onReset,
}: {
  result: Result;
  form: FormState;
  onReset: () => void;
}) {
  if (result.kind === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-2">
          <p>{result.message}</p>
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-bold text-amber-900 underline underline-offset-2 hover:text-amber-700"
          >
            Recommencer
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === 'already_linked') {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <MailCheck className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-bold text-slate-900">{ALREADY_LINKED_COPY}</h3>
        </div>
        <Link
          href={`/parent/children/${result.studentId}`}
          className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:underline"
        >
          Voir le dossier
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  // kind === 'submitted' — byte-identical for matched / no-match / ambiguous.
  return (
    <div className="space-y-4 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <MailCheck className="h-6 w-6" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h3 className="text-base font-bold text-slate-900">Demande envoyée</h3>
        <p className="mx-auto max-w-sm text-sm text-slate-600">{SUBMITTED_COPY}</p>
      </div>
      {/* Echo ONLY the parent's own typed input — never roster-resolved data. */}
      <dl className="mx-auto max-w-xs space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-left text-xs ring-1 ring-slate-200">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Enfant</dt>
          <dd className="font-semibold text-slate-800">
            {form.firstName} {form.lastName}
          </dd>
        </div>
        {form.birthDate && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Date de naissance</dt>
            <dd className="font-semibold text-slate-800">{form.birthDate}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Lien</dt>
          <dd className="font-semibold text-slate-800">
            {form.relationship ? RELATIONSHIP_LABEL[form.relationship] : '—'}
          </dd>
        </div>
      </dl>
      <Link
        href="/parent/children#mes-demandes"
        className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:underline"
      >
        Voir mes demandes
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function UnavailablePanel() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <p>Le rattachement en ligne n’est pas encore disponible — contactez l’établissement.</p>
    </div>
  );
}
