# V3-E04 — Data model

> **Épic** : `V3-E04 — Audit trail and governance surfaces` (L0 · M · dépend de `V3-E02`, bloque `V3-E03` et `V3-E11`).
> **Auteur** : Winston (Architect), run `epic-spec` du 2026-08-08. **Docs only** — aucun fichier de `apps/`,
> `packages/`, `prisma/schema.prisma` ou `scripts/` n'est modifié par ce run.
> **Compagnon** : [`contracts/openapi.yaml`](./contracts/openapi.yaml) (contrats REST), `spec.md` (John), `tasks.md` (découpage).
>
> **Posture, reprise de `v3-e06/PROGRESS.md` et `v3-e02/PROGRESS.md`** : ce document nomme ce qui est **mesuré**,
> ce qui est **décidé**, et ce qui n'est **pas revendiqué**. Aucune gate n'est déclarée satisfaite ici ; chaque gate
> est accompagnée de la manière dont elle **sera** prouvée. Aucun chiffre n'est inventé : toute quantité vient de la
> section « Mesures » ci-dessous ou est explicitement marquée `NON MESURÉ`.

---

## 0. Mesures — l'état réel, le 2026-08-08

Toutes les mesures ci-dessous ont été prises **ce run**, contre la stack Docker locale en fonctionnement ou par
lecture directe de l'arbre. Elles sont plus récentes que les audits A2 §5.6 / App. B.5 / App. C.2 et **priment** sur eux.

| # | Mesure | Valeur | Source |
|---|---|---|---|
| M-1 | Lignes dans `audit_log` (base locale) | **54** | `select count(*) from audit_log` |
| M-2 | Lignes portant `hash` / `prev_hash` | **0 / 0** | même requête |
| M-3 | Lignes portant `ip_address` / `user_agent` | **0 / 0** | même requête |
| M-4 | `actor_role` observés | `school_admin` × **53**, `teacher` × **1** | même requête |
| M-5 | Sites `prisma.auditLog.create` dans `apps/api/src` | **28**, répartis sur **16** fichiers | `grep` |
| M-6 | Sites qui **codent en dur** `actorRole: 'school_admin'` | **8** — `identity/invite.controller.ts:155`, `identity/roles.controller.ts:135`/`:185`/`:219`, `imports/imports.service.ts:440`, `integrations/integrations.service.ts:639`, `school-structure/academic-years.controller.ts:266`, `school-structure/subjects.controller.ts:227` | `grep` |
| M-7 | **Sites d'écriture d'audit hors `apps/api/src`** | **2**, dans `packages/imports-core/src/engine.ts:197` et `:288`, tous deux en `tx.auditLog.create` (donc **dans** la transaction) | `grep` |
| M-8 | Sites écrivant `hash` ou `prevHash` | **0** — la chaîne n'a jamais existé ; `alerts.service.ts:607` porte un commentaire qui le dit | `grep` |
| M-9 | `identity/roles.controller.ts` `create()` | `prisma.role.create(...)` **puis** un `prisma.auditLog.create(...)` séparé, **sans `$transaction`** — le rôle peut exister sans audit. `update()` ouvre bien un `$transaction` mais écrit la ligne d'audit **en dehors**. `delete()` : idem `create()` | lecture de `:104-225` |
| M-10 | `portal:` codé en dur | `'admin'` sur **9** sites | `grep` |
| M-11 | Codes `resourceType` réellement écrits | **20** distincts : `academic_year`, `alert_instance`, `assessment`, `booking`, `calendar_event`, `conversation`, `conversation_report`, `export_job`, `grade`, `guardianship_claim`, `import_row`, `meeting_request`, `remediation_plan`, `role`, `roster_source`, `snapshot_recompute_trigger`, `subject_coefficient`, `tutor`, `tutor_availability`, `user_profile` | `grep` |
| M-12 | Clés de `RESOURCE_TYPE_LABELS` (`apps/web/src/app/admin/audit/AuditPageFilters.tsx:21-35`) | **13** | lecture |
| M-13 | Intersection M-11 ∩ M-12 | **6** (`academic_year`, `assessment`, `grade`, `role`, `subject_coefficient`, `user_profile`) | dérivé |
| M-14 | Clés du label-map qu'**aucun site n'écrit** | **7** (`announcement`, `class_section`, `enrollment`, `enrollment_request`, `import_batch`, `student`, `teacher_profile`) | dérivé |
| M-15 | Codes écrits **sans label** | **14** | dérivé (M-11 − M-13) |
| M-16 | `resource_type` réellement **en base** (les 54 lignes) | 8 chaînes **françaises d'affichage** : `Professeur`, `Note`, `Classe`, `Élève`, `Inscription`, `Évaluation`, `Résultats`, `Année scolaire` — intersection avec M-11 et M-12 : **0** | requête live |
| M-17 | `action` réellement **en base** | `Création`, `Mise à jour`, `Suppression`, `Validation`, `Export` — intersection avec les codes machine : **0** | requête live |
| M-18 | KPI `criticalChanges` (`analytics.service.ts:3310-3326`) | `action in ['delete','Suppression','Révision','revise']` → mesuré **9**, atteint uniquement par le français `Suppression` ; `Révision`/`revise`/`delete` ne matchent **rien** | lecture + requête |
| M-19 | KPI `sensitiveExports` | mesuré **7** (`action contains 'Export'`) | requête |
| M-20 | KPI `adminLogins` | mesuré **0**, et **structurellement toujours 0** : aucun site de l'API n'écrit de ligne d'audit de connexion | requête + `grep` |
| M-21 | Filtre `to` (`analytics.service.ts:3251`) | `lte: new Date(to)` → `to=2026-08-08` devient `2026-08-08T00:00:00Z`, toute la journée est perdue | lecture |
| M-22 | Portée des 4 KPI | calculés sur un `where` qui **ignore** `from`/`to`/`action`/`resourceType`/`portal`/`actorId` — trois compteurs *all-time* posés à côté d'un tableau filtré | lecture `:3310-3326` |
| M-23 | `trust proxy` / `trustProxy` dans `apps/api/src` + `infra/` | **0 occurrence** ; `apps/api/src/main.ts:37` est un `NestFactory.create` nu → `req.ip` = **pair de socket** | `grep` |
| M-24 | **RLS** (`ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`) dans tout le dépôt | **0 occurrence**, y compris dans `0_baseline/migration.sql` | `grep` |
| M-25 | Fichiers sous `apps/api/prisma/migrations/` | **`0_baseline` seulement** (+ `migration_lock.toml`) | `ls` |
| M-26 | `Tenant` | **pas de colonne `timezone`** ; `settings Json @default("{}")`. `School.timezone String @default("Europe/Paris")` existe | `schema.prisma:249-274` |
| M-27 | `AuditLog` → `Tenant` | **aucune clé étrangère** (`tenant_id` est un `uuid` nu) — c'est `PF-96`, **ouvert**, non traité ici | `schema.prisma:1225-1244` |
| M-28 | Index sur `audit_log` | **un seul** : `(tenant_id, created_at)` | `0_baseline/migration.sql:1401` |
| M-29 | `/admin/reports` | **aucun répertoire** `apps/web/src/app/admin/reports` ; lien vivant dans `apps/web/src/components/shell/sidebar-items.ts:175` ; déjà inventorié dans `scripts/link-integrity-baseline.json`. Sonde live : `307` vers `/admin/login?callbackUrl=%2Fadmin%2Freports` | `ls` + `grep` + `curl` |
| M-30 | Module finance dans `apps/api/src/modules/` | **inexistant** | `ls` |
| M-31 | Troisième consommateur du vocabulaire | `apps/worker/src/modules/exports/generators/audit-csv.generator.ts:16` lit `auditLog` et exporte la colonne `action` **brute** | lecture |
| M-32 | Sites écrivant **dans** une transaction | **6 sur 28** (`tx.auditLog.create`) ; les **22** autres écrivent hors transaction (`this.prisma.auditLog.create`) | `grep` (6 + 22 = 28, réconcilié avec M-5) |
| M-33 | Familles n'écrivant **aucune** ligne d'audit | `identity/users.service.ts` `assignRole()` **:57** et `revokeRole()` **:74** — c'est-à-dire **l'octroi/révocation de rôle**, la première famille nommée par AC-2 ; `modules/schools/` et `modules/enrollments/` : **0** référence à `auditLog`. Ces sites **ne font pas partie des 28** de M-5 : ils sont absents, pas mal écrits | `grep` + lecture |
| M-34 | `/admin/analytics` | **existe** (`apps/web/src/app/admin/analytics/page.tsx`, « Analytique des performances ») et n'a **aucune** entrée de barre latérale, alors que l'entrée `BarChart3` de la barre pointe sur `/admin/reports` qui, lui, n'existe pas — une page orpheline et un lien mort partagent une icône. Enregistré comme **`PF-119`** | `ls` + `grep` |

> **Ce tableau est le registre de référence des mesures pour `V3-E04`.** `PROGRESS.md` §« What Step 2 measured »
> reprend les mêmes identifiants `M-n` et ne doit jamais les renuméroter : les deux fichiers ont brièvement porté
> **deux registres différents sous le même espace de noms** (`M-7` = « sites hors `apps/api` » ici et « sites codant
> `portal: 'admin'` » là-bas, `M-24` = RLS ici et « troisième consommateur » là-bas). C'est la forme exacte de
> `PF-110`, que ce kit dénonce trois sections plus bas pour les numéros d'ADR. Corrigé au land pass et enregistré
> comme **`PF-120`** ; `M-32`…`M-34` sont les trois mesures que seul `PROGRESS.md` portait, promues ici après
> re-vérification indépendante plutôt que reprises sur parole (`R-30`).

### Mesures que ce run n'a **pas** pu prendre — à ne pas lire comme des faits

| Question | Statut | Comment la trancher |
|---|---|---|
| **`/admin/audit` plante-t-il encore ?** (`PF-14`) | **OUVERT — non mesuré.** Le crash *ne se reproduit pas statiquement* : `page.tsx` est un server component avec `export const dynamic = 'force-dynamic'`, enveloppe ses deux `fetch` dans un `safe()` qui avale `ApiError`, et importe `humanizePortal`/`humanizeResourceType` **comme valeurs** depuis `AuditPageFilters.tsx` qui est `'use client'` — légal en Next 15, mais cela force ces fonctions dans le bundle client. La sonde live renvoie `307` vers le login : **le rendu authentifié n'a pas été observé** | Un rendu **authentifié** de `/admin/audit` (session admin `mme.dupont@voltaire.fr`), capturé avec la console. C'est la mesure qui ferme AC-1, dans un sens **ou dans l'autre** |
| Le nombre de sauts (hop count) réel Traefik→nginx→web | **NON MESURÉ** | Voir §4, procédure `HOP-1` |
| Combien de lignes `audit_log` existent sur le déploiement hébergé | **NON MESURÉ** (la routine n'a pas les accès) | L'ancrage (§3.2) stocke le compte **au moment de sa déclaration**, quel qu'il soit — il n'est jamais supposé |

---

## 1. Ce que ces mesures changent au contrat de l'épic

Le contrat d'épic (`docs/daily-improvement-v3/epics/V3-E02-E06-layer0.md`, §V3-E04) décrit `PF-32` comme
« *the end-date filter and the three structurally wrong KPIs* ». **C'est plus petit que la réalité.** Cinq défauts
distincts, dont deux qui traversent `packages/contracts` :

1. **Le filtre de fin** (M-21) — un `lte` sur un minuit UTC. *Et* : il n'existe aucun fuseau tenant pour dire ce
   qu'est « le jour sélectionné » (M-26). Le corriger correctement demande une colonne (§3.3).
2. **La portée des KPI** (M-22) — trois compteurs *all-time* posés à côté d'un tableau filtré. C'est du **G-TRUTH**.
3. **`adminLogins` est structurellement impossible** (M-20) — aucune ligne d'audit de connexion n'est jamais écrite,
   nulle part. La carte « CONNEXIONS ADMIN — Sessions ouvertes » ne peut afficher que `0`, pour toujours.
4. **La scission de vocabulaire** (M-16/M-17 vs M-11) — la base porte des **chaînes d'affichage françaises dans des
   colonnes structurelles**, les 30 sites d'écriture écrivent des **codes machine**, et le label-map du front ne
   couvre **aucun** des 8 types présents en base (intersection = **0**). Le KPI `criticalChanges` enjambe les deux
   vocabulaires et n'en touche correctement aucun (M-18). C'est du **G-TRUTH** et, parce que la déclaration doit
   vivre dans `packages/contracts`, du **G-PORTAL**.
5. **La transactionnalité** (M-9) — reproduite sur `roles.controller.ts`. C'est le défaut AC-2.

**Conséquence sur AC-2, à dire plutôt qu'à laisser deviner.** AC-2 énumère « role grant/revoke, school mutation,
enrollment decision, grade publish **and every finance action** ». Mesuré : **il n'existe aucun module finance**
(M-30) — `ADR-018` diffère la finance en Phase 9 et l'épic V3-E15 la porte. La clause finance d'AC-2 est donc
**vide aujourd'hui** : elle ne peut être ni satisfaite ni violée. La spec doit l'écrire ainsi et **ne pas** compter
une clause vide comme un critère passé. Idem pour `school mutation` et `enrollment decision` : les modules
`schools/` et `enrollments/` **n'apparaissent pas** dans les 16 fichiers de M-5 — ils n'écrivent *aucune* ligne
d'audit, ce qui est un défaut plus grave qu'une ligne hors transaction.

**Correction mesurée à l'intake de ce run.** L'intake affirmait « 28 sites … none in `apps/worker` ». C'est exact
pour `apps/worker/src`, mais **incomplet** : `packages/imports-core/src/engine.ts` porte **2 sites** de plus (M-7),
exécutés *par le worker* via `@pilotage/imports-core`. Le total est **30**, et le worker **audite bien** — à travers
le package partagé. Deux conséquences portantes, développées en §2.4 : une gate « un seul écrivain » qui ne
regarderait que `apps/api/src` serait **fausse**, et la moitié pure de l'écrivain doit vivre dans `packages/` pour
rester atteignable des deux côtés.

---

## 2. Décisions d'architecture

> Trois décisions de ce lot méritent un ADR. Elles sont marquées **`[ADR]`** et récapitulées en §7.

### 2.1 `[ADR]` La provenance derrière le proxy — un nombre de sauts épinglé, ou rien

**Le problème, mesuré.** `main.ts:37` est un `NestFactory.create` nu et `trust proxy` n'est posé nulle part (M-23),
donc `req.ip` est le **pair de socket**. La chaîne réelle est :

```
navigateur → Traefik (hôte) → nginx (compose) → apps/web (Next, server action)
           → fetch serveur de apps/web  ──(n'envoie que Accept / Content-Type / Authorization)──▶ nginx → apps/api
```

Le pair de socket vu par l'API est donc **le conteneur web** — identique pour tout acteur, pour toujours — et
`userAgent` est `null` sur **toute** écriture pilotée par l'UI, parce qu'`undici` n'en envoie pas.
`sanitiseInetOrNull` ne peut rien y faire : **une IP de proxy *est* un inet valide**. Le champ inverse donc le
principe que le service énonce lui-même — « *une provenance absente, jamais une provenance fausse* » — et
`/admin/audit` le rend en monospace comme « d'où l'admin a agi ».

**Ce qui est décidé.**

- **D-1 — `app.set('trust proxy', true)` est interdit**, définitivement. La confiance aveugle en `X-Forwarded-For`
  rend l'IP d'audit **forgeable par le client** : *strictement pire que vide*. Une assertion de gate doit refuser
  la chaîne `trust proxy` / `trustProxy` avec un argument non épinglé, et **aucune variable d'environnement ne doit
  pouvoir l'activer** (`DNC-10`).
- **D-2 — `trust proxy` sur l'API ne résoudrait de toute façon rien.** Le saut qui *perd* l'IP client est le `fetch`
  sortant de `apps/web`, qui n'émet aucun `X-Forwarded-For`. Régler `trust proxy` côté API ferait lire un en-tête
  absent. **Le correctif commence dans `apps/web`, pas dans l'API.**
- **D-3 — `apps/web` transmet explicitement deux en-têtes dédiés**, et non `X-Forwarded-For` (dont le nom appelle la
  confiance aveugle) : `X-Pilotage-Client-Ip` et `X-Pilotage-Client-User-Agent`, dérivés côté web des en-têtes
  entrants via un **nombre de sauts épinglé**.
- **D-4 — le nombre de sauts est une constante mesurée, pas supposée.** Côté `apps/web`, l'IP client est
  `XFF[len − H]` où `H` = nombre de proxys de confiance devant `apps/web`. **Hypothèse topologique : `H = 2`
  (Traefik, nginx) — `NON MESURÉ`, à établir par la procédure `HOP-1` (§4) avant que la valeur n'entre dans le
  code.** Tant que `H` n'est pas vérifié et configuré, la provenance vaut **`null`** (fail-closed).
- **D-5 — l'API n'accepte ces deux en-têtes que d'un pair de socket interne déclaré.** Une liste de CIDR
  (`AUDIT_TRUSTED_HOP_CIDRS`, sans valeur par défaut permissive). Si le pair n'y est pas, les en-têtes sont
  **ignorés** et l'IP retenue est le pair de socket lui-même — qui, dans ce cas, *est* réellement l'appelant
  (un `curl` porteur d'un jeton, par exemple). Cette règle est la seule qui donne un résultat correct dans les
  **deux** topologies.
- **D-6 — nginx doit effacer ces deux en-têtes sur toute requête entrante externe**, sinon un navigateur peut les
  injecter. C'est une modification `infra/` qui appartient à la même slice que D-3/D-5, sans quoi D-5 est une
  demi-mesure.
- **D-7 — la valeur par défaut, partout, est `null`.** Pas de « meilleure approximation », pas de `0.0.0.0`, pas de
  chaîne `unknown`. `« une provenance absente, jamais une provenance fausse »` devient exécutoire.

**Ce qui n'est PAS revendiqué** : que `H = 2`. Que l'IP capturée soit celle de l'utilisateur final si un CDN ou un
second reverse-proxy est ajouté devant Traefik (elle serait alors celle du CDN — d'où l'épinglage, qui doit être
re-mesuré à chaque changement de topologie et dont la valeur doit figurer dans le runbook de déploiement).

### 2.2 `[ADR]` L'écriture d'audit : un seul écrivain, dans la transaction de l'appelant

- **D-8 — un seul écrivain.** `prisma.auditLog.create` / `tx.auditLog.create` ne doit apparaître que dans **un
  seul fichier** de production. Tous les autres sites appellent ce point d'entrée.
- **D-9 — l'écrivain prend un client de transaction, jamais le `PrismaService`.** Signature :
  `writeAuditRow(tx, input)`.
  **Et il faut dire tout de suite ce que le typage ne fait pas** : `Prisma.TransactionClient` est
  `Omit<PrismaClient, ITXClientDenyList>`, et `PrismaClient` **lui est assignable** — le type seul **n'empêche pas**
  de passer le service hors transaction. Une spec qui s'arrêterait là revendiquerait une garantie inexistante.
  Deux mécanismes, cumulatifs :
  1. un type **marqué** (`AuditTx = Prisma.TransactionClient & { readonly __auditTx: unique symbol }`) obtenu
     uniquement depuis un helper `withAudit(prisma, fn)` qui ouvre le `$transaction` — appeler l'écrivain hors
     transaction devient **non représentable**, pas seulement déconseillé (forme `DNC-06`) ;
  2. une **gate de source** (§5, G-AUDIT) qui compte les occurrences de `auditLog.create` sur `apps/api/src`
     **et** `packages/*/src` **et** `apps/worker/src` — les trois racines, parce que M-7 prouve qu'en regarder
     une seule donne un compte faux.
- **D-10 — la tension avec « l'audit ne doit jamais faire échouer la mutation » est tranchée, pas ignorée.**
  Le commentaire de `calendar-seed.service.ts:11-31` justifie l'assainissement *avant* la transaction par : « un cast
  raté ferait rouler en arrière un import parfaitement valide ». Ce raisonnement reste juste pour les échecs
  **évitables** (un inet malformé). Mais **G-AUDIT exige littéralement que les deux atterrissent ou aucun** : un
  échec d'écriture d'audit qui annule la mutation est, par définition de la gate, le comportement **correct**.
  Règle : *tout ce qui peut être validé avant l'ouverture de la transaction l'est* (inet, troncature UA, appartenance
  au vocabulaire) ; ce qui reste (l'écriture elle-même, le verrou d'ancrage) **a le droit d'annuler**.
- **D-11 — pas de `try/catch` avaleur autour de l'écriture d'audit.** `grades.controller.ts:337` en porte un
  aujourd'hui (« best-effort : a write failure is logged and swallowed »). Sous G-AUDIT c'est un défaut : la mutation
  survivrait sans trace. À supprimer sur les chemins privilégiés, en le **nommant** dans la slice qui le fait.

### 2.3 `[ADR]` Le vocabulaire d'audit se déclare dans `packages/contracts`, pas dans un `enum` Postgres

**Pourquoi pas un `enum` Postgres** (l'option qui vient d'abord à l'esprit) :

1. chaque nouveau code d'action deviendrait une **migration** — ~24 codes aujourd'hui, un ou deux de plus par slice
   fonctionnelle. Cela met une migration de schéma sur le chemin de chaque fonctionnalité, et déclenche
   `G-MIGRATION` à chaque fois ;
2. les 54 lignes héritées (M-16/M-17) **échoueraient au cast**. La migration devrait donc les réécrire ou les
   supprimer — les deux sont interdits (risque `A-01`, et une réécriture serait une **fabrication** : `Suppression`
   ne dit pas *ce qui* a été supprimé) ;
3. `audit_log` est en append-only : un `enum` n'y apporte aucune intégrité référentielle utile que le point
   d'entrée unique (D-8) ne donne pas déjà.

**Décidé.** `action` et `resource_type` **restent `text`** en base. Le vocabulaire canonique est déclaré une fois,
dans **`packages/contracts/src/audit/`**, comme une liste de descripteurs :

```ts
// packages/contracts/src/audit/index.ts  (forme cible — écrite par la slice, pas par ce run)
export interface AuditActionDescriptor {
  code: string;              // 'role.create'      — la colonne `action`
  resourceType: string;      // 'role'             — la colonne `resource_type`
  severity: 'normal' | 'critical';
  labelFr: string;           // « Création d'un rôle »
  parentVisible: boolean;    // réservé — voir §8, aucun code ne le lit dans cet épic
}
```
plus les dérivés (`AUDIT_ACTION_CODES`, `AUDIT_RESOURCE_TYPES`, `AUDIT_CRITICAL_ACTIONS`, `AUDIT_ACTION_LABELS_FR`,
`AUDIT_RESOURCE_TYPE_LABELS_FR`) et un `isAuditActionCode()`.

- **D-12 — le label français est attaché au CODE, jamais stocké en base.** C'est exactement l'inverse de ce que font
  les 54 lignes. Le rendu français est dérivé une fois et hérité par les quatre portails.
- **D-13 — on n'impose PAS `action.startsWith(resourceType)`.** Mesuré : `user.invite`/`user_profile`,
  `analytics.snapshot_rebuild`/`snapshot_recompute_trigger`, `calendar.seed_french_holidays`/`calendar_event`,
  `import.conflict.resolve`/`import_row` violeraient la règle. Les codes expédiés ne sont pas renommés (ce serait un
  changement de données déguisé). À la place, **chaque descripteur déclare son `resourceType`**, et l'écrivain (D-8)
  **valide la paire**. La règle devient vérifiable sans renommer quoi que ce soit.
- **D-14 — les 54 lignes héritées ne sont ni réécrites ni supprimées.** Elles sont **déclarées héritées** par la
  frontière de l'ancrage (§3.2) et rendues honnêtement : chaîne brute + puce « format historique ». Le seed est
  corrigé pour n'émettre que des codes canoniques — c'est la source du défaut, pas les lignes.
- **D-15 — un code observé absent du vocabulaire est retourné tel quel avec `vocabulary: 'unknown'`, jamais
  silencieusement écarté** (forme `DNC-08` : ce qui ne peut pas être classé doit être **visible**, pas absent).
- **D-16 — `portal` prend le vocabulaire à 4 membres.** Mesuré : `packages/contracts/src/enums/index.ts:3` déclare
  `PORTALS` à **3** membres (`admin`/`teacher`/`parent`) alors que `apps/web/src/lib/portals.ts` déclare `PORTAL_IDS`
  à **4** (avec `student`). C'est `PF-101`, ouvert. Le vocabulaire d'audit doit utiliser **le jeu à 4** ; réconcilier
  les deux déclarations reste à `PF-101` et n'est **pas** fait ici.
- **D-17 — `packages/contracts` est construit en CJS (`dist/`)**. Ajouter `src/audit/` impose un ré-export depuis
  `src/index.ts` **et** une reconstruction du package. C'est un pré-requis opérateur/orchestrateur (les agents ne
  construisent pas — `project-context.md` §4), à énoncer dans la slice, jamais à supposer résolu.

### 2.4 Où vit le code partagé

| Élément | Emplacement | Pourquoi |
|---|---|---|
| Vocabulaire, labels, sévérité, validation de paire | **`packages/contracts/src/audit/`** | Pur, sans Prisma ; consommé par `apps/web` (label-map), `apps/api` (validation), `apps/worker` (`audit-csv.generator.ts`, M-31) et `packages/imports-core` (M-7). C'est **G-PORTAL** : la déclaration est visible des 4 portails |
| Canonicalisation + hachage (fonctions pures) | **`packages/contracts/src/audit/`** | Même raison : le vérificateur de chaîne et l'écrivain doivent utiliser **le même** code, et l'un des deux peut vivre dans un script |
| `sanitiseInetOrNull`, `truncateUserAgent`, `MAX_USER_AGENT_LENGTH` | **déplacés** de `apps/api/src/modules/calendar/calendar-seed.service.ts:11-38` vers **`apps/api/src/shared/audit/`** | Hérité verbatim de `v3-e06/PROGRESS.md` : ces helpers vivent dans un module **fonctionnel**. **C'est la toute première tâche de `tasks.md`**, pour qu'une seconde copie ne soit jamais écrite |
| `deriveAlertActorProvenance` | **déplacé** de `apps/api/src/modules/alerts/alert-provenance.ts` vers **`apps/api/src/shared/audit/`**, renommé `deriveActorProvenance` | Même raison ; 6 sites d'import à mettre à jour (`alerts.controller.ts` ×4, `meeting-requests.controller.ts`, `calendar.controller.ts`) |
| L'écrivain lié à Prisma (`writeAuditRow`, `withAudit`) | **`apps/api/src/shared/audit/`** | Il dépend de `@prisma/client` |
| **Conséquence à nommer** | `apps/worker/src` et `packages/imports-core` **ne peuvent pas importer** `apps/api/src/shared/`. Les 2 sites de M-7 **restent donc hors de l'écrivain unique dans cet épic** — ils écrivent déjà dans la transaction (donc AC-2 tient pour eux), mais **ils n'hériteront pas** de la chaîne ni de la provenance IP/UA. **À écrire dans le « non revendiqué »**, pas à laisser sous-entendre. Si une slice ultérieure en a besoin : promouvoir en `@pilotage/audit-core`, en suivant le précédent `@pilotage/imports-core` (`ADR-024`) — hors périmètre ici |

---

## 3. Modèle de données

### 3.1 `AuditLog` — modifié (expand uniquement)

État actuel (`apps/api/prisma/schema.prisma:1225-1244`) — inchangé sauf mention :

```prisma
model AuditLog {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  actorId      String?  @map("actor_id") @db.Uuid
  actorRole    String?  @map("actor_role")
  portal       String?
  action       String
  resourceType String   @map("resource_type")
  resourceId   String?  @map("resource_id") @db.Uuid
  before       Json?
  after        Json?
  ipAddress    String?  @map("ip_address") @db.Inet
  userAgent    String?  @map("user_agent")
  hash         String?
  prevHash     String?  @map("prev_hash")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  // ── AJOUTS V3-E04 ────────────────────────────────────────────────────────
  seq          BigInt   @map("seq")           // ordre total, per-tenant chain order

  @@unique([tenantId, seq],  map: "audit_log_tenant_seq_uq")
  @@unique([tenantId, hash], map: "audit_log_tenant_hash_uq")   // nullable ⇒ les 54 héritées coexistent
  @@index([tenantId, createdAt])                                 // existant
  @@index([tenantId, resourceType, createdAt])                   // nouveau
  @@index([tenantId, actorId, createdAt])                        // nouveau
  @@index([tenantId, action, createdAt])                         // nouveau
  @@map("audit_log")
}
```

**Pourquoi `seq` et pas `createdAt`.** La chaîne a besoin d'un **prédécesseur déterministe**. `createdAt` est un
`timestamptz(6)` non unique : deux lignes dans la même microseconde rendent « la ligne précédente » ambiguë, et une
horloge qui recule rend la chaîne invérifiable. `seq` est monotone et strictement croissant ; l'ordre de chaîne est
`(tenantId, seq)`. La séquence est **globale** (donc les `seq` d'un tenant présentent des trous) : c'est voulu, `seq`
**ordonne**, il ne compte pas.

**`tenant_id` reste sans clé étrangère** (M-27, `PF-96`, ouvert). Les lignes d'audit survivent donc à leur tenant.
**Référencé, non corrigé ici** : ajouter la FK est une migration de type *contract* qui exige d'abord un relevé
d'orphelins sur des données que cette routine ne peut pas inspecter en hébergé.

**Aucune colonne n'est supprimée, aucune n'est rendue `NOT NULL`.** `hash`/`prev_hash` restent nullables —
**définitivement**, pas temporairement : les lignes antérieures au genesis n'en auront jamais (`A-01`), et prétendre
le contraire par un `NOT NULL` obligerait à fabriquer des valeurs.

**Contraintes ajoutées (SQL, sans équivalent Prisma) :**
```sql
ALTER TABLE audit_log ADD CONSTRAINT audit_log_hash_hex_chk
  CHECK (hash IS NULL OR hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_prev_hash_hex_chk
  CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$') NOT VALID;
-- puis, dans une instruction séparée :
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_hash_hex_chk;
```
`NOT VALID` puis `VALIDATE` : la forme sûre en hébergé (pas de scan sous verrou exclusif). Le format hexadécimal
minuscule sur 64 caractères est ainsi **non représentable autrement**, sans changer le type de colonne.

### 3.2 `AuditChainAnchor` — nouveau modèle (le genesis déclaré)

```prisma
/// Genesis déclaré de la chaîne d'audit, une ligne par tenant.
/// La chaîne d'un tenant commence à `genesisSeq` ; toute ligne de `audit_log`
/// dont `seq < genesisSeq` est **héritée** : ni chaînée, ni exprimée dans le
/// vocabulaire canonique, et déclarée telle — jamais réécrite (risque A-01).
model AuditChainAnchor {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @unique @map("tenant_id") @db.Uuid
  genesisSeq        BigInt   @map("genesis_seq")
  genesisHash       String   @map("genesis_hash")            // 64 hex — le prevHash de la 1re ligne canonique
  algorithm         String   @default("sha256-jcs-v1")
  vocabularyVersion Int      @default(1) @map("vocabulary_version")
  legacyRowCount    Int      @map("legacy_row_count")        // mesuré à la déclaration, jamais supposé
  declaredAt        DateTime @default(now()) @map("declared_at") @db.Timestamptz(6)
  note              String?

  @@map("audit_chain_anchor")
}
```

- **`genesisHash`** n'est pas aléatoire : c'est
  `sha256("pilotage-audit-genesis-v1|" + tenantId + "|" + declaredAt.toISOString() + "|" + legacyRowCount)`.
  Il est donc **reproductible** à partir de la ligne d'ancrage elle-même — un vérificateur peut le recalculer et
  détecter qu'on a bricolé l'ancrage.
- **`legacyRowCount`** rend le trou **chiffré et stocké**, au lieu d'une phrase dans un document. Ce que cela
  détecte, exactement : une **insertion ou suppression** de lignes antérieures au genesis (le compte ne correspond
  plus). Ce que cela **ne** détecte **pas** : une **modification de contenu** d'une ligne héritée. Le dire, plutôt
  que de laisser lire « les anciennes lignes sont protégées ».
- **Une frontière, deux significations.** `genesisSeq` sépare *à la fois* chaîné/non-chaîné et
  canonique/hérité — parce que la même migration pose les deux **au même instant**. C'est une simplification
  délibérée (une frontière au lieu de deux colonnes qui pourraient diverger, forme `R-26`). Si une slice future
  devait les désolidariser, elle devrait ajouter une seconde colonne, et le dire.
- **`vocabularyVersion`** existe pour qu'un futur changement de vocabulaire soit **représentable** sans réécriture.
  Il vaut `1` partout dans cet épic ; aucun code ne branche dessus.

### 3.3 `Tenant.timezone` — nouvelle colonne (additive)

```prisma
model Tenant {
  // …
  timezone String @default("Europe/Paris")   // AJOUT V3-E04
}
```

**Pourquoi.** `to=2026-08-08` doit signifier « toute la journée du 8 août », et « la journée » n'existe pas sans
fuseau. Mesuré : `Tenant` n'a pas de fuseau (M-26) ; `School.timezone` existe mais `AuditLog` n'a **pas** de
`schoolId`, et un tenant peut avoir plusieurs écoles dans des fuseaux différents — le fuseau **doit** donc être une
propriété du tenant.

Deux options ont été pesées :
- lire `Tenant.settings` (`Json @default("{}")`, déjà là, **zéro migration**) — rejeté : non typé, non contraint,
  invisible au drift-gate `S-E02-5`, et le prochain lecteur ne saurait pas que la clé existe ;
- **une colonne dédiée, `NOT NULL DEFAULT 'Europe/Paris'`** — retenu. Additive, valeur par défaut non volatile
  (donc pas de réécriture de table en PG 11+), rollback = `DROP COLUMN`.

**Le fuseau n'est jamais fourni par le client.** S'il l'était, deux admins verraient des comptes différents pour le
même filtre — précisément le défaut G-TRUTH que cet épic corrige. Il est résolu côté serveur et **renvoyé** dans la
réponse (`filters.timezone`, voir `openapi.yaml`) pour que l'UI puisse l'afficher.

### 3.4 Ce qui n'est **PAS** ajouté, et pourquoi

| Envisagé | Verdict | Raison |
|---|---|---|
| `enum` Postgres pour `action` / `resource_type` | **Rejeté** | §2.3 — une migration par fonctionnalité, et les 54 lignes échoueraient au cast |
| `AuditLog.schoolId` | **Rejeté** | Aucun besoin lisible dans cet épic ; le fuseau est résolu au tenant (§3.3). Une colonne ajoutée « au cas où » est une colonne qui sera nulle partout |
| Table `AuditRetentionPolicy` | **Hors périmètre**, par le contrat d'épic | Rétention / legal-hold demandent un avis juridique (adjacent à `D-08`) |
| FK `audit_log.tenant_id → tenant.id` | **Hors périmètre** | `PF-96`, ouvert. Migration de type *contract*, exige un relevé d'orphelins en hébergé |
| `AuditLog.hash`/`prev_hash` en `NOT NULL` | **Impossible** | `A-01` — le backfill des lignes pré-V3 est impossible ; les rendre obligatoires imposerait de **fabriquer** des valeurs |
| Modèle pour `/admin/reports` | **Aucun** | AC-5 est satisfait en **retirant l'entrée de navigation** (§6). Une page de rapports future lirait les agrégats `analytics/*` existants et ne demanderait aucun schéma |
| Table d'événements de connexion (pour `adminLogins`) | **Rejeté dans cet épic** | L'API est sans état (JWT) : il n'existe **aucun** événement de connexion à capter (M-20). Le produire demanderait un *event-listener SPI* Keycloak ou un ping `/auth/session` — une nouvelle surface d'intégration, avec son propre ADR. La carte est **remplacée** (§3.6), pas rafistolée |

### 3.5 La chaîne : préimage, canonicalisation, concurrence

**D-18 — préimage.** Pour une ligne canonique :
```
preimage = prevHash + "\n" + JCS({
  tenantId, seq, actorId, actorRole, portal, action, resourceType,
  resourceId, before, after, ipAddress, userAgent, createdAt   // createdAt en ISO-8601 UTC
})
hash = sha256hex(preimage)
```
où **JCS** = RFC 8785 (JSON Canonicalization Scheme : clés triées, échappement et nombres canoniques).

**Le piège, nommé plutôt que découvert en revue.** `before`/`after` sont des colonnes `jsonb`. PostgreSQL
**normalise** le `jsonb` : il trie les clés, **écarte les clés dupliquées**, et canonicalise les nombres. Si
l'écrivain hache la valeur *telle qu'il l'a en mémoire* et que le vérificateur hache la valeur *relue de la base*,
les deux peuvent différer — et la chaîne serait rouge sur des données parfaitement saines (le piège `R-30` :
une gate qui devient faussement rouge apprend aux gens à l'ignorer). Divergences possibles, et leur traitement :

| Divergence `jsonb` | Traitement |
|---|---|
| Ordre des clés | **Neutralisé** : JCS trie des deux côtés |
| Clés dupliquées | **Impossible** : la source est un objet JS |
| Nombres non finis (`NaN`, `Infinity`) | **Refusés à l'écriture** par un garde-fou explicite (le `jsonb` les rejette aussi) |
| Précision numérique | `jsonb` stocke en `numeric` (plus précis qu'un double) ; la valeur **venant** d'un double JS, aucun aller-retour ne perd d'information |
| `U+0000` dans une chaîne | **PostgreSQL rejette** `U+0000` en `jsonb` → refusé à l'écriture, avec un message explicite |
| `undefined` dans un objet | **Refusé à l'écriture** (JCS ne le représente pas, `JSON.stringify` le supprime silencieusement) |

**Chaque ligne de ce tableau doit avoir un test d'aller-retour** (écrire → relire → recalculer → comparer). C'est le
test le plus rentable de la slice chaîne : sans lui, la chaîne est rouge en production sur la première charge utile
inhabituelle.

**D-19 — concurrence.** Deux transactions concurrentes du même tenant qui liraient la même queue de chaîne
produiraient une **fourche**. Sérialisation retenue :
```sql
SELECT genesis_seq FROM audit_chain_anchor WHERE tenant_id = $1 FOR UPDATE;   -- 1re instruction de l'écriture
```
Le verrou est pris sur la **ligne d'ancrage** (une par tenant), donc :
- toutes les écritures d'audit d'un tenant se **sérialisent** — acceptable : le volume d'audit est faible (M-1 : 54
  lignes) et la correction de la chaîne en dépend ;
- l'écriture d'audit doit être la **dernière** instruction de la transaction de l'appelant, pour tenir le verrou le
  moins longtemps possible ;
- le risque d'interblocage est structurellement borné : **une seule** ligne verrouillable par tenant, toujours prise
  en dernier, donc jamais dans un ordre différent d'une transaction à l'autre. À **asserter** par un test à deux
  transactions concurrentes, pas à supposer.
- `@@unique([tenantId, seq])` et `@@unique([tenantId, hash])` sont les **filets** : même si le verrou était mal pris,
  une fourche déclencherait une violation d'unicité — donc un échec bruyant, jamais une chaîne silencieusement
  cassée.

**D-20 — l'ancrage doit préexister.** Si la ligne d'ancrage manque, l'écriture **échoue** (`DNC-08` : ce qui ne peut
pas s'exécuter doit **échouer**, jamais être sauté). L'ancrage est créé (a) par la migration, pour tous les tenants
existants ; (b) par une transaction **séparée et committée** au provisionnement d'un tenant. Il n'est **jamais**
créé paresseusement à l'intérieur de la transaction de l'appelant : une violation d'unicité sur cet `upsert`
annulerait la mutation métier de l'appelant pour une raison qui ne le concerne pas.

### 3.6 Les quatre KPI — définitions exécutoires (G-TRUTH)

**D-21 — les quatre KPI sont calculés sur le filtre actif.** M-22 est le défaut : trois compteurs *all-time* posés à
côté d'un tableau filtré, qui le contredisent en silence.

**D-22 — chaque KPI transporte sa portée.** L'enveloppe est `{ value: number, scope: 'filtered' | 'all_time' }`.
Aujourd'hui les quatre valent `filtered` ; le champ `scope` existe pour qu'une exception délibérée soit
**représentable et visible**, jamais implicite.

| Clé | Définition exécutoire | Portée | Remplace |
|---|---|---|---|
| `eventsInRange` | `count(*)` sur le `where` filtré **complet** | `filtered` | `today` (un compteur « aujourd'hui » à côté d'un tableau filtré **est** le défaut G-TRUTH) |
| `criticalChanges` | `count(*)` sur le filtre **∩** `action ∈ AUDIT_CRITICAL_ACTIONS` (déclaré en contracts, §2.3) | `filtered` | la liste `['delete','Suppression','Révision','revise']` (M-18), qui enjambe deux vocabulaires et n'en touche correctement aucun |
| `sensitiveExports` | `count(*)` sur le filtre **∩** `resourceType = 'export_job'` — **structurel**, plus une recherche de sous-chaîne | `filtered` | `action contains 'Export'` (M-19), qui dépend d'une casse et d'une langue |
| `distinctActors` | `count(distinct actor_id)` sur le filtre, `actor_id` non nul | `filtered` | **`adminLogins`** — mesuré `0` et **structurellement toujours `0`** (M-20) |

**D-23 — `adminLogins` est supprimé, pas réparé.** Une carte qui ne peut afficher que `0` est une contre-vérité de
produit. Le remplacement (`distinctActors`) est calculable à partir des données qui existent. **Conséquence de
contrat à énoncer** : la clé `kpis.adminLogins` disparaît de la réponse — c'est un **changement cassant** pour
`apps/web/src/app/admin/audit/page.tsx:26-31`, dont c'est **l'unique consommateur** ; les deux atterrissent dans la
même PR (même schéma que `S-E06-6`).

**D-24 — G-TRUTH est prouvée par une fixture commune.** Un même jeu de lignes doit donner, pour le même filtre, des
KPI *et* un `total` de tableau **cohérents par construction** : `eventsInRange === total`. C'est une **assertion**,
pas une remarque : elle attrape la classe entière de défauts.

---

## 4. `HOP-1` — la procédure qui épingle le nombre de sauts

**À exécuter avant que `H` n'entre dans le code.** Tant qu'elle n'a pas été exécutée, `H` est **indéfini** et la
provenance vaut `null` (D-4/D-7).

1. Depuis un navigateur réel, atteindre une page authentifiée qui déclenche une server action auditée.
2. Dans `apps/web`, journaliser **temporairement** l'intégralité de `X-Forwarded-For`, `X-Real-Ip` et
   `Forwarded` reçus (jamais en production, jamais committé).
3. Compter les entrées et identifier la position de l'IP publique réelle du client, en partant de la **droite**.
4. `H` = nombre d'entrées à droite de l'IP client. Hypothèse à falsifier : `H = 2` (Traefik, nginx).
5. Répéter **derrière chaque chemin d'accès** utilisé en production (accès direct, VPN, éventuel CDN). Si les
   valeurs diffèrent, `H` **n'est pas épinglable** — et la décision correcte est alors `null`, pas une moyenne.
6. Consigner la valeur, la date et la topologie mesurée dans l'ADR **et** dans le runbook de déploiement, avec la
   règle : *toute modification de la topologie de proxy invalide `H` et impose de refaire `HOP-1`*.

---

## 5. Plan de migration — non destructif, expand/contract

**Contexte mesuré, à ne pas perdre de vue** : `apps/api/prisma/migrations/` ne contient que `0_baseline` (M-25), et
`S-E02-5` a installé une gate de dérive qui **rejoue le registre de migrations dans une base jetable et le compare à
`schema.prisma`**. Donc : **aucun `db push`**, jamais. Chaque changement de schéma est un **fichier de migration
relu**, généré avec `prisma migrate dev --create-only` puis édité et revu.

**Rappel opérationnel (déjà rencontré sur E11-S1/S2 et E11-S3)** : toute modification additive de `schema.prisma`
rend `pnpm typecheck` **ROUGE** tant que `prisma generate` n'a pas été relancé. C'est mécanique, pas un défaut de
conception — à énoncer dans la slice pour qu'aucune revue ne re-scope le travail sur cette base.

| # | Slice | Change le schéma ? | G-MIGRATION | Contenu | Rollback |
|---|---|---|---|---|---|
| **M1** | Provenance partagée + ADR trust-proxy | **NON** | ne se déclenche pas | Déplacements de fichiers, `shared/audit/`, les 8 sites de M-6, `infra/nginx` (strip d'en-têtes), `apps/web` (transmission explicite). **À dire explicitement dans la PR**, plutôt que de laisser la question ouverte | `git revert` |
| **M2** | Vocabulaire canonique | **NON** | ne se déclenche pas | `packages/contracts/src/audit/`, correction du **seed**, label-map dérivé, gate de vocabulaire. Aucune ligne existante n'est touchée | `git revert` (+ rebuild `contracts`) |
| **M3** | Filtres + KPI | **OUI**, 1 colonne | **se déclenche** | `ALTER TABLE tenant ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';` — défaut non volatile ⇒ **pas de réécriture de table** en PG 11+ | `ALTER TABLE tenant DROP COLUMN timezone;` — sans perte (valeur dérivable) |
| **M4** | Chaîne de hachage + genesis | **OUI**, 1 colonne + 1 table + 4 index + 2 CHECK | **se déclenche**, fortement | voir ci-dessous | voir ci-dessous |

### M4 en détail — la seule migration délicate

```sql
-- (a) colonne nullable d'abord : pas de défaut volatil, donc pas de réécriture de table
ALTER TABLE audit_log ADD COLUMN seq bigint;

-- (b) séquence dédiée
CREATE SEQUENCE audit_log_seq_seq OWNED BY audit_log.seq;

-- (c) backfill dans l'ordre physique déclaré (déterministe : created_at puis id)
--     À l'échelle mesurée (54 lignes) une seule instruction suffit ; en hébergé,
--     la boucle par lots de 10 000 est la forme sûre — les deux sont écrites,
--     la seconde est celle qui part.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM audit_log
)
UPDATE audit_log a SET seq = o.rn FROM ordered o WHERE a.id = o.id;

-- (d) recaler la séquence puis attacher le défaut
SELECT setval('audit_log_seq_seq', COALESCE((SELECT max(seq) FROM audit_log), 0));
ALTER TABLE audit_log ALTER COLUMN seq SET DEFAULT nextval('audit_log_seq_seq');
ALTER TABLE audit_log ALTER COLUMN seq SET NOT NULL;

-- (e) unicité — voir la note CONCURRENTLY ci-dessous
CREATE UNIQUE INDEX audit_log_tenant_seq_uq  ON audit_log(tenant_id, seq);
CREATE UNIQUE INDEX audit_log_tenant_hash_uq ON audit_log(tenant_id, hash);
CREATE INDEX audit_log_tenant_resource_created_idx ON audit_log(tenant_id, resource_type, created_at);
CREATE INDEX audit_log_tenant_actor_created_idx    ON audit_log(tenant_id, actor_id, created_at);
CREATE INDEX audit_log_tenant_action_created_idx   ON audit_log(tenant_id, action, created_at);

-- (f) l'ancrage, et le genesis déclaré — une ligne par tenant AYANT des lignes d'audit
CREATE TABLE audit_chain_anchor ( … );
INSERT INTO audit_chain_anchor (id, tenant_id, genesis_seq, genesis_hash,
                                algorithm, vocabulary_version, legacy_row_count, declared_at)
SELECT gen_random_uuid(), tenant_id, max(seq) + 1, '<calculé côté application>',
       'sha256-jcs-v1', 1, count(*), now()
FROM audit_log GROUP BY tenant_id;
```

**Trois pièges, nommés :**

1. **`CREATE INDEX CONCURRENTLY` ne peut pas s'exécuter dans une transaction**, et Prisma exécute chaque fichier de
   migration dans une transaction. À l'échelle mesurée (54 lignes) l'index non concurrent est instantané et c'est la
   forme retenue. **En hébergé sur une table volumineuse, ce serait un verrou `SHARE` bloquant les écritures** — la
   forme sûre est alors un fichier de migration séparé marqué pour exécution hors transaction. À décider avec le
   volume hébergé réel, qui est `NON MESURÉ`.
2. **`genesis_hash` n'est pas calculable en SQL pur** (il dépend de `declaredAt` et d'un sha256 sur une chaîne
   composée). Deux options : (i) l'`INSERT` pose un `genesis_hash` provisoire et un script de migration applicatif
   relu le remplace dans la même transaction ; (ii) `pgcrypto` (`digest()`) — mais l'extension doit être déclarée
   (`ADR-014` liste les extensions). **Option (i) retenue** : moins d'hypothèses sur l'environnement.
3. **Un tenant sans aucune ligne d'audit n'obtient pas d'ancrage** par le `GROUP BY` ci-dessus. Son ancrage est créé
   au provisionnement (D-20), avec `genesis_seq = 1` et `legacy_row_count = 0`. À couvrir par un test : *un tenant
   neuf écrit sa première ligne d'audit et la chaîne vérifie*.

### Ce qui reste explicitement en phase *contract* — donc hors de cet épic

- `hash` / `prev_hash` en `NOT NULL` — **impossible** (`A-01`).
- FK `audit_log.tenant_id → tenant.id` — `PF-96`, exige un relevé d'orphelins.
- Suppression ou réécriture des lignes héritées — **interdit** (`A-01`, D-14).
- Toute politique de rétention / purge — hors périmètre par le contrat d'épic (adjacent `D-08`).

---

## 6. Gates — comment chacune **sera** prouvée

> Aucune n'est déclarée satisfaite. Chaque ligne dit **quelle exécution** produira la preuve.

| Gate | Ce qu'elle exige ici | Comment elle sera **prouvée** |
|---|---|---|
| **G-AUDIT** (primaire) | Une ligne d'audit écrite **dans la même transaction** que la mutation, portant acteur, rôle, tenant, IP/UA et before/after | **(a)** Un test de rollback : on force l'échec de la mutation **après** l'écriture d'audit → **ni** la ligne métier **ni** la ligne d'audit n'existent ; puis on force l'échec de l'écriture d'audit → la mutation **n'existe pas non plus**. Les deux sens, pas un seul. **(b)** Le test doit être prouvé **capable d'échouer** : en revenant à la forme mesurée en M-9 (`create` puis `auditLog.create` séparés), il doit devenir rouge. **(c)** Une gate de source comptant `auditLog.create` sur **les trois** racines (`apps/api/src`, `apps/worker/src`, `packages/*/src`) — M-7 prouve qu'en oublier une donne un compte faux |
| **G-TENANT** | Toute nouvelle requête est clé-tenant ; un id d'un autre tenant est refusé sur tout nouveau chemin | Un test par nouveau point d'entrée avec un `tenantId` étranger → `403`/`404`, jamais une ligne. **Et il faut dire l'état réel du socle** : **RLS n'existe nulle part dans le dépôt** (M-24) — `ADR-002` la déclare, aucune migration ne crée de policy, et `ADR-032` (réservé à `V3-E01`) porte ce travail. Le tenant-scoping de cet épic est donc **applicatif seul**. Ne jamais écrire « RLS protège les lignes d'audit » |
| **G-AUTHZ** | `audit.read` est déjà exigé sur les deux points d'entrée existants ; tout nouveau point d'entrée exige un test négatif **par rôle** | Un test par rôle (`teacher`, `parent`, `student`, et un `school_admin` d'un autre tenant) → `403` sur `GET /analytics/audit-chain`. Un test positif pour `school_admin`/`super_admin` du bon tenant |
| **G-TRUTH** | La portée de **chaque** KPI est étiquetée et identique pour la même fixture | Test unitaire sur une fixture unique : les 4 KPI + `total` calculés sur le même filtre, avec `eventsInRange === total` (D-24) ; plus une assertion que chaque KPI porte un `scope`. Plus un test de **frontière** sur `to` : une ligne à `23:59:59` dans le fuseau du tenant **est** comptée |
| **G-PORTAL** | La déclaration de vocabulaire atterrit dans `packages/contracts`, donc visible des 4 portails | Vérifier `admin`, `teacher`, `parent`, `student` : (a) aucun ne casse à la compilation après l'ajout de `src/audit/` ; (b) `AUDIT_PORTALS` porte les **4** membres (D-16), et le fait que `PORTALS` en contracts n'en déclare que 3 (`PF-101`) est **référencé, pas corrigé** |
| **G-MIGRATION** | Fichier de migration relu, jamais `db push`, forme expand/contract, rollback énoncé | **M1 et M2 : ne se déclenche pas — dit explicitement, pas omis.** M3 et M4 : un fichier sous `apps/api/prisma/migrations/`, la gate de dérive `S-E02-5` verte (elle rejoue le registre et compare à `schema.prisma`), et le rollback écrit dans la PR |
| **G-DNC** | Aucun de `DNC-01`…`DNC-12` reproduit | **`DNC-08`** (le plus tranchant ici) : le vérificateur de chaîne ne doit **jamais** rendre « ok, sauté » — ancrage manquant, ligne illisible, algorithme inconnu produisent un **verdict d'échec nommé** (`openapi.yaml`, `AuditChainVerdict`). **`DNC-10`** : aucune variable d'environnement ne peut désactiver l'écriture d'audit, ni activer la confiance aveugle en `X-Forwarded-For` — à asserter en négatif. **`DNC-06`** : la validation du vocabulaire n'est pas une seconde implémentation de la liste — un seul tableau de descripteurs, tout est dérivé |

**AC-5 (`/admin/reports`) — verdict d'architecture.** Mesuré (M-29) : aucune page, un lien vivant dans la sidebar,
déjà inventorié comme mort. **Retirer l'entrée de navigation**, retirer la ligne de baseline correspondante, et
laisser `scripts/link-integrity-check.js` le prouver (la gate existe déjà, stage 13). Construire une page de
rapports serait une fonctionnalité nouvelle, sans besoin exprimé, dans un épic dont l'objet est la redevabilité —
et `/admin/analytics` couvre déjà le besoin. Aucun modèle de données. **Ce qui n'est pas revendiqué** : que le
besoin « rapports » n'existe pas — seulement qu'il n'appartient pas à cet épic.

---

## 7. ADR à ouvrir

**La règle de numérotation, d'abord** — parce que `PF-110` s'est produit exactement ici. `docs/adr/` est le
**registre de référence** ; `docs/daily-improvement-v3/architecture-impact.md` §4 est une liste de vœux. §4 réserve
`ADR-029` (V3-E07), `ADR-030` (V3-E11), `ADR-031` (V3-E15) et `ADR-032`…`ADR-035` (les quatre décisions non
écrites, dont **`ADR-035` = « Audit in-transaction, chain genesis, and the accepted pre-V3 gap », épic V3-E04**).
Prendre `ADR-029` « parce que c'est le premier fichier libre » **recréerait `PF-110`**. Donc :

| ADR | Titre | Quand il doit atterrir | Bloquant ? |
|---|---|---|---|
| **`ADR-035`** *(déjà réservé à V3-E04 par §4)* | **L'audit s'écrit dans la transaction ; la chaîne part d'un genesis déclaré et le trou pré-V3 est accepté** | Avec la slice **chaîne** (la dernière). Couvre D-8…D-11, D-18…D-20, `A-01` | **Oui** |
| **`ADR-036`** *(nouveau — premier numéro au-delà de toute réservation)* | **La provenance client derrière le proxy : un nombre de sauts épinglé, ou rien** | Avec la **première** slice, avant toute écriture de provenance. Couvre D-1…D-7 et `HOP-1` | **Oui** — c'est le précédent dont ~20 sites d'appel hériteront |
| **`ADR-037`** *(nouveau)* | **Le vocabulaire d'audit se déclare dans `packages/contracts`, pas en `enum` Postgres ; le libellé français est attaché au code** | Avec la slice **vocabulaire**. Couvre D-12…D-17 et le traitement des 54 lignes héritées | **Oui** — la déclaration est visible des 4 portails et la surface parent future en dépend (§8) |

**Chaque slice qui écrit un de ces ADR doit, dans le même diff, ajouter sa ligne à `architecture-impact.md` §4**,
sans quoi le registre repart en dérive. `ADR-036` et `ADR-037` ne *superseden*t rien ; `ADR-035` **précise**
`ADR-002` (le tenant-scoping de l'audit est applicatif tant que `ADR-032` n'a pas livré RLS) et **précise**
`ADR-015` (le rôle d'acteur d'une ligne d'audit est le rôle **réel** du porteur du jeton, résolu par précédence,
jamais le rôle attendu par la surface).

**`ADR-036` est indissociable de `ADR-037` sur un point** : une chaîne calculée par-dessus un `actorRole` littéral,
une `ipAddress` qui est celle du conteneur web et un `userAgent` toujours nul produirait un **enregistrement
cryptographiquement vérifiable de faussetés** — pire que le vide honnête que le principe de l'épic exige. C'est la
raison de l'ordre imposé : **la provenance d'abord, la chaîne en dernier.**

---

## 8. Ce qui n'est **pas** revendiqué (ledger)

| Affirmation qu'on pourrait lire | Ce qui est vrai |
|---|---|
| « `/admin/audit` plantait, et cet épic le corrige » | **Non mesuré dans les deux sens.** Le crash ne se reproduit pas statiquement ; le rendu authentifié n'a pas été observé (sonde live = `307` vers le login). AC-1 se ferme par **un rendu authentifié**, pas par de la lecture de code |
| « Toutes les mutations privilégiées seront auditées » | AC-2 énumère la finance : **il n'y a pas de module finance** (M-30). `schools/` et `enrollments/` n'écrivent **aucune** ligne d'audit aujourd'hui. Le périmètre réel de chaque slice est énuméré dans `tasks.md`, pas déduit d'AC-2 |
| « L'IP d'audit est celle de l'opérateur » | Elle le sera **si et seulement si** `HOP-1` a été exécutée, `H` épinglé, la transmission `apps/web` livrée et le strip nginx en place. Avant cela, elle vaut **`null`** — délibérément |
| « La chaîne protège l'historique d'audit » | Elle protège les lignes **à partir du genesis**. Les **54** lignes antérieures (M-1) ne sont **pas** chaînées et ne le seront jamais (`A-01`). L'ancrage stocke leur **compte**, ce qui détecte une insertion/suppression, **pas** une modification de contenu |
| « Le vocabulaire est unifié » | Il le sera pour les lignes **canoniques**. Les 54 lignes héritées gardent leurs chaînes françaises et sont **rendues comme telles**, jamais traduites après coup |
| « Les écritures du worker héritent de la chaîne » | **Non.** Les 2 sites de `packages/imports-core` (M-7) écrivent dans la transaction — donc AC-2 tient pour eux — mais ne peuvent pas importer `apps/api/src/shared/`, donc **ils n'auront ni chaîne ni provenance IP/UA** dans cet épic. Une promotion en `@pilotage/audit-core` est hors périmètre |
| « RLS protège les lignes d'audit » | **RLS n'existe nulle part dans le dépôt** (M-24). Le scoping est applicatif. `ADR-032` / `V3-E01` porte ce travail |
| « L'export CSV d'audit est cohérent avec l'UI » | `apps/worker/.../audit-csv.generator.ts` exporte `action` **brut** (M-31). C'est un **troisième** consommateur du vocabulaire : à traiter dans la slice vocabulaire, ou à énoncer comme non traité |
| « L'enveloppe KPI est la forme canonique du projet » | **Non.** `architecture-impact.md` §4 réserve **`ADR-034`** (« Canonical read projections : versioning, freshness contract, **KPI envelope** ») à **`V3-E03`**. L'enveloppe définie ici est **minimale et locale** ; elle est offerte comme **entrée** à `V3-E03`, et cet épic ne revendique **pas** `ADR-034` |

**Idée directrice, coût nul dans cet épic.** Le vocabulaire est déclaré dans `packages/contracts` — et non dans un
fichier de constantes local à l'admin — parce qu'une surface parent « qui a consulté les données de mon enfant »
(droit d'accès RGPD, posture du cahier des charges) se réduirait alors à *un endpoint de lecture et une page*.
Le champ `parentVisible` du descripteur (§2.3) existe pour cela et **n'est lu par aucun code de cet épic** : c'est
une place réservée déclarée, pas une fonctionnalité à moitié livrée. Déclaré autrement — du texte d'affichage dans
une colonne structurelle et un label-map dans un composant client admin — cette surface coûterait un second
vocabulaire et une seconde dérive.
