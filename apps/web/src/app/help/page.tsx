import {
  Bell,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  Compass,
  FileSpreadsheet,
  GraduationCap,
  HeartHandshake,
  History,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Lock,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  PenTool,
  Settings as SettingsIcon,
  Target,
  Upload,
  User,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { ComponentType } from 'react';

import { auth } from '@/auth';
import {
  PublicBackCta,
  PublicCard,
  PublicInfoPage,
  PublicLink,
  PublicRow,
  PublicSection,
  SupportContactBlock,
} from '@/components/public/PublicInfoPage';
import { isPortalId, PORTAL_LANDING, type PortalId } from '@/lib/portals';

/**
 * `/help` — the Centre d'aide (PF-39, S-E06-5 / AC-3).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * It is a routing map of what the application actually does, plus the one contact
 * channel that exists in configuration. It is NOT a knowledge base: there are no
 * articles, no tickets, no chat and no phone line, so the page never implies any of
 * them (DNC-06). It also carries no holding copy (DNC-09) — a help page that says
 * "bientôt disponible" is worse than one that lists only what works.
 *
 * `/help` was dead on TWO affordances before this slice, not one: the topbar user
 * menu of all four portals (`TopbarUserMenu.tsx`) and — invisibly to the link gate,
 * whose source set is `apps/web/src` only — `HelpSidebarCard`'s `ctaHref` default in
 * `packages/ui`, rendered on every parent and student page.
 *
 * Every route listed below was checked against the emitted route inventory
 * (`scripts/web-route-baseline.json`). Two neighbours are deliberately ABSENT
 * because they are not emitted and a help page must not send anyone to a 404:
 *   • `/parent/remediation` (index) — PF-92, owner V3-E07; only the per-plan
 *     `/parent/remediation/[planId]` route exists
 *   • `/student/settings`, `/student/notifications` — PF-57, owner L2
 *
 * A third used to be listed here — the admin « Rapports » route (PF-14). `S-E04-2`
 * retired it: no surface links that target any more, because the sidebar entry now
 * points at the real `/admin/analytics`, so there is nothing left for this page to
 * avoid. The admin rows below stay a curated subset of the sidebar, not a mirror.
 *
 * The labels are the sidebar's own (`components/shell/sidebar-items.ts`), so each
 * row names the screen exactly as the application names it.
 *
 * ⚠️ To whoever writes a DNC-09 guard over this file: the parent row label is
 * « Évaluations à venir » and the student row label is « À venir », because those
 * are the product's real names for `/parent/upcoming` and `/student/upcoming`. A
 * bare `à venir` grep would go red on correct copy. DNC-09 bans sentences about the
 * *product's own* availability or schedule ("bientôt disponible", "coming soon",
 * "en cours de finalisation"), not the school calendar. This is PF-83 one layer up.
 *
 * G-PORTAL: when the session resolves to a portal, ONLY that portal's section is
 * rendered — a student is never shown a capability the student portal lacks. Signed
 * out, the four audiences are listed with their login surfaces.
 *
 * G-AUTHZ: the "Retour à mon espace" target is `PORTAL_LANDING[portal]` where
 * `portal` is the session's own claim, validated by `isPortalId`. It is never
 * derived from a query parameter, a header or a referrer, so this page cannot be
 * turned into an open redirect.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Centre d'aide",
  description:
    "Où trouver chaque écran de Pilotage scolaire, portail par portail, et à qui écrire selon votre question.",
};

interface HelpRow {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

interface HelpPortalSection {
  heading: string;
  blurb: string;
  icon: LucideIcon;
  rows: readonly HelpRow[];
}

const PORTAL_HELP: Record<PortalId, HelpPortalSection> = {
  parent: {
    heading: 'Espace famille',
    blurb: 'Suivre la scolarité de votre enfant et savoir quoi faire ensuite.',
    icon: Users,
    rows: [
      {
        href: '/parent/dashboard',
        label: 'Tableau de bord',
        description: "Où en est votre enfant, matière par matière, et les alertes ouvertes.",
        icon: LayoutDashboard,
      },
      {
        href: '/parent/recommendations',
        label: 'Recommandations',
        description: "Chaque alerte expliquée — règle, matière, seuil, tendance — et l'action suggérée.",
        icon: Lightbulb,
      },
      {
        href: '/parent/messages',
        label: 'Messages',
        description: 'Écrire au professeur qui suit votre enfant, et relire le fil.',
        icon: MessageSquare,
      },
      {
        href: '/parent/grades',
        label: 'Notes et évaluations',
        description: 'Les notes publiées par les professeurs, par matière et par période.',
        icon: PenTool,
      },
      {
        href: '/parent/subjects',
        label: 'Suivi des matières',
        description: 'La tendance de chaque matière sur la période.',
        icon: Compass,
      },
      {
        href: '/parent/upcoming',
        label: 'Évaluations à venir',
        description: 'Les évaluations déjà programmées par les professeurs.',
        icon: CalendarClock,
      },
      {
        href: '/parent/attendance',
        label: 'Absences et retards',
        description: "Les absences et retards enregistrés par l'établissement.",
        icon: UserX,
      },
      {
        href: '/parent/children',
        label: "Profil de l'élève",
        description: 'Le dossier de chaque enfant rattaché à votre compte.',
        icon: User,
      },
      {
        href: '/parent/settings',
        label: 'Paramètres',
        description: "Vos préférences de notification, d'affichage et de sécurité.",
        icon: SettingsIcon,
      },
    ],
  },
  teacher: {
    heading: 'Espace professeur',
    blurb: 'Saisir, publier et suivre — sans ressaisir ce que la plateforme sait déjà.',
    icon: GraduationCap,
    rows: [
      {
        href: '/teacher/dashboard',
        label: 'Tableau de bord',
        description: 'Vos classes, vos évaluations et les demandes en attente.',
        icon: LayoutDashboard,
      },
      {
        href: '/teacher/classes',
        label: 'Mes classes',
        description: 'Vos classes, leurs élèves, le cahier de texte et les présences.',
        icon: Users,
      },
      {
        href: '/teacher/assessments',
        label: 'Évaluations',
        description: 'Créer une évaluation, fixer sa date et son coefficient.',
        icon: ClipboardCheck,
      },
      {
        href: '/teacher/grades',
        label: 'Notes',
        description: "Saisir les notes d'une évaluation, puis les publier aux familles.",
        icon: PenTool,
      },
      {
        href: '/teacher/conversations',
        label: 'Conversations parents',
        description: 'Les fils ouverts par les familles des élèves que vous suivez.',
        icon: MessagesSquare,
      },
      {
        href: '/teacher/remediation',
        label: 'Soutien scolaire',
        description: 'Publier vos créneaux de soutien et gérer les réservations.',
        icon: HeartHandshake,
      },
      {
        href: '/teacher/reports',
        label: 'Rapports',
        description: 'Les moyennes et tendances de vos classes.',
        icon: FileSpreadsheet,
      },
      {
        href: '/teacher/settings',
        label: 'Paramètres',
        description: "Vos préférences de notification et d'affichage.",
        icon: SettingsIcon,
      },
    ],
  },
  admin: {
    heading: 'Espace administrateur',
    blurb: "Structurer l'établissement, ouvrir les accès, garder la trace.",
    icon: Lock,
    rows: [
      {
        href: '/admin/dashboard',
        label: 'Tableau de bord',
        description: "L'activité de l'établissement en une vue.",
        icon: LayoutDashboard,
      },
      {
        href: '/admin/students',
        label: 'Élèves',
        description: 'Le répertoire des élèves et leur dossier.',
        icon: User,
      },
      {
        href: '/admin/imports/new',
        label: 'Nouvel import',
        description: 'Charger un fichier, le valider, prévisualiser, puis appliquer.',
        icon: Upload,
      },
      {
        href: '/admin/users/invite',
        label: 'Inviter un utilisateur',
        description: 'La personne invitée définit elle-même son mot de passe via un lien sécurisé.',
        icon: UserPlus,
      },
      {
        href: '/admin/alerts',
        label: 'Alertes',
        description: "Activer chaque règle d'alerte, régler ses seuils et sa gravité.",
        icon: Bell,
      },
      {
        href: '/admin/exports',
        label: 'Exports',
        description: 'Demander un export et récupérer le fichier produit.',
        icon: FileSpreadsheet,
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Le journal des actions, en ajout seul.',
        icon: History,
      },
      {
        href: '/admin/settings',
        label: 'Paramètres',
        description: "La configuration de l'établissement et de la plateforme.",
        icon: SettingsIcon,
      },
    ],
  },
  student: {
    heading: 'Espace élève',
    blurb: 'Ce que tu peux consulter, et où le trouver.',
    icon: Target,
    rows: [
      {
        href: '/student/dashboard',
        label: 'Mon objectif',
        description: 'Où tu en es, matière par matière.',
        icon: Target,
      },
      {
        href: '/student/grades',
        label: 'Mes notes',
        description: 'Les notes publiées par tes professeurs.',
        icon: BookOpenCheck,
      },
      {
        href: '/student/upcoming',
        label: 'À venir',
        description: 'Les évaluations déjà programmées par tes professeurs.',
        icon: CalendarClock,
      },
      {
        href: '/student/attendance',
        label: 'Mon assiduité',
        description: 'Tes absences et retards enregistrés.',
        icon: ClipboardCheck,
      },
      {
        href: '/student/announcements',
        label: 'Annonces',
        description: "Les annonces de tes professeurs et de l'établissement.",
        icon: Megaphone,
      },
    ],
  },
};

/** The order the four audiences are presented in when nobody is signed in. */
const AUDIENCE_ORDER: readonly PortalId[] = ['parent', 'teacher', 'admin', 'student'];

/**
 * Resolve the reader's portal from their own session claim, or `null`.
 *
 * A failure to read the session is not an error state on a public page — it means
 * "signed out", which is the honest default and the layout the page already has.
 */
async function resolveViewerPortal(): Promise<PortalId | null> {
  try {
    const session = await auth();
    if (!session?.user) return null;
    return isPortalId(session.portal) ? session.portal : null;
  } catch {
    return null;
  }
}

export default async function HelpPage() {
  const portal = await resolveViewerPortal();

  return (
    <PublicInfoPage
      accent="violet"
      eyebrow="Aide"
      eyebrowIcon={LifeBuoy}
      title="Centre d'aide"
      lede="Chaque écran de la plateforme, portail par portail, avec ce qu'il permet de faire. Et si la réponse n'est pas ici, l'adresse à qui écrire."
      heroAction={
        portal ? (
          <PublicBackCta accent="violet" href={PORTAL_LANDING[portal]} label="Retour à mon espace" />
        ) : undefined
      }
    >
      {portal ? (
        <PortalHelpSection portal={portal} isViewerPortal />
      ) : (
        <>
          <PublicSection
            title="Accéder à votre espace"
            intro="Chaque audience a son portail. Les données ne circulent pas entre eux."
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:gap-6">
              <PublicCard accent="violet" icon={Users} title="Famille">
                <p>
                  Suivi de votre enfant, alertes expliquées, messages au professeur. Un compte famille
                  se crée en ligne ; le rattachement à un enfant est validé par l&apos;établissement.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <PublicLink accent="violet" href="/parent/login" label="Connexion famille" />
                  <PublicLink accent="violet" href="/parent/register" label="Créer un compte" />
                </div>
              </PublicCard>

              <PublicCard accent="violet" icon={GraduationCap} title="Professeur">
                <p>
                  Saisie et publication des notes, évaluations, conversations avec les familles de vos
                  élèves.
                </p>
                <div className="pt-2">
                  <PublicLink accent="violet" href="/teacher/login" label="Connexion professeur" />
                </div>
              </PublicCard>

              <PublicCard accent="violet" icon={Lock} title="Administration">
                <p>
                  Structure de l&apos;établissement, inscriptions, imports, règles d&apos;alerte et
                  journal d&apos;audit.
                </p>
                <div className="pt-2">
                  <PublicLink accent="violet" href="/admin/login" label="Connexion administrateur" />
                </div>
              </PublicCard>

              <PublicCard accent="violet" icon={Target} title="Élève">
                <p>
                  Consultation de tes notes, de tes évaluations et de ton assiduité. Les comptes élève
                  sont créés par l&apos;établissement : il n&apos;y a pas d&apos;inscription en ligne.
                </p>
                <div className="pt-2">
                  <PublicLink accent="violet" href="/student/login" label="Connexion élève" />
                </div>
              </PublicCard>
            </div>
          </PublicSection>

          {AUDIENCE_ORDER.map((p) => (
            <PortalHelpSection key={p} portal={p} />
          ))}
        </>
      )}

      <SupportContactBlock accent="violet" />
    </PublicInfoPage>
  );
}

function PortalHelpSection({
  portal,
  isViewerPortal = false,
}: {
  portal: PortalId;
  isViewerPortal?: boolean;
}) {
  const section = PORTAL_HELP[portal];
  const Icon = section.icon;

  return (
    <PublicSection
      title={isViewerPortal ? `${section.heading} — votre espace` : section.heading}
      intro={section.blurb}
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg">
          <Icon className="h-5 w-5 text-white" strokeWidth={1.9} />
        </span>
        <ul className="mt-4">
          {section.rows.map((row) => (
            <PublicRow
              key={row.href}
              accent="violet"
              href={row.href}
              icon={row.icon}
              label={row.label}
              description={row.description}
            />
          ))}
        </ul>
      </div>
    </PublicSection>
  );
}
