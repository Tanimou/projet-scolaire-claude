# Pilotage Scolaire

> Plateforme web de pilotage scolaire avec **3 portails distincts** (admin / teacher / parent), hyper-customizable, multi-tenant, mobile-first.
> Cahier des charges: `rapport_pilotage_scolaire_detaille.pdf` (16 pages, v1.0).

**Statut:** plan v2 rédigé, prêt à démarrer l'implémentation.

## Démarrage rapide (après scaffolding du monorepo)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
```

Ouvrir:
- Landing publique : http://localhost:3000
- Portail admin    : http://localhost:3000/admin   (admin@pilotage.local / Changeme123!)
- Portail prof     : http://localhost:3000/teacher (teacher@pilotage.local / Changeme123!)
- Portail parent   : http://localhost:3000/parent  (parent@pilotage.local / Changeme123!)
- Keycloak admin   : http://localhost:8080 (admin / admin)
- Maildev          : http://localhost:1080
- MinIO console    : http://localhost:9001 (minio / miniominio)
- Jaeger UI        : http://localhost:16686

## Documentation

| Doc | Description |
|---|---|
| [PLAN.md](./PLAN.md) | Plan d'implémentation v2 complet (50+ pages markdown) |
| [docs/design/PHILOSOPHY.md](./docs/design/PHILOSOPHY.md) | Philosophie visuelle "Lucid Stewardship" |
| [docs/design-system.md](./docs/design-system.md) | Design system harmonisé 3 portails |
| [docs/mockups/](./docs/mockups/) | 4 mockups HTML haute-fidélité (ouvrables navigateur) |
| [docs/screens/](./docs/screens/) | Wireframes détaillés de chaque écran |
| [docs/spec/data-model.md](./docs/spec/data-model.md) | Modèle relationnel complet (Postgres 15) |
| [docs/adr/](./docs/adr/) | 18 Architecture Decision Records |

## Stack

| Couche | Techno |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TS + Tailwind v4 + shadcn/ui |
| Backend  | NestJS 11 + Prisma 6 |
| Base     | **PostgreSQL 15** + RLS + extensions (uuid-ossp, citext, pg_trgm, pgcrypto) |
| Cache    | Redis 7 + BullMQ |
| Identité | Keycloak 26 — 1 realm + 3 clients (admin/teacher/parent) |
| Stockage | MinIO (dev) / S3 (prod) |
| Obs.     | OpenTelemetry → Jaeger + Grafana stack |
| Mono     | Turborepo + pnpm |

## Modules backend (NestJS — modular monolith)

Identity · School Structure · Enrollment · Teaching · Assessment · Gradebook · Analytics · Alerting · Notification · Audit ·
**Attendance** · **Timetable** · **Lessons** · **Discipline** · **Communications** · **Documents** · **Customization** · **Imports** · **Search**

## Roadmap

| Phase | Durée | Livrables |
|---|---|---|
| 0 — Fondations | 1-2 sem | monorepo, docker-compose, CI, landing, design tokens, Storybook |
| 1 — Auth + Identity + Customization base | 3-5 sem | 3 portails auth, Keycloak realm, branding, custom roles |
| 2 — Structure école + Bulk imports | 3-4 sem | classes, matières, calendrier, imports CSV |
| 3 — Personnes + Custom fields | 3-4 sem | profs/élèves/parents, guardianship, custom fields |
| 4 — Évaluations + Snapshots + Alertes | 4-5 sem | gradebook, alert engine + rule builder |
| 5 — Présences + EDT + Cahier de texte | 3-4 sem | attendance, timetable drag-drop, lessons |
| 6 — Dashboards + Reports + Annonces | 3-4 sem | widgets configurables, PDF, library docs |
| 7 — Hardening + A11y + Perf | 2-3 sem | audit OWASP, WCAG, Lighthouse ≥90 |
| 8 — Docker prod + Deploy | 1-2 sem | livraison portable |
| 9 — Extensions | itératif | paiement, messagerie, tutorat |

### 9a — Module Finance (futur)

Le module Finance est prévu en **Phase 9 (Extensions)**, après la livraison de la plateforme de base (Phases 0–8). Il prendra la forme d'un **espace séparé** dans le portail admin (`/admin/finance`), et non d'une grande carte sur le dashboard principal — ce choix préserve la lisibilité du dashboard centré sur le pilotage pédagogique.

**Périmètre prévu :**

| Fonctionnalité | Description |
|---|---|
| Frais d'inscription | Tarif par cycle / classe, appliqué à chaque nouvel inscrit |
| Scolarité par cycle / classe | Montants configurables, surcharges optionnelles |
| Paiements attendus / reçus / en retard | Échéancier par famille, enregistrement des versements, détection des retards |
| Graphes de recouvrement | Taux global + par cycle/classe + évolution mensuelle |
| État financier par famille | Solde, historique, reçus PDF téléchargeables |

Le dashboard admin affichera un **signal discret** (badge dans la section « Alertes opérationnelles ») indiquant les familles en retard de paiement, avec un lien vers `/admin/finance?filtre=en_retard`. Ce signal ne prendra pas la forme d'une grande carte.

> Les demandes d'inscription et de rattachement parent-élève restent accessibles via les KPI du dashboard admin et la page dédiée `/admin/enrollments` — elles ne migrent pas vers le module Finance.

Voir [docs/adr/ADR-018-finance-module.md](./docs/adr/ADR-018-finance-module.md) pour les décisions d'architecture détaillées.

## Commands utiles (post-scaffolding)

```bash
pnpm dev                          # lance tout en watch (web + api + worker)
pnpm --filter @pilotage/api dev   # api seule
pnpm --filter @pilotage/web dev   # web seule
pnpm --filter @pilotage/api prisma migrate dev
pnpm test                         # unit + integration
pnpm test:e2e                     # Playwright
pnpm storybook                    # design system
pnpm build                        # turbo build all

docker compose up -d              # stack complète dev
docker compose --profile seed up seed   # seed données démo
docker compose --profile prod up -d     # mode prod (avec nginx)
docker compose --profile obs up -d      # avec Grafana/Prometheus/Loki
docker compose down -v            # tout supprimer
```
