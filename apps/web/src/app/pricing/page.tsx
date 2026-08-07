import { Building2, Sparkles, Tag, Users } from 'lucide-react';
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
 * `/pricing` — a dead link in the landing footer until now (PF-94, S-E06-5 / AC-3).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE CARRIES NO PRICE
 * ---------------------------------------------------------------------------
 * Decision **D-05** (commercial packaging) is open, so there is no reviewed price,
 * tier or billing period to publish. Inventing one would be the same class of
 * overreach as authoring policy text (R-13): a sentence the product cannot honour,
 * shipped by an automated routine. So the page states what is *true today* and
 * routes the question to the one channel that exists.
 *
 * Every sentence below is checkable:
 *  - "Aucun paiement n'est demandé ni traité dans l'application" — there is no
 *    payment integration anywhere in the repository (no Stripe/Paddle/subscription/
 *    invoice/billing code path; the only `stripe` matches in the tree are a CSS
 *    accent-bar variable), and no `finance` module: `docs/adr/018` records it as
 *    deferred to Phase 9;
 *  - "Un compte famille se crée directement en ligne" — `/parent/register` is an
 *    emitted, self-service route, whereas `AUTH_ROUTES_BY_PORTAL.student` in
 *    `middleware.ts` deliberately has no register entry;
 *  - "ne sont pas publiées sur cette page" is a statement about *this page*, in the
 *    present tense — not a schedule. DNC-09 forbids the alternative ("bientôt",
 *    "en cours de finalisation"), and rightly: holding copy reads as an unbuilt
 *    product and quietly ages into a broken promise.
 *
 * Forbidden here, and absent on purpose: any amount, currency token, billing
 * period, tier name or comparison grid (D-05); any postal address, phone number,
 * opening hours or response-time promise; any contact form (no endpoint accepts
 * one — DNC-06); any RGPD/data-controller statement or `/legal/*` link (D-08).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tarifs',
  description:
    "Ce que Pilotage scolaire dit aujourd'hui de ses conditions d'accès : un compte famille se crée en ligne, et aucun paiement n'est traité dans l'application.",
};

export default function PricingPage() {
  return (
    <PublicInfoPage
      accent="blue"
      eyebrow="Conditions d'accès"
      eyebrowIcon={Tag}
      title="Tarifs"
      lede="Aucun paiement n'est demandé ni traité dans l'application. Voici comment on y accède aujourd'hui, côté famille comme côté établissement."
    >
      <PublicSection
        title="Accéder à Pilotage scolaire"
        intro="Deux portes d'entrée, deux façons d'ouvrir un accès."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:gap-6">
          <PublicCard accent="blue" icon={Users} title="Compte famille">
            <p>
              Un compte famille se crée directement en ligne. Le rattachement à un enfant est ensuite
              validé par l&apos;établissement, qui reste seul à décider qui voit le dossier scolaire
              d&apos;un élève.
            </p>
            <div className="pt-2">
              <PublicCta accent="blue" href="/parent/register" label="Créer un compte famille" />
            </div>
          </PublicCard>

          <PublicCard accent="blue" icon={Building2} title="Accès établissement">
            <p>
              Les conditions de l&apos;accès établissement ne sont pas publiées sur cette page.
              Écrivez à <SupportEmailLink accent="blue" /> pour en discuter.
            </p>
            <p>Si votre établissement est déjà équipé, connectez-vous à votre espace administrateur.</p>
            <div className="pt-2">
              <PublicLink accent="blue" href="/admin/login" label="Espace administrateur" />
            </div>
          </PublicCard>
        </div>
      </PublicSection>

      <PublicSection title="Ce que fait la plateforme">
        <div className="grid gap-5">
          <PublicCard accent="blue" icon={Sparkles} title="Le détail des fonctionnalités">
            <p>
              Notes, tendances par matière, alertes explicables et recommandations d&apos;action sont
              présentées sur la page d&apos;accueil, avec le fonctionnement de chaque portail.
            </p>
            <div className="pt-2">
              <PublicLink accent="blue" href="/" label="Voir les fonctionnalités" />
            </div>
          </PublicCard>
        </div>
      </PublicSection>

      <SupportContactBlock accent="blue" />
    </PublicInfoPage>
  );
}
