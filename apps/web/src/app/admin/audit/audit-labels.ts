/**
 * Libellés lisibles du journal d'audit — **module neutre, sans `'use client'`**.
 *
 * Pourquoi ce fichier existe (S-E04-2 / PF-14) : ces quatre déclarations vivaient
 * dans `AuditPageFilters.tsx`, qui porte `'use client'`. `page.tsx` est un composant
 * serveur et les **appelait** pour construire les options de filtre. Importer une
 * valeur depuis un module client est légal en Next 15 ; l'**appeler** depuis le
 * serveur ne l'est pas — le bundler remplace l'export par une référence client et
 * l'invoquer lève :
 *
 *   Attempted to call humanizeResourceType() from the server but humanizeResourceType
 *   is on the client.
 *
 * Mesuré le 2026-08-08 sur la stack locale, connecté en `school_admin` :
 * `/admin/audit` renvoyait **HTTP 500** (digest `2236692779`) et tombait sur la
 * frontière d'erreur `/admin/error.tsx`. La page n'a donc jamais rendu pour un
 * administrateur authentifié.
 *
 * Règle à tenir : ce module ne doit **jamais** recevoir `'use client'` ni importer
 * un module qui le porte. Il est consommé des deux côtés de la frontière —
 * `page.tsx` (serveur) et `AuditPageFilters` / `AuditTable` / `AuditDetailDrawer`
 * (client).
 *
 * Portée : ces libellés restent locaux au portail admin. `S-E04-4` (ADR-037) doit
 * les remonter dans `packages/contracts` pour que les quatre portails partagent un
 * vocabulaire unique ; ce fichier est l'étape intermédiaire, pas la destination.
 */

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  user_profile: 'Utilisateurs',
  role: 'Rôles',
  assessment: 'Évaluations',
  academic_year: 'Année scolaire',
  subject_coefficient: 'Coefficients',
  import_batch: 'Imports',
  enrollment: 'Inscriptions',
  enrollment_request: 'Demandes',
  student: 'Élèves',
  class_section: 'Classes',
  teacher_profile: 'Enseignants',
  grade: 'Notes',
  announcement: 'Annonces',
};

const PORTAL_LABELS: Record<string, string> = {
  admin: 'Admin',
  teacher: 'Professeur',
  parent: 'Parent',
};

/**
 * Un type de ressource inconnu reste **visible** — on le dé-souligne et on le
 * capitalise plutôt que de le masquer derrière un libellé générique (DNC-08).
 */
export function humanizeResourceType(rt: string): string {
  return (
    RESOURCE_TYPE_LABELS[rt] ??
    rt
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

export function humanizePortal(p: string | null): string {
  if (!p) return '—';
  return PORTAL_LABELS[p] ?? p;
}
