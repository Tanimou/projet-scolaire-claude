# ADR-002: Multi-tenancy via shared DB + tenant_id + Row-Level Security

**Status:** Accepted — **superseded in part by [ADR-032](./ADR-032-tenant-enforcement.md) (mécanisme)**, et sa moitié RLS n'est **PAS implémentée** (`PF-02`)
**Date:** 2026-05-15

## Context

La plateforme est multi-tenant dès le départ (plusieurs écoles, potentiellement plusieurs tenants commerciaux). Le cahier §11 insiste sur la protection des données enfants et l'isolation stricte. Risque majeur: cross-tenant data leak.

> **Note d'état (2026-08-11, `S-E01-2` / `PF-02`).** Ce qui suit décrit la CIBLE, pas l'état de la base.
> Mesuré sur le dépôt à cette date : **zéro** `ENABLE ROW LEVEL SECURITY` et **zéro** `CREATE POLICY`,
> `0_baseline` compris — la moitié RLS de cette décision (Action Item #2) n'est pas implémentée ; et
> `withTenant` a **zéro appelant**, donc la moitié applicative non plus. Par ailleurs le mécanisme nommé au
> point 4 ci-dessous — `SET LOCAL app.current_tenant_id = <id>` — est **remplacé** par
> [`ADR-032`](./ADR-032-tenant-enforcement.md) : `SET` n'accepte aucun paramètre, donc cette forme ne peut
> qu'interpoler la valeur dans le texte SQL, ce qui était exactement la moitié (b) de `PF-02`. La forme
> retenue est `set_config('app.current_tenant_id', $1, true)`, avec refus en amont d'un id non-UUID et
> relecture de la valeur posée. Le reste de cette ADR (base partagée, `tenant_id` partout, RLS comme couche
> d'application, découpage de rôles `app_user` / `app_migrator` / `auditor`) reste la cible et reste à faire.

## Decision

**Shared database + `tenant_id` sur chaque table métier + Postgres Row-Level Security**.

- Une seule instance Postgres, une seule database.
- Chaque table métier porte `tenant_id` (FK vers `tenant`).
- Policy RLS sur chaque table: `tenant_id = current_setting('app.current_tenant_id')::uuid`.
- Middleware Prisma exécute `SET LOCAL app.current_tenant_id = <id>` au début de chaque transaction.
- Rôle Postgres `app_user` est l'utilisateur applicatif (RLS activée).
- Rôle `app_migrator` pour migrations (RLS bypass possible).
- Rôle `auditor` pour requêtes audit cross-tenant (super-admin uniquement).

## Options Considered

### Option A: Shared DB + tenant_id + RLS (choisi)
- Coût: très bas (une instance).
- Isolation: forte au niveau DB (défense en profondeur en + de l'app).
- Onboarding tenant: instantané.
- Migration: une seule fois.

### Option B: Schema-per-tenant
- Coût: bas-moyen (une instance, N schemas).
- Isolation: forte (schémas distincts).
- Onboarding: nécessite création schéma + migration.
- Migration: répliquer sur N schémas (script).
- Pénible avec ORM si N > 50.

### Option C: Database-per-tenant
- Coût: élevé (N instances ou logical DBs).
- Isolation: maximale.
- Onboarding: lourd.
- Adapté aux clients très réglementés ou très volumineux. Pas notre cas au MVP.

## Trade-off Analysis

L'option A combine économie + sécurité (RLS comme couche défense en profondeur même si garde applicatif bypass). La complexité Prisma + RLS est gérable avec un middleware bien testé.

Risque principal: un bug applicatif qui oublie de set le tenant pourrait crash (ce qui est mieux qu'un cross-leak). La policy RLS fail-closed empêche tout accès sans tenant.

Évolution: si un client demande une isolation forte (ex. ministère), migration possible vers option C pour ce tenant uniquement.

## Consequences

**Plus facile:**
- Une seule migration à exécuter.
- Onboarding tenant instantané (insertion ligne `tenant`).
- Coûts maîtrisés.
- Backup unifié.

**Plus difficile:**
- Discipline absolue: jamais de query brute sans `SET LOCAL` ; ESLint rule sur Prisma raw.
- Tests d'intégration obligatoires pour RLS (test cross-tenant denial).
- Backup partiel/restore d'un seul tenant nécessite filtres.

## Action Items

1. [ ] Middleware Prisma `withTenant(tenantId)` qui SET LOCAL avant chaque transaction.
2. [ ] Migration template avec `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + policy.
3. [ ] Test d'intégration: créer 2 tenants, vérifier que l'un ne voit jamais les données de l'autre, même via injection JWT.
4. [ ] Documenter procédure d'export/anonymisation per-tenant pour RGPD portabilité.
5. [ ] Setup `pg_audit` extension pour tracer les accès super-admin (RLS bypass).
