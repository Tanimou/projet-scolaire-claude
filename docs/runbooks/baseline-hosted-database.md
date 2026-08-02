# Runbook — Baseliner la base hébergée (S-E02-1 / PF-03)

**Public.** Opérateur ayant accès au VPS de production et à `DATABASE_URL`.
**Durée.** ~10 min. **Écritures de schéma.** Aucune — l'étape 3 n'insère qu'une ligne dans `_prisma_migrations`.

> **Pourquoi ce runbook existe.** Jusqu'à cette story, la production démarrait sur
> `prisma db push --accept-data-loss` sans aucun historique de migration : personne ne pouvait prouver quelle
> transition avait produit le schéma hébergé, ni en annuler une. Le migrator applique désormais des migrations
> revues — mais il **refuse** de le faire tant que la base hébergée n'a pas été baselinée, parce que le faire
> à l'aveugle inscrirait un mensonge dans le ledger.

---

## 0. Pré-requis

- `DATABASE_URL` pointant sur la base **hébergée**.
- Le dépôt à la révision qui contient `apps/api/prisma/migrations/0_baseline/`.
- Une **sauvegarde fraîche et vérifiée** (voir `open-decisions.md` **D-01**, non résolue à ce jour).

Toutes les commandes se lancent depuis `apps/api/`.

---

## 1. Vérifier la dérive — **ne rien écrire**

C'est l'étape qui décide de tout. Elle est en lecture seule.

```bash
pnpm exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script --exit-code
```

| Sortie | Signification | Action |
|---|---|---|
| **exit 0**, diff vide | La base hébergée correspond exactement à `schema.prisma` | Continuer en §2 |
| **exit 2**, diff non vide | **Dérive source ↔ hébergé** | **STOP.** Ne pas baseliner |

> **Si le diff n'est pas vide, arrêtez-vous.** L'audit A2 App. C.4 enregistre la base hébergée comme **antérieure
> à E11** alors que `schema.prisma` est plus récent. Dans ce cas, `0_baseline` **ne décrit pas** la base hébergée, et
> la marquer comme appliquée ferait croire au ledger que des tables existent alors qu'elles sont absentes. La
> réconciliation de cette dérive est la story **S-E02-5** — elle n'est pas couverte ici.

---

## 2. Contrôle de cohérence (optionnel mais recommandé)

Rejouer la baseline sur une base **scratch** et vérifier qu'elle reproduit bien `schema.prisma` :

```bash
createdb baseline_check
psql -d baseline_check -v ON_ERROR_STOP=1 -f prisma/migrations/0_baseline/migration.sql

pnpm exec prisma migrate diff \
  --from-url "postgresql://…/baseline_check" \
  --to-schema-datamodel prisma/schema.prisma \
  --script --exit-code    # doit sortir 0
```

C'est exactement le contrôle exécuté au moment de la PR (voir la section preuve de la PR).

---

## 3. Marquer la baseline comme appliquée

Aucune modification de schéma : une seule ligne est insérée dans `_prisma_migrations`.

```bash
pnpm exec prisma migrate resolve --applied 0_baseline
```

## 4. Vérifier

```bash
pnpm exec prisma migrate status      # attendu : « Database schema is up to date! »
```

Puis relancer le déploiement. Le migrator doit maintenant afficher `état = BASELINED` et appliquer les migrations
en attente (aucune à ce stade).

Contrôle applicatif — le manifeste de release expose la version réellement servie (VAL-10) :

```bash
curl -fsS https://<host>/version
# { "buildSha": "…", "schemaVersion": "0_baseline", "migrations": { "status": "clean", … } }
```

---

## 5. Plan expand / contract pour les migrations suivantes

Exigé par la gate **G-MIGRATION**. Toute migration ultérieure se déroule en deux releases au minimum :

| Phase | Contenu autorisé | Interdit |
|---|---|---|
| **Expand** (release N) | Ajouter table/colonne/index **nullable ou avec défaut** ; écrire dans l'ancien *et* le nouveau chemin ; backfill par lots | Rendre `NOT NULL`, renommer, supprimer |
| **Migrate** (release N, après backfill) | Basculer les lectures sur le nouveau chemin | Supprimer l'ancien |
| **Contract** (release N+1, après une période d'observation) | Supprimer l'ancienne colonne/table, poser les contraintes | Tout faire dans la même release qu'`expand` |

Règle dure : **aucune suppression destructive dans la même release que l'ajout**. C'est la mitigation du risque
**R-01** — sans elle, une erreur de tenancy sur données hébergées est irrécupérable.

---

## 6. Rollback

### 6.1 Rollback de *ce changement* (le mécanisme de déploiement)

Ce changement ne modifie aucun schéma ; il ne fait que remplacer la façon dont le schéma est appliqué. Pour revenir
en arrière, redéployer la révision précédente : le migrator y exécute à nouveau `db push`. Aucune donnée n'est
concernée. Le contrôle inverse (l'API qui refuse de démarrer sur un schéma non vérifié) disparaît avec lui — c'est
précisément ce qu'on perd.

### 6.2 Annuler une baseline posée par erreur

```sql
DELETE FROM _prisma_migrations WHERE migration_name = '0_baseline';
```

Sans effet sur le schéma : la table `_prisma_migrations` n'est qu'un journal. À n'utiliser que si l'étape 3 a été
jouée alors que l'étape 1 signalait une dérive.

### 6.3 Rollback d'une migration future

Prisma n'a pas de `down`. Pour toute migration ultérieure, la voie de retour est :

1. une **migration compensatoire** écrite à l'avance (préférée, car elle passe par le même ledger revu) ; ou
2. une **restauration de sauvegarde** — dont la fenêtre et le sign-off restent **non décidés (D-01)**.

C'est la raison pour laquelle §5 interdit les suppressions destructives : sans `down`, expand/contract *est* le
mécanisme de rollback.

---

## 7. Ce que le migrator fait désormais tout seul

`infra/docker/migrate-entrypoint.sh` :

| État détecté | Comportement |
|---|---|
| `EMPTY` (aucune table) | `prisma migrate deploy` |
| `BASELINED` (`_prisma_migrations` présente) | `prisma migrate deploy` |
| `UNBASELINED_NONEMPTY` | **Refus, sortie 1**, et impression de ce runbook en résumé |

Il n'existe **aucune** variable d'environnement réactivant `db push` ou `--accept-data-loss` : ce serait un bypass
codé en dur (`DNC-10`), et rapporter un succès non obtenu serait `DNC-08`.
