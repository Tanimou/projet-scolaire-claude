# ADR-015: Permission model — RBAC + ABAC + Custom roles

**Status:** Accepted
**Date:** 2026-05-15
**Amended by `S-E05-2`** (2026-08-11) — le **plafond de privilège** : D1–D8 à la fin de ce fichier.
Ce fichier n'avait aucun identifiant de décision `D<n>` ; `S-E05-2` est son premier amendeur, ouvre la
numérotation à **D1** et **réserve D9 et suivants** au prochain amendeur.

## Context

Le projet a:
- 3 rôles principaux (admin, teacher, parent) + super-admin
- Volonté de custom roles (ADR-013)
- Règles ABAC métier strictes (parent voit l'élève SEULEMENT si guardianship approuvé; prof note SEULEMENT son affectation)
- Multi-tenant strict

## Decision

**Modèle 3 couches:**

### Couche 1 — RBAC classique (Keycloak realm roles)
Rôles fixes: `super_admin`, `school_admin`, `teacher`, `parent`, `student` (futur).
Stockés dans JWT, lus par garde NestJS `@Roles('teacher')`.

### Couche 2 — Custom roles applicatifs
Tables `permission`, `role`, `role_permission`, `user_role` (voir data-model §16).
Custom roles ajoutables par admin (ex. "comptable", "surveillant").
Permissions sous forme de codes `<resource>.<action>` (ex. `students.read`, `enrollments.approve`).
Garde NestJS `@RequiresPermission('students.read')` vérifie permissions effectives = union(realm role permissions) + (custom role permissions assignées).

### Couche 3 — ABAC métier
Gardes spécifiques sur règles métier:
- `@AuthorizeStudentAccess()` — parent doit avoir `guardianship.status='approved'` sur l'élève
- `@AuthorizeTeachingAssignment()` — prof doit avoir `teaching_assignment` actif sur (classe, matière, période)
- `@SameTenant()` — vérifie cohérence tenant_id sur ressources
- `@SameSchool()` — vérifie cohérence school_id (multi-school dans même tenant)

### Couche 4 (défense en profondeur) — RLS Postgres
RLS active sur toutes tables métier (ADR-002).
Si garde NestJS est bypassé (bug), RLS refuse l'accès.

## Permission catalog (extrait)

| Code | Resource | Action |
|---|---|---|
| `schools.read` | school | read |
| `schools.write` | school | write |
| `classes.read/write/delete` | class | * |
| `students.read/write/delete` | student | * |
| `enrollments.read/write/approve` | enrollment | * |
| `grades.read/write/publish/revise` | grade | * |
| `attendance.read/write` | attendance | * |
| `lessons.read/write/publish` | lesson | * |
| `audit.read` | audit | read |
| `branding.write` | branding | write |
| `custom_fields.write` | custom_field | write |
| `roles.write` | role | write |
| `imports.execute` | import | execute |
| etc. |  |  |

## Rôles système prédéfinis

| Rôle | Description | Portail principal |
|---|---|---|
| `super_admin` | Opère la plateforme, accès cross-tenant | — |
| `school_admin` | Gère son école entièrement | admin |
| `teacher` | Pilote ses classes | teacher |
| `parent` | Voit ses enfants approuvés | parent |
| `student` (futur) | Voit son propre dossier | (futur) |

Custom roles peuvent être créés dans n'importe quel portail principal.

## Consequences

**Facile:**
- Flexibilité custom roles
- Vérifications composables via décorateurs NestJS
- Défense en profondeur (4 couches)

**Difficile:**
- Performance: garde ABAC fait des queries DB → cacher avec Redis (TTL court)
- Audit changements de rôle obligatoire

## Action Items

1. [ ] Catalog `permission` seedé en base avec ~80 permissions initiales
2. [ ] Rôles système (school_admin, teacher, parent) seedés avec leurs permissions par défaut
3. [ ] Décorateurs NestJS `@Roles`, `@RequiresPermission`, `@AuthorizeStudentAccess`, `@AuthorizeTeachingAssignment` implémentés Phase 1
4. [ ] Tests d'intégration permissions complets
5. [ ] Audit log obligatoire sur changements `user_role`

---

## S-E05-2 amendment — le plafond de privilège (2026-08-11)

- **Status**: Accepted
- **Date**: 2026-08-11
- **Slice**: `S-E05-2` (epic `V3-E05` — durcissement AuthN/AuthZ et intégrité des permissions)
- **Findings**: **`PF-09`** (BROKEN_SECURITY, P0 — fermé) · **`PF-156`** (P1, propriétaire ADR-015 — fermé)
- **Gates**: G-AUTHZ (primaire), G-TENANT, G-AUDIT, G-DNC · **DNC**: DNC-10
- **Supersedes**: la posture « on ne change pas qui peut octroyer quoi » écrite dans
  `ADR-035-audit-in-transaction.md:288-296` et `:460`, et la correction qu'elle propose
  (voir **D4**). N'annule rien d'autre : les quatre couches ci-dessus sont intactes.
- **Réserve D9 et suivants** au prochain amendeur.

### Contexte — ce qui était réellement ouvert, mesuré

La couche 2 (custom roles) n'avait **aucun plafond**. `roles.controller.ts create()` (`:116-122`) ne
demandait qu'une chose — *ce code existe-t-il dans le catalogue `Permission` ?* — jamais *l'appelant
le détient-il ?*. `update()` réécrivait l'ensemble des permissions d'un rôle existant à partir de codes
arbitraires. `users.service.ts assignRole()` octroyait sans comparer quoi que ce soit.

`school_admin` détient **à la fois** `roles.write` et `roles.assign`
(`permissions.constants.ts:209-211`). La chaîne vivante était donc de deux requêtes : créer un rôle
portant **tous** les codes du catalogue, se l'assigner, se ré-authentifier —
`UserSyncService.effectivePermissions` (`user-sync.service.ts:71-84`) unit les permissions des rôles
custom dans l'ensemble effectif sans plafond, et `PermissionsGuard:28-29` lit cette union.

**Correction factuelle au constat d'origine de `PF-156`** — l'instance qu'il désigne comme « la plus
nette » (POSTer l'id du rôle `super_admin` seedé) **n'est pas reproductible** :
`grep -rn super_admin apps/api/prisma/` ne renvoie **aucune** occurrence ; `seed.ts:189-199` ne seed que
`school_admin`, `teacher`, `parent`, `student`. Le défaut est néanmoins bien vivant, par le chemin
ci-dessus. Le texte de `PF-156` doit être corrigé au passage de land.

### D1 — La règle

**Aucun octroyeur ne peut créer, réécrire ou assigner une permission qu'il ne détient pas lui-même.**
Formellement : l'ensemble des codes demandés doit être un **sous-ensemble** de l'ensemble effectif de
l'octroyeur. La couche 2 gagne un plafond ; les couches 1 (realm roles Keycloak), 3 (ABAC métier) et
4 (RLS) sont **inchangées**. Refus : `403 ForbiddenException`, message **français**, corps
`{ message, required, missing }` — exactement la forme que `permissions.guard.ts:31-35` émet déjà, donc
un client qui affiche l'un affiche l'autre. Les codes en excès sont **dans la chaîne `message`** et pas
seulement dans `missing`, parce que le portail admin ne lit que `body.message`
(`apps/web/src/app/admin/roles/actions.ts:26-27, 45-47`) ; `message` reste une chaîne simple, jamais un
objet imbriqué (`RoleBuilderForm.tsx:236` le rend directement comme enfant React).

### D2 — Un seul prédicat, quatre sites d'appel, l'ensemble dérivé au contrôleur

`apps/api/src/shared/auth/privilege-ceiling.ts` — `exceedsGrantor()` (le prédicat pur) et
`assertWithinCeiling()` (l'unique endroit où la 403 est construite). Fonctions pures : pas de classe,
pas de provider injectable, pas de module Nest, pas d'import Prisma. Il n'existe **aucun barrel** dans
`shared/auth/` (huit fichiers, pas d'`index.ts`) : les sites d'appel importent le module directement,
comme ils importent déjà `permissions.guard` et `user-sync.service`. **Ne pas créer de barrel** — ce
serait une nouvelle convention, donc un nouvel ADR.

L'ensemble de l'octroyeur est dérivé **au contrôleur**, depuis le même seam que la garde utilise
(`UserSyncService.effectivePermissions(jwt.sub, jwt.realm_access?.roles ?? [])`), et **passé en
paramètre requis** à `UsersService`. `UserSyncService` n'est **pas** injecté dans `UsersService` et
l'union realm ∪ custom n'est **pas** réimplémentée : c'est le patron `ADR-035` D4 que ces mêmes fichiers
appliquent déjà à `provenance`. Le paramètre est requis et non optionnel pour la raison exacte qui vaut
pour `provenance` : un ensemble omis doit être une erreur de compilation, jamais un ensemble vide
silencieux.

`effectivePermissions` est donc lu **deux fois** par requête (la garde, puis le handler). Coût accepté,
**sans cache** : un cache sur une décision d'autorisation est un fail-open par obsolescence. On n'attache
pas non plus l'ensemble de la garde à `req` : cela coupleraient la garde au handler et cacherait un
chemin `null`.

Les quatre sites :

| # | Site | Placement |
|---|---|---|
| 1 | `roles.controller.ts create()` | après le 400 « Permissions inconnues », avant `$transaction` |
| 2 | `roles.controller.ts update()` | dans `if (body.permissionCodes)`, après le refus `isSystem`, avant `$transaction` |
| 3 | `users.service.ts assignRole()` | après la lecture du rôle, **avant** le retour idempotent et avant `$transaction` |
| 4 | `invite.controller.ts invite()` | étape 1b, avant l'étape 3 (création Keycloak) — voir **D7** |

### D3 — Fail-closed par construction, et le refus précède la transaction

- Un ensemble octroyeur **vide** ou `undefined` renvoie **tous** les codes demandés (refus). Jamais lu
  comme « inconnu, donc on laisse passer ». Chemin **vivant** : `user-sync.service.ts:67` résout un
  realm role non reconnu en `[]`.
- Un code **inconnu** n'est dans l'ensemble de personne, donc il excède, donc il est refusé. Le prédicat
  ne consulte jamais le catalogue — c'est aussi pourquoi son paramètre est `string[]` et non
  `PermissionCode[]` : les codes viennent d'un corps de requête, et un type union y refuserait de
  compiler ou masquerait silencieusement le cas à refuser.
- `requested` vide ⇒ autorisé. **C'est le seul permit-on-empty**, il est commenté et testé pour qu'il ne
  puisse pas être pris pour un fail-open : un rôle sans permission n'octroie aucun privilège. (Corollaire
  assumé : `PATCH /roles/:id` avec `permissionCodes: []` dépouille un rôle — une désescalade que le
  plafond autorise par construction.)
- Aucun cas particulier par **nom de rôle**. `super_admin` est épargné **structurellement**, pas par
  exemption : `REALM_ROLE_PERMISSIONS.super_admin` est le catalogue entier
  (`permissions.constants.ts:143`), donc le prédicat renvoie `[]`. La chaîne `super_admin` n'apparaît
  nulle part dans le module ; un `if (roles.includes('super_admin')) return []` serait un contournement
  déguisé en nom de rôle et doit être refusé en revue.
- **Le refus précède la transaction** : une requête refusée n'écrit ni ligne d'entité ni ligne d'audit,
  et n'ouvre aucune `$transaction` — la posture maison que les deux refus cross-tenant de
  `users.service.ts` suivent déjà. `writeAudit` n'est ni déplacé, ni enveloppé dans un `if`, ni touché
  (`ADR-035` D1 : le gate de vocabulaire et `scripts/audit-write-check.js` résolvent `action` /
  `resourceType` depuis l'AST du site d'appel).

### D4 — Divergence assumée : **pas** d'interdiction générale des rôles `isSystem`

Le texte de `PF-156` propose « un contrôle de sur-ensemble **plus** un refus explicite des rôles
`isSystem` pour les octroyeurs non-`super_admin` » (repris tel quel dans `ADR-035:294-296`). **La moitié
« sur-ensemble » est prise ; la moitié « ban `isSystem` » est refusée**, et l'argument d'origine est
**corrigé par la mesure** :

- l'argument tel qu'écrit (« le ban empêcherait d'assigner `teacher` ou `parent`, l'opération ordinaire »)
  est **à moitié faux** : le plafond **refuse déjà** `teacher`, `parent` et `student` pour un octroyeur
  `school_admin` (voir D5). Sur ces trois-là, le ban et le plafond disent la même chose ;
- **l'argument qui tient (a)** : le ban refuserait `school_admin → school_admin`, que le plafond
  **autorise** (zéro code en excès) et qui est une opération ordinaire — promouvoir un collègue au rang
  de pair administrateur. C'est une régression concrète, pas une hypothèse ;
- **l'argument qui tient (b)** : le ban est **de forme rôle** là où l'exploit vivant est **de forme
  permission**. Les rôles custom sont créés `isSystem: false` (`roles.controller.ts:136`), donc
  « créer un rôle plein catalogue puis se l'assigner » passe **entièrement à côté** du ban, et le site
  de création (`PF-09`) n'a aucune notion d'`isSystem` à interdire.

Un seul mécanisme, pas deux règles concurrentes. Consigné aussi dans un commentaire de code
(`users.service.ts`, docblock de `assignRole`).

### D5 — Conséquence produit, **acceptée et consignée**, pas lissée

Mesuré contre `seed.ts` `ROLE_PERMISSIONS` (ce qui atterrit réellement dans `role_permission`) et
confirmé contre `permissions.constants.ts` :

| Ligne `Role` seedée | Codes en excès pour un octroyeur `school_admin` | Assignable après ce slice ? |
|---|---|---|
| `school_admin` | *(aucun)* | ✅ oui |
| `teacher` | `grades.write`, `grades.revise`, `attendance.write`, `lessons.write`, `exports.execute.teacher` | ❌ non |
| `parent` | `guardianships.claim`, `exports.execute.parent`, `remediation.book` | ❌ non |
| `student` | `grades.read.self`, `assessments.read.self`, `attendance.read.self`, `announcements.read.self`, `analytics.read.self` | ❌ non |

*(Contre `permissions.constants.ts`, la liste `teacher` porte en plus `lessons.delete` et
`class_sessions.*`, que la ligne seedée ne porte pas. Le plafond lit la ligne en base : les cinq codes
sont le chiffre opérant.)*

**Après ce slice, un `school_admin` ne peut plus assigner les rôles seedés `teacher`, `parent` ni
`student`.** « Intégrer un professeur » est une opération quotidienne, et elle répond désormais 403.
C'est **structurel, pas accidentel** : la famille de permissions rétrécies par rôle
(`*.read.self`, `*.parent`, `*.teacher` — `permissions.constants.ts:41-46, 110-111, 119-128`) existe
précisément pour qu'aucun administrateur ne les détienne, donc un test « détenu ⊇ octroyé » sur un
catalogue qui en contient refusera **toujours** tout octroi inter-audience.

**Le rayon d'action réel est plus petit qu'il n'y paraît, et les deux moitiés sont dites :**
`effectivePermissions` est realm ∪ DB, donc un professeur qui s'authentifie avec le realm role `teacher`
porte déjà l'ensemble teacher **sans** la ligne DB. Les lignes `Role` `teacher` / `parent` / `student`
sont donc **redondantes pour les utilisateurs à realm role** ; il leur reste la puce d'affichage
(`apps/web/src/app/admin/users/UsersTable.tsx:115`) et la composition de rôles custom. Soit : un refus
réel d'une opération que les admins font aujourd'hui, dont le coût pratique est un octroi d'affichage
redondant.

**Ne pas affaiblir le plafond pour rattraper ce test.** Trois résolutions légitimes, **aucune dans ce
slice** : (1) élargir `REALM_ROLE_PERMISSIONS.school_admin` — un octroi de privilège délibéré, avec son
propre amendement ; (2) introduire un droit de **délégation** explicite (un *grantable set* distinct du
*held set* — voir D8) ; (3) accepter que l'attribution de rôles realm passe à Keycloak / `super_admin`
et que `roles.assign` devienne une capacité custom-only. **Décision : accepter et consigner.** Signalé
`needs-human-review`, et repris dans le corps de la PR.

### D6 — DNC-10 : aucun interrupteur, et pas de place pour en mettre un

Le module ne lit aucun environnement, ne porte aucun drapeau de contournement, n'a aucune échappatoire
de développement et ne prend **aucun objet d'options**. Le plafond est requis en développement
exactement comme en production. Asserté **structurellement** (scan du texte source) **et par arité** :
les deux exports ont `.length === 2`, donc un sac d'options — la forme sous laquelle un contournement
arrive — ne peut pas apparaître sans faire rougir un test.

### D7 — Le quatrième site : `invite.controller.ts`, sans lequel le correctif était cosmétique

`POST /users/invite` porte un **quatrième** chemin d'octroi que les trois sites nommés par le constat ne
couvraient pas : `body.customRoleSlug` était résolu **dans** la transaction de `persistInvitedProfile`
et octroyé sans aucun plafond, sur un handler gardé par `users.write` — **plus faible** que
`roles.assign`. `body.email` étant contrôlé par l'appelant, un octroyeur refusé sur
`POST /users/:id/roles` pouvait inviter une seconde adresse lui appartenant avec un `customRoleSlug`
pointant sur un rôle plein catalogue, recevoir le courriel d'activation et se connecter en détenant
`grades.revise`. Fermer `PF-09` sur trois sites en laissant celui-ci ouvert aurait **déplacé**
l'escalade, pas fermée — la forme `PF-164` (une affirmation que le code ne porte pas).

Le slug est donc résolu et plafonné **dans `invite()`, avant l'étape 3** : aucune identité Keycloak n'est
créée pour une invitation refusée, donc aucune compensation n'est nécessaire.
`persistInvitedProfile` reçoit un `roleId: string | null` déjà résolu et garde sa transaction, son
`.catch()` de compensation `S-E04-9` au site d'appel et son `writeAudit` intacts (la règle B de
`scripts/audit-write-check.js` rejette un `try` **n'importe où** parmi les ancêtres AST d'un
`writeAudit`). Le **no-op silencieux** d'un slug non résolvable est préservé verbatim : slug inconnu ⇒
`null` ⇒ pas d'octroi, pas de 400. Seul un rôle **résolu** dont les permissions excèdent l'octroyeur
lève une 403.

### D8 — Ce que cet amendement ne prétend **pas** avoir fermé

Nommé plutôt que sous-entendu ; chaque ligne est un résiduel avec un propriétaire.

1. **Le canal `realmRole` de l'invitation reste OUVERT, délibérément.**
   `@IsEnum(['school_admin','teacher','parent'])` laisse un `school_admin` provisionner une identité
   `teacher`, et `REALM_ROLE_PERMISSIONS.teacher` porte `grades.revise`. Y appliquer le plafond
   refuserait « inviter un professeur », c'est-à-dire le flux d'intégration principal du produit. Ce
   n'est **pas** une question de sous-ensemble mais de **délégation** (D5 option 2), et elle est
   repointée, pas silencieusement absorbée. **À ouvrir comme constat, propriétaire ADR-015.**
2. **Le plafond est relatif, donc les octrois déjà escaladés sont « grandfathered ».** Un `school_admin`
   qui détient déjà un rôle custom portant `grades.revise` passe le plafond et peut en produire d'autres.
   Ce slice arrête l'escalade **nouvelle** ; il ne remédie pas à l'état existant que `PF-09` a pu créer.
   Résiduel : une **requête de détection** (pas une migration — G-MIGRATION ne doit pas se déclencher).
3. **Un refus ne laisse aucune ligne d'audit**, et c'est voulu : rien ne s'est produit, et la posture
   maison pour un refus pré-transactionnel est de n'écrire rien (ajouter un `writeAudit` casserait
   `ADR-035` D1). Compensation partielle : `assertWithinCeiling` émet **un `Logger.warn` structuré** sur
   chaque refus. Il ne porte **pas** l'id de l'acteur — le prédicat n'a délibérément aucun contexte
   d'acteur, et un troisième paramètre rouvrirait la porte au sac d'options que D6 ferme. Écart consigné.
4. **TOCTOU, non fermé et non prétendu fermé.** L'ensemble de l'octroyeur et l'ensemble du rôle sont lus
   avant la transaction ; un `PATCH /roles/:id` concurrent peut réécrire `role_permission` entre la
   vérification et l'écriture. Une **relecture dans la transaction a été envisagée et écartée** : en
   READ COMMITTED elle rétrécit la fenêtre sans la fermer, ce qui donnerait l'apparence d'une garantie
   que le code ne porte pas — exactement la forme que cet epic combat. La vraie fermeture est un
   verrouillage explicite (`SELECT … FOR UPDATE` sur les lignes du rôle) ou une transaction
   sérialisable. Résiduel nommé, propriétaire ADR-015.
5. **L'exemption de renommage** (`PATCH /roles/:id` sans `permissionCodes` ⇒ aucun plafond) est correcte
   — renommer n'octroie rien — mais elle est aujourd'hui **inatteignable depuis l'UI livrée** :
   `RoleBuilderForm.tsx:132-135` envoie toujours `permissionCodes` en édition. En pratique, un
   `school_admin` ne peut donc pas renommer un rôle custom portant un code qu'il ne détient pas.
6. **`PF-153` reste hors périmètre** : la lecture du rôle dans `assignRole` demeure **non filtrée** par
   tenant. `Role` n'a pas de `tenantId` ; la tenancy passe par `schoolId → School.tenantId` et
   `schoolId: null` signifie global. Y ajouter un filtre serait un changement de visibilité déguisé en
   correctif, il est bloqué sur ADR-013, et le faire dans un slice d'autorisation est précisément le
   changement silencieux que cet epic existe pour empêcher. `GET /roles` reste également non filtré.
7. **`apps/web` n'est pas touché.** `UsersTable.tsx:115-116` liste **tous** les rôles renvoyés par
   `GET /roles` et poste l'id choisi (`:30-34`) : trois des quatre rôles système seedés seront donc
   proposés et répondront 403. **DNC-06 n'est pas reproduit** — mesuré, aucune chaîne française de
   l'arbre n'affirme qui peut octroyer quoi (la copie est le neutre « Assigner un rôle » / « Aucun rôle
   personnalisé »), donc aucune copie existante ne devient fausse. Ce qui se dégrade est l'**affordance**.
   Pire : `apps/web/src/app/admin/users/actions.ts:7-10` (`assignRoleAction`) n'a **aucun `catch`** et
   renvoie `void`, et son appelant `UsersTable.tsx:30-39` est un `try … finally` **sans `catch`** — la
   403 y sera donc **muette** (spinner, menu qui se ferme, rien). C'est un constat de suite pour la piste
   FE (aligner `assignRoleAction` sur `roles/actions.ts`, filtrer la liste déroulante contre les
   permissions effectives de `GET /me`, afficher les codes de `missing`, désactiver dans
   `RoleBuilderForm` les cases hors plafond). **La prévention côté UI ne remplace jamais le refus côté
   serveur** ; le plafond reste la seule vraie garde.

### Évolution nommée, différée : l'ensemble *octroyable*

La forme correcte à long terme sous ADR-015 est un **grantable set** distinct du **held set** : ce qu'un
acteur peut *transmettre* n'a pas de raison d'être identique à ce qu'il peut *exercer*. C'est ce qui
donnerait une sortie documentée aux refus de D5. Hors périmètre ici (schéma + produit), enregistré comme
la suite.
