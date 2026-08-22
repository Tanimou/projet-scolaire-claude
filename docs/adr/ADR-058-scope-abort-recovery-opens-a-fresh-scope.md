# ADR-058 — Une erreur rattrapée SORT de sa portée, et la récupération en ouvre une FRAÎCHE

- **Statut :** accepté
- **Date :** 2026-08-22
- **Tranche :** `S-E01-1j` — `RemediationService` entre dans la portée tenant sur ses 23 sites d'appel
- **Prolonge :** ADR-048 (la couture), ADR-049 §D4 (budget d'instructions), ADR-054 (conversion partielle),
  ADR-056 (la portée est une propriété du DÉPLOIEMENT), ADR-057 §D1/§D2/§D4 (clôture relation-profonde,
  portée dans le helper partagé, le constructeur comme preuve)
- **Qualifie :** ADR-057 §D2 (« l'imbrication est sûre si elle arrive »)

---

## Contexte

`RemediationService` est le **cinquième** module converti (après `calendar`, `lessons`, `announcements`,
`student-portal`). Son constructeur était `(private readonly prisma: PrismaService)` — **aucun collaborateur** —
et ses **23** instructions Prisma sont toutes converties, donc le constructeur devient
`(private readonly scope: TenantScopeService)` et la classe ne détient plus AUCUNE référence au client
propriétaire.

Ce module est aussi le **premier** converti qui **RATTRAPE des erreurs Prisma et CONTINUE**. Les quatre
précédents n'en rattrapaient aucune, et c'est pour cela que la règle ci-dessous n'avait encore jamais eu à
s'écrire.

Mesuré sur la base de la pile (conteneur `pilotage_postgres`, `app_user`) AVANT d'écrire une ligne :
`rolbypassrls = false`, RLS activée avec **1 policy `ALL`** (USING + WITH CHECK) sur les cinq tables
nouvelles, **20/20 grants** détenus, et **37/37** paires de la clôture élargie détenues. Aucun changement de
schéma, aucune migration : cette tranche n'en a besoin d'aucun.

---

## §D1 — LA DÉCISION : une erreur rattrapée doit propager HORS de sa portée

> **Un `catch` ne peut pas émettre d'instruction Prisma dans la portée dont l'instruction a levé. Le `try {`
> s'ouvre AVANT `await this.scope.run(…)`, le `catch` se ferme APRÈS, et l'instruction de récupération ouvre
> une portée FRAÎCHE.**

**Mécanisme.** `withTenant` ouvre une transaction **interactive** Prisma. Toute erreur l'**avorte** ; chaque
instruction suivante sur le même `tx` échoue en `25P02` (*current transaction is aborted, commands ignored
until end of transaction block*). Une récupération émise à l'intérieur ne rend donc pas la ligne voulue : elle
rend une seconde erreur, d'un type que personne n'attendait à cet endroit.

**Trois instances dans ce seul fichier**, chacune vérifiable en lisant le diff :

| # | Site | Ce que le rattrapage voulait faire | Ce qu'une portée unique en aurait fait |
|---|---|---|---|
| 1 | `promotePlan` — P2002 sur `create` → relecture du gagnant | rester idempotent sous course | **500** sous concurrence, exactement le défaut que la relecture existe pour éviter |
| 2 | `reopenPlan` — P2002 sur `updateMany` → sentinelle `'conflict_open_exists'` | rendre un 409 aimable | aujourd'hui la sentinelle sort tout de suite (le `COMMIT` dégénère en `ROLLBACK`) et *paraît* marcher — mais toute instruction ajoutée ensuite dans cette portée devient `25P02` |
| 3 | `readSubjectAverage` — échec du snapshot → retombée `computeLiveSubjectBaseline` | dégrader **gracieusement** vers les notes vives | la retombée meurt à son tour : la dégradation DÉLIBÉRÉE devient un `{avg:null}` **dur**, et la moitié « retombée » du lecteur cesse silencieusement d'exister |

Le cas 3 est ce qui fait de §D1 une exigence de **correction** et non de style.

**Qualification d'ADR-057 §D2.** ADR-057 écrit « l'imbrication est SÛRE si elle arrive », parce que `run` sur le
même tenant RÉUTILISE le cadre actif et n'ouvre pas de seconde transaction. C'est vrai des chemins de **succès**
(`resolveSelf`, qui n'avale rien). Ce n'est **pas** vrai quand l'appelé avale ses erreurs et continue : sa portée
interne devient un no-op, donc son `try/catch` n'isole plus rien de la transaction de l'appelant. ADR-057 n'est
pas faux ; il est **sous-spécifié**, et un lecteur qui prend sa phrase généralement écrira le bug.

**Remède INTERDIT (DNC-10).** On n'ajoute PAS un paramètre optionnel `tx?: Prisma.TransactionClient` aux helpers
pour que l'appelant enfile sa transaction. C'est la forme « sac d'options » que DNC-10 nomme, et ADR-057 §D2 a
déjà refusé l'alternative d'inlining pour la même famille de raison.

**Précondition ÉNONCÉE, faute de pouvoir la vérifier :** `promotePlan` ne doit pas être invoqué depuis
l'intérieur d'une portée du même tenant — le `run` de récupération recevrait alors la transaction avortée de
l'appelant. Les trois appelants d'aujourd'hui (le contrôleur, `analytics.service.ts:1207`,
`student-portal.service.ts:603`) sont tous DEHORS, vérifié ce run.

**Ce que la preuve peut et ne peut pas faire — `PF-247`.** Un faux `run` qui appelle `fn(client)` n'ouvre aucune
transaction, donc rien ne peut être avorté : **aucun test à faux client ne peut attraper cette faute.** La
propriété est donc asservie **lexicalement** dans `remediation-scope-ownership.spec.ts` (l'index du `try {`
précède celui du `this.scope.run(`, le `catch` suit, et aucun callback de portée ne contient de `catch`). C'est
un cliquet réel mais partiel, et `PF-247` enregistre le reste comme une **obligation de revue** que le matcher
dérivé ne voit pas.

---

## §D2 — La partition des portées, et le budget qui n'est PAS ré-amendé

Vingt portées pour vingt-trois instructions, toutes **séquentielles**, aucune imbriquée :

| Méthode | Portées | Instructions / portée |
|---|---|---|
| `promotePlan` | 4 (la 4ᵉ seulement sur le chemin P2002) | 1 / 1 / 1 / 1 |
| `getPlan`, `listPlansForStudent`, `loadPlanForLifecycle`, `loadPlanForBooking`, `loadBookableAvailability` | 1 chacune | 1 |
| `closePlan`, `reopenPlan` | 2 séquentielles | 1 / 1 |
| `remediationProgress` | 2 (+ les portées du helper partagé) | 1 / 1 |
| `catalogue` | 2 | 2 / ≤ 2 |
| `readSubjectAverage`, `computeLiveSubjectBaseline` | 1 chacune | 1 |
| `isTeacherOfStudent` | 1 | 2 |

**Le budget de trois instructions d'ADR-049 §D4 n'est pas approché et n'est PAS ré-amendé.** On le dit
explicitement parce qu'ADR-049 §D4 consigne qu'un budget ré-amendé en silence est la manière dont ADR-048 §D3
est devenu faux.

**`catalogue` — deux portées avec un calcul PUR entre les deux.** `resolveNextSessionAt` est une boucle CPU sur
les créneaux ; elle tourne **entre** la portée A (matière + tuteurs) et la portée B (réservations actives +
lignes du calleur), **hors** de toute transaction. Une boucle CPU dans une transaction interactive courrait
contre le timeout de 5 s pour rien. La borne du travail reste celle du **SCHÉMA** (le nombre de créneaux actifs
publiés) et non celle de la **REQUÊTE** : c'est l'invariant d'ADR-049 §D4, satisfait sans amendement.

**`remediationProgress` — la boucle n'est PAS enveloppée.** Une portée extérieure rendrait la portée interne du
lecteur partagé no-op (réutilisation du cadre), ce qui **ré-ouvre l'instance 3 de §D1**, et tiendrait N lectures
non bornées (`findMany` sans `take`) dans une seule transaction de 5 s, sur le chemin < 2 s du tableau de bord
parent. `portée tardive, fermeture précoce`. Coût énoncé plutôt que caché : le pire cas est **2 + 2·N**
transactions pour N plans ouverts.

**`closePlan` / `reopenPlan` — deux portées, pas une.** Aujourd'hui ces deux instructions ne partagent AUCUNE
transaction ; les fusionner ajouterait une atomicité que le code n'avait pas. La non-régression exigée par cette
tranche est byte-à-byte : deux portées courtes préservent le comportement observable, une portée unique le
changerait.

---

## §D3 — La clôture est RELATION-PROFONDE (deuxième application de PF-246)

`APP_ROLE_REQUIRED_PRIVILEGES` passe de **30 à 37**. Les sept nouvelles :
`alert_instance.SELECT`, `remediation_plan.SELECT/INSERT/UPDATE`, `booking.SELECT`, `tutor.SELECT`,
`tutor_availability.SELECT`.

**NEUF tables étaient déjà déclarées et ne sont pas dupliquées** — mais elles sont dues **ICI** aussi, et la
raison est relationnelle dans huit cas sur neuf :

| Table | Pourquoi elle est due dans CE module |
|---|---|
| `student`, `subject` | `PLAN_INCLUDE`, sur chaque DTO de plan |
| `grade` | racine de `computeLiveSubjectBaseline` |
| `assessment`, `teaching_assignment` | le `where` traverse le **FILTRE** relationnel `assessment: { teachingAssignment: { subjectId } }`, et le `select` descend `assessment.maxScore` |
| `teacher_profile` | `teacherProfile: { userProfileId }` dans `isTeacherOfStudent` |
| `academic_year` | `academicYear: { status: 'active' }` sur l'enrôlement |
| `enrollment` | racine du même `findFirst` |
| `student_subject_snapshot` | le point-read de `readSubjectAverage` |

**Un filtre relationnel dans un `where` est une LECTURE sous RLS**, exactement comme un `include` : c'est la
moitié de PF-246 que `S-E01-1i` avait rencontrée sur les `select` imbriqués, et qui se répète ici sur les
`where`. Le matcher dérivé `tx.<modèle>.<verbe>(` n'en voit **aucune** — d'où la liste NOMMÉE dans le spec.

**Ce qui est délibérément ABSENT.** Aucun `DELETE` (ce service n'a aucun chemin de suppression), pas de
`booking.INSERT`/`booking.UPDATE` (le chemin d'écriture vit dans `booking.service.ts`, non converti), pas
d'`alert_instance.UPDATE`. `app_user` détient pourtant les quatre verbes sur les cinq tables : une entrée
`DELETE` démarrerait donc au **vert** et serait **morte** — et une entrée morte ne peut plus faire échouer le
contrôle d'égalité d'ensembles que PF-246 / PF-219 existent pour acheter.

`ENUMERATED_OUTSIDE_SCOPE` n'est **pas** élargie. `booking.service.ts`, `teacher-remediation.service.ts`,
`admin-remediation.service.ts` et `booking-index.bootstrap.ts` gardent leur `PrismaService` ; leur seule raison
disponible serait « pas encore converti », et cette liste tient des raisons **structurelles** (ADR-048 §D6).

---

## §D4 — Le second module sans client propriétaire (ADR-057 §D4, appliqué)

`PrismaService` n'est plus injecté dans `RemediationService`. La classe **ne peut pas** atteindre la connexion
du propriétaire, quoi qu'un relecteur futur manque : c'est une propriété du constructeur, pas une convention.

**Ce que cette phrase ne dit PAS**, et il faut l'écrire ici : le **module** n'est pas isolé. Le contrôleur garde
son propre `PrismaService` — sa lecture d'alerte de garde (`remediation.controller.ts:92`, qui résout le
`studentId` pour `canAccessStudent`) et ses lignes d'`auditLog` restent sur la connexion du propriétaire, et
c'est **requis** par `portée tardive` : un mur ABAC ne peut pas tourner dans la transaction qu'il autorise. La
double lecture de l'alerte (contrôleur puis service) n'est donc pas un défaut, c'est la forme.

**Les gardes `tenantId:` explicites RESTENT** dans chaque `where` (25 occurrences). Elles ne sont pas rendues
redondantes par RLS : sur un déploiement où `DATABASE_URL_APP` n'est pas déclarée, `run` s'exécute sur le
propriétaire (ADR-056), qui échappe à ses propres policies. Les retirer ferait de l'isolation une propriété du
fichier d'environnement d'**un** déploiement — l'édition la plus destructrice disponible dans ce diff.

---

## §D5 — Conséquence SQL à écrire, sinon quelqu'un rognera « le SELECT redondant »

En PostgreSQL, `INSERT … RETURNING` exige `SELECT` sur les colonnes rendues, et `UPDATE … WHERE` exige `SELECT`
sur les colonnes que le prédicat lit. Le `create({ include: PLAN_INCLUDE })` et les deux `updateMany` **ont donc
besoin de `remediation_plan.SELECT`** même si aucun `findFirst` ne partageait leur transaction.
`remediation_plan.SELECT` est **obligatoire**, pas incident. Un relecteur futur qui le supprimerait comme
redondant ferait basculer TOUTE l'application en `refused_unusable`, donc un 503 sur calendar, lessons,
announcements et student-portal aussi — cette liste est GLOBALE.

---

## Conséquences

**Positives.** 23 sites d'appel passent de « non couverts » à « portés » (**47 → 70 sur 818**, dénominateur
inchangé, mesuré et non écrit). Le portail élève perd son dernier producteur sur connexion propriétaire pour le
bloc C. Une règle nouvelle et non évidente est écrite AVANT que quelqu'un la découvre en production.

**Négatives, énoncées.** `remediationProgress` ouvre `2 + 2·N` transactions courtes pour N plans ouverts, sur un
chemin < 2 s. Les trois `catch` de dégradation (`readSubjectAverage`, `computeLiveSubjectBaseline`,
`isTeacherOfStudent`) avalent désormais AUSSI un refus de portée (503) ou un `42501` : le comportement est
inchangé par cette tranche (la non-régression l'exige), mais la conséquence est nouvelle et enregistrée en
**`PF-248`** — pendant une fenêtre de mauvaise configuration un plan promu naîtrait avec un `baseline_avg` nul
**définitif**, et le mur enseignant répondrait « n'enseigne pas à cet élève » au lieu d'une panne. Le
resserrement de ces trois `catch` est une tranche à part.

**Retour arrière.** Remplacer les `this.scope.run(...)` par un client propriétaire ramène le service comme il
était. Aucun changement de schéma, aucune migration à défaire, aucun intercepteur à retirer — il n'y en a jamais
eu.

---

## Alternatives rejetées

1. **Une portée unique par méthode.** Casse les trois récupérations de §D1 et enjambe le calcul pur du
   catalogue.
2. **Envelopper la boucle de `remediationProgress`.** Rend la portée du helper no-op (ré-ouvre §D1 instance 3)
   et tient N lectures non bornées dans une transaction de 5 s.
3. **Inliner la portée du lecteur partagé à ses deux points d'appel.** Achèterait un numérateur plus haut en
   grossissant le corpus — l'inflation de métrique qu'ADR-057 §D2 nomme.
4. **Un paramètre `tx?:` sur les helpers.** DNC-10, sac d'options sur la couture.
5. **Déclarer `DELETE` « par symétrie ».** Une entrée morte qu'aucun contrôle futur ne peut faire échouer
   (PF-219).
6. **Ajouter `school.SELECT` « pour la FK du plan ».** Inutile : les contrôles d'intégrité référentielle
   tournent comme le PROPRIÉTAIRE de la table et échappent à RLS (`force = false`, mesuré).
