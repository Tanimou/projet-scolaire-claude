# ADR-014: PostgreSQL 15 + extensions

**Status:** Accepted
**Date:** 2026-05-15
**Decision drivers:** Utilisateur a Postgres 15 installé. Volonté de minimiser friction setup local.

## Context

Le cahier (§8.1) ne fixe pas de version Postgres. La v1 du plan prévoyait Postgres 16. L'utilisateur précise qu'il a Postgres 15 sur sa machine.

## Decision

**PostgreSQL 15** comme version cible dev, staging, prod. Image Docker `postgres:15-alpine`.

Extensions activées au bootstrap:
- `uuid-ossp` — UUID v4 (UUID v7 généré côté app)
- `citext` — emails insensibles à la casse
- `pg_trgm` — recherche fuzzy
- `pgcrypto` — hash chains audit + chiffrement
- `btree_gin` — index combinés
- `pg_partman` (optionnel) — partitionnement audit_log

## Compatibilité

Tous les features utilisés sont **compatibles Postgres 15**:
- JSONB + GIN ✓
- Row-Level Security ✓
- Partial indexes ✓
- Generated columns ✓
- tsvector full-text search ✓
- Partitionnement déclaratif ✓
- Logical replication ✓
- Async multixact ✓

Features Postgres 16+ **non utilisés** pour rester compatible:
- `JSON_TABLE` (16+)
- `MERGE...RETURNING` (17+)
- Optimisations parallel hash join 16+ (purement perf, non bloquant)

Migration future PG15→PG16 documentée comme non-breaking pour ce schéma.

## Options Considered

### Option A: Postgres 15 (choisi)
- Installé sur la machine utilisateur
- LTS jusqu'à novembre 2027
- Stack majeure stable

### Option B: Postgres 16
- Plus récent
- Quelques perf improvements
- Mais friction local (réinstallation utilisateur)

### Option C: Postgres 17
- Trop récent au moment du choix
- LTS plus long mais EOL 2029

## Consequences

**Facile:**
- Setup local immédiat utilisateur
- Compatibilité large (la plupart des cloud Postgres supportent 15)
- LTS suffisant pour ce projet

**Difficile:**
- Veille pour migrer en LTS suivante (à prévoir 2027)
- Quelques optimisations PG16+ non disponibles (non bloquant)

## Action Items

1. [ ] Dockerfile et docker-compose utilisent `postgres:15-alpine`
2. [ ] CI utilise testcontainers Postgres 15
3. [ ] Scripts init SQL extensions à `infra/postgres/init/01-extensions.sql`
4. [ ] Documenter migration future vers PG16 dans runbook
