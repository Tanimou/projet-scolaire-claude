# Runbook — provisionner le locataire de démonstration

> **Story** S-E02-4 · **Findings** PF-03 (moitié seed), PF-17 · **Risque** R-12 · **Gate** G-MIGRATION

Ce runbook existe parce que le seed ne part **plus** tout seul. Avant S-E02-4, `scripts/deploy-prod.sh`
enchaînait sept scripts de seed de démonstration **à chaque déploiement de production**, et l'unique
garde-fou existant était neutralisé par une ligne de `infra/docker-compose.prod.yml`. C'est le mécanisme
qui a rempli le déploiement hébergé de données et d'étiquettes de démonstration (PF-17).

R-12 dit l'autre moitié : **les parties prenantes dépendent de cette démo**. On ne la supprime pas, on la
rend délibérée.

---

## 1. Ce qui a changé, en une phrase

| Avant | Après |
|---|---|
| `deploy-prod.sh` seedait par défaut ; `--no-seed` pour l'éviter | `deploy-prod.sh` ne seede pas ; `--seed` pour le demander |
| 1 script sur 7 portait un contrôle, désactivé par le compose | 7 scripts sur 7 refusent, sur deux signaux indépendants |
| `NODE_ENV: development` forcé sur le service `seed` en prod | supprimé — le rétablir produit `refused-conflicting-signals` |

## 2. Provisionner la démo

Dans `.env.prod` de la stack **de démonstration** (jamais d'un déploiement client) :

```
DEPLOY_ENV=demo
ALLOW_SEED=provision-demo-data
```

Puis, depuis la racine du dépôt, sur le serveur :

```bash
bash scripts/deploy-prod.sh --seed
```

Pour re-seeder sans redéployer :

```bash
bash scripts/deploy-prod.sh --seed-only
```

Les deux déclarations sont exigées **ensemble**. Il n'existe pas de raccourci : `ALLOW_SEED` seul ne suffit
pas, et `ALLOW_SEED` ne lève jamais un refus de production (ce serait un drapeau de contournement, DNC-10).

## 3. Table de décision (`apps/api/prisma/seed-guard.ts`)

| `NODE_ENV` | `DEPLOY_ENV` | `ALLOW_SEED` | Verdict | Sortie |
|---|---|---|---|---|
| *(quelconque)* | `production` | jeton exact | `refused-production` | 1 |
| `production` | *(absent)* | jeton exact | `refused-production` | 1 |
| `development` | `production` | jeton exact | `refused-conflicting-signals` | 1 |
| `development` | `demo` | *(absent)* | `refused-no-opt-in` | 1 |
| `development` | `demo` | `true` | `refused-bad-token` | 1 |
| `development` | `demo` | jeton exact | `allowed` | 0 |

Le jeton exact est `provision-demo-data`. Un booléen est refusé volontairement : l'opt-in doit être écrit,
pas coché.

### Pourquoi deux variables et non une

`NODE_ENV` décrit ce que le **process** prétend être et se règle par service — c'est précisément par là que
le contournement est passé. `DEPLOY_ENV` décrit ce que le **déploiement** est et se règle une fois, au
niveau de la stack. Un désaccord entre les deux n'est pas tranché au profit du plus permissif : il constitue
son propre refus.

**Conséquence attendue sur la stack hébergée :** le service `seed` hérite de `NODE_ENV=development` de
l'ancre `x-app-env`, tandis que `DEPLOY_ENV` retombe sur `production` quand rien n'est déclaré. Le refus par
défaut est donc `refused-conflicting-signals`, pas `refused-production`. Les deux refusent et sortent en 1 ;
le message nomme la contradiction. Ce n'est pas un défaut, c'est la valeur par défaut fermée.

## 4. En développement local

Rien à faire : `infra/docker-compose.yml` fournit déjà `ALLOW_SEED=provision-demo-data` au service `seed`,
parce qu'activer le profil `seed` **est** le geste délibéré, et que cette stack est non-production par
construction. `infra/pilotage.sh seed` continue de fonctionner sans configuration.

Pour lancer un script de seed hors Docker :

```bash
ALLOW_SEED=provision-demo-data pnpm --filter @pilotage/api run prisma:seed
```

## 5. Vérifier que la garde est bien active

Un refus doit être observable par un shell — c'est le critère d'acceptation 1 de S-E02-4 :

```bash
DEPLOY_ENV=production ALLOW_SEED=provision-demo-data pnpm --filter @pilotage/api exec tsx prisma/seed.ts; echo "exit=$?"
```

Attendu : `✖ seed : seed refusé [refused-production]` et `exit=1`, **sans qu'aucune connexion base de données
ne soit ouverte** (la garde s'exécute avant `new PrismaClient()`).

## 6. Ce que ce runbook ne couvre pas

- **Retirer les données de démonstration déjà présentes** sur le déploiement hébergé. Ce seed a déjà tourné
  en production ; la garde empêche la suite, elle ne réécrit pas le passé. Un nettoyage est une action
  destructive sur données hébergées — condition d'arrêt n°3 de la routine — et appartient à l'opérateur.
- **Les étiquettes d'auteur de seed visibles dans l'UI** (PF-17) : c'est `S-E06-1`.
- **La baseline de la base hébergée** (`S-E02-1`) : voir `docs/runbooks/baseline-hosted-database.md`.
