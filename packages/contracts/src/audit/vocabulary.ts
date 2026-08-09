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

// ---------------------------------------------------------------------------
// Types de ressource — 22 codes, relevés sur les sites d'écriture
// ---------------------------------------------------------------------------

export const AUDIT_RESOURCE_TYPES: readonly AuditVocabularyEntry[] = [
  { code: 'academic_year', label: 'Année scolaire' },
  { code: 'alert_instance', label: 'Alerte' },
  { code: 'assessment', label: 'Évaluation' },
  { code: 'booking', label: 'Créneau réservé' },
  // Le code qui manquait à la carte web et que la vérification à sens unique
  // n'a jamais signalé — la raison d'être de la comparaison bidirectionnelle.
  { code: 'calendar_event', label: 'Événement du calendrier' },
  { code: 'conversation', label: 'Conversation' },
  { code: 'conversation_report', label: 'Signalement de conversation' },
  { code: 'export_job', label: "Tâche d'export" },
  { code: 'grade', label: 'Note' },
  { code: 'guardianship_claim', label: 'Demande de rattachement' },
  { code: 'import_batch', label: 'Lot d’import' },
  { code: 'import_row', label: 'Ligne d’import' },
  { code: 'meeting_request', label: 'Demande de rendez-vous' },
  { code: 'remediation_plan', label: 'Plan de remédiation' },
  { code: 'role', label: 'Rôle' },
  { code: 'roster_source', label: 'Source d’effectifs' },
  { code: 'snapshot_recompute_trigger', label: 'Recalcul d’agrégats' },
  { code: 'student', label: 'Élève' },
  { code: 'subject_coefficient', label: 'Coefficient de matière' },
  { code: 'tutor', label: 'Tuteur' },
  { code: 'tutor_availability', label: 'Disponibilité de tuteur' },
  { code: 'user_profile', label: 'Utilisateur' },
] as const;

// ---------------------------------------------------------------------------
// Actions — 48 codes, relevés sur les sites d'écriture
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
}

export const AUDIT_ACTIONS: readonly AuditActionEntry[] = [
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

  { code: 'student.account_linked', label: 'Rattachement d’un compte élève' },
  { code: 'user.invite', label: 'Invitation d’un utilisateur' },
] as const;

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

/** Codes canoniques comptés par « Modifications critiques ». */
export const AUDIT_CRITICAL_ACTIONS: readonly string[] = AUDIT_ACTIONS.filter(
  (a) => a.critical,
).map((a) => a.code);

/** Codes canoniques comptés par « Exports sensibles ». */
export const AUDIT_EXPORT_ACTIONS: readonly string[] = AUDIT_ACTIONS.filter(
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
