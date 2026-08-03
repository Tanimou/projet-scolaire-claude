# Runbook — Release gate : prouver que le code déployé est le code attendu

> **Finding** VAL-10 · **Risque** R-05 (`materialised`) · **Story** S-E02-6 · **Epic** V3-E02 · **Gate** G-MIGRATION

## 1. Pourquoi cette gate existe

R-05 n'est pas hypothétique, il s'est **déjà produit**. L'image API qui tournait portait
`controllers: [AssessmentsController, GradesController]` dans `dist/modules/grades/grades.module.js`, alors
qu'**aucune ref du dépôt** ne contenait cette ligne depuis le 2026-06-01 : l'artefact avait été construit depuis un
arbre de travail non commité. Conséquence — sept semaines de `404` en production sur `/api/v1/assessments` et
`/api/v1/grades/*` (`PF-62`) : les professeurs ne pouvaient ni créer une évaluation ni saisir une note.

Rien ne pouvait le voir. Les tests, le typecheck et le build regardent **la source**. Un test manuel en local regardait
**une autre image**. Le healthcheck disait `healthy` — il l'était : un conteneur sain qui sert le mauvais artefact est
précisément le mode de panne décrit par R-05.

La gate compare deux sources **indépendantes** :

| Valeur | Origine | Signifie |
|---|---|---|
| `GIT_SHA` | `ARG` → `ENV`, **gravé dans l'image au build** | ce que l'artefact **est** |
| `EXPECTED_GIT_SHA` | injecté dans le conteneur **au démarrage** | ce que l'opérateur **croit** déployer |

Les faire produire par la même étape n'aurait rien prouvé. C'est leur indépendance qui fait le contrôle.

## 2. Les cinq verdicts

`GET /version` publie `release.verdict` :

| Verdict | Sens | API démarre ? | Gate |
|---|---|---|---|
| `match` | l'artefact est le commit attendu | oui | ✅ |
| `unverified` | aucune attente déclarée — **rien n'a été comparé** | oui | ❌ |
| `drift` | l'image exécute un autre commit | **non** (en production) | ❌ |
| `dirty` | image construite depuis un arbre non commité | **non** (en production) | ❌ |
| `unstamped` | l'image ne porte aucun `GIT_SHA` | **non** (en production) | ❌ |

`unverified` laisse démarrer mais **échoue la gate** : c'est la distinction que V3 exige entre « vérifié » et
« non vérifié ». Un déploiement qui n'a rien comparé ne doit jamais être présenté comme conforme (`DNC-08`).

**Il n'existe aucun drapeau de contournement** (`DNC-10`). Ne pas déclarer `EXPECTED_GIT_SHA` *est* l'interrupteur —
et il est visible dans le manifeste, donc il ne peut pas passer pour un succès. Le test
`n'offre AUCUN drapeau de contournement en production` verrouille cette propriété.

## 3. Déploiement normal

```bash
bash scripts/deploy-prod.sh
```

Le script :

1. lit `git rev-parse HEAD` → `GIT_SHA` (build arg) **et** `EXPECTED_GIT_SHA` (env runtime) ;
2. **refuse un arbre de travail sale** — c'est la cause exacte de R-05 ;
3. construit, démarre, attend `healthy` ;
4. exécute `scripts/release-gate.sh` et **échoue le déploiement** si l'artefact n'est pas conforme.

### Arbre de travail sale

Le déploiement s'arrête. Commitez. Si un correctif à chaud est réellement nécessaire :

```bash
ALLOW_DIRTY_BUILD=1 bash scripts/deploy-prod.sh
```

L'image est alors estampillée `<sha>-dirty`, le verdict devient `dirty`, l'API **refuse de démarrer en production** et
la gate échoue. Ce n'est pas un contournement : c'est un artefact explicitement marqué comme irreproductible. Pour le
servir, il faut commiter — ce qui est le comportement voulu.

## 4. Vérifier un déploiement existant, à tout moment

```bash
bash scripts/release-gate.sh https://pilotage.srv861861.hstgr.cloud
```

Sans argument : `http://localhost:4000`, attendu = `HEAD` du checkout courant.

## 5. Diagnostic

| Symptôme | Cause | Action |
|---|---|---|
| `Manifeste injoignable` + l'API tourne | l'artefact déployé **précède** `/version` (PR #171) — déjà une dérive | redéployer |
| `Manifeste injoignable` derrière nginx | le reverse-proxy ne route pas `/version` | vérifier le bloc `location = /version` dans `infra/nginx/conf.d/pilotage.conf` |
| `unstamped` | image construite sans le build arg (hors `deploy-prod.sh`, ou image antérieure) | reconstruire via `scripts/deploy-prod.sh` |
| `unverified` | `EXPECTED_GIT_SHA` non injecté dans le conteneur | déployer via `deploy-prod.sh`, ou renseigner la variable dans `.env.prod` |
| `drift` | l'image ne vient pas du commit attendu | reconstruire ; si la dérive persiste, l'image est tirée d'un registre obsolète |
| L'API refuse de démarrer, `ReleaseDriftError` | verdict non servable en production | lire le message : il porte les deux SHA |

## 6. Portée délibérément limitée

Le manifeste n'expose qu'un **nom de migration** et des **SHA courts** — aucune donnée de tenant, aucune chaîne de
connexion, même niveau de confiance que la route `/` déjà publique. `/version` est exposé par une règle nginx en
correspondance **exacte** (`location = /version`), pas par un préfixe, et hérite de la limite de débit `api_zone`.

## 7. Ce que cette gate ne couvre pas

- Le **worker** et le **web** portent leur `GIT_SHA` (lisible via `docker inspect`) mais n'exposent pas de manifeste
  HTTP : une dérive worker/web n'est pas détectée automatiquement. Suivi en `PF-68`.
- La comparaison **schéma attendu vs schéma appliqué** n'est pas faite ici : `schemaVersion` est publié, mais la gate
  ne le compare pas à la dernière migration livrée par le checkout. Suivi en `PF-68`.
- Le dépôt n'a **pas de runner CI** (`PF-59`, facturation Actions) : cette gate s'exécute au déploiement et à la
  demande, pas sur chaque PR.
