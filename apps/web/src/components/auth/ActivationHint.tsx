import { Clock, MailCheck } from 'lucide-react';

import { SUPPORT_EMAIL } from '@/lib/support-contact';

/**
 * ActivationHint — the single "what happens next" line for account activation
 * (S-E06-1 / PF-17, PF-54).
 *
 * Replaces four independent copies of a development note that pointed real users at
 * a local mail catcher. Every sentence below is verifiable against
 * `apps/api/src/modules/identity/invite.controller.ts`:
 *   - the invited user is created with a random temporary password and the required
 *     action `UPDATE_PASSWORD` (§2/§3) — so "the person sets their own password" is true;
 *   - `CONFIGURE_TOTP` is added for `school_admin` and `teacher` only (§2) — hence `mfa`;
 *   - a failed send raises a `BadRequestException` surfaced in the form's error block (§4)
 *     — so "if the send fails, the error appears here" is true.
 *
 * Deliberately NOT claimed: a link validity window (Keycloak owns the action-token
 * lifespan, this codebase never sets it) and a resend action (no resend endpoint
 * exists). A shorter true sentence beats a config-shaped guess.
 *
 * No `'use client'`: this is pure presentation. It renders as a server component on
 * the register pages and is pulled into the client bundle by `InviteForm`.
 */

type HintPortal = 'admin' | 'teacher';

const ACCENT: Record<HintPortal, string> = {
  admin: 'text-blue-700 focus-visible:ring-blue-500/40',
  teacher: 'text-teal-700 focus-visible:ring-teal-500/40',
};

function SupportLink({ portal }: { portal: HintPortal }) {
  return (
    <a
      href={`mailto:${SUPPORT_EMAIL}`}
      className={`inline-block rounded-sm break-words py-1 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${ACCENT[portal]}`}
    >
      {SUPPORT_EMAIL}
    </a>
  );
}

export function ActivationHint({
  portal,
  variant,
  mfa = false,
}: {
  portal: HintPortal;
  /**
   * `awaiting` — the invitee is waiting for the email (register pages).
   * `sent`     — the admin has just sent an invitation (success card).
   * `pre-send` — the admin has not submitted yet (helper under the CTA).
   */
  variant: 'awaiting' | 'sent' | 'pre-send';
  /** True when the invited role must also configure TOTP (school_admin / teacher). */
  mfa?: boolean;
}) {
  if (variant === 'awaiting') {
    return (
      <div className="mt-3 flex w-full items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
        <MailCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          L&apos;email d&apos;invitation arrive en quelques minutes. Pensez à vérifier vos courriers
          indésirables.{' '}
          {portal === 'teacher'
            ? "S'il n'arrive pas, contactez l'administration de votre établissement, ou écrivez à "
            : "S'il n'arrive pas, écrivez au support à "}
          <SupportLink portal={portal} />.
        </p>
      </div>
    );
  }

  if (variant === 'sent') {
    return (
      <p className="mt-3 flex items-start gap-2 text-left text-xs leading-relaxed text-emerald-800">
        <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <span>
          Le lien sécurisé lui permet de définir son mot de passe
          {mfa ? ', puis de configurer la double authentification (TOTP)' : ''}. S&apos;il n&apos;arrive
          pas, demandez-lui de vérifier ses courriers indésirables.
        </span>
      </p>
    );
  }

  return (
    <p className="text-center text-xs leading-relaxed text-slate-500">
      Aucun mot de passe n&apos;est transmis : la personne définit le sien via le lien sécurisé de
      l&apos;email
      {mfa ? ', puis configure la double authentification' : ''}. Si l&apos;envoi échoue,
      l&apos;erreur s&apos;affiche ici.
    </p>
  );
}
