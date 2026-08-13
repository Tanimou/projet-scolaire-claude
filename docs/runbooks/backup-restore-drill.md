# Runbook — Répétition sauvegarde → restauration chronométrée (S-E02-3 / VAL-03 / R-01)

**Public.** Opérateur ou routine disposant du stack Docker **local**.
**Durée.** ~25 s sur le jeu de démo (13 550 lignes). **Écritures.** Aucune sur la base source — le drill crée puis
détruit une base *scratch* dédiée.
**Artefact.** [`scripts/restore-drill.js`](../../scripts/restore-drill.js) · baseline
[`scripts/restore-drill-baseline.json`](../../scripts/restore-drill-baseline.json) · garde
[`apps/api/src/shared/quality/restore-drill-gate.spec.ts`](../../apps/api/src/shared/quality/restore-drill-gate.spec.ts)

> **Pourquoi ce runbook existe.** R-01 — « une migration de tenancy ou de schéma déplace des données de manière
> irrécupérable » — a toujours été atténué en supposant qu'une sauvegarde permettait de revenir en arrière.
> Personne n'avait **jamais exécuté** de restauration. « On a `pg_dump` » n'est pas une stratégie de sauvegarde,
> c'est une affirmation à son sujet, et cet épique existe parce que les affirmations que personne n'a exécutées
> étaient la plus grosse catégorie de l'audit.

---

## 1. Ce que le drill prouve

Un cycle réel et chronométré : `pg_dump` → `CREATE DATABASE` scratch → `pg_restore` → **reconstruction du manifeste
depuis la base restaurée** → comparaison champ par champ.

| Ce qui est comparé | Comment |
|---|---|
| L'ensemble des tables | piloté par la liste **source** (une table absente de la restauration est un échec ; l'inverse aussi) |
| Le nombre de lignes | `count(*)` par table |
| Le **contenu** | `md5` d'un agrégat ordonné de `md5(ligne::text)` — indépendant de l'ordre physique |
| Le **schéma** | libellés d'enums, colonnes (`udt_name`/nullabilité/position), index (`indexdef`), clés (PK/UNIQUE/FK), séquences |
| Le **ledger** | chaque répertoire de `apps/api/prisma/migrations` présent, `finished_at` non nul, `rolled_back_at` nul, `applied_steps_count > 0`, checksum recalculé depuis les octets sur disque |
| La **durée** | dump / restore / verify / total, comparées à la baseline revue |

« Les données sont revenues » n'est pas « la base est revenue » : c'est pourquoi le schéma est dans le manifeste.
Un index unique perdu passe une comparaison de compteurs — jusqu'à la première insertion.

---

## 2. La cible est le stack Docker **LOCAL**

Le drill vise `127.0.0.1:5433/pilotage`, c'est-à-dire le conteneur `pilotage_postgres` de
`infra/docker-compose.yml`. **Les données locales sont jetables** : réinitialiser la base, effacer le volume et
re-seeder sont du travail ordinaire.

> **La décision D-01 ne bloque pas ce drill.** D-01 demande *quand l'installation hébergée peut être arrêtée* —
> une question sur `pilotage.srv861861.hstgr.cloud`, qui est une **fixture d'audit**, pas un système de production.
> Le drill ne la touche pas. Deux fichiers du dépôt (`docs/spec/features/v3-e02/PROGRESS.md` et
> `docs/daily-improvement-v3/stories/sprint-01.md`) portaient encore une mention « bloqué par D-01 » : elle est
> périmée depuis la correction de `open-decisions.md` au run 19.

---

## 3. Pré-requis — démarrer le stack

```bash
docker compose --env-file .env -f infra/docker-compose.yml --profile app up -d
```

> **`--env-file .env` est obligatoire (PF-86).** Compose résout `.env` depuis le **répertoire du projet**, c'est-à-dire
> `infra/`, et non depuis le `cwd` de l'appelant. Or `infra/.env` n'existe pas : `POSTGRES_PORT=5433` et
> `KEYCLOAK_PORT=8180` vivent dans le `.env` **racine**. Sans `--env-file .env`, Compose démarre un stack
> **différent** — postgres et keycloak remontent **sans port publié**. Observé en direct : les conteneurs ont été
> recréés sans leur mapping de ports et **toute** commande prisma côté hôte a échoué en `P1001` jusqu'à l'ajout du
> flag. `infra/pilotage.sh` est la seule entrée qui le passait déjà.
>
> Note associée : `--profile seed` seul échoue (« service seed depends on undefined service api ») car le service
> `seed` dépend de `api`, qui est dans le profil `app`.

Le drill n'a besoin d'**aucun client Postgres côté hôte** : il passe par `docker exec`, et `postgres:15-alpine`
embarque `pg_dump`/`pg_restore`/`psql` exactement à la version majeure du serveur.

---

## 4. Lancer le drill

```bash
node scripts/restore-drill.js                          # le drill (exit 1 à la moindre divergence)
node scripts/restore-drill.js --source <url>           # autre base source (défaut : DATABASE_URL puis le stack local)
node scripts/restore-drill.js --container <nom>        # autre conteneur postgres (défaut : pilotage_postgres)
node scripts/restore-drill.js --mode host              # utiliser un client pg de l'hôte au lieu de docker exec
node scripts/restore-drill.js --update                 # enregistrer les durées mesurées dans la baseline
```

Il n'y a **aucun drapeau de contournement** : pas de `skip`, pas de `force`, pas d'`allow-failure`, et aucune variable
d'environnement autre que `DATABASE_URL` n'est lue (DNC-10).

### Le seul crochet d'injection de faute

```bash
node scripts/restore-drill.js --inject-fault-sql "DELETE FROM student WHERE ctid IN (SELECT ctid FROM student LIMIT 1);"
```

Le SQL est exécuté **sur la base scratch**, strictement entre la restauration et la vérification. Ce n'est pas un
contournement : il est **monotone dans le sens de l'échec** — il peut faire échouer le drill, jamais le faire passer.
Le verdict ne peut jamais être `ok` et un tel run ne peut jamais écrire la baseline.

---

## 5. Table des verdicts

Code de sortie **0** pour `ok`, **1** pour tout le reste. C'est la chaîne de verdict qui porte l'information ; le code
de sortie décide seulement si quelqu'un le remarque.

| Verdict | Ce que ça veut dire | Action opérateur |
|---|---|---|
| `ok` | Dump, restauration et vérification complets et identiques | Rien. `--update` si la mesure doit devenir la référence |
| `unreachable_source` | La base source n'a pas répondu | Démarrer le stack (§3). **Jamais** lu comme « rien à faire » (DNC-08) |
| `tooling_unavailable` | Ni `docker exec` ni `pg_dump` hôte | Démarrer Docker, ou installer un client pg et `--mode host` |
| `dump_route_mismatch` | Le conteneur ne publie pas le port visé par l'URL source | Stack démarré sans `--env-file .env` (PF-86), ou second Postgres parasite |
| `insufficient_read_role` | Le rôle n'est ni SUPERUSER ni BYPASSRLS | Se connecter avec le rôle propriétaire. **Critique après V3-E01** — voir §7 |
| `unbaselined_ledger` | Pas de `_prisma_migrations` (source ou restaurée) | État exact de PF-03 → `docs/runbooks/baseline-hosted-database.md` |
| `unsafe_scratch_target` | Le nom de la base scratch ne passe pas le garde-fou | Bug du drill. **Ne pas contourner** — c'est le seul endroit destructeur |
| `scratch_not_empty` | La base scratch n'était pas vide juste après création | Bug : la connexion de vérification vise peut-être la source |
| `restore_failed` | `pg_restore --exit-on-error` a échoué | Lire son stderr, imprimé intégralement au-dessus du verdict |
| `empty_manifest` | Moins de 50 tables de base sur la source | La découverte est cassée, ou ce n'est pas la bonne base |
| `missing_table` | Table présente à la source, absente de la restauration | La sauvegarde est incomplète. **Ne pas s'en servir** |
| `unexpected_table` | Table présente dans la restauration, absente de la source | Base scratch réutilisée, ou dump d'une autre base |
| `source_mutated_during_dump` | La source a changé pendant le dump | Écriture concurrente, **pas** un défaut de restauration. Rejouer avec le profil `app` arrêté |
| `row_count_divergence` | Compteur différent, table et champ nommés | Sauvegarde incomplète |
| `checksum_divergence` | Même nombre de lignes, contenu différent | Exactement ce qu'un contrôle par compteurs seuls raterait |
| `schema_divergence` | Enum / colonne / index / contrainte / séquence divergents | « Les données sont revenues » ≠ « la base est revenue » |
| `inventory_drift` | Le nombre de tables ne correspond plus à la baseline revue | Table ajoutée/supprimée → relire le diff, puis `--update` |
| `pending_migration` | Migration absente, inachevée ou annulée dans le ledger restauré | La restauration a perdu l'identité de la base |
| `ledger_checksum_mismatch` | Le fichier de migration a été édité **après** son application | Défaut G-MIGRATION. Ne jamais « réparer » en éditant le ledger |
| `slo_unrecorded` | La baseline porte des durées placeholder (`recordedFrom: null`) | `--update` depuis un run `ok`. « Non mesuré » n'est pas un succès |
| `fault_injected` | Ce run a injecté une faute | Attendu. Un tel run ne passe jamais et n'écrit jamais la baseline |
| `scratch_cleanup_failed` | La base scratch n'a pas pu être supprimée | La commande `DROP DATABASE … WITH (FORCE)` exacte est imprimée : la jouer à la main |
| `unknown` | Le drill n'a pas pu décrire son propre run | Un plantage est un **échec**, pas un 0 silencieux |

**Précédence.** `unreachable_source` > `tooling_unavailable` > `dump_route_mismatch` > `insufficient_read_role` >
`unbaselined_ledger` > `unsafe_scratch_target` > `scratch_not_empty` > `restore_failed` > `empty_manifest` >
`missing_table` > `unexpected_table` > `source_mutated_during_dump` > `row_count_divergence` >
`checksum_divergence` > `schema_divergence` > `inventory_drift` > `pending_migration` >
`ledger_checksum_mismatch` > `slo_unrecorded` > `fault_injected` > `scratch_cleanup_failed` > `unknown` > `ok`.

Un run qui **diverge** *et* échoue à nettoyer rapporte la **divergence** — sinon un bug de nettoyage rétrograderait
un vrai échec de données — et liste quand même l'échec de nettoyage dans `failures[]`.

---

## 6. La baseline SLO

`scripts/restore-drill-baseline.json` est un **enregistrement revu**, pas un bloc-notes. Chaque entrée porte une
**raison écrite** — jamais un nombre nu : une durée sans le jeu de données ni la machine sur laquelle elle a été
mesurée n'est pas un SLO.

Elle contient : `recordedAt`, `recordedFrom`, `source`, `inventory` (nombre de tables, tables non vides, total de
lignes), `ledger` (les migrations attendues), `durations` (`dumpMs`/`restoreMs`/`verifyMs`/`totalMs`) et
`toleranceFactor`.

- **`--update` n'écrit que depuis un run sans défaut de correction.** Un run raté est *rapide* — il a restauré moins ;
  enregistrer ses durées desserrerait le SLO pour toujours, et enregistrer son inventaire gèlerait la casse dans
  l'enregistrement revu. C'est la règle que `scripts/boot-check.js` a apprise à ses dépens (son premier `--update` a
  silencieusement retiré une application qui n'avait pas démarré). Seul `slo_unrecorded` autorise encore l'écriture,
  puisque enregistrer les durées **est** son remède.
- **Quand ré-enregistrer :** après un changement délibéré du jeu de démo, après une modification du schéma qui change
  le nombre de tables, ou après un changement de machine/de version Postgres. Le diff est fait pour être relu.
- **Dépasser la tolérance est un WARN, jamais un échec.** Décision assumée : ces nombres sont mesurés sur un portable
  contre un volume Docker sous charge variable. Un aléa de chronométrage qui ferait rougir le drill entraînerait
  l'opérateur à le rejouer jusqu'au vert — et c'est ainsi qu'une garde cesse d'être lue. **Une divergence de
  correction échoue ; une lenteur est rapportée.**

---

## 7. Ce que le drill **ne prouve pas**

À lire avant de citer ce drill comme preuve de quoi que ce soit.

1. **Pas le volume de production.** 13 550 lignes de données de démo ne sont pas un corpus réel. Le checksum
   `string_agg` a en outre un plafond varlena de 1 Go qu'une vraie table finira par atteindre.
2. **Pas une restauration inter-machines.** Dump et restauration se font sur **le même serveur**, avec le même cache
   de pages. Rien n'est prouvé sur le transport d'un dump vers une autre machine.
3. **Pas une restauration inter-versions PostgreSQL.** Le checksum `md5(ligne::text)` n'est comparable qu'entre deux
   bases **du même serveur**, même version majeure et même locale.
4. **Pas de PITR / archivage WAL.** C'est un dump **logique**, pas une sauvegarde physique : aucune revendication de
   RPO, aucun point-in-time recovery.
5. **Pas de rétention, pas de copie hors site.** Le dump est écrit dans `/tmp` **dans le conteneur** et supprimé sur
   tous les chemins de sortie. Rien n'est conservé nulle part de durable.
6. **Jamais exécuté contre la base hébergée.** La moitié hébergée de R-01 reste ouverte : cette base n'a toujours pas
   de ledger et n'a jamais été ni dumpée ni restaurée.
7. **Le rôle de lecture est vérifié, la RLS ne l'est pas encore.** ADR-002 déclare la RLS comme mécanisme de tenancy et
   `V3-E01` est l'épique qui la livre. Sous un rôle soumis à la RLS, `pg_dump` ne dumpe silencieusement que les lignes
   visibles, et un manifeste construit par le même rôle **compare égal à un dump partiel**. Le drill exige donc
   SUPERUSER ou BYPASSRLS et pose `row_security = off`. **À relire dès que la première migration RLS atterrit.**
8. **Le contrôle d'identité de route est partiel.** Il prouve que le conteneur publie bien le port visé par l'URL
   source, pas l'identité du cluster.
9. **Le drill n'est pas un quiesce.** Manifeste et dump sont deux lectures. Une écriture concurrente est détectée par
   une **relecture de la source après le dump** et rapportée comme `source_mutated_during_dump`, distinctement d'une
   divergence de données.

La garde couvre aussi PF-84 (`.dockerignore` excluait `infra/docker`), mais **seulement** pour les chemins `/app/…`
référencés par un `command:`/`entrypoint:` de `infra/docker-compose.yml`. La même classe de défaut s'applique aux
sources de bind-mount `volumes:` et aux `COPY` des Dockerfiles : hors périmètre, et dit plutôt que sous-entendu.

---

## 8. Pourquoi le drill n'est **pas** dans `ci-gate.sh`

`scripts/ci-gate.sh` et `.github/workflows/ci.yml` ne référencent pas `restore-drill.js`, et **c'est une décision**
(ADR-025 D1), pas un oubli — la garde `restore-drill-gate.spec.ts` l'affirme explicitement, en négatif, pour qu'un run
futur ne « corrige » pas l'étape manquante.

Le drill a besoin d'un Postgres qui tourne. `ci-gate.sh` n'a **délibérément** besoin d'aucun service (ses étapes :
runtime-engines, production-artefacts, prisma generate, lint, lint:warnings, typecheck, ratchets de tests, build,
boot-check, web-artifact-check, observability, tracing). Une étape qui ne peut pas tourner là où la garde tourne
serait soit **sautée** — c'est DNC-08, un succès que personne n'a obtenu — soit rouge à chaque run et contournée,
c'est-à-dire R-23.

Ce que la CI exécute, c'est la **garde** : `apps/api/src/shared/quality/restore-drill-gate.spec.ts`, ramassée
automatiquement par l'étape `test:api (ratchet)` (`node scripts/test-ratchet.js api`) parce que
`apps/api/jest.config.js` matche `<rootDir>/src/**/*.spec.ts`. Elle verrouille la table verdict → code de sortie,
l'absence de contournement, le refus d'écriture de `--update`, les garde-fous de la base scratch, G-TENANT dans les
deux sens, et la non-régression de PF-84.

---

## 9. Dérive de schéma — `ci-gate.sh` exige désormais un PostgreSQL joignable (S-E02-5, ADR-027)

**Nouveau pré-requis, dit ici plutôt que découvert.** Depuis `S-E02-5`, `scripts/ci-gate.sh` porte une étape **0d**,
`node scripts/schema-drift-check.js`, qui **crée une base scratch jetable**, y applique `apps/api/prisma/migrations`,
compare **cette base** à `apps/api/prisma/schema.prisma`, puis la supprime sur **tous** les chemins de sortie. Elle
tourne aussi sous `--quick` (elle lit `prisma/` et une base, jamais `dist/` ni `.next/`).

Conséquence directe : **stack local éteint ⇒ `bash scripts/ci-gate.sh` échoue**, sur un arbre pourtant sain. C'est
voulu — DNC-08 ne laisse pas de troisième option : une étape qui se dégraderait en « sautée » rapporterait un contrôle
qui n'a pas eu lieu comme un résultat. Le remède est **de démarrer la base, jamais de modifier du code** :

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
```

Comment distinguer les deux familles de verdicts (l'étape imprime la ligne `SCHEMA DRIFT CHECK: FAIL — <verdict>`) :

| Verdict | Ce que ça veut dire | Action |
|---|---|---|
| `unreachable_server` | **aucun serveur n'a répondu** : le préflight TCP a mesuré `refused` à l'adresse résolue, et c'est une mesure de l'absence du serveur | démarrer le stack (commande ci-dessus), puis relancer |
| `tooling_unavailable`, préflight `refused` | même cause que la ligne précédente : `tooling_unavailable` l'emporte par précédence, et `unreachable_server` reste listé dans les constats | démarrer le stack (commande ci-dessus), puis relancer |
| `tooling_unavailable`, préflight `open` ou `indeterminate` | le contrôle **n'a pas pu tourner faute de CLIENT**, pas faute de serveur. Les trois routes SQL sont nommées avec leur erreur réelle, et le message dit quel état le préflight a mesuré ; la joignabilité est alors rapportée **inconnue**, jamais comme une absence (TOOL-24) | installer un client PostgreSQL (`psql` / `pg_dump` / `pg_restore`), ou vérifier qu'un jeu **complet** existe sous une racine d'installation connue — le script imprime la liste de tout ce qu'il a cherché (TOOL-23) |
| `migrate_deploy_failed` | une migration **ne s'exécute pas** sur PostgreSQL (la sortie de Prisma est reproduite telle quelle) | corriger le SQL de la migration |
| `schema_drift` | le registre de migrations **ne reproduit pas** `schema.prisma`. La sortie de Prisma nomme l'objet dérivé (`[+] Added tables …`) | écrire la migration manquante : `pnpm --filter @pilotage/api exec prisma migrate dev --name <ce-qui-change>` |
| `scratch_create_failed` / `scratch_not_empty` / `scratch_cleanup_failed` | problème sur la base scratch (droit `CREATEDB` manquant, base non vide à la création, suppression impossible) | la commande de suppression manuelle est imprimée par le script |
| `no_migrations` / `empty_scratch_schema` / `ledger_incomplete` | le contrôle aurait comparé **rien** — refusé plutôt que passé à vide | vérifier `apps/api/prisma/migrations` |
| `unknown` | le run n'a pas produit les preuves qu'un verdict exige (chaque champ manquant est nommé) | lire les champs listés ; ce n'est jamais un succès |

Ce pré-requis **ne s'applique pas** au drill du §8 : ADR-027 explique pourquoi les deux décisions tiennent ensemble —
le drill a besoin de la base **applicative peuplée** (un *état* que la CI ne peut pas avoir et ne doit pas fabriquer),
l'étape 0d a besoin d'un **serveur PostgreSQL vide** (une *capacité* que le job `build` de `ci.yml` provisionne déjà
et que le stack local fait déjà tourner).
