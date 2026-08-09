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

/**
 * Phrase unique employée partout où la provenance client est absente
 * (`S-E04-3`, `ADR-036 D4`). Elle est **déclarée ici et nulle part ailleurs**
 * pour que la table et le tiroir ne puissent pas diverger.
 *
 * Elle ne nomme **aucune cause** : la même absence couvre une ligne héritée,
 * un chemin qui ne relaie pas encore, et un jeton de transfert refusé. Toute
 * formulation causale (« entrée antérieure au suivi », « requête relayée »)
 * serait fausse sur une partie des lignes — et une explication fausse dans une
 * surface de gouvernance est pire qu'une absence énoncée.
 */
export const PROVENANCE_UNAVAILABLE = 'Provenance non disponible';

/**
 * Vrai quand l'entrée ne porte **aucune** provenance client.
 *
 * Déclarée dans ce module neutre — et non à côté du composant — parce que
 * `page.tsx` (serveur) l'**appelle** : une valeur importée depuis un module
 * client est légale, l'invoquer depuis le serveur ne l'est pas. C'est la règle
 * que `PF-14` / `S-E04-2` a coûté une page en HTTP 500 pour établir.
 */
export function hasNoProvenance(entry: {
  ipAddress: string | null;
  userAgent: string | null;
}): boolean {
  return !entry.ipAddress && !entry.userAgent;
}

const BROWSER_TOKENS: Array<[RegExp, string]> = [
  // L'ordre est porteur : Edge et Opera annoncent aussi `Chrome`, et Chrome
  // annonce aussi `Safari`. Un ordre inversé enregistrerait chaque session Edge
  // comme Chrome — une fausseté légère, mais exactement la classe d'erreur que
  // cet épic existe pour supprimer.
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bChrome\//, 'Chrome'],
  [/\bFirefox\//, 'Firefox'],
  [/\bSafari\//, 'Safari'],
];

const OS_TOKENS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Libellé court d'un `User-Agent` — « Chrome sur Windows ».
 *
 * Renvoie `null` quand rien ne correspond : l'appelant affiche alors la chaîne
 * brute. On ne devine jamais, et on n'écrit jamais « Navigateur inconnu » — ce
 * libellé n'est qu'une aide à la lecture posée **au-dessus** de la valeur
 * réelle, jamais un remplacement de celle-ci.
 */
export function humanizeUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = BROWSER_TOKENS.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = OS_TOKENS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && os) return `${browser} sur ${os}`;
  if (browser) return browser;
  return null;
}
