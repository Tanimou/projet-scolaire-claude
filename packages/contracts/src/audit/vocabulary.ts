/**
 * Vocabulaire d'audit — **la déclaration unique** (S-E04-4, ADR-037, PF-32).
 *
 * Trois populations disaient des choses différentes de `audit_log.action` et
 * `audit_log.resource_type` :
 *
 *  1. les **54 lignes historiques** portent des *libellés français* dans des
 *     colonnes structurelles (`'Suppression'`, `'Élève'`) ;
 *  2. les **sites d'écriture** de l'API et de `imports-core` écrivent des
 *     *codes machine* (`'role.delete'`, `'user_profile'`) ;
 *  3. la **carte de libellés du portail admin** ne couvrait qu'un sous-ensemble
 *     et portait 7 clés que personne n'écrit.
 *
 * Ce module est désormais le seul endroit où le vocabulaire est déclaré. Les
 * trois consommateurs — la couche de libellés web, les prédicats KPI de l'API,
 * et le générateur CSV du worker — le lisent ; aucun n'en garde une copie.
 *
 * **Ce module est pur** : pas de Prisma, pas de Nest, pas de `node:*`, aucune
 * dépendance nouvelle. Il est consommé des deux côtés de la frontière
 * serveur/client de Next 15 et par du Node CJS (`packages/contracts` construit
 * vers `dist/`, GUARDRAILS §2).
 *
 * **Comment cette liste a été obtenue.** Elle n'est pas rédigée à la main : elle
 * a été relevée sur les sites d'écriture réels (`auditLog.create` + les six
 * helpers privés qui y relaient une `action`) dans `apps/api/src`,
 * `packages/imports-core/src` et `apps/api/prisma/seed-demo.ts`. Le garde
 * `audit-vocabulary-gate.spec.ts` re-dérive cet ensemble depuis les sources à
 * chaque exécution et compare **dans les deux sens** — tout code écrit doit
 * avoir un libellé, et tout libellé doit correspondre à un code écrit. Une
 * vérification à sens unique est exactement ce qui a laissé `calendar_event`
 * sans libellé.
 *
 * **Ce qui n'est PAS déclaré ici** : aucun enum Prisma (refusé, ADR-037 D3),
 * aucune réécriture des lignes héritées (append-only, ADR-037 D4).
 */

/** Descripteur d'un code du vocabulaire canonique. */
export interface AuditVocabularyEntry {
  /** La valeur exacte écrite en base. */
  readonly code: string;
  /** Le libellé français affiché **au-dessus** du code, jamais à sa place. */
  readonly label: string;
}

/**
 * Descripteur d'une valeur **héritée** — un libellé français écrit dans une
 * colonne structurelle avant l'unification du vocabulaire.
 *
 * La table est **gelée** : elle n'existe que pour les 54 lignes antérieures à
 * `S-E04-4`. Rien ne doit y être ajouté. Un code ajouté demain et oublié dans
 * `AUDIT_ACTIONS` n'est pas « hérité » — il est `unknown`, et c'est le garde de
 * complétude qui doit passer au rouge, pas l'interface qui doit inventer une
 * provenance.
 */
export interface AuditLegacyAlias {
  /** La valeur telle qu'elle est stockée — **jamais réécrite**. */
  readonly code: string;
  /**
   * Le libellé affiché. Il est **identique au code** : ces valeurs sont déjà
   * du français. Une ligne héritée n'est pas re-libellée, elle est marquée.
   */
  readonly label: string;
  /** Compte dans le KPI « Modifications critiques ». */
  readonly critical?: boolean;
  /** Compte dans le KPI « Exports sensibles ». */
  readonly export?: boolean;
}

// ---------------------------------------------------------------------------
// Portails
// ---------------------------------------------------------------------------

/**
 * Les **quatre** portails, pour l'audit uniquement.
 *
 * `PORTALS` dans `src/enums/index.ts` reste délibérément à **trois** : il est
 * consommé par `dto/auth.ts` (`portal: z.enum(PORTALS)`) pour la **connexion**.
 * L'élargir ferait silencieusement de `student` un portail de login légal —
 * un vrai changement d'autorisation, hors périmètre (ADR-037 D2).
 *
 * `apps/web/src/lib/portals.ts` (`PORTAL_IDS`) porte déjà quatre portails mais
 * est **délibérément sans import** (bundle Edge) : il ne lit pas cette table,
 * et la dérive entre les deux est attrapée par un garde statique, jamais par un
 * import à l'exécution. PF-101 possède la réconciliation.
 *
 * Mesuré : **aucun site d'écriture n'émet `portal: 'student'` aujourd'hui** —
 * `deriveAuditProvenance` ne mappe que trois rôles de realm. Le libellé existe
 * et rend ; aucun écrivain n'a été fabriqué pour le rendre atteignable.
 */
export const AUDIT_PORTALS: readonly AuditVocabularyEntry[] = [
  { code: 'admin', label: 'Admin' },
  { code: 'teacher', label: 'Professeur' },
  { code: 'parent', label: 'Parent' },
  { code: 'student', label: 'Élève' },
] as const;

/**
 * Sentinelle de filtre pour `portal IS NULL` (PF-123, moitié lecture).
 *
 * Une ligne dont `portal` est nul n'était atteignable par **aucune** valeur
 * offerte : la facette était construite avec `portal: { not: null }` pendant que
 * le filtre de ligne comparait `portal` à l'égalité. Le trou se referme par une
 * valeur réservée, décodée **côté serveur** en `{ portal: null }`.
 *
 * Pourquoi une sentinelle et pas la chaîne vide : `''` est indiscernable de
 * « aucun filtre » dans une query string. Pourquoi pas un `null` transmis par le
 * client : une valeur de filtre reste une chaîne sur le fil, et un `null`
 * traversant jusqu'à Prisma est un littéral non validé.
 *
 * **Ce n'est pas un portail.** Elle n'est volontairement pas ajoutée à
 * `AUDIT_PORTALS` : le vocabulaire déclare ce que les lignes portent, et
 * « aucun portail » n'est pas une valeur portée. Un garde vérifie la
 * non-collision.
 */
export const AUDIT_PORTAL_NONE = '__none__';

/** Libellé de la sentinelle « portail non enregistré ». */
export const AUDIT_PORTAL_NONE_LABEL = 'Sans portail';

/** `true` quand la valeur de facette/filtre est la sentinelle `portal IS NULL`. */
export function isAuditPortalNone(code: string | null | undefined): boolean {
  return code === AUDIT_PORTAL_NONE;
}

// ---------------------------------------------------------------------------
// Types de ressource — 25 codes, relevés sur les sites d'écriture
// ---------------------------------------------------------------------------

/**
 * S-E04-6 ajoute **trois** codes — `enrollment`, `school`, `user_role` — parce
 * que trois familles privilégiées se sont mises à écrire une ligne d'audit dans
 * leur propre transaction (`apps/api/src/shared/audit/write-audit.ts`).
 *
 * `enrollment` **revient** : `S-E04-4` l'avait supprimé comme libellé orphelin
 * (déclaré, jamais écrit) et avait épinglé la suppression par son nom dans
 * `audit-vocabulary-gate.spec.ts`. Ce n'est pas une annulation de cette décision
 * mais son aboutissement : le code n'était orphelin que parce que la décision
 * d'inscription n'était pas tracée du tout. Il a désormais quatre écrivains, et
 * l'assertion par nom a été amendée — avec la raison — plutôt que supprimée.
 *
 * `user_role` et **non** `user_profile` pour la famille grant/revoke :
 * `AuditLog.resourceId` est une colonne `@db.Uuid`, la valeur qui identifie
 * l'attribution est `UserRole.id`, et nommer la ressource `user_profile` tout en
 * y écrivant l'identifiant d'une autre table rendrait la colonne illisible. Un
 * identifiant composite (`userId:roleId`) est refusé pour la même raison qu'une
 * IP non-inet l'est dans `provenance.ts` : PostgreSQL rejette le cast et la
 * ligne d'audit ferait échouer la mutation qu'elle trace.
 *
 * ## `as const satisfies`, et pourquoi l'annotation a disparu (PF-162, S-E04-7)
 *
 * La déclaration portait `: readonly AuditVocabularyEntry[]` **et** un `as const`
 * final. L'annotation gagne : le type déclaré du tableau était
 * `readonly AuditVocabularyEntry[]`, donc
 * `(typeof AUDIT_RESOURCE_TYPES)[number]['code']` valait `string` — pas une
 * union. Une dérivation écrite au-dessus de cette forme aurait compilé, exporté
 * un type nommé, et n'aurait **rien** interdit : le `as const` n'achetait rien.
 *
 * `as const satisfies readonly AuditVocabularyEntry[]` garde la vérification
 * (une entrée mal formée reste une erreur de compilation, au même endroit) et
 * conserve le type littéral, d'où `AuditResourceTypeCode` plus bas. C'est ce qui
 * fait de `ADR-035` D6 — « le code écrit est un code déclaré » — un invariant du
 * compilateur au lieu d'une convention relue.
 */
export const AUDIT_RESOURCE_TYPES = [
  { code: 'academic_year', label: 'Année scolaire' },
  { code: 'alert_instance', label: 'Alerte' },
  { code: 'assessment', label: 'Évaluation' },
  { code: 'booking', label: 'Créneau réservé' },
  // Le code qui manquait à la carte web et que la vérification à sens unique
  // n'a jamais signalé — la raison d'être de la comparaison bidirectionnelle.
  { code: 'calendar_event', label: 'Événement du calendrier' },
  { code: 'conversation', label: 'Conversation' },
  { code: 'conversation_report', label: 'Signalement de conversation' },
  // S-E04-6. Le libellé est volontairement identique au code hérité
  // « Inscription » de `LEGACY_AUDIT_RESOURCE_TYPE_ALIASES` : les deux DÉSIGNENT
  // la même chose. Ce qui les distingue à l'écran n'est pas le mot mais le
  // marqueur « Format hérité », que seule la ligne héritée porte.
  { code: 'enrollment', label: 'Inscription' },
  { code: 'export_job', label: "Tâche d'export" },
  { code: 'grade', label: 'Note' },
  { code: 'guardianship_claim', label: 'Demande de rattachement' },
  { code: 'import_batch', label: 'Lot d’import' },
  { code: 'import_row', label: 'Ligne d’import' },
  { code: 'meeting_request', label: 'Demande de rendez-vous' },
  { code: 'remediation_plan', label: 'Plan de remédiation' },
  { code: 'role', label: 'Rôle' },
  { code: 'roster_source', label: 'Source d’effectifs' },
  { code: 'school', label: 'Établissement' },
  { code: 'snapshot_recompute_trigger', label: 'Recalcul d’agrégats' },
  { code: 'student', label: 'Élève' },
  { code: 'subject_coefficient', label: 'Coefficient de matière' },
  { code: 'tutor', label: 'Tuteur' },
  { code: 'tutor_availability', label: 'Disponibilité de tuteur' },
  { code: 'user_profile', label: 'Utilisateur' },
  { code: 'user_role', label: 'Attribution de rôle' },
] as const satisfies readonly AuditVocabularyEntry[];

/**
 * L'union des codes de type de ressource **déclarés** (PF-162, `ADR-035` D14).
 *
 * Dérivée de la table ci-dessus, jamais d'une seconde liste : `ADR-037` D1 dit
 * que le vocabulaire est déclaré **une fois**, et une union recopiée à la main
 * serait exactement la deuxième déclaration que cet ADR interdit.
 *
 * Elle **exclut délibérément** `LEGACY_AUDIT_RESOURCE_TYPE_ALIASES` : les lignes
 * héritées ne sont jamais réécrites (`ADR-037` D4) et rien de neuf ne doit être
 * écrit dans ce vocabulaire-là. Un écrivain qui émettrait « Inscription » est
 * donc une erreur de compilation, et c'est le comportement voulu.
 */
export type AuditResourceTypeCode = (typeof AUDIT_RESOURCE_TYPES)[number]['code'];

// ---------------------------------------------------------------------------
// Actions — 57 codes, relevés sur les sites d'écriture
// ---------------------------------------------------------------------------

/**
 * `critical` = compte dans « Modifications critiques » : suppression d'une
 * entité structurelle, révision d'une décision de gouvernance, retour arrière.
 * `export` = compte dans « Exports sensibles ».
 *
 * Ces deux drapeaux sont la **source** des prédicats KPI de
 * `analytics.service.ts` : plus aucun `contains: 'Export'` sur une chaîne
 * d'affichage française — une sous-chaîne n'est pas un vocabulaire.
 */
export interface AuditActionEntry extends AuditVocabularyEntry {
  readonly critical?: boolean;
  readonly export?: boolean;
  /**
   * Teinte de la puce d'action, **déclarée** (PF-134).
   *
   * Optionnelle : par défaut elle est *dérivée* des deux drapeaux ci-dessus —
   * `critical` → `danger`, `export` → `info`, sinon `neutral`. Une teinte
   * explicite n'existe que pour un code dont la lecture visuelle doit s'écarter
   * de sa comptabilisation ; elle ne change **jamais** ce qui est compté.
   *
   * C'est la déclaration qui remplace la quatrième table de vocabulaire :
   * `AuditTable.tsx` faisait de la correspondance de sous-chaîne sur le code
   * (`a.includes('update')`), ce qui peignait `coefficient.upsert` et
   * `grade.unflag` en `neutral` alors que la carte « Modifications critiques »
   * les comptait — la couleur contredisait le chiffre.
   */
  readonly tone?: AuditActionTone;
}

/**
 * Les teintes qu'une action d'audit peut prendre. Volontairement un
 * sous-ensemble de `StatusTone` de `@pilotage/ui` : `packages/contracts` ne
 * dépend d'aucun paquet d'interface, la compatibilité est structurelle.
 */
export type AuditActionTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Même forme que `AUDIT_RESOURCE_TYPES` et pour la même raison (PF-162) :
 * `as const satisfies` plutôt qu'une annotation qui écrasait le `as const`.
 */
export const AUDIT_ACTIONS = [
  { code: 'academic_year.create', label: 'Création d’une année scolaire' },
  { code: 'academic_year.update', label: 'Modification d’une année scolaire', critical: true },
  { code: 'academic_year.delete', label: 'Suppression d’une année scolaire', critical: true },

  { code: 'alert.acknowledge', label: 'Prise en compte d’une alerte' },
  { code: 'alert.dismiss', label: 'Rejet d’une alerte' },
  { code: 'alert.meeting_intent', label: 'Demande de rendez-vous depuis une alerte' },
  { code: 'alert.resolve', label: 'Résolution d’une alerte' },

  { code: 'analytics.snapshot_rebuild', label: 'Recalcul des agrégats' },
  { code: 'assessment.publish', label: 'Publication d’une évaluation' },
  { code: 'calendar.seed_french_holidays', label: 'Import des vacances scolaires' },
  { code: 'coefficient.upsert', label: 'Modification des coefficients', critical: true },

  { code: 'conversation.create', label: 'Ouverture d’une conversation' },
  { code: 'conversation.moderation_read', label: 'Lecture de modération' },
  { code: 'conversation.report', label: 'Signalement d’une conversation' },

  // S-E04-6 — la décision d'inscription. Quatre codes pour quatre décisions
  // distinctes ; `status_change` et `cancel` sont comptés par « Modifications
  // critiques » parce qu'ils retirent un élève d'une classe.
  { code: 'enrollment.create', label: 'Inscription d’un élève' },
  { code: 'enrollment.status_change', label: 'Changement de statut d’inscription', critical: true },
  { code: 'enrollment.transfer', label: 'Transfert de classe' },
  { code: 'enrollment.cancel', label: 'Annulation d’une inscription', critical: true },

  { code: 'export.bulletin.request', label: 'Demande d’export de bulletins', export: true },
  { code: 'export.grade_grid.request', label: 'Demande d’export du tableau de notes', export: true },

  { code: 'grade.flag', label: 'Signalement d’une note' },
  { code: 'grade.unflag', label: 'Levée du signalement d’une note', critical: true },

  { code: 'guardianship.claim_submitted', label: 'Dépôt d’une demande de rattachement' },
  { code: 'guardianship.claim_match_failed', label: 'Échec d’appariement d’un rattachement' },
  { code: 'guardianship.claim_withdrawn', label: 'Retrait d’une demande de rattachement' },
  { code: 'guardianship.claim_approved', label: 'Approbation d’un rattachement' },
  { code: 'guardianship.claim_rejected', label: 'Refus d’un rattachement' },

  { code: 'import.apply', label: 'Application d’un import' },
  { code: 'import.conflict.resolve', label: 'Résolution d’un conflit d’import' },
  { code: 'import.rollback', label: 'Retour arrière d’un import', critical: true },
  { code: 'import.sync.pull', label: 'Synchronisation d’une source d’effectifs' },
  { code: 'integration.roster_source.created', label: 'Création d’une source d’effectifs' },

  { code: 'meeting_request.resolve', label: 'Traitement d’une demande de rendez-vous' },

  { code: 'remediation.availability_created', label: 'Création d’une disponibilité de tuteur' },
  { code: 'remediation.availability_updated', label: 'Modification d’une disponibilité de tuteur' },
  { code: 'remediation.plan_created', label: 'Création d’un plan de remédiation' },
  { code: 'remediation.plan_closed', label: 'Clôture d’un plan de remédiation', critical: true },
  { code: 'remediation.plan_reopened', label: 'Réouverture d’un plan de remédiation', critical: true },
  { code: 'remediation.tutor_created', label: 'Création d’un tuteur' },
  { code: 'remediation.tutor_updated', label: 'Modification d’un tuteur' },

  // Famille `remediation.booking_*` — voir AUDIT_ACTION_FAMILIES.
  { code: 'remediation.booking_created', label: 'Réservation d’un créneau' },
  { code: 'remediation.booking_cancelled', label: 'Annulation d’un créneau' },
  { code: 'remediation.booking_confirmed', label: 'Confirmation d’un créneau' },
  { code: 'remediation.booking_declined', label: 'Refus d’un créneau' },
  { code: 'remediation.booking_completed', label: 'Séance de remédiation effectuée' },
  { code: 'remediation.booking_no_show', label: 'Absence à une séance de remédiation' },
  { code: 'remediation.booking_proposed_alternative', label: 'Proposition d’un autre créneau' },

  { code: 'role.create', label: 'Création d’un rôle' },
  { code: 'role.update', label: 'Modification d’un rôle', critical: true },
  { code: 'role.delete', label: 'Suppression d’un rôle', critical: true },
  // S-E04-6 — l'attribution et le retrait d'un rôle sont les deux mutations de
  // privilège les plus sensibles de la plateforme, et jusqu'à cette tranche
  // elles n'écrivaient AUCUNE ligne. Toutes deux critiques.
  { code: 'role.grant', label: 'Attribution d’un rôle', critical: true },
  { code: 'role.revoke', label: 'Retrait d’un rôle', critical: true },

  // S-E04-6 — `school.close` et non `school.delete` : `DELETE /schools/:id` est
  // une fermeture douce (`status: 'closed'`), la ligne survit. Le vocabulaire ne
  // doit pas annoncer une suppression qui n'a pas eu lieu.
  { code: 'school.create', label: 'Création d’un établissement' },
  { code: 'school.update', label: 'Modification d’un établissement', critical: true },
  { code: 'school.close', label: 'Fermeture d’un établissement', critical: true },

  { code: 'student.account_linked', label: 'Rattachement d’un compte élève' },
  { code: 'user.invite', label: 'Invitation d’un utilisateur' },
  // S-E05-11 — `POST /auth/register-parent` est le SEUL chemin de création de
  // compte non authentifié du produit, et il n'écrivait aucune ligne (`PF-166`).
  // « Auto-inscription » et non « Création d'un compte » : dans la cellule d'une
  // seule ligne du tableau d'audit, « Création d'un compte » serait indiscernable
  // de `user.invite` ci-dessus, alors que toute la valeur de gouvernance de cette
  // ligne tient dans la distinction — ce compte a été créé par une requête
  // publique anonyme, pas par un administrateur. Nommer *parent* suit le
  // précédent `school.close` : le vocabulaire dit ce qui s'est réellement passé,
  // et cet endpoint n'accorde qu'un seul rôle de realm.
  //
  // PAS `critical: true`, délibérément : `user.invite`, le frère administré, ne
  // l'est pas non plus, et `AUDIT_CRITICAL_ACTIONS` alimente le compteur
  // « Modifications critiques » de `/admin/audit`. Une inscription parent est du
  // trafic public récurrent et routinier ; la marquer critique noierait le seul
  // compteur qui sert à repérer `role.grant` / `role.revoke` / `role.delete`.
  { code: 'user.register', label: 'Auto-inscription d’un parent' },
] as const satisfies readonly AuditActionEntry[];

/**
 * L'union des codes d'action **déclarés** (PF-162, `ADR-035` D14).
 *
 * Ce que cette union ne couvre pas, et pourquoi ce n'est pas un oubli : les
 * **familles calculées** (`AUDIT_ACTION_FAMILIES`, ci-dessous) produisent leur
 * code à l'exécution — `` `remediation.booking_${dto.toStatus}` ``. Un site qui
 * écrit une famille ne peut pas satisfaire cette union, et le garde de
 * vocabulaire reste l'instrument qui couvre ce cas ; les deux moitiés sont
 * complémentaires, aucune ne remplace l'autre.
 *
 * Comme pour les types de ressource, les alias hérités en sont exclus : rien de
 * neuf ne s'écrit dans le vocabulaire français hérité (`ADR-037` D4).
 */
export type AuditActionCode = (typeof AUDIT_ACTIONS)[number]['code'];

/**
 * Familles d'actions **calculées** — un préfixe suivi d'une valeur produite à
 * l'exécution.
 *
 * `remediation.controller.ts` construit `` `remediation.booking_${dto.toStatus}` ``
 * : ce n'est pas un littéral et un extracteur AST ne peut pas l'énumérer. On ne
 * fait donc pas semblant : la famille est déclarée ici avec ses membres, et le
 * garde vérifie que les membres déclarés couvrent ce que le site de calcul peut
 * produire (`TEACHER_BOOKING_TRANSITION` ∪ `created` ∪ `cancelled`).
 */
export const AUDIT_ACTION_FAMILIES: readonly {
  readonly prefix: string;
  readonly computedAt: string;
  readonly members: readonly string[];
}[] = [
  {
    prefix: 'remediation.booking_',
    computedAt: 'apps/api/src/modules/remediation/remediation.controller.ts (transition)',
    members: [
      'remediation.booking_created',
      'remediation.booking_cancelled',
      'remediation.booking_confirmed',
      'remediation.booking_declined',
      'remediation.booking_completed',
      'remediation.booking_no_show',
      'remediation.booking_proposed_alternative',
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Table d'alias hérités — GELÉE
// ---------------------------------------------------------------------------

/**
 * Les valeurs françaises portées par les 54 lignes antérieures à `S-E04-4`.
 *
 * **Gelée.** Rien ne doit y être ajouté : elle n'existe que pour que les lignes
 * déjà écrites restent lisibles et restent comptées par les KPI. Les lignes
 * elles-mêmes ne sont **jamais** mises à jour ni supprimées — le journal est
 * append-only.
 */
export const LEGACY_AUDIT_ACTION_ALIASES: readonly AuditLegacyAlias[] = [
  { code: 'Création', label: 'Création' },
  { code: 'Mise à jour', label: 'Mise à jour', critical: true },
  { code: 'Validation', label: 'Validation' },
  { code: 'Suppression', label: 'Suppression', critical: true },
  { code: 'Export', label: 'Export', export: true },
] as const;

export const LEGACY_AUDIT_RESOURCE_TYPE_ALIASES: readonly AuditLegacyAlias[] = [
  { code: 'Année scolaire', label: 'Année scolaire' },
  { code: 'Professeur', label: 'Professeur' },
  { code: 'Inscription', label: 'Inscription' },
  { code: 'Résultats', label: 'Résultats' },
  { code: 'Élève', label: 'Élève' },
  { code: 'Classe', label: 'Classe' },
  { code: 'Évaluation', label: 'Évaluation' },
  { code: 'Note', label: 'Note' },
] as const;

/** Alias agrégés, pour un garde qui veut les deux axes d'un coup. */
export const LEGACY_AUDIT_ALIASES: readonly AuditLegacyAlias[] = [
  ...LEGACY_AUDIT_ACTION_ALIASES,
  ...LEGACY_AUDIT_RESOURCE_TYPE_ALIASES,
] as const;

// ---------------------------------------------------------------------------
// Ensembles dérivés — la source des prédicats KPI
// ---------------------------------------------------------------------------

/**
 * Vue élargie sur `AUDIT_ACTIONS`, pour lire les drapeaux *optionnels*.
 *
 * `AUDIT_ACTIONS` est déclarée en `as const satisfies` (PF-162) : son type
 * d'élément est l'**union** des 57 littéraux, et une entrée sans `critical` ni
 * `export` ne possède pas ces propriétés. Lire un membre facultatif sur une
 * union exige qu'il soit présent partout — d'où deux TS2339 quand on filtre
 * directement. On élargit donc ici, au point de consommation, ce qu'on refuse
 * d'élargir à la déclaration : `AuditActionCode` reste dérivé des littéraux.
 */
const AUDIT_ACTION_ENTRIES: readonly AuditActionEntry[] = AUDIT_ACTIONS;

/** Codes canoniques comptés par « Modifications critiques ». */
export const AUDIT_CRITICAL_ACTIONS: readonly string[] = AUDIT_ACTION_ENTRIES.filter(
  (a) => a.critical,
).map((a) => a.code);

/** Codes canoniques comptés par « Exports sensibles ». */
export const AUDIT_EXPORT_ACTIONS: readonly string[] = AUDIT_ACTION_ENTRIES.filter(
  (a) => a.export,
).map((a) => a.code);

/** Alias hérités comptés par « Modifications critiques » (gelés). */
export const LEGACY_AUDIT_CRITICAL_ALIASES: readonly string[] =
  LEGACY_AUDIT_ACTION_ALIASES.filter((a) => a.critical).map((a) => a.code);

/** Alias hérités comptés par « Exports sensibles » (gelés). */
export const LEGACY_AUDIT_EXPORT_ALIASES: readonly string[] =
  LEGACY_AUDIT_ACTION_ALIASES.filter((a) => a.export).map((a) => a.code);

/**
 * **Vide par mesure, pas par oubli.**
 *
 * Aucun site d'écriture n'émet d'action de connexion, et aucune des 54 lignes
 * héritées ne contient la sous-chaîne `login`. Le prédicat KPI
 * `action: { contains: 'login' }` ne pouvait donc lire que 0 — pour toujours
 * (DNC-09 : aucune carte qui ne peut structurellement lire que 0).
 *
 * On **ne** pointe **pas** un `{ in: [] }` vers cette constante : cela
 * convertirait une carte cassée en carte canoniquement cassée. La carte doit
 * annoncer « Non instrumenté ». Instrumenter la connexion est un nouveau chemin
 * d'écriture privilégié — hors périmètre de cette tranche.
 */
export const AUDIT_LOGIN_ACTIONS: readonly string[] = [];
