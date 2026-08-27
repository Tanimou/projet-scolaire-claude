import type { ConversationDto, ConversationInboxResponse } from '@pilotage/contracts';
import { buttonVariants, EmptyState, PageHeader } from '@pilotage/ui';
import { MessageSquarePlus, MessagesSquare, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ThreadList } from './ThreadList';

import { PortalShell } from '@/components/PortalShell';
import { ReadErrorState } from '@/components/ReadErrorState';
import { ChildrenReadError } from '@/components/parent/ChildrenReadError';
import { api, ApiError } from '@/lib/api-client';
import { readParentChildren } from '@/lib/parent-children';


export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

/**
 * S-E03-3 / `PF-12` — `enrollments: ChildEnrollment[]` supprimé.
 *
 * Cette page ne lisait le champ **nulle part** (elle ne teste que la longueur
 * de la liste d'enfants), mais elle en déclarait la forme — et c'était la même
 * forme fausse que sur les cinq autres surfaces parent :
 * `academicYear: { status }`, alors que `GET /students` ne projette que
 * `{ id, name }`. Une septième déclaration d'un champ que le runtime ne livre
 * pas est `DNC-06` en dormance : elle attend le premier `.find()` qui la lira.
 * On la retire pendant qu'elle est encore inoffensive.
 */
interface Child {
  id: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Parent Messages — the E2-S2 inbox (thread list). Replaces the S1 compose-only
 * shell with the real inbox: server-fetches the role-aware aggregate
 * `GET /api/v1/conversations` (ONE call — unread counts + previews computed
 * server-side, no client N+1) and renders the thread rows. The "Nouveau
 * message" entry routes to `/parent/messages/new` (the relocated S1 compose).
 *
 * Three terminal states (all kind, non-stigmatising per the cahier tone):
 *  - no child rattaché → the S1 `UserRoundX` EmptyState (unchanged);
 *  - no thread yet → a `MessagesSquare` EmptyState whose action is "Nouveau
 *    message";
 *  - threads → the `ThreadList` with unread badges + alert chips.
 *
 * The dual-wall ABAC + tenant scoping are enforced entirely by the backend; this
 * surface only ever shows the caller's own participant threads.
 */
export default async function ParentMessagesPage() {
  // Does the parent guard any child? (drives the "no child" EmptyState — same
  // scoped `/students` aggregate the children page reads, no client N+1).
  // ─────────────────────────────────────────────────────────────────────────
  // S-E03-3d / `PF-363` — deux défauts sur cette page, et le second était
  // invisible depuis la phrase.
  //
  // 1. `hasChild` valait `false` sur un 403 / 500, donc la page rendait
  //    « Aucun enfant rattaché » : une lecture ratée présentée comme un fait
  //    sur la famille. `hasChild` n'est plus dérivable que d'une lecture
  //    RÉUSSIE.
  // 2. `hasChild` gouverne aussi le CTA principal « Nouveau message » : sur un
  //    échec, la commande disparaissait **sans explication**. Elle reste
  //    absente (elle mènerait à un formulaire dont le sélecteur d'enfant est
  //    précisément ce qu'on n'a pas pu lire), mais l'absence est désormais
  //    EXPLIQUÉE juste en dessous, et l'action de repli — contacter
  //    l'établissement — est portée par l'état d'erreur lui-même.
  // ─────────────────────────────────────────────────────────────────────────
  const childrenRead = await readParentChildren<Child>('parent-messages/children');
  const childrenFailure = childrenRead.ok ? null : childrenRead;
  const hasChild = childrenRead.ok && childrenRead.data.data.length > 0;

  const inbox = await safe(
    api<ConversationInboxResponse>('/api/v1/conversations', { cache: 'no-store' }),
  );
  const conversations: ConversationDto[] = inbox?.data ?? [];
  const loadFailed = inbox === null && hasChild;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Messages' },
        ]}
        title="Messages"
        subtitle="Vos échanges avec les enseignant·e·s de votre enfant"
        actions={
          hasChild ? (
            <Link href="/parent/messages/new" className={`${buttonVariants()} min-h-11`}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              Nouveau message
            </Link>
          ) : undefined
        }
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Contactez directement un·e enseignant·e qui suit votre enfant pour poser une
            question ou demander un point. La conversation reste privée et bienveillante.
          </p>
        </section>

        {childrenFailure ? (
          <ChildrenReadError
            failure={childrenFailure}
            domain="Vos conversations existantes ne sont pas supprimées."
            // Le défaut par défaut (« Contacter l'établissement » →
            // `/parent/messages/new`) mènerait ici à la page voisine, qui lit
            // la MÊME liste d'enfants et échouerait pour la même raison : une
            // boucle. On renvoie donc vers les rattachements, seul endroit où
            // un problème de tutelle est visible et actionnable.
            secondaryAction={{ label: 'Voir mes rattachements', href: '/parent/children' }}
          />
        ) : !hasChild ? (
          <EmptyState
            icon={UserRoundX}
            tone="slate"
            title="Aucun enfant rattaché"
            description="La messagerie s'ouvre une fois un enfant rattaché à votre compte. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant."
          />
        ) : loadFailed ? (
          /*
            S-E03-3d — ce `<p role="alert">` nu était un SECOND vocabulaire
            d'échec sur une page qui en porte maintenant un autre : pas
            d'icône, pas de « Réessayer », pas d'action secondaire. Deux
            grammaires d'erreur sur un même écran, c'est la dérive que cette
            tranche ferme ailleurs ; il passe par le composant partagé.
          */
          <ReadErrorState
            variant="failure"
            title="Vos conversations n’ont pas pu être chargées."
            description="Vos échanges avec les enseignant·e·s ne sont pas perdus : c'est l'affichage qui a échoué. Réessayez dans un instant."
            retryable
            secondaryAction={{ label: 'Nouveau message', href: '/parent/messages/new' }}
          />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            tone="violet"
            title="Aucune conversation pour le moment"
            description="Démarrez un échange avec un·e enseignant·e qui suit votre enfant pour poser une question ou demander un point."
            action={{ label: 'Nouveau message', href: '/parent/messages/new' }}
          />
        ) : (
          <ThreadList conversations={conversations} />
        )}
      </div>
    </PortalShell>
  );
}
