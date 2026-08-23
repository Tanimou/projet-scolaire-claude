# ADR-060 — Le sixième module entre dans la portée tenant, et le privilège que les écritures LISENT cesse d'être accidentel

- **Statut** : accepté
- **Date** : 2026-08-23
- **Tranche** : `S-E01-1l` (épique `V3-E01` — l'isolation tenant rendue réelle)
- **Remplace / complète** : ADR-048 (la couture), ADR-051 (liste d'énumération à deux couches),
  ADR-054 (conversion partielle), ADR-056 (la portée est une propriété du DÉPLOIEMENT),
  ADR-057 §D1/§D2/§D4 (clôture relation-profonde, portée dans le helper, le constructeur est la preuve),
  ADR-058 §D1 (une erreur rattrapée sort de sa portée), ADR-059 (clôture DÉRIVÉE, égalité bidirectionnelle)
- **Findings** : ferme `PF-254` **et** `PF-256` ; enregistre `PF-257`, `PF-258`, `PF-259`, `PF-260`, `PF-261`, `TOOL-41`

---

## Contexte

Cinq modules tournaient déjà entièrement dans `TenantScopeService.run` : `calendar`, `lessons`,
`announcements`, `remediation`, `student-portal`. La jauge de bascule mesurée avant cette tranche,
contre le conteneur `pilotage_postgres` :

```
AC-9 CUTOVER READINESS: 70 scoped + 120 enumerated / 818
```

`alerts` est le sixième. C'est aussi le premier module dont **une partie ne peut pas** entrer dans une
portée, et le premier à faire entrer une table **franchement write-only** — `audit_log` — dans la
clôture de privilèges. Ces deux faits sont ce que cet ADR enregistre.

---

## §D1 — La conversion, et les six instructions qui restent DEHORS avec leur mécanisme

`meeting-requests.service.ts` convertit **en entier** (5/5). `alerts.service.ts` convertit **26 de ses
32** instructions. Les six autres restent sur la connexion PROPRIÉTAIRE, **énumérées une par une**
dans `ENUMERATED_OUTSIDE_SCOPE` (`scripts/tenant-adversarial-check.js`), avec leur raison propre —
jamais « pas encore converti », qui n'est pas un mécanisme (ADR-048 §D6).

| Instruction | Mécanisme |
|---|---|
| `alertRule.findMany`, `academicYear.findFirst`, `alertInstance.findFirst`, `alertInstance.create` (`evaluateAll`) | c'est un **LOT**. `evaluateAll` ouvre en éventail sur sept évaluateurs `rules/*.rule.ts` qui émettent chacun leurs propres requêtes sur tout le tenant, puis boucle **par détection** sur une lecture de déduplication, une écriture et un fan-out de notifications. O(règles × détections) allers-retours, contre une couture qui borne explicitement une portée à « ≤ 2 instructions » et une transaction interactive Prisma qui coupe à 5 s. L'y enfermer rendrait **P2028** sur le bouton admin « Lancer l'évaluation » **et annulerait les alertes déjà matérialisées** dans le même passage. |
| idem, seconde raison indépendante | la convertir exige de retyper `RuleContext.prisma: PrismaService` en `Prisma.TransactionClient` et de convertir **sept** fichiers de règles — le rayon de souffle d'un autre module. À moitié convertie, elle mettrait des `ctx.prisma.*` sur la connexion propriétaire **à l'intérieur** d'une portée ouverte : l'inverse dangereux de PF-200, invisible au compilateur. |
| `guardianship.findMany` (`notifyGuardiansOfAlert`) | appelé **depuis** la boucle de l'évaluateur, et suivi immédiatement d'un `NotificationsService.createMany` qui détient le client propriétaire. |
| `alertRule.findMany` (`tenantsWithEnabledRules`) | ne prend **aucun** `tenantId` et fait `distinct` dessus : elle **PRODUIT** l'ensemble des tenants qu'un appelant scoperait. L'entrée d'une portée ne peut pas être émise depuis l'intérieur de cette portée. |
| `auditLog.create` (docblock de `writeAuditEntry`) | **ce n'est pas une instruction** : c'est un artefact du matcher texte, déclaré plutôt que caché — la forme PF-219 de `user-sync.service.ts`. Les deux côtés du cliquet sont dérivés du **même** matcher ; l'exclure discrètement serait une seconde liste invisible. |

**Chiffre mesuré après la tranche, exécuté deux fois, figures byte-identiques :**

```
AC-9 CUTOVER READINESS: the tenant scope covers only PART of the corpus
(101 scoped + 127 enumerated / 818)
```

Soit **+31 scoped**, **+7 enumerated**, dénominateur **inchangé** (aucune instruction ajoutée ni
supprimée). Le brief dimensionnait la tranche à « ~106 scoped » en supposant `evaluateAll` convertie ;
elle ne l'est pas, et le chiffre honnête est 101.

---

## §D2 — La règle : PostgreSQL exige `SELECT` sur toute colonne qu'une instruction **LIT**

`VERB_PRIVILEGES` donnait `create → [INSERT]`, `update → [UPDATE]`, `delete → [DELETE]`,
`upsert → [INSERT, UPDATE]`. **C'est faux, et de deux manières indépendantes.**

Une écriture lit des colonnes à deux endroits, tous deux produits par Prisma sans qu'on le demande :

1. **`RETURNING`** — les écritures singulières (`create`, `update`, `delete`, `upsert`) et
   `createManyAndReturn` rendent la ligne. PostgreSQL exige `SELECT` sur chaque colonne rendue.
2. **`WHERE`** — `update`, `updateMany`, `delete`, `deleteMany` lisent les colonnes de leur
   condition. Prisma compile `updateMany` en `UPDATE … WHERE id IN (SELECT …)`, ce qui rend la
   lecture explicite.

`createMany` est le **seul** verbe d'écriture qui ne rende rien et ne lise aucune condition : il garde
son privilège d'écriture seul.

La table corrigée :

| verbe | privilèges | pourquoi SELECT |
|---|---|---|
| `createMany` | `INSERT` | ne retourne rien, ne lit aucune condition |
| `create`, `createManyAndReturn` | `INSERT`, `SELECT` | `INSERT … RETURNING` |
| `update`, `updateMany` | `UPDATE`, `SELECT` | `RETURNING` (singulier) / `WHERE` (les deux) |
| `delete`, `deleteMany` | `DELETE`, `SELECT` | `RETURNING` (singulier) / `WHERE` (les deux) |
| `upsert` | `INSERT`, `UPDATE`, `SELECT` | les deux |

**La raison est écrite dans le code adjacent**, et un test l'exige (`tenant-adversarial-gate.spec.ts`) :
sans elle, la table se relit comme une symétrie lecture/écriture — ce qu'elle n'est pas — et invite à
« simplifier » exactement ce qui la rend correcte.

### Pourquoi CETTE tranche et pas une plus tard

Parce que le défaut était **accidentellement invisible** jusqu'ici. Jusqu'à `alerts`, toute table
ÉCRITE dans une portée avait aussi un site de LECTURE dans la même clôture, qui apportait le `SELECT`
manquant. `audit_log` est la **première table franchement write-only** à entrer dans une portée :
`alerts` l'écrit à trois sites et ne la lit **jamais**. Une dérivation sans la règle aurait donc
déclaré `audit_log.INSERT` seul, certifié `enforcing: true`, et laissé un cluster répondre 42501 sur
la première écriture d'audit.

La liste **déclarée** connaissait pourtant déjà les deux moitiés : `tenant-scope.ts` motive
`remediation_plan.INSERT` par l'`INSERT … RETURNING` de son `include`, et `remediation_plan.UPDATE`
par « les deux `updateMany`, dont le `WHERE` exige `SELECT` sur les colonnes qu'il lit ». C'est la
**table de correspondance** qui ignorait la règle que la liste écrite à la main appliquait déjà.
`PF-254` couvrait la moitié `RETURNING` ; la moitié `WHERE` est enregistrée comme `PF-256` et corrigée
dans le **même** diff, parce que fermer `PF-254` par-dessus son propre résidu aurait reproduit le
défaut un verbe plus loin.

**Coût mesuré de la correction** : la clôture repo-wide passe de 167 à 170 paires (table, privilège),
**168 satisfaites, 2 non** — les deux non satisfaites sont `tenant/INSERT` et `tenant/UPDATE`,
inchangées et préexistantes. Aucune nouvelle paire non satisfaite. La correction est **gratuite
aujourd'hui**, elle ne le serait plus après un module de plus.

---

## §D3 — Latent, pas vécu. Dit sans l'enfler.

**MESURÉ le 2026-08-23 sur le conteneur `pilotage_postgres` en cours d'exécution**, avant toute
déclaration :

```
$ docker exec pilotage_postgres psql -U pilotage -d pilotage -Atc \
  "select table_name, privilege_type from information_schema.role_table_grants
   where grantee='app_user' and table_name in
   ('alert_rule','alert_instance','meeting_request','audit_log') order by 1,2;"

alert_instance|DELETE     alert_rule|DELETE      meeting_request|DELETE
alert_instance|INSERT     alert_rule|INSERT      meeting_request|INSERT
alert_instance|SELECT     alert_rule|SELECT      meeting_request|SELECT
alert_instance|UPDATE     alert_rule|UPDATE      meeting_request|UPDATE
audit_log|INSERT
audit_log|SELECT
```

`app_user` détient `SELECT, INSERT` sur `audit_log` — **et rien d'autre**, délibérément
(migration `20260813120000_tenant_rls_policies`, `append_only := ARRAY['audit_log',
'conversation_message']` ; ADR-037 §D4 / GUARDRAILS §1 : la chaîne de hachage d'audit ne doit pas
devenir réinscriptible). **Donc le runtime FONCTIONNE et le défaut était LATENT sur ce déploiement,
pas vécu.** Aucun incident de production n'a eu lieu et aucun n'était possible sur un cluster
correctement migré.

Ce qui était faux, c'est la **DÉRIVATION**. Et le durcissement naturel d'une table append-only est
`GRANT INSERT` seul — contre lequel la sonde de démarrage aurait dit **vert** pendant que la première
écriture d'audit levait 42501. C'est la valeur de la correction, et c'est tout ce qu'elle vaut.

---

## §D4 — Le cliquet « le constructeur est la preuve » s'applique à UN des deux services

`MeetingRequestsService` atteint ADR-057 §D4 : `constructor(private readonly scope: TenantScopeService) {}`,
aucune référence au client propriétaire, aucune importation de `prisma.service`.

`AlertsService` **garde** `PrismaService`, et c'est une **décision**, pas un oubli. `evaluateAll`,
`notifyGuardiansOfAlert` et `tenantsWithEnabledRules` sont réellement sur la connexion du
propriétaire ; le simuler en masquant le client derrière un helper serait une **preuve fausse**. Le
constructeur devient `(scope, prisma, notifications)`, dans cet ordre, et le paramètre `prisma` porte
un commentaire qui nomme les trois méthodes qui l'utilisent.

---

## §D5 — G-AUDIT : la relation transactionnelle est **INCHANGÉE**, et la lecture naïve l'aurait aggravée

**MESURÉ** : `alerts.service.ts` ne contient **aucun** `$transaction`. Les trois `auditLog.create` du
module (`alert.meeting_intent`, les transitions de cycle de vie, `meeting_request.resolve`) étaient
donc déjà **post-mutation, best-effort, chacun sa propre instruction, avec un `catch` qui avale**.

Chacun garde exactement cette relation : **sa propre portée**, jamais celle de la mutation qu'il
consigne, avec le `try {` avant le `run` et le `catch` après.

Cette tranche **ne rend pas la piste d'audit transactionnelle**, et ne l'affaiblit pas non plus.

La lecture naïve — « une portée par handler » — aurait été **strictement pire** que l'état actuel.
Dans une portée unique, un `auditLog.create` en échec **AVORTE** la transaction interactive ; le
`catch` existant l'avale ; `run` atteint alors le `COMMIT`, qui dégénère en `ROLLBACK` — et
**l'acquittement / la résolution / la demande de rendez-vous que la ligne d'audit se contentait de
CONSIGNER est perdu en silence pendant que le handler rend 200**. « Audit best-effort » serait devenu
« jeter la mutation en silence ».

---

## §D6 — Ce qui est resté à la main, et ce qui a été mécanisé

La **troisième liste** — `déclaré ⊆ matrice de grants` — n'est toujours pas mécanisée dans son
entier (`PF-257`). Elle a été **acquittée par MESURE** avant déclaration (§D3), ce qui est la
discipline ADR-057/ADR-058 et non une dispense.

Une moitié **est** mécanisée par cette tranche, sans base de données, parce que c'est celle que cette
tranche rend atteignable : `tenant-adversarial-gate.spec.ts` exige qu'**aucune paire déclarée ne
réclame `UPDATE`/`DELETE` sur une table `APPEND_ONLY`**. La tentation naturelle sur `audit_log` (« la
table est écrite, déclarons `UPDATE` ») serait précisément la panne — `refused_unusable` au démarrage,
donc **503 sur les quatre portails**, pas un échec circonscrit au module fautif.

L'autre moitié — l'appartenance aux 44 tables tenant — reste `PF-257`, ouverte et nommée.

---

## §D7 — ADR-058 §D1 n'est prouvable que LEXICALEMENT, et alerts en multiplie les instances

`alerts` porte **cinq** récupérations qui avalent et continuent (P2002 de `recordMeetingIntent`,
l'audit d'intention, `resolveMeetingAssignee`, `writeAuditEntry`, `loadMeetingRequestedAt`) plus une
sixième dans `meeting-requests.service.ts` — contre **trois** pour `remediation`. À partir de cette
tranche, la **majorité** des instances de la règle vit dans ce module.

La règle est appliquée partout : `try {` avant `this.scope.run(…)`, `catch` après, et toute
instruction de récupération ouvre une portée **FRAÎCHE** (le `findUnique` du gagnant après P2002).

**La preuve reste LEXICALE, et c'est une limite à écrire, pas à contourner (`PF-247`)** : un faux
`run` qui appelle `fn(client)` n'ouvre aucune transaction, donc **rien ne peut être avorté**, donc
aucun test à faux client ne peut distinguer « la récupération ouvre une portée fraîche » de « elle
réutilise une transaction morte ». `alerts-scope-ownership.spec.ts` assied donc la propriété sur le
texte source ; le cliquet reste **par module**, ce que `TOOL-41` enregistre.

Une conséquence nouvelle, et corrigée ici : `resolveMeetingAssignee` **persiste** sa dégradation
(`assignedToId: null`, écrit une fois pour toutes). Avant la conversion, ses seules erreurs possibles
étaient des pannes base. La conversion **ajoute** une classe d'erreur — le refus de portée
(`ServiceUnavailableException`, `TenantScopeError`) — et l'avaler ferait d'un défaut de configuration
une perte silencieuse sur la promesse centrale du produit : le parent demande, l'enseignant ne voit
jamais. Ces deux classes **REMONTENT** désormais ; tout ce qui pouvait déjà échouer avant dégrade
exactement comme avant (`PF-258`).

---

## Conséquences

- **Aucune migration, aucun changement de schéma, aucune entrée `scripts/restore-drill-baseline.json`**
  (PF-80 ne s'arme pas). Aucun changement de `packages/contracts` : les DTO sont identiques byte à byte.
- `APP_ROLE_REQUIRED_PRIVILEGES` passe de **38 à 47** paires. Les neuf ajoutées sont **celles que la
  dérivation a nommées**, lues dans la sortie du contrôleur puis déclarées à l'identique — jamais
  devinées. L'égalité d'ensembles bidirectionnelle tient : `47 déclarées === 47 dérivées`.
- Le garde-fou `POSITIONAL attribution refuses the phantom audit_log.INSERT` est **retiré**. Il
  existait parce qu'aucun `auditLog.create` du corpus ne vivait dans une portée ; `alerts` en met
  trois. Une sentinelle qui survit à sa prémisse cesse de tester le mécanisme et se met à tester le
  passé — et aurait ici viré au rouge sur une conversion correcte.
- Aucun drapeau, aucune branche `NODE_ENV`, aucun plancher de ratio, aucun mode « warn-only », aucune
  relaxation d'un étage de `scripts/ci-gate.sh` (DNC-10).

## Retour arrière

Remplacer chaque `this.scope.run(args.tenantId, tx => …)` par `this.prisma` rétablit mot pour mot le
comportement d'avant la tranche, retirer le bloc `alerts` de `APP_ROLE_REQUIRED_PRIVILEGES` et
l'entrée `alerts.service.ts` de `ENUMERATED_OUTSIDE_SCOPE`. La correction de `VERB_PRIVILEGES` est
**indépendante** de la conversion et ne doit pas être annulée avec elle : elle est correcte sur les
cinq modules déjà convertis aussi.
