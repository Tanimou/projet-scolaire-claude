import { EmptyState, PageHeader } from '@pilotage/ui';
import { ArrowLeft, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ComposeForm, type ComposeChild } from '../ComposeForm';

import { PortalShell } from '@/components/PortalShell';
import { ChildrenReadError } from '@/components/parent/ChildrenReadError';
import {
  resolveEnrollmentActivity,
  type CarriesEnrollmentActivity,
} from '@/lib/enrollment-activity';
import { readParentChildren } from '@/lib/parent-children';


export const metadata: Metadata = { title: 'Nouveau message' };
export const dynamic = 'force-dynamic';

/**
 * S-E03-3 / `PF-12` — `enrollments` retiré du type, et `classLabel()` avec.
 *
 * La dérivation locale `c.enrollments.find(e => e.academicYear.status === 'active')`
 * lisait un champ (`academicYear.status`) que `GET /students` ne projette pas :
 * `classLabel()` rendait donc `null` pour **tout** enfant, et le sélecteur du
 * compose n'a jamais affiché la moindre classe. Le verdict canonique arrive
 * maintenant dans `enrollmentActivity` (`ADR-072`, `AC-2`) et le libellé de
 * classe est celui, unique, de `@/lib/enrollment-activity`.
 */
interface Child extends CarriesEnrollmentActivity {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Parent compose — the relocated E2-S1 compose surface, now living at
 * `/parent/messages/new` (the inbox at `/parent/messages` is the list). It
 * doubles as the alert-seeded compose landing: the E1 `AlertNextSteps`
 * "Discuter avec l'enseignant·e" CTA deep-links here with
 * `?alertId=&studentId=(&subjectId&alertTitle)`, and the `ComposeForm` pre-fills
 * the child + a kind body and forwards `alertId`/`subjectId` to the create
 * action so the resulting thread is alert-seeded (the visionary E1→E2 loop).
 *
 * Server-fetches the parent's guarded children (the scoped `/students`
 * aggregate, no client N+1); the dual-wall ABAC + alert re-check (guardianship ∩
 * teaching, alert.studentId === studentId) are enforced entirely by the backend.
 */
export default async function ParentNewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    alertId?: string;
    subjectId?: string;
    alertTitle?: string;
  }>;
}) {
  const sp = await searchParams;

  // S-E03-3d / `PF-363` — sur un échec de lecture, cette page n'affiche NI
  // « Aucun enfant rattaché » (une affirmation sur la famille produite par
  // notre propre panne) NI le formulaire : un sélecteur de destinataire vide
  // invite le parent à rédiger puis à échouer à l'envoi.
  const childrenRead = await readParentChildren<Child>('parent-message-new/children');
  const childrenFailure = childrenRead.ok ? null : childrenRead;
  const children: ComposeChild[] = (childrenRead.ok ? childrenRead.data.data : []).map((c) => {
    const enrolment = resolveEnrollmentActivity(c);
    // Hors `active`, le sélecteur ne montre PAS une classe périmée : il montre
    // la portée (« Hors année en cours … »), ce qui reste une information utile
    // au moment de choisir à qui écrire, sans affirmer une scolarité en cours.
    const label =
      enrolment.state === 'active'
        ? [enrolment.classLabel, enrolment.gradeLevelName].filter(Boolean).join(' · ')
        : enrolment.scopeLabel;
    return {
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      classLabel: label || null,
    };
  });

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Messages', href: '/parent/messages' },
          { label: 'Nouveau message' },
        ]}
        title="Nouveau message"
        subtitle="Contactez un·e enseignant·e qui suit votre enfant"
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <Link
          href="/parent/messages"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour aux messages
        </Link>

        {childrenFailure ? (
          <ChildrenReadError
            failure={childrenFailure}
            domain="Vous pourrez écrire à l'enseignant·e dès que la liste sera de nouveau lisible."
            // Voir `/parent/messages` : l'action par défaut pointerait sur
            // cette page même. On renvoie vers les rattachements.
            secondaryAction={{ label: 'Voir mes rattachements', href: '/parent/children' }}
          />
        ) : children.length === 0 ? (
          <EmptyState
            icon={UserRoundX}
            tone="slate"
            title="Aucun enfant rattaché"
            description="La messagerie s'ouvre une fois un enfant rattaché à votre compte. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant."
          />
        ) : (
          <ComposeForm
            students={children}
            initialStudentId={sp.studentId ?? null}
            alertId={sp.alertId ?? null}
            subjectId={sp.subjectId ?? null}
            alertTitle={sp.alertTitle ?? null}
          />
        )}
      </div>
    </PortalShell>
  );
}
