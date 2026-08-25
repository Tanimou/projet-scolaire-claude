import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * S-E01-1d — la COUTURE de portée tenant, moitié PURE.
 *
 * Ce fichier ne construit aucun client, n'ouvre aucune connexion et n'importe
 * ni Nest ni Prisma en VALEUR : il est exécutable par un spec qui tourne sans
 * client généré et sans base, exactement comme la moitié libre de
 * `prisma.service.ts` (`assertTenantId` / `runWithTenant`). C'est ce qui rend le
 * verdict de sonde et la sémantique d'imbrication démontrables sans PostgreSQL.
 *
 * CE QUI RESTE VRAI, ET QU'IL NE FAUT PAS SURLIRE — l'application connectée
 * comme `pilotage` N'EST PAS ISOLÉE par RLS : le propriétaire échappe à ses
 * propres policies tant que `FORCE ROW LEVEL SECURITY` est absent (ADR-032 §D5).
 * Cette story n'y change rien globalement : elle ouvre une DEUXIÈME connexion,
 * non propriétaire, et n'y fait passer QUE les sites d'appel qu'un module a
 * explicitement convertis. Les 782 autres restent sur la connexion du
 * PROPRIÉTAIRE et continuent de fonctionner — c'est le point : la bascule
 * cesse d'être un événement tout-ou-rien et devient une migration par module.
 *
 * AUCUNE ÉCRITURE DE STRING SQL ICI. Le `set_config`, son paramètre lié, son
 * `nullif` et sa relecture appartiennent à `applyTenantContext`
 * (ADR-032 §D1–§D3) et sont RÉUTILISÉS tels quels, jamais réimplémentés.
 */

/**
 * Refus de portée tenant. Interne à l'API : ce n'est pas une forme client.
 *
 * DISTINCT de `TenantContextError` (`prisma.service.ts`), et la distinction
 * porte la propriété : `TenantContextError` dit « l'identifiant fourni n'est pas
 * un tenant recevable » (une valeur), `TenantScopeError` dit « la portée
 * demandée ne peut pas être ouverte dans l'état courant » (une structure).
 * Les confondre reviendrait à faire d'un bug de câblage une erreur de saisie.
 */
export class TenantScopeError extends Error {
  constructor(reason: string) {
    super('Portée tenant refusée : ' + reason);
    this.name = 'TenantScopeError';
  }
}

/**
 * Les TROIS états de `DATABASE_URL_APP`, et il n'y en a pas un quatrième.
 *
 * - `degraded_no_app_url` — la variable est absente ou vide. La portée s'ouvre
 *   quand même, sur le client PROPRIÉTAIRE, et l'état est NOMMÉ : une ligne de
 *   log au démarrage, la jauge `pilotage_tenant_scope_enforced` à 0. Jamais
 *   silencieux, jamais vert.
 * - `enforced` — la variable est déclarée ET la sonde a prouvé, sur la connexion
 *   elle-même, que le rôle n'est pas le propriétaire, ne porte pas `BYPASSRLS`,
 *   n'est pas membre du propriétaire, et détient les privilèges dont le module
 *   converti a besoin.
 * - `refused_unusable` — la variable est déclarée et la sonde a ÉCHOUÉ. On
 *   REFUSE ; on ne se rabat PAS sur le propriétaire. Déclarer la variable EST
 *   l'opt-in de l'exploitant ; un opt-in cassé est une mauvaise configuration,
 *   et se rabattre en silence serait exactement la forme que DNC-08 interdit —
 *   un état de connexion inclassable qui passe au vert.
 *
 * DNC-10 — aucun de ces trois états n'est atteignable par un drapeau, une
 * branche sur `NODE_ENV` ou une variable d'échappement. Ils sont dérivés d'UNE
 * variable d'adresse et d'une sonde exécutée sur la connexion qu'elle désigne.
 */
export type TenantScopeState = 'enforced' | 'degraded_no_app_url' | 'refused_unusable';

/**
 * Le cadre porté par le store pour la durée d'UN callback.
 *
 * `tx` est typé `unknown` DÉLIBÉRÉMENT. La règle d'architecture de cette story
 * est « portée LEXICALE, pas ambiante » : le consommateur reçoit son client de
 * transaction en PARAMÈTRE de son callback, il ne va pas le chercher dans le
 * store. Un `getCurrentTx(): PrismaClient` serait précisément la forme ambiante
 * qu'un service futur pourrait atteindre sans s'être inscrit dans la couture —
 * la faute qu'ADR-035 reproche déjà aux intercepteurs (« un endroit qu'un auteur
 * futur oublie d'appliquer »). Le store existe pour DEUX usages seulement :
 * détecter l'imbrication, et rendre `current()` observable par un test.
 */
export interface TenantScopeFrame {
  readonly tenantId: string;
  readonly tx: unknown;
}

const store = new AsyncLocalStorage<TenantScopeFrame>();

/**
 * Exécute `fn` avec le cadre installé. Usage INTERNE à la couture (le service
 * de portée) : aucun module métier n'appelle ceci.
 */
export function runInTenantScope<T>(frame: TenantScopeFrame, fn: () => Promise<T>): Promise<T> {
  return store.run(frame, fn);
}

/**
 * Le cadre actif, ou `undefined` hors de toute portée. INTERNE.
 *
 * C'est la preuve d'AC-4 rendue triviale : hors de tout `run(...)`, il n'y a
 * pas de cadre, donc rien d'ambiant, donc les 782 sites d'appel non convertis
 * ne peuvent pas hériter d'une portée par accident.
 */
export function currentTenantScopeFrame(): TenantScopeFrame | undefined {
  return store.getStore();
}

/**
 * Une table que LES MODULES CONVERTIS touchent, verbe par verbe.
 *
 * S-E01-1e — cette phrase disait littéralement « les tables que le module
 * `calendar` converti touche ». Elle était vraie d'un module et fausse dès le
 * deuxième : `lessons` est converti depuis cette tranche, et la clôture est
 * désormais l'UNION des clôtures relationnelles de TOUS les modules convertis.
 * Un docblock qui nomme un module est un docblock qui périme au module suivant.
 */
export interface AppRolePrivilegeRequirement {
  readonly table: string;
  readonly privilege: string;
  readonly why: string;
}

/**
 * La CLÔTURE RELATIONNELLE des modules convertis, pas seulement leurs tables.
 *
 * `calendarEvent.findMany` embarque un `include` sur `cycle`, `gradeLevel` et
 * `classSection`, et la branche parent lit `enrollment`. Sous RLS, ces jointures
 * doivent PASSER pour `app_user` aussi : convertir un module, c'est convertir sa
 * clôture relationnelle, jamais sa seule table. C'est la phrase dont l'auteur du
 * module suivant a besoin.
 *
 * Vérifié contre `20260813120000_tenant_rls_policies` : toutes les tables citées
 * ici sont dans les 44 accordées à `app_user`.
 *
 * S-E01-5 — CETTE LISTE EST TENUE À LA MAIN, ET ELLE A DÉJÀ DÉCROCHÉ UNE FOIS.
 * Les sondes de propriété de `calendar.controller.ts` ont ajouté quatre tables
 * aux instructions émises DANS la portée ; trois y figuraient déjà par chance
 * (l'`include` de `list`), `academic_year` n'y figurait pas. Le couplage est
 * désormais TESTÉ — `calendar-scope-ownership.spec.ts` (AC-10) et
 * `lessons-scope-ownership.spec.ts` (AC-9) dérivent les privilèges des sites
 * d'appel `tx.<modèle>.<verbe>(` de leur contrôleur et exigent que cette liste
 * les couvre. Toute sonde ajoutée sans ligne ici vire au ROUGE.
 *
 * S-E01-1e — LE DEUXIÈME MODULE, ET POURQUOI SON ABSENCE ICI SERAIT UN 500 EN
 * MASSE PLUTÔT QU'UN REFUS. `appRoleVerdict` parcourt cette liste AU DÉMARRAGE :
 * une entrée manquante ne fait pas échouer la sonde, elle fait certifier
 * `enforcing: true` sur une clôture jamais vérifiée, et CHAQUE requête leçon des
 * trois portails rend alors « permission denied » (42501) — soit exactement le
 * défaut qu'`academic_year` a infligé à S-E01-5, un module plus loin.
 *
 * S-E01-1g — LE TROISIÈME MODULE, ET LA MOITIÉ DE LA RÈGLE QUE LES DEUX
 * PREMIERS N'AVAIENT PAS EU À ÉCRIRE : une entrée EN TROP est aussi
 * destructrice qu'une entrée manquante, et son rayon de souffle est le MÊME.
 * `appRoleVerdict` parcourt cette liste GLOBALEMENT au démarrage ; déclarer un
 * privilège que `app_user` ne détient PAS rend `refused_unusable`, et
 * `transactionRunnerOrNull()` lève alors un 503 pour calendar et lessons AUSSI,
 * pas seulement pour le module fautif. Les tables FK-dérivées (`announcement_
 * receipt`, `user_role`) ont un ensemble de privilèges CLOS sans `DELETE`
 * (ADR-042 §D5) : c'est là que la faute est la plus facile à commettre.
 *
 * S-E01-1k — CETTE LISTE N'EST PLUS SEULE À SE RELIRE. Elle reste écrite à la
 * main — une RAISON ne se dérive pas — mais elle est désormais comparée, DANS
 * LES DEUX SENS, à une clôture DÉRIVÉE du corpus par
 * `scripts/tenant-adversarial-check.js` (`derivePrivilegeClosure` /
 * `privilegeClosureDrift`, ADR-059). La dérivation part des sites d'appel
 * attribués EXACTEMENT `scoped` — jamais d'un grep `tx.`, qui confondrait la
 * portée locataire avec le `$transaction` du PROPRIÉTAIRE — puis elle DESCEND la
 * profondeur relationnelle que `where` / `select` / `include` / `orderBy` /
 * `_count.select` traversent, en résolvant chaque relation contre
 * `schema.prisma`. Une paire dérivée absente d'ici échoue (`undeclared-pair`) ;
 * une entrée d'ici que la dérivation ne voit pas échoue aussi
 * (`dead-entry-advisory`) — mais elle ne s'EFFACE PAS sur ce seul constat : la
 * dérivation est bornée par ce qu'une analyse statique peut voir, donc retirer
 * une paire exige un négatif MESURÉ (REVOKE sur une base jetable, le handler
 * toujours 200). Supprimer un droit sur la foi d'un `dead-entry` serait une
 * panne 42501 verte au démarrage, sur les quatre portails à la fois.
 *
 * CE QUE LA MÉCANISATION A TROUVÉ DÈS SON PREMIER PASSAGE : `guardian.SELECT`.
 * Trente-sept entrées relues à la main sur cinq tranches, et la trente-huitième
 * a été nommée par la machine en une exécution. C'est la mesure du défaut, pas
 * une anecdote.
 */
export const APP_ROLE_REQUIRED_PRIVILEGES: readonly AppRolePrivilegeRequirement[] = Object.freeze([
  // ── calendar (S-E01-1d, S-E01-5) ────────────────────────────────────────
  { table: 'calendar_event', privilege: 'SELECT', why: 'list + les deux gardes findUnique' },
  // S-E01-1e — ces trois raisons disaient « create » / « update » / « remove »,
  // soit le nom du handler et rien de plus. La garde anti-vacuité d'AC-9 les a
  // refusées (6 caractères), et elle a eu raison : une raison qui répète le verbe
  // n'apprend rien à qui relit cette liste pour décider si une entrée est encore
  // due. Dette PRÉEXISTANTE de S-E01-5, corrigée ici parce que c'est la garde de
  // cette tranche qui l'a levée — pas parce que cette tranche l'a produite.
  {
    table: 'calendar_event',
    privilege: 'INSERT',
    why: '`createEvent` écrit la ligne DANS la portée, après ses sondes de propriété',
  },
  {
    table: 'calendar_event',
    privilege: 'UPDATE',
    why: '`update` réécrit la ligne dans la MÊME portée que sa lecture de garde (pas de TOCTOU)',
  },
  {
    table: 'calendar_event',
    privilege: 'DELETE',
    why: '`remove` supprime après la garde findUnique, dans la portée qui l’a lue',
  },
  {
    table: 'enrollment',
    privilege: 'SELECT',
    why: 'branche parent de calendar/list (G-PORTAL) ET branche `studentId` de lessons/list',
  },
  {
    table: 'class_section',
    privilege: 'SELECT',
    why: 'include de calendar/list + sonde de propriété + include de lessons/list et /getOne ; ' +
      'S-E01-1g — ET la sonde `classSectionId` d’announcements/create : sans elle, aucune ' +
      'annonce de classe ne peut plus être rédigée par un enseignant',
  },
  {
    table: 'cycle',
    privilege: 'SELECT',
    why: 'include de calendar/list + sonde de propriété + include imbriqué de lessons/getOne ; ' +
      'S-E01-1g — ET la sonde `cycleId` d’announcements/create, qui refuse avant d’écrire',
  },
  {
    table: 'grade_level',
    privilege: 'SELECT',
    why: 'include de calendar/list + sonde de propriété + include imbriqué de lessons/getOne ; ' +
      'S-E01-1g — ET la sonde `gradeLevelId` d’announcements/create',
  },
  {
    table: 'academic_year',
    privilege: 'SELECT',
    why: 'S-E01-5 — sonde de propriété de `createEvent` : sans ce privilège, la sonde ' +
      'lève permission denied sur CHAQUE création d’événement dès que RLS est enforcé',
  },
  // ── lessons (S-E01-1e) ──────────────────────────────────────────────────
  // Verbe par verbe, et chacun avec SA raison : un `SELECT` accordé sur une
  // table ÉCRITE passait l'ancien contrôle par table (c'est PF-193).
  {
    table: 'lesson_entry',
    privilege: 'SELECT',
    why: 'lessons/list (findMany), lessons/getOne + les gardes findUnique d’update et de remove',
  },
  { table: 'lesson_entry', privilege: 'INSERT', why: 'lessons/create' },
  { table: 'lesson_entry', privilege: 'UPDATE', why: 'lessons/update' },
  { table: 'lesson_entry', privilege: 'DELETE', why: 'lessons/remove' },
  {
    table: 'teaching_assignment',
    privilege: 'SELECT',
    why: 'garde de propriété de lessons/create (findFirst id+tenantId) ET include de list/getOne — ' +
      'sans elle, aucune leçon ne peut être créée ni affichée avec sa matière',
  },
  {
    table: 'class_session',
    privilege: 'SELECT',
    why: 'S-E01-1e / PF-217 — sonde de propriété du `classSessionId` fourni : sans ce privilège, ' +
      'la sonde lève permission denied sur CHAQUE création de leçon rattachée à une séance',
  },
  // ── `guardianship.SELECT` et `guardian.SELECT` : SUPPRIMÉES par `S-E03-2`, sur
  //    un négatif MESURÉ — jamais sur le seul `dead-entry-advisory` (`PF-355`).
  //
  // POURQUOI ELLES EXISTAIENT. Toutes deux servaient UN site : la garde ABAC
  // parent de `lessons/list`, un `tx.guardianship.findFirst` DANS
  // `this.scope.run`, dont le `where` portait `guardian: { userProfileId }` —
  // un filtre RELATIONNEL, donc une LECTURE de `guardian`, invisible à trois
  // relectures humaines parce qu'aucun `tx.guardian.<verbe>(` n'existe nulle
  // part. `S-E03-2` / `AC-2` a HISSÉ cette garde hors de la portée vers
  // `StudentAccessService`, qui lit sur la connexion du PROPRIÉTAIRE
  // (`ADR-071 §D2`). Le dernier consommateur de portée a donc disparu, et le
  // cliquet `tenant adversarial` l'a signalé au land — la dérivation a vu juste.
  //
  // POURQUOI LA SUPPRESSION EST LÉGITIME ICI ALORS QUE LE CLIQUET L'INTERDIT
  // SUR LE SEUL AVIS. Son message est explicite : *« removal requires a MEASURED
  // negative (REVOKE on a scratch database and the module's handler still
  // 200) … either the pair is genuinely dead, or the walker is blind to the
  // construct that needs it — and the second case is a 42501 on four portals »*.
  // Ce négatif a été EXÉCUTÉ, le 2026-08-25, contre la pile locale, avec
  // `DATABASE_URL_APP` ACTIVE (les sites convertis tournent bien en `app_user`
  // sous RLS — sans quoi la mesure n'aurait rien mesuré) :
  //
  //   1. BASELINE, droits détenus — 12 appels, 3 principals, tous les modules
  //      convertis (lessons ×4, calendar ×2, announcements ×2, alerts ×2,
  //      meeting-requests ×2) : `200,200,200,200,200,200,200,200,200,404,403,200`.
  //   2. NÉGATIF, `REVOKE SELECT ON guardianship, guardian FROM app_user` :
  //      matrice **IDENTIQUE À L'OCTET**. Le consommateur NOMMÉ par l'ancienne
  //      raison — `GET /lessons?studentId=` en parent — rend toujours 200.
  //   3. CONTRÔLE POSITIF, parce qu'un négatif incapable de rougir ne prouve
  //      rien : `REVOKE SELECT ON lesson_entry` (un privilège que la portée
  //      exerce réellement) → `500,500,500,500,…`, les QUATRE cas `lessons` en
  //      échec, sur l'endpoint même qui vient de survivre. L'instrument voit
  //      donc bien un 42501 quand il y en a un.
  //   4. Les trois GRANT ont été RESTAURÉS et la matrice re-vérifiée identique
  //      à la baseline. Les droits SQL n'ont pas bougé — c'est la DÉCLARATION
  //      qui change, pas la permission (`AC-2` compare la matrice réelle à un
  //      ensemble CLOS, et cet ensemble est inchangé).
  //
  // CE QUI RESTE VRAI, ET QU'IL NE FAUT PAS PERDRE AVEC CES DEUX ENTRÉES : un
  // filtre relationnel EST une lecture de la table cible. Le jour où une
  // instruction de portée refiltre sur `guardian`/`guardianship`, il faudra
  // les redéclarer — la dérivation le dira, comme elle l'a dit ici.

  {
    table: 'subject',
    privilege: 'SELECT',
    why: 'include de lessons/list et /getOne — la matière est ce que le parent lit en premier',
  },
  {
    table: 'teacher_profile',
    privilege: 'SELECT',
    why: 'include de lessons/list et /getOne (le nom du professeur affiché sur chaque entrée)',
  },
  {
    table: 'user_profile',
    privilege: 'SELECT',
    why: 'include imbriqué `teacherProfile.userProfile` de lessons/list et /getOne — la jointure ' +
      'qui porte firstName/lastName ; à ne PAS confondre avec `ensureUser`, qui lit la même table ' +
      'mais HORS de toute portée, sur la connexion du propriétaire (PF-199) ; S-E01-1g — ET la ' +
      'sonde `userProfileId` d’announcements/create, la SEULE vérification possible sur une ' +
      'colonne qui n’a AUCUNE clé étrangère au schéma',
  },
  // ── announcements (S-E01-1g) ────────────────────────────────────────────
  // CINQ handlers convertis : `unreadCount`, `create`, `update`, `publish`,
  // `markRead`. Chaque entrée ci-dessous est EXERCÉE par un site d'appel converti
  // du MÊME diff — l'inverse de la forme PF-219, et vrai seulement parce que la
  // partition est étroite. Ce qui est délibérément ABSENT est aussi une décision :
  //   • `announcement.DELETE`          — `remove` n'est PAS converti (la cascade
  //     vers `announcement_receipt`, sur lequel `app_user` ne détient PAS DELETE,
  //     est ATTENDUE passante par le trigger RI mais n'est PROUVÉE nulle part) ;
  //   • `announcement_receipt.DELETE`  — l'ensemble accordé est CLOS sur
  //     `SELECT, INSERT, UPDATE` (migration dérivée :371). Déclarer ce privilège
  //     ferait rendre `refused_unusable` à la sonde de démarrage, donc un 503 sur
  //     calendar ET lessons AUSSI : cette liste est GLOBALE, pas par module ;
  //   • `announcement_receipt.INSERT`  — accordé, mais écrit uniquement par
  //     `materialiseReceipts`, hors portée. Une entrée qu'aucune instruction de
  //     portée n'exerce certifie une clôture que personne ne vérifie ;
  //   • `user_role`, `role`, `notification` — atteints seulement par `getOne`,
  //     `previewRecipients` et `publishInternal`, tous les trois exclus par
  //     mécanisme nommé.
  {
    table: 'announcement',
    privilege: 'SELECT',
    why: 'gardes findUnique d’update et de publish, ET le filtre de JOINTURE `announcement: {…}` ' +
      'du compteur de non-lus — que le cliquet dérivé de `tx.<modèle>.<verbe>(` ne peut PAS ' +
      'voir : sans ce privilège le badge des portails parent et élève rend permission denied',
  },
  {
    table: 'announcement',
    privilege: 'INSERT',
    why: 'la rédaction écrit la ligne DANS la portée, après sa sonde de propriété — c’est le seul ' +
      'moment où un id de portée étranger peut encore être refusé sans oracle d’existence',
  },
  {
    table: 'announcement',
    privilege: 'UPDATE',
    why: 'la modification réécrit la ligne dans la MÊME portée que sa lecture de garde : sans ce ' +
      'privilège la garde passerait et l’écriture qu’elle autorise échouerait, fenêtre TOCTOU ' +
      'rouverte au passage',
  },
  {
    table: 'announcement_receipt',
    privilege: 'SELECT',
    why: 'garde d’unicité du marquage « lu » (clé announcementId_userProfileId) et comptage des ' +
      'non-lus : sans elle un parent ne peut plus ouvrir une communication qui lui est adressée',
  },
  {
    table: 'announcement_receipt',
    privilege: 'UPDATE',
    why: 'le marquage « lu » est un SOFT WRITE sur `read_at` — le seul retour que le portail ' +
      'parent renvoie à l’école, et la table ne porte AUCUN `tenant_id` (policy FK-dérivée)',
  },
  {
    table: 'student',
    privilege: 'SELECT',
    why: 'sonde de propriété du `studentId` d’une annonce individuelle : sans ce privilège, ' +
      'écrire à la famille d’UN élève devient impossible sur les quatre portails ; ' +
      'S-E01-1i — ET `resolveSelf`, la résolution de l’élève lié au compte appelant, qui ' +
      'précède CHAQUE lecture du portail élève',
  },
  // ── student-portal (S-E01-1i) ───────────────────────────────────────────
  // LE BRIEF EN ANNONÇAIT TROIS. IL EN FAUT CINQ, ET L’ÉCART EST MESURÉ.
  //
  // `NEXT.md` (run 66) dimensionnait cette tranche à « trois nouveaux droits :
  // grade.SELECT, attendance_record.SELECT, student_subject_snapshot.SELECT ».
  // Cette liste ne compte que les tables RACINES des `findMany`. Elle oublie les
  // relations que les `select` IMBRIQUÉS traversent, et sous RLS une relation
  // traversée est une table LUE : Prisma émet sa propre requête dessus, et sans
  // le privilège elle lève 42501. `/student/grades` descend
  // `grade -> assessment -> term` et `assessment -> teaching_assignment ->
  // subject` ; `subjectTrends` retraverse `grade -> assessment`. `assessment` et
  // `term` sont donc DUES, et elles manquaient au dimensionnement (PF-246).
  //
  // Les cinq sont VÉRIFIÉES DÉTENUES par `app_user` sur la base de la pile AVANT
  // d’être déclarées ici (`information_schema.role_table_grants`), pas après :
  // une entrée déclarée puis constatée manquante refuserait le démarrage.
  {
    table: 'grade',
    privilege: 'SELECT',
    why: '`/student/grades` — les notes PUBLIÉES de l’élève lui-même, et la retombée ' +
      'live de `subjectTrends` quand aucun snapshot n’est matérialisé',
  },
  {
    table: 'attendance_record',
    privilege: 'SELECT',
    why: '`/student/attendance` — « Mon assiduité » : sans ce privilège le portail élève ' +
      'rendrait un résumé à zéro absence, ce qui se lit comme une donnée et non comme une panne',
  },
  {
    table: 'student_subject_snapshot',
    privilege: 'SELECT',
    why: 'bloc A de `/student/dashboard` — la tendance par matière lit le snapshot ' +
      'année (termId=null) AVANT toute retombée sur les notes vives',
  },
  {
    table: 'assessment',
    privilege: 'SELECT',
    why: 'S-E01-1i — relation TRAVERSÉE, pas racine : chaque note de `/student/grades` ' +
      'et de la retombée de `subjectTrends` descend son `assessment` (titre, barème, ' +
      'coefficient). Absente du dimensionnement de la tranche ; elle est due',
  },
  {
    table: 'term',
    privilege: 'SELECT',
    why: 'S-E01-1i — relation traversée depuis `assessment` : le trimestre étiquette ' +
      'chaque ligne de notes rendue à l’élève. Absente du dimensionnement ; elle est due',
  },
  // ── remediation (S-E01-1j) ──────────────────────────────────────────────
  // SEPT entrées, 30 -> 37, et pas une de plus. `RemediationService` convertit
  // ses VINGT-TROIS instructions ; les NEUF tables que sa clôture touche déjà
  // (`student`, `subject`, `grade`, `assessment`, `teaching_assignment`,
  // `teacher_profile`, `academic_year`, `enrollment`,
  // `student_subject_snapshot`) sont DÉCLARÉES PLUS HAUT et ne sont pas
  // dupliquées — elles sont dues ICI aussi, pour des raisons relationnelles
  // vérifiées par LECTURE et non par confiance :
  //   • `student` + `subject`        — `PLAN_INCLUDE`, sur CHAQUE DTO de plan ;
  //   • `grade` + `assessment` + `teaching_assignment` — le `where` de
  //     `computeLiveSubjectBaseline` traverse le FILTRE relationnel
  //     `assessment: { teachingAssignment: { subjectId } }`, et son `select`
  //     descend `assessment.maxScore`. Un filtre relationnel est une LECTURE
  //     sous RLS, exactement comme un `include` (PF-246) ;
  //   • `teacher_profile` + `academic_year` + `enrollment` — les deux `where`
  //     d'`isTeacherOfStudent` traversent `academicYear: { status:'active' }` et
  //     `teacherProfile: { userProfileId }` depuis `enrollment` ;
  //   • `student_subject_snapshot` — le point-read de `readSubjectAverage`.
  //
  // CE QUI EST DÉLIBÉRÉMENT ABSENT, et c'est une décision, pas un oubli :
  //   • AUCUN `DELETE` — ce service n'a aucun chemin de suppression. `app_user`
  //     détient pourtant les QUATRE verbes sur les cinq tables (mesuré) : une
  //     entrée `DELETE` démarrerait donc au VERT et serait MORTE, et une entrée
  //     morte ne peut plus faire échouer le contrôle d'égalité d'ensembles que
  //     PF-246 / PF-219 existent pour acheter ;
  //   • `booking.INSERT` / `booking.UPDATE` — le chemin d'écriture de
  //     réservation vit dans `booking.service.ts`, que cette tranche ne convertit
  //     PAS. Le déclarer certifierait une clôture qu'aucune instruction de portée
  //     n'exerce ;
  //   • `alert_instance.UPDATE` — NOTE CADUQUE, corrigée en S-E01-1l. Elle
  //     disait « sa mutation appartient au module alerts, NON CONVERTI » ; le
  //     module l'est depuis, et la paire est déclarée dans le bloc `alerts`
  //     ci-dessous. Une exclusion motivée par « pas encore converti » périme au
  //     module suivant : elle est corrigée dans le diff qui la périme, jamais
  //     laissée à faire lire « non converti » d'un module qui l'est.
  //
  // Les sept paires sont VÉRIFIÉES DÉTENUES sur la base de la pile AVANT d'être
  // déclarées (`information_schema.role_table_grants` : 20/20 sur les cinq
  // tables), pas après — une entrée déclarée puis constatée manquante rendrait
  // `refused_unusable`, donc un 503 sur calendar, lessons, announcements ET
  // student-portal aussi. Cette liste est GLOBALE, jamais par module.
  {
    table: 'alert_instance',
    privilege: 'SELECT',
    why: '`promotePlan` RÉSOUT le diagnostic depuis l’alerte (student, subject et school ' +
      'dérivés du serveur, jamais du client) : sans ce privilège plus AUCUNE alerte n’est ' +
      'promouvable en plan, et le bouton « agir » du tableau de bord parent — la promesse ' +
      'du produit — rend permission denied au lieu d’un plan',
  },
  {
    table: 'remediation_plan',
    privilege: 'SELECT',
    why: 'la garde d’idempotence de la promotion, la relecture du GAGNANT après P2002, ' +
      '`getPlan` / `listPlansForStudent` / `loadPlanForLifecycle` / `loadPlanForBooking`, et ' +
      'les plans ouverts de la bande de progression — ET les deux `updateMany`, dont le ' +
      '`WHERE` exige `SELECT` sur les colonnes qu’il lit (ADR-058 §D5) : rogner ce ' +
      '« SELECT redondant » ferait basculer toute l’application en refused_unusable',
  },
  {
    table: 'remediation_plan',
    privilege: 'INSERT',
    why: 'la promotion écrit la ligne DANS la portée : c’est le `WITH CHECK` de la policy qui ' +
      'refuse un GUC étranger, et l’`include` de la création fait un `INSERT … RETURNING`, ' +
      'qui exige en plus le SELECT déclaré ci-dessus',
  },
  {
    table: 'remediation_plan',
    privilege: 'UPDATE',
    why: 'les `updateMany` gardés par le statut de DÉPART de `closePlan` / `reopenPlan` ' +
      '(idiome ADR-020) — la garde EST l’écriture, donc sans ce privilège clôturer ou ' +
      'rouvrir un plan devient un 42501 sur les portails parent ET admin, là où le produit ' +
      'promet une boucle réversible',
  },
  {
    table: 'booking',
    privilege: 'SELECT',
    why: 'la lecture GROUPÉE des séances de la bande de progression (séances prévues / faites / ' +
      'prochaine date, une seule requête pour tous les plans ouverts) et les deux lectures ' +
      'groupées du catalogue (sièges restants par créneau, réservation propre du parent) : ' +
      'sans elle le catalogue afficherait « Indisponible » sur chaque créneau libre',
  },
  {
    table: 'tutor',
    privilege: 'SELECT',
    why: 'le `findMany` des tuteurs publiés du catalogue ET la relation `tutor` TRAVERSÉE par ' +
      'le `select` imbriqué de `loadBookableAvailability` — une relation traversée est une ' +
      'table lue (ADR-057 §D1) : sans elle le mur enseignant du chemin de réservation ne ' +
      'peut plus lire la liaison du tuteur',
  },
  {
    table: 'tutor_availability',
    privilege: 'SELECT',
    why: 'l’`include: { availabilities }` du catalogue et le `findFirst` de ' +
      '`loadBookableAvailability` : sans ce privilège aucun créneau n’est affichable ni ' +
      'réservable, et la boucle alerte → plan → séance s’arrête à la moitié',
  },
  // ── alerts (S-E01-1l) ───────────────────────────────────────────────────
  // NEUF entrées, 38 -> 47, et pas une de plus. `AlertsService` convertit 26 de
  // ses 32 instructions et `MeetingRequestsService` les CINQ siennes ; les
  // tables que leur clôture relationnelle traverse déjà (`student`, `subject`,
  // `class_section`, `enrollment`, `academic_year`, `teaching_assignment`,
  // `teacher_profile`, `user_profile`, `alert_instance` en SELECT, `grade` —
  // via aucune relation ici) sont DÉCLARÉES PLUS HAUT et ne sont pas dupliquées.
  //
  // CORRECTION `S-E03-2` (`PF-355`) : cette liste citait aussi `guardianship`,
  // et c'était FAUX — au sens où cette phrase a failli faire garder deux entrées
  // mortes. Le seul accès d'`AlertsService` à `guardianship` est
  // `alerts.service.ts:1029`, un `this.prisma.guardianship.findMany` sur la
  // connexion du PROPRIÉTAIRE (le fan-out de notifications), pas une instruction
  // de portée — et le chemin `evaluateAll` est de toute façon ÉNUMÉRÉ HORS
  // PORTÉE, comme le dit déjà le bloc « délibérément absent » plus bas. Aucune
  // instruction `tx.*` de ce module ne lit `guardianship`. Mesuré, pas relu :
  // `REVOKE SELECT ON guardianship, guardian FROM app_user` laisse la matrice
  // des 12 appels IDENTIQUE, tandis qu'un `REVOKE` sur `lesson_entry` la fait
  // rougir — voir le négatif exécuté au bloc `guardianship`/`guardian` supprimé.
  //
  // CES NEUF PAIRES NE SONT PAS DEVINÉES : elles sont celles que
  // `scripts/tenant-adversarial-check.js` a DÉRIVÉES du corpus après la
  // conversion (`undeclared-pair` × 9, exécuté le 2026-08-23 contre le
  // conteneur `pilotage_postgres`), puis déclarées à l'identique. L'égalité
  // d'ensembles étant BIDIRECTIONNELLE depuis ADR-059, une paire de trop
  // échouerait tout autant qu'une paire manquante.
  //
  // VÉRIFIÉES DÉTENUES AVANT DÉCLARATION (mesuré le 2026-08-23,
  // `information_schema.role_table_grants`, grantee `app_user`) :
  //   alert_rule      → SELECT, INSERT, UPDATE, DELETE
  //   alert_instance  → SELECT, INSERT, UPDATE, DELETE
  //   meeting_request → SELECT, INSERT, UPDATE, DELETE
  //   audit_log       → SELECT, INSERT  ← et RIEN D'AUTRE, délibérément
  //                     (ADR-037 §D4 / GUARDRAILS §1 : la chaîne de hachage
  //                     d'audit ne doit pas devenir réinscriptible). Aucune
  //                     entrée `audit_log.UPDATE` / `.DELETE` n'est déclarée
  //                     ici, et il ne faut JAMAIS en ajouter une : la matrice
  //                     la retient, donc la sonde rendrait `refused_unusable`
  //                     et 503 sur les QUATRE portails, pas seulement alerts.
  //
  // CE QUI EST DÉLIBÉRÉMENT ABSENT :
  //   • `audit_log.UPDATE` / `audit_log.DELETE` — voir ci-dessus ;
  //   • tout `DELETE` — aucun chemin de suppression n'existe dans les deux
  //     services convertis ; `app_user` détient pourtant DELETE sur les trois
  //     tables non append-only, donc une telle entrée démarrerait au VERT et
  //     serait MORTE (elle ne pourrait plus faire échouer l'égalité) ;
  //   • `guardianship` / `notification` du chemin `evaluateAll` — ce chemin est
  //     ÉNUMÉRÉ hors portée (ADR-060 §D1), et déclarer un privilège qu'aucune
  //     instruction de portée n'exerce certifierait une clôture non vérifiée.
  {
    table: 'alert_rule',
    privilege: 'SELECT',
    why: '`ensureRules` inventorie les règles du tenant, `updateRule` résout la ligne à écrire par ' +
      'sa clé composée nullable, et la relecture qui suit la matérialisation les rend au portail ' +
      'admin : sans ce privilège l’écran « Règles d’alerte » ne s’ouvre plus du tout',
  },
  {
    table: 'alert_rule',
    privilege: 'INSERT',
    why: 'les huit règles par défaut sont MATÉRIALISÉES au premier accès plutôt qu’au moment de ' +
      'l’installation (`createMany`, sans RETURNING donc sans SELECT de retour) — sans ce droit, ' +
      'un tenant neuf n’acquiert jamais de règles et n’émet donc JAMAIS d’alerte',
  },
  {
    table: 'alert_rule',
    privilege: 'UPDATE',
    why: 'activer une règle, changer sa sévérité ou ses seuils — la seule commande que l’école a ' +
      'sur ce que la plateforme lui signale ; l’écriture partage la portée de sa lecture de garde, ' +
      'donc sans ce droit la garde passerait et l’écriture qu’elle autorise lèverait 42501',
  },
  {
    table: 'alert_instance',
    privilege: 'UPDATE',
    why: 'les transitions acquitter / résoudre / rejeter, écrites dans la MÊME portée que le ' +
      '`findFirst` gardé par `tenantId` qui les ancre (l’`update` ne porte qu’un `id`, donc c’est ' +
      'cette lecture qui ferme la fenêtre TOCTOU). Exercé depuis les portails admin, enseignant ET ' +
      'parent : sans ce droit, la boucle « information → action » s’arrête sur son premier geste',
  },
  {
    table: 'meeting_request',
    privilege: 'SELECT',
    why: 'la garde d’idempotence de l’intention de rendez-vous, la relecture du GAGNANT après ' +
      'P2002, le marqueur « Demande envoyée » rechargé par le parent, et la file d’action ' +
      'enseignant/admin avec son compte — huit sites de portée ; c’est aussi le SELECT qu’exigent ' +
      'l’`INSERT … RETURNING` de la création et le `WHERE` de la résolution (ADR-060 §D2)',
  },
  {
    table: 'meeting_request',
    privilege: 'INSERT',
    why: 'la promotion de l’intention parentale en demande QUERYABLE, avec son assigné résolu côté ' +
      'serveur : c’est l’instruction qui fait exister « le parent a demandé à parler à ' +
      'l’enseignant », et son unicité `(tenant, alerte, demandeur)` est ce qui rend le double-clic ' +
      'inoffensif',
  },
  {
    table: 'meeting_request',
    privilege: 'UPDATE',
    why: 'la clôture open → resolved par l’enseignant ou l’admin, écrite dans la portée de la ' +
      'lecture filtrée par RÔLE qui interdit à un enseignant de fermer la file d’un autre — RLS ' +
      'isole le TENANT, jamais deux enseignants du même établissement',
  },
  {
    table: 'audit_log',
    privilege: 'INSERT',
    why: 'les trois lignes append-only qu’alerts écrit — `alert.meeting_intent`, les transitions ' +
      'de cycle de vie, et `meeting_request.resolve`. C’est la PREMIÈRE table franchement ' +
      'WRITE-ONLY à entrer dans une portée : ce module l’écrit et ne la lit jamais, ce qui rend la ' +
      'règle RETURNING de `VERB_PRIVILEGES` porteuse au lieu d’accidentelle (ADR-060 §D2)',
  },
  {
    table: 'audit_log',
    privilege: 'SELECT',
    why: 'PAS une lecture métier — il n’en existe AUCUNE ici — mais l’exigence du moteur : Prisma ' +
      'émet `INSERT … RETURNING` sur un `create` singulier, et PostgreSQL réclame SELECT sur toute ' +
      'colonne rendue. Rogner ce « SELECT redondant » ferait rendre `refused_unusable` à la sonde ' +
      'de démarrage et 503 sur les quatre portails ; l’ajouter n’élargit rien, la matrice ' +
      'l’accorde déjà (ADR-032 §D7 : append-only = SELECT, INSERT, et rien de plus)',
  },
]);

/** Ce que la sonde ramène de la connexion sous test. */
export interface AppRoleProbe {
  /** current_user MESURÉ sur la connexion, jamais déduit de l'adresse. */
  readonly currentUser: string | null;
  /** Le propriétaire RÉEL de `calendar_event`, lu au catalogue. */
  readonly tableOwner: string | null;
  readonly bypassRls: boolean;
  readonly memberOfOwner: boolean;
  /** Clé `table.PRIVILEGE` -> détenu ou non. */
  readonly privileges: Readonly<Record<string, boolean>>;
}

export interface AppRoleVerdict {
  readonly enforcing: boolean;
  /** `null` quand tout passe ; sinon la raison NOMMÉE du refus. */
  readonly reason: string | null;
}

export function privilegeKey(table: string, privilege: string): string {
  return table + '.' + privilege;
}

/**
 * Le verdict de la sonde, comme fonction PURE — donc pilotable par un spec avec
 * des entrées connues-fausses, sans base.
 *
 * TROIS familles d'échec, et aucune n'est un détail :
 *
 *  1. **Le propriétaire déguisé.** `DATABASE_URL_APP` peut être un copier-coller
 *     de `DATABASE_URL`, un super-utilisateur, ou un rôle `BYPASSRLS`. Le
 *     « second client » enforce alors ZÉRO pendant que chaque compteur dit
 *     « couvert ». On compare donc `current_user` au propriétaire RÉEL de
 *     `calendar_event` lu au catalogue — jamais à un nom de rôle écrit en dur,
 *     qui serait faux sur le premier cluster nommé autrement.
 *  2. **Le rôle connectable mais NON ACCORDÉ.** La migration RLS calcule
 *     `has_app_user` et, quand il est faux, émet un `RAISE NOTICE` en laissant
 *     `migrate deploy` passer au vert. Un cluster où `app_user` a été créé APRÈS
 *     cette migration a donc les 50 policies et ZÉRO grant : le client se
 *     connecte, et chaque requête calendrier échoue en permission denied. On
 *     teste le PRIVILÈGE, pas la connectivité.
 *  3. **La table absente.** Sans propriétaire lisible, il n'y a rien à comparer :
 *     l'état est inclassable, donc refusé (DNC-08).
 *
 * Ce que cette sonde NE prouve PAS, et il faut le dire ici plutôt que de le
 * laisser croire : elle ne montre pas les lignes APPARAÎTRE puis DISPARAÎTRE
 * selon le GUC. Ce contrôle positif appartient à la preuve exécutée
 * (`scripts/tenant-scope-check.js`, AC-2), pas à un démarrage de production.
 */
export function appRoleVerdict(probe: AppRoleProbe): AppRoleVerdict {
  if (probe.currentUser === null || probe.currentUser.length === 0) {
    return { enforcing: false, reason: 'la sonde n’a pas pu lire current_user sur la connexion' };
  }
  if (probe.tableOwner === null || probe.tableOwner.length === 0) {
    return {
      enforcing: false,
      reason:
        'le propriétaire de public.calendar_event est illisible (table absente ?) : ' +
        'l’état de la connexion est inclassable, donc refusé (DNC-08)',
    };
  }
  if (probe.currentUser === probe.tableOwner) {
    return {
      enforcing: false,
      reason:
        'la connexion est celle du PROPRIÉTAIRE des tables ; un propriétaire échappe à ses ' +
        'propres policies, la portée n’enforcerait rien',
    };
  }
  if (probe.bypassRls) {
    return { enforcing: false, reason: 'le rôle porte BYPASSRLS' };
  }
  if (probe.memberOfOwner) {
    return {
      enforcing: false,
      reason: 'le rôle est membre du propriétaire, donc porte ses privilèges par héritage',
    };
  }

  const missing: string[] = [];
  for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
    const key = privilegeKey(requirement.table, requirement.privilege);
    if (probe.privileges[key] !== true) missing.push(key);
  }
  if (missing.length > 0) {
    return {
      enforcing: false,
      reason:
        'privilège(s) manquant(s) sur la clôture relationnelle du module converti : ' +
        missing.join(', ') +
        '. Un rôle connectable mais non accordé rendrait "permission denied" sur chaque ' +
        'requête calendrier des quatre portails.',
    };
  }

  return { enforcing: true, reason: null };
}

/**
 * Ce que le log de démarrage a le droit de dire du réglage de pool.
 *
 * LECTURE SEULE, et c'est la règle, pas une pudeur : aucun code de cette story
 * ne COMPOSE une chaîne de connexion. Pas d'ajout de paramètre, pas d'analyse
 * suivie d'une reconstruction, pas de valeur par défaut. Du code capable de
 * composer une chaîne de connexion est du code capable de composer le MAUVAIS
 * RÔLE, et la posture d'ADR-032 §D2 est « refuser, jamais assainir ». Le
 * dimensionnement du pool se déclare DANS L'URL, là où Prisma le lit ; ici on se
 * contente de RELIRE ce que l'exploitant a écrit, pour pouvoir le dire.
 *
 * Ne rend QUE deux entiers. Jamais l'hôte, jamais la base, jamais le rôle,
 * jamais les identifiants — la ligne de log nomme un ÉTAT, pas une adresse.
 */
export function readPoolSettings(url: string): { connectionLimit: number | null; poolTimeout: number | null } {
  const limit = /[?&]connection_limit=(\d+)/.exec(url);
  const timeout = /[?&]pool_timeout=(\d+)/.exec(url);
  return {
    connectionLimit: limit === null ? null : Number(limit[1]),
    poolTimeout: timeout === null ? null : Number(timeout[1]),
  };
}
