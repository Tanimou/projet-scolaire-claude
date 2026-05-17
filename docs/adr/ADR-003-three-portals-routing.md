# ADR-003: 3 portails distincts via préfixes de routes Next.js

**Status:** Accepted
**Date:** 2026-05-15
**Decision drivers:** Demande utilisateur explicite (v2) — 3 portails distincts avec leurs propres login/register harmonisés mais distincts.

## Context

L'application doit exposer 3 portails distincts à 3 URLs différentes:
- `/admin` — Administrateur (login obligatoire, MFA)
- `/teacher` — Professeur (login obligatoire, MFA)
- `/parent` — Parent (login obligatoire, MFA recommandé)

Chacun avec ses propres pages d'authentification (`/admin/login`, `/teacher/login`, `/parent/login`).
Données partagées via le même backend; design system harmonisé.
Utilisateurs possibles multi-rôle (un prof peut aussi être parent).

## Decision

**Une seule application Next.js avec 3 préfixes de routes dans App Router**, organisée via route groups.

Structure:
```
app/
├── (marketing)/          # / public
├── admin/(auth|app)/     # /admin/*
├── teacher/(auth|app)/   # /teacher/*
├── parent/(auth|app)/    # /parent/*
└── api/                  # route handlers
```

Chaque portail:
- A son propre `layout.tsx` qui pose le `<PortalShell portal="..." >` et applique `data-portal` sur `<html>` pour theming.
- A ses propres pages `login`, `register`, `forgot-password`, `reset-password`, `accept-invite`, `verify-email`.
- A ses propres `error.tsx` et `not-found.tsx` avec navigation portail-aware.

Côté Keycloak (voir ADR-004):
- 1 realm `pilotage-scolaire`
- 3 clients OIDC distincts: `portal-admin`, `portal-teacher`, `portal-parent`
- Chaque page login redirige vers Keycloak avec son `client_id`
- Garde server-side: vérifie que le rôle de l'utilisateur correspond au portail

Utilisateurs multi-rôle:
- Session SSO entre portails (un seul login)
- Cookie `__Host-active-portal` pour le portail courant
- Header expose `<RoleSwitcher>` pour basculer

## Options Considered

### Option A: 1 app Next.js, 3 préfixes (choisi)
**Pros:**
- Design system partagé (tokens, composants, primitives)
- Build/déploiement unique → ops simple
- Bundle splitting natif Next.js par route → chaque portail charge ses chunks
- Navigation cross-portail facile (multi-rôle)
- Single domain → pas de CORS, pas de gestion de certificats multiples
- SEO + indexation: une seule app à crawler

**Cons:**
- Discipline nécessaire pour ne pas mélanger code des portails (mitigé par ESLint rule + structure dossiers)
- Build plus gros (mitigé par Next.js splitting automatique)

### Option B: 3 apps Next.js séparées
**Pros:**
- Isolation totale
- Déploiement indépendant par portail

**Cons:**
- Triplication du design system (sauf packager + maintenance lourde)
- 3 builds, 3 déploiements, 3 monitoring
- Navigation cross-portail = hard refresh
- SSO complexe entre apps
- Coût ops × 3

### Option C: Sous-domaines (admin.app.com, teacher.app.com, parent.app.com)
**Pros:**
- URLs très claires
- Isolation cookies par sous-domaine

**Cons:**
- Infra complexe (certs SSL × 3, DNS, reverse proxy)
- CORS pour API calls
- SSO inter-subdomain nécessite cookie `.app.com` parent
- Pas demandé par l'utilisateur (qui spécifie des paths, pas des subdomains)

## Trade-off Analysis

L'option A maximise la réutilisation (design system, composants, contrats API) tout en isolant clairement les portails par structure de routes. C'est l'idiome Next.js App Router (route groups + nested layouts).

La discipline est apportée par:
- ESLint rule `no-restricted-paths` interdisant imports cross-portail
- Convention de nommage et structure
- Tests E2E par portail
- Code review

## Consequences

**Facile:**
- Design system partagé immédiat
- Navigation `Link` cross-portail
- SSO transparent
- Une seule app à déployer / monitorer

**Difficile:**
- Vigilance pour ne pas leak des features entre portails
- Préserver les bundles séparés (vérifier en bundle analyzer)

## Action Items

1. [ ] Structure de dossiers initialisée selon le plan
2. [ ] ESLint rule `no-restricted-paths` pour interdire imports cross-portail (sauf via `packages/ui`)
3. [ ] Documentation CONTRIBUTING avec règles
4. [ ] Tests E2E par portail (Playwright projects séparés)
5. [ ] Bundle analyzer en CI avec budget par route
