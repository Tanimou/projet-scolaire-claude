# ADR-004: Keycloak — 1 realm, 3 clients OIDC

**Status:** Accepted
**Date:** 2026-05-15

## Context

3 portails distincts (admin, teacher, parent) nécessitent leur propre flux d'authentification, mais partagent les mêmes utilisateurs (utilisateurs multi-rôle possibles), mêmes politiques de mot de passe, même base d'identités.

## Decision

**1 realm Keycloak `pilotage-scolaire` avec 3 clients OIDC distincts**, un par portail.

Clients:
- `portal-admin` — Authorization Code + PKCE, redirect URIs `/admin/api/auth/callback`, MFA required
- `portal-teacher` — idem, MFA required
- `portal-parent` — idem, MFA optional (recommandé)

Realm settings communs:
- Password policy: ≥ 12 chars, complexité, HIBP check, history 5
- Brute force detection
- Session timeouts: admin/teacher 4h, parent 24h
- SSO entre clients (utilisateur ne re-loggue pas)

Rôles realm: `super_admin`, `school_admin`, `teacher`, `parent`, `student` (futur).
Custom roles (ex. "comptable", "surveillant") portés par l'app (table `role`) — Keycloak ne les connaît pas. Garde NestJS vérifie permissions effectives.

## Options Considered

### Option A: 1 realm + 3 clients (choisi)
- SSO inter-portail naturel
- Users uniques
- Politiques unifiées
- 3 client_id distincts = identification par portail dans logs et tokens

### Option B: 3 realms (1 par portail)
- Isolation forte
- Mais users dupliqués si multi-rôle, politiques à maintenir × 3, pas de SSO

### Option C: 1 realm + 1 client
- Plus simple
- Mais impossible de distinguer par client_id, MFA forcé partout, redirect URIs mélangées

## Consequences

**Facile:**
- SSO multi-portail
- Distinction du portail d'origine dans tokens/logs
- Politiques unifiées maintenables

**Difficile:**
- Garde server-side qui vérifie cohérence rôle ↔ portail demandé

## Action Items

1. [ ] Realm export JSON versionné dans `infra/keycloak/realm-export.json`
2. [ ] Bootstrap script qui importe le realm au démarrage Docker
3. [ ] Test E2E SSO inter-portail (user prof+parent)
