// `Bell` is imported as a TYPE only: it is never rendered here, it just supplies
// the shape every entry of `KIND_ICON` must have (`typeof Bell`).
import type { Bell } from 'lucide-react';
import {
  AlertTriangle,
  ClipboardCheck,
  Info,
  Megaphone,
  PenTool,
  UserPlus,
} from 'lucide-react';

/**
 * S-E04-3 — le vocabulaire des notifications, séparé du composant serveur qui
 * l'affichait.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `NotificationCenter.tsx` est un composant **serveur** : il importe `api` de
 * `@/lib/api-client`, qui appelle `auth()` puis `fetch()` côté serveur. Il
 * déclarait AUSSI `KIND_ICON` et les types de la ligne de notification — et
 * `NotificationListItem.tsx`, lui `'use client'`, importait `KIND_ICON` de là.
 * Une **valeur** importée depuis un module serveur tire tout ce module dans le
 * graphe client.
 *
 * C'était sans conséquence visible tant qu'`api-client.ts` n'avait aucun import
 * strictement serveur : le helper de fetch partait dans le bundle navigateur,
 * inutile mais silencieux. `S-E04-3` y ajoute `next/headers` (lecture de la
 * provenance client, ADR-036 D5), qui est serveur-uniquement — et le build a
 * cassé net :
 *
 *     You're importing a component that needs "next/headers".
 *     ./src/lib/api-client.ts → NotificationCenter.tsx → NotificationListItem.tsx
 *
 * Le défaut n'était donc PAS l'import de `next/headers` : c'était cette
 * frontière serveur/client déjà franchie, que le nouvel import a rendue
 * visible. Le corriger au bon niveau veut dire déplacer la frontière, pas
 * contourner l'import — un `await import('next/headers')` dynamique aurait
 * rendu le build vert en laissant un composant client dépendre d'un module
 * serveur, c'est-à-dire en cachant le défaut au lieu de le fermer.
 *
 * Ce module ne contient donc QUE des déclarations sûres pour les deux côtés :
 * des types (effacés à la compilation) et une table d'icônes `lucide-react`.
 * Aucun import de `@/lib/api-client`, aucun `next/headers`, aucun `auth()`.
 * `tsc` ne peut pas voir cette règle — seul `next build` la voit — donc elle est
 * écrite ici, à l'endroit où quelqu'un ajouterait l'import qui la casse.
 *
 * CE QUI N'A DÉLIBÉRÉMENT **PAS** DÉMÉNAGÉ : `Portal`
 * ---------------------------------------------------
 * Seules les **valeurs** franchissent la frontière de façon nuisible. Un
 * `import type` est effacé avant le bundling, donc il ne crée aucune arête de
 * graphe — c'est pourquoi la trace d'erreur de `next build` nommait
 * `NotificationListItem.tsx` (qui importe la valeur `KIND_ICON`) et **pas**
 * `NotificationsFilters.tsx`, qui importait déjà `type Portal` du même fichier
 * serveur sans rien casser.
 *
 * `Portal` reste donc déclaré dans `NotificationCenter.tsx`, et ce n'est pas un
 * détail de style : `scripts/link-integrity-check.js` résout l'union
 * **dans le fichier qui porte le lien**. `NotificationCenter.tsx:240` écrit
 * `` href={`/${portal}/notifications`} ``, et le contrôle n'expanse ce gabarit en
 * `/admin`, `/teacher`, `/parent` que s'il trouve `portal: Portal` **et**
 * `type Portal = 'admin' | 'teacher' | 'parent'` dans ce même fichier. Déplacer
 * l'alias ici a été essayé et mesuré : le lien retombait en forme non résolue
 * (« étoile » + `/notifications`, 3 sites, source `portal`), la gate restait
 * **verte** — une forme non résolue est tolérée — et trois routes cessaient
 * d'être vérifiées sans que
 * rien ne le dise. Exactement l'« under-approximate invisibly » que le docblock
 * de `resolveDeclaredUnion` décrit. Ne le déplacez pas ici sans déplacer aussi
 * le lien, ou sans enseigner au résolveur à suivre un import.
 */

export type NotificationKind =
  | 'announcement'
  | 'alert'
  | 'grade_published'
  | 'enrollment_status'
  | 'lesson_published'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
}

export const KIND_LABEL: Record<NotificationKind, string> = {
  announcement: 'Annonce',
  alert: 'Alerte',
  grade_published: 'Note publiée',
  enrollment_status: 'Inscription',
  lesson_published: 'Cours publié',
  system: 'Système',
};

export const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  announcement: Megaphone,
  alert: AlertTriangle,
  grade_published: PenTool,
  enrollment_status: UserPlus,
  lesson_published: ClipboardCheck,
  system: Info,
};
