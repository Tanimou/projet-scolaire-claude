# Pilotage Scolaire — Suivi d'exécution du plan de refonte

> Référence : `REDESIGN-PLAN.md` v2.0 + `ADMIN-DASHBOARD-PRODUCTION.md` (sprint production)
> Statut au terme de cette session : **Phases R0 → R5 + stubs R6-R8 + R9-R11 partiel + sprint Admin Dashboard production-quality + sprint Parent Settings + sprint Teacher Messaging Center**

---

## 🆕 Sprint Alert Audit Provenance (continuous-improvement)

Fermer la **dette P1 explicitement reportée** par le sprint précédent (Lifecycle Audit Trail, PR #98) : `writeAuditEntry` **asseverait** `actorRole:'school_admin'` + `portal:'admin'` en dur au lieu de les **dériver** du vrai appelant. Comme `alerts.write` est détenu par `school_admin` **et** `super_admin` (qui hérite de toutes les permissions), et qu'un rôle custom `teacher` (ADR-015) peut aussi le porter, le journal append-only attribuait à tort ces actions à un `school_admin` — atteinte à l'honnêteté de provenance (cahier de charges §2.5).

### Livré
- **`apps/api/src/modules/alerts/alert-provenance.ts`** (NEW) : mapper pur `deriveAlertActorProvenance(jwt) → { actorRole, portal }`. Lit les rôles realm via l'idiome maison `jwt.realm_access?.roles ?? []` (identique à `PermissionsGuard`), résout le rôle **le plus privilégié** par précédence `super_admin > school_admin > teacher > parent` (indépendant de l'ordre → attribution déterministe), mappe vers un portail, et retombe sur `{ realmRoles[0] ?? null, portal: null }` pour un appelant inconnu. Ne throw jamais → sûr dans le chemin audit best-effort.
- **`apps/api/.../alerts.controller.ts`** : les 3 endpoints de cycle de vie (`acknowledge`/`resolve`/`dismiss`) dérivent `{ actorRole, portal }` du JWT et les passent au service, à côté de `tenantId`/`userProfileId` inchangés (issus de `ensureUser(jwt)`).
- **`apps/api/.../alerts.service.ts`** : signatures `acknowledge/resolve/dismiss` + `writeAuditEntry` étendues avec `actorRole/portal: string | null` ; les littéraux en dur remplacés par les valeurs passées. **Tous les invariants préservés** : tenant-scoping (`args.tenantId`, `findFirst` in-tenant avant mutation), best-effort try/catch (une panne d'audit ne rollback jamais la transition), garde `didTransition` (no-op → zéro ligne), `hash`/`prevHash` nuls.
- **Tests (30/30 verts)** : `alert-provenance.spec.ts` (NEW, matrice de précédence + fallbacks inconnu/vide/absent) ; `alerts.controller.spec.ts` (**NEW — ferme l'unique condition de merge du panel verify** : prouve que le contrôleur câble réellement `deriveAlertActorProvenance(jwt)` vers le service — teacher→teacher/teacher, super_admin→super_admin/admin, rôle inconnu→rôle brut/null, + sûreté tenant) ; `alerts.service.spec.ts` étendu (T5-T7 pass-through provenance incl. null).

### Décision de cadrage (assumée, autonome)
- **Path A (Winston)** : dérivation **locale au module alerts**, réutilisant le pattern « contrôleur dérive le contexte puis le passe au service » (déjà la norme : `me`/`schoolId`). **Pas de nouvel `AuditService` partagé, pas d'ADR** — généraliser aux 7 autres call sites (`invite`, `roles`, `academic-years`, `subjects`, `imports`, `assessments`) serait une nouvelle décision d'archi (ADR-019) hors scope. Documenté comme dette : le `audit_log` a désormais une sémantique de provenance **incohérente selon le writer** jusqu'au backfill.
- **FR2 > Critic** : sur appelant inconnu, `actorRole = realmRoles[0] ?? null` + `portal: null` (colonnes `String?` nullables) plutôt qu'un sentinel `'unknown'` — la spec FR2/AC4 fait autorité.

### État technique
- ✅ Typecheck `@pilotage/api` propre (Murat) · ✅ `nest build` OK · ✅ 30/30 tests alerts · ✅ `git diff --check` propre
- ✅ Seam disjoint = module `alerts` uniquement (6 fichiers) · aucune migration, aucun changement schéma/contracts/UI/scoping tenant
- ⚠️ PR #99 taguée **P1 / needs-human-review** (`[auth][audit]`) : panel PASS (CONCERNS) à l'unanimité ; les 2 points humains sont (a) promouvoir le helper + ADR-019 + backfill des 7 autres sites, ou accepter la dette cadrée ; (b) nit cosmétique du rôle technique Keycloak brut écrit en `actorRole`.

---

## 🆕 Sprint Alert Lifecycle Audit Trail (continuous-improvement)

Combler une **lacune de conformité R6** signalée comme dette dans les deux derniers run summaries : `AlertsService.acknowledge`/`resolve`/`dismiss` muent le statut d'une `AlertInstance` **sans écrire aucune entrée d'audit**, alors que le cahier de charges impose un audit **append-only sur toute action sensible** (DoD §14.2, project-context §2.5). Les transitions de cycle de vie d'alerte étaient donc invisibles dans le journal d'audit admin.

### Livré
- **`apps/api/src/modules/alerts/alerts.service.ts`** : nouvelle méthode privée `writeAuditEntry({ tenantId, alertId, actorId, action, beforeStatus, afterStatus })` qui fait un `prisma.auditLog.create` **inline** (réutilise la convention maison — il n'existe pas de `AuditService` partagé : voir `roles.controller.ts`, `imports.service.ts`, `academic-years.controller.ts`). Champs : `action` ∈ `alert.acknowledge|alert.resolve|alert.dismiss`, `resourceType: 'alert_instance'` (identique au littéral source déjà utilisé pour la rétraction de notification), `resourceId`, `before:{status}` → `after:{status}`, `actorRole:'school_admin'` + `portal:'admin'` (hardcodés comme tous les autres call sites), `hash`/`prevHash` laissés nuls.
- **Best-effort + post-update** : chaque écriture est encapsulée dans son propre try/catch (`logger.error` puis swallow), placée **après** l'`alertInstance.update` et indépendante de la rétraction de notification — une panne du journal d'audit ne rollback jamais la transition de statut ni ne remonte au contrôleur (réplique de la sémantique `markReadBySource`).
- **Garde de transition réelle sur `acknowledge`** : refactor en `const didTransition = row.status === 'open'` ; l'audit n'est écrit **que** sur la vraie transition `open → acknowledged`. Un re-acknowledge d'une alerte déjà close écrit **zéro ligne** → le journal append-only reste signifiant.
- **Tenant-scoping préservé** : `tenantId` porte toujours `args.tenantId` (dérivé du JWT côté contrôleur) ; l'id d'alerte est déjà confirmé in-tenant par le `findFirst({ where:{ id, tenantId } })` du caller (404 sur un id cross-tenant avant toute écriture).
- **Tests** : `alerts.service.spec.ts` étendu (+133) — `makeService(initialStatus)` paramétrable + mock `auditLog.create`. Matrice T1 (happy paths resolve/dismiss/acknowledge, assertion sur les champs exacts), T2 (no-op acknowledge sur `acknowledged`/`resolved` → zéro ligne), T3 (rejet de `auditLog.create` → la méthode renvoie quand même la ligne, ne throw pas), T4 (panne audit ⫫ panne rétraction notification, indépendantes). **13/13 verts.**

### Décision de cadrage (assumée, autonome)
- **`prisma.auditLog.create` inline, PAS de `AuditService`** : introduire une abstraction transverse serait une nouvelle décision d'archi (ADR requis) hors scope — Winston a tranché PASS sans ADR.
- **Best-effort, pas transactionnel** : Winston notait que `academic-years`/`imports` écrivent l'audit *dans* le `$transaction` (garantie plus forte). Choix conscient ici de la **disponibilité** (une panne d'audit ne doit pas empêcher un admin de résoudre une alerte), aligné sur la sémantique best-effort déjà en place pour la rétraction de notification dans ce même fichier. Documenté.
- **`actorRole`/`portal` hardcodés** (dette signalée) : exacts aujourd'hui (les 3 endpoints sont admin-only derrière `@RequiresPermission('alerts.write')`), mais **asseverés et non dérivés du JWT**. Le panel (Sentinel + Winston) note que si un chemin worker-cron / `grade.publish` / rôle custom non-admin pilote un jour ces transitions, le trail append-only attribuera à tort l'action à un `school_admin` — non corrigeable. À traiter au prochain sprint.
- **Hors scope volontaire** : garde `didTransition` sur `resolve`/`dismiss` (un double-resolve écrit aujourd'hui une ligne no-op `before===after` — bruit P2, pas une faille), le hash-chain `hash`/`prevHash`, l'extraction du littéral `'alert_instance'` en constante partagée.

### État technique
- ✅ Typecheck `@pilotage/api` (tsc --noEmit) propre · ✅ 13/13 tests ciblés · ✅ `git diff --check` propre · ✅ **`pnpm --filter @pilotage/api build` (nest build) OK**
- ✅ Seam disjoint = `apps/api` uniquement (2 fichiers) · aucune migration, aucun changement schéma/contracts/controller/module/UI/scoping tenant
- ⚠️ PR taguée **P1 / needs-human-review** (`[audit][security]`) : panel PASS/GO à l'unanimité (Winston + Sentinel + Murat), le seul point à valider côté humain est l'honnêteté de provenance `actorRole`/`portal`.

---

## 🆕 Sprint Alert-Rule Parameter Hardening (continuous-improvement)

Durcir le parsing des paramètres admin-tunables des règles d'alerte R6 contre le **JSONB non validé** `AlertRule.parameters` (couche de customisation ADR-013). Deux règles lisaient encore leurs seuils via un `Number(...)` brut sans garde finie/entière/positive : une valeur `0`, négative, NaN ou hors-échelle saisie par un admin pouvait **désactiver silencieusement** une règle ou **déclencher une alerte sur toute la cohorte** (+ notification de tous les tuteurs sur le chemin cron R8).

### Livré
- **`high-absence.rule.ts`** (copies API + worker) : `count` → fini + entier (`Math.floor`) + `>= 1` (défaut 5) ; `windowDays` → fini + entier + **borné `[1, 3650]`** (défaut 30). La borne supérieure évite qu'une valeur énorme mais finie (ex. `1e9`) ne fasse déborder `setUTCDate` en **Invalid Date** → Prisma rejetterait la requête et avorterait la règle sur le cron. Sans la borne, `count: 0` produirait `having gte: 0` (toute la cohorte).
- **`low-subject-avg.rule.ts`** (copies API + worker) : `threshold` → fini + `> 0` + `<= 20` (échelle de note, défaut 10), **non arrondi** (un seuil `9.5/20` est légitime). Ferme les deux modes : `<= 0` désactive silencieusement la règle (`avg < 0` ne matche jamais) ; `> 20` la déclenche sur tous les élèves.
- **Commentaires explicatifs** (rationale ADR-013) au-dessus de chaque garde, calqués sur le pattern déjà présent dans `missing-assessment.rule.ts` / `negative-trend.rule.ts`, pour qu'aucun lecteur ne réintroduise un `Number()` brut.
- **Parité** : les copies API et worker de chaque règle restent **byte-identiques** (vérifié par `git diff --no-index`) — le chemin manuel « Évaluer maintenant » (API) et le cron 15 min (worker) ne peuvent pas diverger.
- **Tests** : 2 nouveaux specs ciblés (`high-absence.rule.spec.ts`, `low-subject-avg.rule.spec.ts`, Prisma mocké, sans DB) en table : `0` / négatif / NaN / fractionnaire / hors-échelle / énorme-fini → défaut, et les valeurs valides passent inchangées. Assertion sur la valeur réellement remise à `groupBy` (HAVING) / au `context` de l'alerte. **21/21 verts.**

### Décision de cadrage (assumée, autonome)
- **Garde par-paramètre, pas uniforme** : `threshold` est borné `(0, 20]` (suivant AC1/AC5 du spec, qui exigent `threshold:0→10` et `threshold:25→10`) tandis que `count`/`windowDays` sont entiers `>= 1`. La borne supérieure `windowDays <= 3650` a été ajoutée au-delà du spec d'origine pour clore la dernière faille « Invalid Date » signalée par le gate (finding mineur folé avant merge).
- **Hors scope volontaire** : `repeated-failure.rule.ts` (déjà gardé), la dé-duplication de moteur API↔worker (extraction `@pilotage/alerts-core` différée), l'asymétrie email/préférences du chemin cron.

### État technique
- ✅ Typecheck monorepo 11/11 (api + worker recompilés) · ✅ 21/21 tests ciblés · ✅ `git diff --check` propre · ✅ parité API/worker confirmée
- ✅ Seam disjoint = 4 fichiers de règles (api + worker) + 2 specs · aucune migration, aucun changement schéma/contracts/controller/UI/scoping tenant
- R6 reste à **5/7 règles câblées** (ce sprint durcit l'existant, ne câble pas de nouvelle règle — les 2 restantes, `TEACHER_COMMENT_FLAG` / `BEHAVIOR_ALERT`, nécessitent un nouveau modèle Prisma absent)

---

## 🆕 Sprint Alert Resolution → Notification Retraction (continuous-improvement)

Fermer la **boucle de cycle de vie R6 → R8** côté lecture : quand un admin **résout** ou **rejette** une `AlertInstance`, les notifications cloche déjà émises vers les tuteurs (`sourceType='alert_instance'`, `sourceId=alertId`) restaient **non-lues à vie**. La cloche parent continuait donc d'afficher des alertes pour des événements clos (alors que `listForStudent` ne renvoie déjà plus que `open`/`acknowledged`).

### Livré
- **`apps/api/src/modules/notifications/notifications.service.ts`** : nouvelle méthode publique `markReadBySource({ tenantId, sourceType, sourceId })` — `updateMany` tenant-scopé, clé par la paire source `(sourceType, sourceId)` (et **non** par `userProfileId`, donc rétracte chez **tous** les tuteurs notifiés), garde `readAt: null` → idempotent (no-op sûr au double-resolve / à la course cron↔admin). Renvoie le nombre de lignes nouvellement lues.
- **`apps/api/src/modules/alerts/alerts.service.ts`** : `resolve` et `dismiss` appellent `markReadBySource` en **best-effort** (try/catch propre + `logger.error`) **après** la transition de statut — une panne de notification ne rollback jamais le changement de cycle de vie (réplique de la sémantique `dispatchEmails`). `acknowledge` reste **intentionnellement intact** (l'alerte est encore active → la cloche doit continuer de sonner).
- **Tests** : nouveau `alerts.service.spec.ts` (resolve/dismiss invoquent avec la clé source exacte, acknowledge non, rejet best-effort renvoie quand même la ligne mise à jour) + extension de `notifications.service.spec.ts` (where tenant-scopé, absence de `userProfileId`, no-op idempotent). 16/16 verts.
- **Fix annexe** : 3 erreurs strict-null pré-existantes (TS2532) dans `apps/worker/.../alerts-evaluator.notify.spec.ts` (`mock.calls[0]![0]`) → typecheck monorepo de nouveau vert (11/11).

### Décision de cadrage (assumée, autonome)
- **Asymétrie de cycle de vie volontaire** : seuls `resolve`/`dismiss` rétractent ; `acknowledge` garde la cloche allumée.
- **Pas d'entrée d'audit** sur la rétraction (différé en follow-up) et **pas de constante partagée** pour `'alert_instance'` (3 littéraux indépendants) — signalés comme dette à durcir au prochain sprint. Aucune migration, aucun changement de schéma/contracts/controller/wiring.

### État technique
- ✅ Typecheck monorepo 11/11 · ✅ 16/16 tests ciblés · ✅ `git diff --check` propre
- ✅ Seam disjoint = `apps/api` (+1 spec worker) · ✅ Réutilise `Notification` + `NotificationsService` déjà injecté
- ⚠️ PR taguée **P1 / needs-human-review** : `markReadBySource` est une mutation bulk cross-destinataires sans authz propre (correcte pour son unique appelant admin de confiance) ; à confirmer côté humain + l'absence d'audit trail.

---

## 🆕 Sprint Alert Cron → Parent Notification (continuous-improvement)

Fermer la boucle **R6 (moteur d'alertes) → R8 (notifications)** sur le chemin de production. Le moteur tourne en réel via un cron worker toutes les 15 min (`apps/worker/src/modules/alerts-cron/`), mais ce chemin créait des `AlertInstance` **sans jamais notifier les parents** : seul le bouton admin « Évaluer maintenant » (chemin API `AlertsService.evaluateAll` → `notifyGuardiansOfAlert`) déclenchait la cloche famille. En production, les alertes périodiques étaient donc silencieuses.

### Livré
- **`apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts`** : après chaque nouvelle `AlertInstance` créée (uniquement sur le chemin `created++`, pas sur le skip de dédup), fan-out d'une notification in-app par tuteur actif de l'élève — réplique de la sémantique API :
  - Tuteurs via `guardianship.findMany` scoping `tenantId` + `status:'active'` + `guardian.userProfileId != null`
  - Map sévérité `AlertSeverity → NotificationSeverity` : `low→info`, `medium→warning`, `high→danger`
  - Source-dédup `(tenantId, sourceType='alert_instance', sourceId=alertId, userProfileId∈destinataires)` pour ne jamais doubler une cloche au re-tick
  - Lien profond `/parent/recommendations?studentId=…`, `kind:'alert'`
  - **Best-effort** : tout `notifyGuardiansOfAlert` est encapsulé en try/catch + `logger.error` → une panne de notification ne rollback jamais l'`AlertInstance` et n'avorte jamais la boucle d'évaluation
  - `evaluateTenant` renvoie désormais `notified` (télémetrie) ; `alerts-cron.service.ts` l'agrège dans son log de tick
- **Test** `alerts-evaluator.notify.spec.ts` (6 cas, ts-jest, Prisma mocké, aucune DB) : map sévérité, fan-out + lien, source-dédup, skip tuteur sans compte, no-op si tous déjà notifiés, best-effort sur échec Prisma.

### Décision de cadrage (assumée, autonome)
- **Canal IN-APP uniquement.** Le canal **email** (BullMQ `dispatchEmails`) et le gate `NotificationPreference` restent **propriété de l'API** (`NotificationsService`). Les répliquer dans le worker dupliquerait la plomberie email et le store de préférences → différé en follow-up. L'email étant opt-in/désactivé par défaut, l'impact réel du chemin cron sans email est négligeable pour v1, et le chemin manuel continue d'emailer. Asymétrie **intentionnelle et documentée** (commentaire de code + ce log).

### État technique
- ✅ Typecheck worker (`tsc --noEmit`) propre
- ✅ 6/6 tests unitaires verts
- ✅ `git diff --check` propre
- ✅ Aucune migration Prisma, aucun changement `packages/contracts` (réutilise `Notification` + `Guardianship`)
- ✅ Seam disjoint = `apps/worker` uniquement (aucune touche `apps/api` / `apps/web`)

---

## 🆕 Sprint Teacher Messaging Center (continuous-improvement)

Combler le canal manquant **enseignant → familles**. Jusqu'ici `/teacher/messages` était un stub avec 4 KPI vides et un message « en cours de développement ». Pourtant le backend `announcement` supportait déjà `authorRoleHint=teacher` et le rôle Keycloak `teacher` avait la permission `announcements.write`.

### Livré
- **Backend `apps/api/src/modules/announcements/announcements.controller.ts`** :
  - `GET /api/v1/announcements?mine=true` — nouveau mode qui retourne les annonces dont l'auteur est l'utilisateur courant (brouillons inclus). Disponible pour admin et teacher.
  - `GET /api/v1/announcements/:id` — autorise désormais l'auteur (`a.authorId === me.id`) à voir son propre brouillon (auparavant non-admin devait avoir un receipt → l'auteur d'un brouillon n'en avait pas).
  - `POST /api/v1/announcements` — durcissement pour le rôle teacher :
    - Refus de `school_wide` et `individual_user` (ces portées restent admin-only)
    - Validation côté serveur que la `classSection` ciblée fait bien partie des affectations actives de l'enseignant (anti-spoof via UUID)
- **Frontend `/teacher/messages` (apps/web/src/app/teacher/messages/page.tsx)** réécrit :
  - 4 `<KpiCard>` réelles (messages publiés / brouillons / destinataires touchés / épinglés) calculées depuis l'API `?mine=true`
  - Table paginée 12/page avec colonnes Titre+extrait / Audience / Priorité / Destinataires / Date publication / Statut / Actions
  - Indicateurs visuels : icône pin ambre pour les annonces épinglées, `<StatusBadge>` publié/brouillon avec dot, line-clamp pour l'extrait
  - Bandeau bas ambre qui rappelle les brouillons en attente
  - CTA principal violet→indigo→bleu « Nouveau message »
- **Frontend `/teacher/messages/new` (apps/web/src/app/teacher/messages/new/page.tsx + NewMessageForm.tsx)** :
  - Récupère les affectations enseignant via `/api/v1/teachers/me/assignments`, déduplique en classes / niveaux / cycles
  - Garde anti-erreur : si l'enseignant n'a aucune affectation, EmptyState ambre explicite
  - Form 3 sections : Contenu (titre 200 cap + corps 10 000 cap avec compteur de caractères) / Destinataires & priorité (portée class/level/cycle uniquement) / Aperçu live coloré (chip portée + chip priorité + chip épinglé)
  - Soumission : « Enregistrer brouillon » (publishNow=false) ou « Publier maintenant » (déclenche le fan-out NotificationsService.createMany côté API → bell + portail famille)
- **Server actions** (`apps/web/src/app/teacher/messages/actions.ts`) : create / publish / delete avec revalidatePath
- **Composant client** `MessageRowActions.tsx` : Publier + Supprimer inline dans le tableau
- **Fix annexe** : caractère apostrophe non échappé dans `/teacher/reports/page.tsx:342` qui faisait planter `next build` (régression introduite dans le sprint précédent teacher-reports)

### Justification produit
Les enseignants étaient les seuls acteurs sans canal de communication structuré : ils devaient passer par l'administration pour diffuser une information à une classe (sortie, contrôle reporté, devoir, réunion). Cela créait des frictions sur des actions très fréquentes. Avec ce sprint :
- **Réactivité** : un prof peut prévenir 30 familles en 30 secondes sans solliciter l'admin
- **Boundary** : la portée est strictement limitée aux classes/niveaux/cycles où l'enseignant est affecté (le serveur valide à la création, pas seulement le client)
- **Notification unifiée** : la publication déclenche le même fan-out que les annonces admin (createMany NotificationsService) → la cloche + le centre de notifications côté parent fonctionnent immédiatement

### État technique
- ✅ Typecheck monorepo (11 tâches) propre
- ✅ Web build OK — les 2 nouvelles routes apparaissent dans le manifest (`/teacher/messages` 1.53 kB, `/teacher/messages/new` 4.13 kB)
- ✅ API build OK (nest build)
- ✅ Aucune migration Prisma (réutilise complètement `Announcement` + `AnnouncementReceipt` + `Notification`)
- ✅ Aucune cassure : la sémantique admin (`mine=false` par défaut) reste inchangée, le mode `mine=true` est purement additif

---

## 🆕 Sprint Parent Settings (continuous-improvement)

Combler l'asymétrie entre les 3 portails : Admin et Teacher avaient `/settings`, le portail famille n'en avait pas — alors qu'il représente la plus large audience.

### Livré
- **Nouvelle page `/parent/settings`** (`apps/web/src/app/parent/settings/page.tsx`) — 5 onglets :
  - **Mon profil** : hero bleu gradient (avatar grand format + nom + email + chips : nombre d'enfants rattachés, langue, MFA si actif) + 4 champs read-only + bandeau d'aide expliquant comment modifier nom/email
  - **Notifications** : réutilise `<PreferencesPanel>` (déjà partagé avec admin/teacher) + bloc "Pourquoi activer les notifications" gradient violet→bleu listant les 3 bénéfices clés pour les parents
  - **Ma famille** : liste des enfants rattachés (Avatar + classe active + cycle color + âge + date de naissance + lien rapide vers le tableau de bord enfant) + EmptyState avec CTA "Comment rattacher un enfant ?" si aucun rattachement
  - **Affichage** : EmptyState (cohérent avec teacher/admin — thème, densité, format dates à venir)
  - **Sécurité** : 4 champs (mot de passe / MFA / sessions / email) + bouton sombre "Ouvrir mon portail compte sécurisé" lien Keycloak account
- **Sidebar parent** : ajout de l'item `Paramètres` (icône `Settings`) en position 15 (`apps/web/src/components/shell/sidebar-items.ts:188`)
- **Revalidation cross-portail** : `preferences-actions.ts` revalide aussi `/parent/settings` après chaque toggle de préférence (auparavant admin + teacher seulement)
- **Cohérence visuelle** : même `<PageHeader>` breadcrumb / titre / sous-titre que `/teacher/settings` et `/admin/settings`. Mêmes radius `rounded-2xl`, mêmes anneaux `ring-1 ring-slate-200/60`, mêmes proportions de Field grid

### Justification produit
Les parents sont la cible primaire du portail : recevoir des alertes ciblées sur la scolarité de leurs enfants, gérer un canal de communication propre, et avoir un point d'accès consolidé pour la sécurité du compte. Sans page settings, le parent n'avait :
- aucun moyen de désactiver les notifications gênantes (ex. cours publiés tous les jours)
- aucun lien direct vers le portail compte Keycloak pour activer MFA
- aucune vue récapitulative des rattachements actifs

### État technique
- ✅ Réutilise `<PreferencesPanel>` (le backend `/api/v1/notifications/preferences` était prêt depuis R8.1, aucune migration nécessaire)
- ✅ Réutilise `/api/v1/students` (déjà filtré par `StudentAccessService` pour les parents) — pas de nouvel endpoint
- ✅ Réutilise `/api/v1/me` pour le profil
- ✅ Frontière server/client respectée : `PreferencesPanel` est le seul client component, le reste reste server-rendered

---

## 🆕 Sprint Admin Dashboard Production-Quality (post-R5)

Documentation détaillée : `docs/spec/ADMIN-DASHBOARD-PRODUCTION.md` + runbook `docs/spec/ADMIN-DASHBOARD-RUNBOOK.md`.

### Livré
- **Schema Prisma** : nouveau modèle `ExportJob` (kind enum + status enum + index sur tenant+createdAt) avec FK `requestedBy` vers `UserProfile`
- **`AnalyticsService.adminDashboard`** :
  - `recentAudit[]` enrichi avec `actorName` (jointure `actorId → UserProfile`) + `detail` (extrait du JSON `after`)
  - `recentExports[]` lit désormais le vrai modèle `ExportJob` avec mapping kind → 'xlsx'|'pdf'|'csv'
  - `enrollmentRequests[]` distingue rattachement vs inscription + statut (pending/to_verify/approved) via parsing JSON dans `Guardianship.notes`
- **Frontend admin dashboard** : suppression du bloc résiduel sr-only "Mes permissions"
- **Tokens design system** : sidebar dark navy plus profonde (`oklch(0.17 0.05 260)`) + active item plus contrasté (`oklch(0.40 0.16 260)`)
- **Seed démo (`apps/api/prisma/seed-demo.ts`)** : ~1170 lignes, idempotent, NODE_ENV=production guard
  - Tenant `voltaire-demo` + École `Lycée Voltaire`
  - 3 années scolaires (2021-22, 2022-23, 2023-24 active) + 3 trimestres
  - 3 cycles (Primaire / Collège / Lycée) + 44 niveaux (12/18/14)
  - 8 matières + coefficients par niveau (8 × 44 = 352 lignes `subject_coefficient`)
  - 94 class sections distribuées (6e/5e/4e/3e × 12 + Primaire × 24 + Lycée × 22)
  - 186 enseignants (5 nommés pour la table Affectations : M. Laurent, Mme Bernard, M. Girard, Mme Petit, M. Robert + 181 génériques)
  - Affectations pédagogiques : 10 nommées (matching table cible) + ~280 génériques
  - 2 458 élèves (624 primaire + 1344 collège + 490 lycée) avec enrollments actives, `createdAt` étalé sur 90 j pour sparklines
  - 2 458 parents + 28 demandes en attente (5 nommées : Sophie Martin / Karim Belkacem / Nadia Lefèvre / Julien Moreau approuvé / Fatou Diallo) avec metadata JSON (kind=rattachement/inscription, review=pending/to_verify/approved)
  - Assessments + notes calibrées Box-Muller pour atteindre exactement 82% Primaire / 74% Collège / 69% Lycée
  - 54 entrées d'audit (4 nommées avec dates 08 mai / 07 mai / 06 mai 2024 + 50 anciennes)
  - 3 ExportJob nommés (Résultats_3e_trimestre.xlsx, Bulletins_2e_trimestre.pdf, Absences_avril_2024.xlsx)
- **Provisioning Keycloak (`apps/api/prisma/seed-keycloak-users.ts`)** : crée `mme.dupont@voltaire.fr` + `m.lefebvre@voltaire.fr` (mot de passe `Demo!2024`), assigne le rôle `school_admin`, patche `UserProfile.authProviderId`
- **Scripts package.json** : `prisma:seed:demo` + `prisma:seed:keycloak`

### Comment l'utiliser
```bash
pnpm docker:up
cd apps/api
pnpm prisma:migrate:dev --name admin_dashboard_production
pnpm prisma:seed:demo
pnpm prisma:seed:keycloak
cd ../..
pnpm dev
# → http://localhost:3100/admin/login  (mme.dupont@voltaire.fr / Demo!2024)
```

### État technique
- ✅ Typecheck monorepo (11 tâches) propre
- ✅ Seeds typechecked via `tsc -p apps/api/prisma`
- ✅ Aucune migration cassante — `ExportJob` est purement additive
- ✅ Seed prod (`prisma:seed`) intact ; seed démo séparé sur tenant distinct (`voltaire-demo`)
- ✅ Idempotent : relançable sans pollution

### Reste à exécuter (côté utilisateur)
- Lancer la stack Docker + migrations + seeds (cf. runbook)
- Hard-reload (`Ctrl+Shift+R`) pour purger le cache CSS du dev server
- Comparer visuellement avec le screenshot cible

---

---

## ✅ Phases livrées

### R0 — Audit & fondations
- Audit du codebase existant (44 pages web, 14 modules API, 34 modèles Prisma)
- Dépendances installées :
  - **`recharts@^3.8.1`** (line/bar/donut/grouped bar charts dans `@pilotage/ui`)
  - **`date-fns@^4.1.0`** (formatage FR)
  - **`exceljs`** + **`@react-pdf/renderer`** (worker BullMQ R7 — installé, non encore utilisé)
  - **`@playwright/test@^1.60.0`** + **`@axe-core/playwright`** (smoke + a11y)
- Configuration `apps/web/playwright.config.ts`
- Tests E2E smoke + a11y (`apps/web/tests/e2e/smoke.spec.ts`) :
  - 3 logins (admin/teacher/parent) — rendu serveur
  - 3 violations critiques axe-core (wcag2a + wcag2aa) sur les login pages
- Scripts ajoutés à `package.json` :
  - `pnpm test:e2e`, `pnpm test:e2e:smoke`, `pnpm test:e2e:install`
- **Typecheck propre** sur les 4 workspaces (web, api, worker, ui)

### R1 — Design system
- **`packages/design-tokens/src/tokens.css`** réécrit v2 :
  - Surfaces (page, card, sidebar dark navy, tonal × 8 couleurs)
  - Ink (strong/default/muted/faint + on-sidebar variants)
  - Borders, Brand, Portal (admin/teacher/parent), Semantic (success/warning/danger/info), Subject (15 matières)
  - Radii, Shadows, Motion, Spacing, Typography
  - Variables de retro-compat (aliases v1) — aucune cassure
  - Portal accent swap via `[data-portal]`
- **`apps/web/src/app/globals.css`** étendu avec tous les tokens Tailwind v4
- **`packages/ui/src/lib/`** — nouveaux helpers :
  - `subject-color.ts` — résolveur stable pour 15 matières (avec alias FR + helper `subjectColor(code)`)
  - `grade-bucket.ts` — bucket Excellent/Satisfaisant/Insuffisant + `gradeVerdict()`
  - `format.ts` — `formatGrade`, `formatGradeOnTwenty`, `formatInt`, `formatPercent`, `formatDelta`, `deltaTone`, `formatDateShort/Long/Card`, `formatRelativeTime`, `formatInDays`
- **30 nouveaux composants** dans `packages/ui/src/components/` :
  - **Layout** : `AppShell`, `Sidebar`, `SidebarItem`, `Topbar`
  - **Atomes** : `Avatar`, `AvatarGroup`, `StatusBadge`, `DateCard`, `Tabs`, `SectionHeader`
  - **Charts** : `Sparkline` (SVG no-deps), `ProgressBar`, `DonutChart`, `LineChart`, `BarChart`, `GroupedBarChart`
  - **KPI** : `KpiCard`, `SubjectKpiCard` (image 6), `Stats2x2Grid`
  - **Cartes complexes** : `AlertCard` (image 7), `RecommendationCard`, `CommentsFeed` (image 7), `SubjectPerfCard` (image 7), `ChildProfileHero` (image 7)
  - **Spécialisés** : `Timeline`, `ActivityTimeline`, `EmptyState`, `Skeleton`/`LoadingCard`/`LoadingTable`, `ErrorState`, `MiniCalendar` (images 6, 7), `QuickActionsList` (image 6)
  - **Gradebook** : `GradePill` (inline editable), `EditableGradeTable` (image 6), `DataTable`
  - **Topbar widgets** : `YearSelector`, `NotificationBell`, `UserMenu`
  - **Sidebar footer** : `TipOfTheDayCard` (image 6), `HelpSidebarCard` (image 7)
- Re-export centralisé via `packages/ui/src/index.ts`
- `recharts` ajouté à `packages/ui` dependencies

### R2 — AppShell unifié
- **`apps/web/src/components/shell/`** (nouveau dossier) :
  - `AppShellRoot.tsx` — server component qui résout `auth() + me + branding`, monte sidebar + topbar
  - `PortalBrand.tsx` — logo + nom + role en haut de la sidebar dark
  - `sidebar-items.ts` — liste complète des items par portail (admin 17, teacher 10, parent 11) + helper `resolveActive(pathname)`
  - `TopbarBell.tsx` — client component qui polle `/api/proxy/v1/notifications/unread-count` toutes les 30 s
  - `TopbarUserMenu.tsx` — UserMenu lié à NextAuth `signOut`
  - `MobileSidebarToggle.tsx` — burger + drawer mobile (sidebar slide-in <lg)
- **`apps/web/src/components/PortalShell.tsx`** réécrit en alias léger qui délègue à `AppShellRoot`. Les 40+ pages existantes restent inchangées.
- **`apps/web/src/middleware.ts`** étendu pour injecter `x-pathname` (active sidebar item detection côté server component sans prop drilling)
- **`apps/web/src/app/api/proxy/[...path]/route.ts`** — proxy thin pour les fetches client-side authentifiés (sert TopbarBell)

### R3 — Admin Portal
- **Backend `apps/api/src/modules/analytics/`** :
  - `analytics.module.ts` + `analytics.service.ts` + `analytics.controller.ts`
  - `GET /api/v1/analytics/dashboard` → 5 KPI (élèves/profs/classes/demandes/alertes) + sparklines 30j + perf donut by cycle + structure + audit récent
  - `GET /api/v1/analytics/school-performance` → perf donut isolé
  - Compute logic : counts + cumulative sparklines + cycle-grouped success rate
- **Frontend `/admin/dashboard`** réécrit :
  - Setup checklist (conservé)
  - **5 `<KpiCard>` avec sparklines** (cf. §1.2 du plan)
  - `<DonutChart>` performance par cycle
  - `<ActivityTimeline>` audit récent
  - Structure école (mini-grid 6 cellules)
  - Permissions du user
  - Quick action cards
- **Nouvelles pages admin** (stubs prêts pour R6/R7) :
  - `/admin/enrollment-requests` — workflow demandes parents en attente (utilise `Guardianship` existant en backend)
  - `/admin/alerts` — règles d'alerte (4 règles par défaut décrites) + instances (empty state R6)
  - `/admin/exports` — 4 types d'export disponibles bientôt (R7)

### R4 — Teacher Portal (image 6 prescriptive)
- **Backend** : `GET /api/v1/analytics/teacher-dashboard` ajouté
  - `subjectStats` : 4+ subject KPI cards (classes + élèves par matière du prof)
  - `upcomingAssessments` : 5 prochaines évals
  - `recentActivity` : journal user-centric
- **Frontend `/teacher/dashboard`** réécrit pixel-correct image 6 :
  - **4 `<SubjectKpiCard>`** gradient subject-coloured (Mathématiques violet, Histoire-Géo cyan, Physique-Chimie teal, Français orange)
  - Card "Saisie rapide des notes" (raccourcis vers gradebook plein écran par classe)
  - Card "Classes enseignées" (regroupement par classSection)
  - `<ActivityTimeline>` activité récente
  - **Aside droit** : "Prochaines évaluations" avec `<DateCard>` colorées par matière + badge "Dans X jours"
  - `<QuickActionsList>` "Outils rapides" (Créer éval / Importer / Rapport / Message)
  - Sidebar : 10 items + footer `<TipOfTheDayCard>` "Conseil du jour" 2/5

### R5 — Parent Portal (image 7 prescriptive)
- **Backend** : `GET /api/v1/analytics/parent-dashboard/:studentId` ajouté
  - Profile hero data + global perf (moyenne, classe avg, progression, assiduité)
  - 4 `subjectPerf` avec classement, coef, trend
  - `termEvolution` (line chart 5 trimestres : élève vs classe)
  - `subjectEvolution` (grouped bar : 4 matières × 3 trimestres)
  - `recentGrades` (5 derniers avec moyenne classe + coef + appréciation)
  - `upcomingAssessments` (5 prochaines)
  - **ABAC parent** : enforcement via `StudentAccessService.canAccessStudent`
- **Frontend `/parent/dashboard`** réécrit pixel-correct image 7 :
  - **Sélecteur d'enfant** (pills cliquables si plusieurs enfants)
  - **`<ChildProfileHero>`** photo + nom + classe + école + 4 chips meta
  - **Card "Performance globale"** avec `<DonutChart>` central + 4 metric rows
  - **Card "Alertes et recommandations"** avec `<AlertCard>` warning + success
  - **Grille 4 `<SubjectPerfCard>`** (couleur matière + grade + badge + progress + 4 metrics)
  - **Charts duo** : `<LineChart>` évolution générale (élève vs classe) + `<GroupedBarChart>` évolution par matière × trimestre
  - **Table "Dernières notes"** : 7 colonnes (date / matière / éval / type / note / moy classe / coef)
  - **`<CommentsFeed>`** stub (sera alimenté R6 quand TeacherComment publie)
  - **Strip bottom "Évaluations à venir"** : cards mini-color par matière
  - Sidebar : 11 items + footer `<HelpSidebarCard>` "Besoin d'aide ?"

### R6 — Stub UI seulement (moteur d'alertes différé)
- Page `/admin/alerts` documente les 4 règles défaut (LOW_SUBJECT_AVG, NEGATIVE_TREND, HIGH_ABSENCE, BEHAVIOR_ALERT)
- L'implémentation BullMQ + `AlertRule`/`AlertInstance` modèles Prisma reste à faire ; le moteur d'évaluation périodique fera l'objet d'une session dédiée
- Le dashboard parent (image 7) consomme un endpoint d'alertes vide ; aucune alerte ne s'affiche tant que R6 n'est pas terminé

### R7 — Stub UI seulement (worker exports différé)
- Page `/admin/exports` montre les 4 types d'export (grades_xlsx / report_card_pdf / enrollment_xlsx / attendance_xlsx)
- Dépendances `exceljs` + `@react-pdf/renderer` installées dans le worker
- L'implémentation du worker BullMQ + modèle `ExportJob` reste à faire

### R8 — Notifications bell (basique)
- **Module `apps/api/src/modules/notifications/`** :
  - `GET /api/v1/notifications` → liste basée sur `AnnouncementReceipt` (modèle existant)
  - `GET /api/v1/notifications/unread-count` → polling 30 s par `TopbarBell`
  - `POST /api/v1/notifications/:id/read` + `POST /api/v1/notifications/read-all`
- Sécurité : filter `announcement.tenantId = me.tenantId` pour cloisonner
- L'extension vers un modèle `Notification` dédié (avec `kind` enum + dispatcher BullMQ) reste planifiée pour la suite

### R9 — Responsive + a11y (partiel)
- **`<MobileSidebarToggle>`** : burger + drawer slide-in pour <lg, body scroll lock + Escape close
- Topbar accepte le slot `burger` (montré uniquement sur `lg:hidden`)
- A11y baseline :
  - axe-core spot-check sur 3 login pages dans `tests/e2e/smoke.spec.ts` (`@a11y`)
  - Focus ring global `:where(:focus-visible)` sur 2 px outline + offset
  - `aria-current="page"` sur sidebar item actif
  - `role="dialog"` / `aria-modal` sur drawer
  - Reduced-motion respecté dans tokens.css

### R10 — E2E smoke
- Suite Playwright opérationnelle (chromium uniquement pour MVP, `tests/e2e/smoke.spec.ts`)
- 3 tests `@smoke` + 3 tests `@a11y`
- Pré-requis non rempli pour exécution complète : pile Docker (Keycloak + Postgres + API) doit tourner. Les tests sont prêts à passer dès `docker compose up`.

### R11 — Polish & docs
- Ce document (`REDESIGN-PROGRESS.md`)
- Tous les typechecks passent (`pnpm typecheck` propre sur 11 tasks)
- 0 régression fonctionnelle vs Phase 5 (PortalShell preserve API)

---

## ⏳ Phases à compléter dans une session ultérieure

### R6 — Moteur d'alertes (2 j)
- Migration Prisma : `AlertRule`, `AlertInstance`, enum `AlertRuleCode`, `AlertSeverity`, `AlertStatus`
- Worker BullMQ : évaluation périodique 15 min + triggers sur `assessment.publish` / `attendance.batch` / `enrollment.create`
- Service : implémentation des 4 règles défaut (LOW_SUBJECT_AVG, NEGATIVE_TREND, HIGH_ABSENCE, BEHAVIOR_ALERT)
- Tests unitaires + 1 test E2E (prof publie note basse → parent voit alerte)

### R7 — Exports asynchrones (1-2 j)
- Migration : `ExportJob` + enum `ExportKind` + `ExportStatus`
- Worker : génération XLSX (exceljs) + PDF (@react-pdf/renderer) → stockage MinIO
- Controller : POST `/exports` + GET liste + status polling + signed URL download
- UI : remplacer les "Disponible bientôt" par boutons fonctionnels

### R8 — Notifications avancées (1 j)
- Migration : `Notification` + enum `NotificationKind` + `NotificationDelivery`
- Module : dispatcher BullMQ qui crée des notifs pour chaque `grade.publish` / `alert.trigger` / `announcement.publish` / `lesson.publish` / `enrollment_request.create`
- Adapter `TopbarBell` pour consommer ce modèle dédié plutôt que l'agrégat `AnnouncementReceipt`

### R9 — Responsive + a11y (1-2 j supplémentaires)
- Lighthouse mobile sur 5 pages clés (objectif perf ≥ 90, a11y ≥ 100)
- Audit axe-core sur 10 pages clés authentifiées (requiert seed test + login automation Playwright)
- Fix critiques (probable : focus order sur Tabs, contrast spot fixes, aria-labels manquants sur charts)

### R10 — Tests E2E complets (1-2 j)
- 4 scénarios manquants :
  1. Création éval prof → saisie notes → publication → parent voit la note
  2. Demande inscription parent → admin approuve → enrollment créé
  3. Alerte automatique : prof publie note < seuil → parent voit alerte + recommandation
  4. Multi-school switching admin
- Run en CI (`pnpm test:e2e:smoke` puis suite complète)

### R11 — Polish & docs utilisateur (1 j)
- Guide rapide par portail (3 pages courtes)
- Empty states sur toutes les pages restantes (admin/students, admin/teachers, etc.)
- Loading skeletons systématiques
- 404 / 500 / 403 pages stylisées

### TipOfTheDay model (déféré)
- Le composant `<TipOfTheDayCard>` est fonctionnel mais alimenté avec un tip statique pour MVP
- Migration Prisma `TipOfTheDay` + `TipDelivery` planifiée à part
- Quand activé : audit `audience=teacher|parent|admin` + livraison personnalisée avec progression `seen/total`

---

## 🎯 État de complétion par rapport au plan v2.0

| Phase | Plan | Livré | % |
|---|---|---|---|
| R0 | Audit + dépendances + smoke | ✅ Complet | 100% |
| R1 | Design system + composants | ✅ 30 composants livrés (≥ plan) | 100% |
| R2 | AppShell unifié + landing | ✅ AppShell (landing existant déjà polish) | 95% |
| R3 | Admin portal dashboard + 4 pages | ✅ Dashboard + 3 nouvelles pages | 95% |
| R4 | Teacher portal image 6 | ✅ Dashboard pixel-correct | 90% (saisie inline simplifiée → R6) |
| R5 | Parent portal image 7 | ✅ Dashboard pixel-correct | 90% (TeacherComment + alerts cards → R6) |
| R6 | Moteur d'alertes | 🔄 Moteur live (cron 15 min + evaluator + dedup) · 5/7 règles câblées (LOW_SUBJECT_AVG, HIGH_ABSENCE, REPEATED_FAILURE, NEGATIVE_TREND, **MISSING_ASSESSMENT**) · **fan-out notification parent câblé sur le chemin cron** (les alertes périodiques allument enfin la cloche famille) | ~58% |
| R7 | Exports async | ⏳ UI stub + deps installées | 25% |
| R8 | Notifications bell | ✅ Endpoint stub + bell wired | 70% |
| R9 | Responsive + a11y | ✅ Mobile drawer + smoke a11y | 50% |
| R10 | E2E + QA | ✅ Smoke suite | 30% |
| R11 | Polish + docs | ✅ Ce document | 60% |

**Total approximatif : 70% du plan v2.0 livré dans cette session**

Les 30% restants concernent les workers backend (BullMQ alerts + exports + notifications) et le polish E2E. Le coeur visuel et fonctionnel des 3 portails est en place.

---

## 🔧 Commandes utiles

```bash
# Typecheck tout
pnpm typecheck

# Smoke tests (avec serveur Next.js auto-démarré)
cd apps/web && pnpm test:e2e:install   # télécharge chromium 1x
cd apps/web && pnpm test:e2e:smoke

# Dev
pnpm docker:up   # docker compose up postgres+keycloak+redis+minio
pnpm dev         # turbo dev parallel

# Apprivoiser une nouvelle session
# Le PROMPT du suivant doit citer : `REDESIGN-PLAN.md` v2 + `REDESIGN-PROGRESS.md` (ce fichier)
```

---

*Document généré au terme de la première session R0→R5 + stubs.*
