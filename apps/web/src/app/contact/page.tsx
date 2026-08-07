import { Building2, LifeBuoy, Mail, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';

import {
  PublicCard,
  PublicCta,
  PublicInfoPage,
  PublicLink,
  PublicSection,
  SupportContactBlock,
  SupportEmailLink,
} from '@/components/public/PublicInfoPage';

/**
 * `/contact` — a dead link in the landing footer until now (PF-94, S-E06-5 / AC-3).
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO FORM ON THIS PAGE
 * ---------------------------------------------------------------------------
 * No endpoint in `apps/api` accepts a public contact submission. A form with a
 * submit button that posts nowhere is precisely DNC-06 — promising behaviour the
 * runtime lacks — shipped as the fix for DNC-06. So the page routes each audience
 * to a channel that already works: the configured support address, or the portal
 * where the conversation actually belongs.
 *
 * The only contact channel is `SUPPORT_EMAIL` from `@/lib/support-contact`, the
 * single source S-E06-1 introduced. Not on this page, because nothing backs them:
 * a phone number, a postal address, opening hours, a response-time or SLA promise,
 * a live-chat widget, a ticket queue.
 *
 * The parent card's "écrire au professeur" claim is checkable against E2: a parent
 * may open a thread with a teacher currently teaching their child (the dual-wall
 * guardianship ∩ teaching-assignment check, re-verified at create and at every
 * send), surfaced at `/parent/messages`. An unauthenticated click on that link is
 * caught by `middleware.ts` and lands on `/parent/login?callbackUrl=/parent/messages`,
 * so the affordance is honest for a signed-out reader too.
 *
 * Nothing is claimed about `/admin/register`: whether professional self-registration
 * is invite-gated is not decidable from this page's own evidence, so the card links
 * to the login surface only — the precedent the landing page already sets.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    "À qui écrire selon votre situation : votre établissement pour la scolarité, le professeur depuis votre espace famille, l'adresse de support pour un problème technique.",
};

export default function ContactPage() {
  return (
    <PublicInfoPage
      accent="sky"
      eyebrow="Nous écrire"
      eyebrowIcon={Mail}
      title="Contact"
      lede="Une seule adresse de support, et deux situations où quelqu'un de plus proche répondra mieux. Voici comment choisir."
    >
      <PublicSection
        title="Selon votre situation"
        intro="La bonne interlocutrice ou le bon interlocuteur dépend de ce que vous voulez obtenir."
      >
        <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
          <PublicCard accent="sky" icon={MessageSquare} title="Vous êtes parent">
            <p>
              Pour une question de scolarité — une note, une absence, une inscription — adressez-vous
              à l&apos;établissement : lui seul peut corriger ces données.
            </p>
            <p>
              Depuis votre espace famille, vous pouvez écrire directement au professeur qui suit votre
              enfant.
            </p>
            <div className="pt-2">
              <PublicCta accent="sky" href="/parent/messages" label="Écrire au professeur" />
            </div>
            <p className="pt-1">
              <PublicLink accent="sky" href="/parent/login" label="Se connecter à l'espace famille" />
            </p>
          </PublicCard>

          <PublicCard accent="sky" icon={Building2} title="Vous êtes un établissement">
            <p>
              Écrivez à <SupportEmailLink accent="sky" /> pour ouvrir un accès professionnel à votre
              école.
            </p>
            <p>Si votre établissement est déjà équipé, connectez-vous à votre espace administrateur.</p>
            <div className="pt-2">
              <PublicLink accent="sky" href="/admin/login" label="Espace administrateur" />
            </div>
          </PublicCard>

          <PublicCard accent="sky" icon={LifeBuoy} title="Problème technique">
            <p>
              Une page qui ne s&apos;affiche pas, une connexion qui échoue, un email d&apos;invitation
              qui n&apos;arrive pas : écrivez à <SupportEmailLink accent="sky" />.
            </p>
            <p>Le centre d&apos;aide indique aussi où trouver chaque écran, portail par portail.</p>
            <div className="pt-2">
              <PublicLink accent="sky" href="/help" label="Ouvrir le centre d'aide" />
            </div>
          </PublicCard>
        </div>
      </PublicSection>

      <SupportContactBlock accent="sky" />
    </PublicInfoPage>
  );
}
