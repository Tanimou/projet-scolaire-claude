# Runbook — Release gate : prouver que le code déployé est le code attendu

> **Findings** VAL-10, PF-68 · **Risque** R-05 · **Stories** S-E02-6 puis **S-E02-10** · **Epic** V3-E02 ·
> **Gate** G-MIGRATION

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

## 1bis. Ce que la gate contrôle (S-E02-10)

La première version n'interrogeait que l'**API**. Le déploiement compte trois artefacts construits et déployés
séparément, et deux d'entre eux n'étaient comparés à rien — dont le worker, qui **écrit** des données réelles. Elle
lisait par ailleurs `schemaVersion`… pour l'afficher, sans jamais le comparer.

| Contrôle | Manifeste | Ce qui est comparé |
|---|---|---|
| `api` | `GET /version` | `GIT_SHA` gravé dans l'image ↔ `HEAD` du checkout qui lance la gate |
| `worker` | `GET /version/worker` | idem |
| `web` | `GET /version/web` | idem |
| `schéma` | `GET /version` | dernière migration **appliquée** en base ↔ dernière migration **livrée** par le checkout |

Chaque manifeste porte un champ `app`, et la gate le vérifie : sans lui, un reverse-proxy mal routé qui renverrait le
manifeste de l'API sur `/version/worker` serait indiscernable d'un worker conforme — la gate serait verte sur un
artefact qu'elle n'a jamais atteint.

**Un artefact injoignable est un ÉCHEC, jamais un saut.** Les variables `RELEASE_GATE_API_URL`,
`RELEASE_GATE_WORKER_URL` et `RELEASE_GATE_WEB_URL` sont des **adresses**, pas des interrupteurs : aucune valeur ne
retire un artefact du contrôle (`DNC-08`/`DNC-10`).

### Pourquoi le schéma est comparé au checkout et pas au manifeste

`migrations.status: clean` ne signifie **que** « toutes les migrations que *cette image* embarque sont appliquées ».
Une image plus ancienne est donc « clean » à propos de son propre retard. La comparaison utile oppose la base à ce que
**ce checkout** livre (`apps/api/prisma/migrations/`, lu sur le disque) — deux sources indépendantes, comme pour le SHA.

## 2. Les cinq verdicts

Chaque manifeste publie `release.verdict` :

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

Une seule base suffit derrière nginx : les trois manifestes y sont routés (`location = /version`,
`= /version/worker`, `= /version/web`).

Quand les conteneurs sont interrogés directement — chacun publiant son propre port, ce que fait `deploy-prod.sh` —
donner une adresse par artefact :

```bash
RELEASE_GATE_API_URL=http://localhost:4000 \
RELEASE_GATE_WORKER_URL=http://localhost:4001 \
RELEASE_GATE_WEB_URL=http://localhost:3000 \
  bash scripts/release-gate.sh
```

Sans argument : `http://localhost:4000` pour les trois, attendu = `HEAD` du checkout courant.

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

Les trois manifestes n'exposent qu'un **nom d'application**, des **SHA courts**, un **verdict** et — pour l'API — un
**nom de migration**. Aucune donnée de tenant, aucune chaîne de connexion, aucune information sur les files du worker ;
même niveau de confiance que la route `/` déjà publique. Un test du worker vérifie explicitement que la réponse ne
contient ni `DATABASE_URL` ni `REDIS_URL`.

Chacun est exposé par une règle nginx en correspondance **exacte** (`location = /version`, `= /version/worker`,
`= /version/web`), jamais par un préfixe, et hérite de la limite de débit `api_zone`.

Le worker n'a **aucune surface HTTP métier** : son socket ne sert que ce manifeste, sur une seule méthode (`GET`) et
deux chemins ; tout le reste est un `404`. Côté hôte, il n'est publié qu'en **loopback**
(`127.0.0.1:${WORKER_HTTP_PORT:-4001}`), la gate tournant sur l'hôte.

## 7. Ce que cette gate ne couvre pas

- Elle n'a **jamais été exécutée contre le déploiement hébergé**. Celui-ci est antérieur aux manifestes, donc elle y
  échouerait aujourd'hui — ce qui **est** la dérive R-05, pas un faux positif. Elle ne devient probante qu'après un
  déploiement portant ce commit.
- Elle prouve **quel** artefact tourne, pas qu'il fonctionne : un conteneur au bon SHA avec une mauvaise chaîne de
  connexion passe la gate et échoue ailleurs. C'est le rôle du healthcheck et du boot check (`scripts/boot-check.js`).
- Le dépôt n'a **pas de runner CI** (`PF-59`, facturation Actions) : cette gate s'exécute au déploiement et à la
  demande, pas sur chaque PR.
- **Keycloak, Postgres, Redis, MinIO et nginx** ne sont pas versionnés par ce contrôle : ce sont des images amont
  épinglées par tag, pas des artefacts construits depuis ce dépôt.
