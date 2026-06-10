import { UserRoundCheck } from 'lucide-react';

import { EmptyState } from '@pilotage/ui';

/**
 * StudentActivationGate — the calm full-page state shown across the whole
 * student portal when the learner's account is not yet linked to a `Student`
 * (`GET /student/me` → `activated: false`). RGPD scenario 7.
 *
 * It is a kind, informational state (not an error) — no `role="alert"`, no CTA
 * that writes. The learner still sees they are in *their* space (rendered inside
 * the shell by the page). The visually-hidden <h1> keeps the page's single
 * top-level heading semantic while the EmptyState carries the visible message.
 */
export function StudentActivationGate() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center">
      <h1 className="sr-only">Ton espace élève n&apos;est pas encore activé</h1>
      <EmptyState
        icon={UserRoundCheck}
        tone="violet"
        title="Ton espace élève n'est pas encore activé"
        description="Rapproche-toi de ton établissement pour le configurer. Une fois ton compte rattaché, tu retrouveras ici tes notes et ta progression."
      />
    </div>
  );
}
