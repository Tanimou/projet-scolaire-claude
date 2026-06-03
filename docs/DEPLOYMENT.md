# Déploiement — Pilotage Scolaire

Deux modes, optimisés pour **simplicité, performance et efficacité** sans surcharger la machine.

| Mode | Infra (Postgres/Redis/Keycloak/MinIO) | App (web/api/worker) | Pour quoi |
|------|---------------------------------------|----------------------|-----------|
| **DEV** (hybride) | **Docker** (léger, 5 conteneurs) | **Local** (`pnpm dev`, hot-reload) | Itération rapide au quotidien |
| **PROD** (full Docker) | **Docker** | **Docker** (+ nginx) | Livraison portable & reproductible |

> **Pourquoi hybride en dev ?** Lancer web/api/worker en local donne le hot-reload instantané et évite de reconstruire des images Docker à chaque changement. Seule l'infra (stateful) tourne en conteneurs. C'est le meilleur compromis vitesse / légèreté.

---

## Pré-requis

- **Node 22** (voir `.nvmrc`) + **pnpm 9** (`pnpm -v`)
  - ⚠️ **Important** : les packages workspace (`@pilotage/contracts`, `ui`, `i18n`, `design-tokens`) sont consommés en **source TypeScript** (`main: src/index.ts`). **Node ≥ 23** (TS natif + ESM strict) **rejette** leurs barrels de dossier (`export * from './enums'`) au runtime → l'app **locale** ne démarre pas. La machine a actuellement **Node 25.7** : utiliser **Node 22** (`nvm use 22`) pour le run local, **OU** lancer l'app **en Docker** (toolchain conteneur, indépendant du Node de l'hôte — voir « Dev full-Docker » ci-dessous). Le **build et le typecheck passent** sur n'importe quelle version ; c'est uniquement le *run local* qui exige Node 22.
- **Docker Desktop** démarré (`docker info` doit répondre)
  - ⚠️ Si Docker reste bloqué à l'init *« Inference manager »* (bug Docker Desktop 4.60.1), un **reboot** le règle. Voir `C:\Users\HP\Downloads\FINIR-DOCKER-reboot.md`.
- `pnpm install` déjà fait une fois à la racine.

### Dev full-Docker (recommandé si Node ≠ 22)

Tout (infra **+** api/worker/web) en conteneurs — indépendant du Node de l'hôte :

```bash
bash infra/pilotage.sh up            # build + start + sync schema + health
bash infra/pilotage.sh update web    # rebuild un seul service après changement
bash infra/pilotage.sh logs api      # logs
```
Web → http://localhost:3000 · API → http://localhost:4000 (une fois les conteneurs healthy).

---

## DEV — une seule commande

```bash
pnpm dev:start
```

Ce que ça fait, dans l'ordre :
1. Démarre l'infra Docker (Postgres `5433`, Redis `6379`, Keycloak `8180`, MinIO `9000/9001`, Maildev `1080`).
2. Attend que Postgres soit prêt.
3. Synchronise le schéma (`prisma db push`).
4. Seed des données démo (idempotent).
5. Lance `pnpm dev` (web `:3000`, api `:4000`, worker).

**Variantes :**
```bash
pnpm dev:infra      # uniquement l'infra (puis 'pnpm dev' à la main)
pnpm dev:reset      # repart d'une base vide (wipe volumes) puis tout relance
bash scripts/dev.sh --no-seed   # sans le seed démo
```

Arrêter l'infra : `pnpm docker:down` (garde les données) · `pnpm docker:reset` (efface).

**Accès :** Web http://localhost:3000 · API http://localhost:4000 (Swagger `/docs`) · Maildev http://localhost:1080
**Login démo :** `mme.dupont@voltaire.fr` / `Demo!2024`

---

## PROD — une seule commande

```bash
pnpm deploy:prod
```

Ce que ça fait :
1. Build des images `api` / `worker` / `web`.
2. Démarre la stack complète (infra + app + **nginx** reverse-proxy, profils `app` + `prod`).
3. Attend Postgres, synchronise le schéma.
4. Seed démo (optionnel).
5. Affiche l'état des conteneurs.

**Variantes :**
```bash
pnpm deploy:prod:rebuild   # rebuild --no-cache (images propres)
pnpm deploy:prod:down      # arrête la stack (garde les volumes)
bash scripts/deploy-prod.sh --no-seed   # sans seed (vrai déploiement)
```

**Accès :** App via nginx → http://localhost

---

## Opérations conteneurs avancées

Le manager mature `infra/pilotage.sh` couvre le cycle de vie fin :

```bash
bash infra/pilotage.sh up                 # build + start whole stack + health
bash infra/pilotage.sh update web         # rebuild + recreate un seul service
bash infra/pilotage.sh rebuild            # rebuild --no-cache
bash infra/pilotage.sh logs api           # suivre les logs
bash infra/pilotage.sh ps                 # état + santé
bash infra/pilotage.sh health             # exit 0 si api+web healthy (CI)
bash infra/pilotage.sh down               # stop (garde volumes)
bash infra/pilotage.sh reset              # wipe volumes + fresh up
```

---

## Profils Docker Compose (`infra/docker-compose.yml`)

| Profil | Services | Démarré par |
|--------|----------|-------------|
| *(base)* | postgres, redis, keycloak, minio, minio_init, maildev | `pnpm docker:up`, `dev:start` |
| `app` | migrator, api, worker, web | `deploy:prod` |
| `prod` | nginx | `deploy:prod` |
| `obs` | jaeger, prometheus, grafana, loki | `docker compose --profile obs up -d` |
| `seed` | seed (one-shot) | `--profile seed up seed` |

## Ports (configurables via `.env`)

Postgres **5433** · Redis **6379** · Keycloak **8180** · MinIO **9000/9001** · Web **3000** · API **4000** · Maildev **1080**.
(Postgres en `5433` pour ne pas entrer en conflit avec un Postgres natif en `5432`.)
