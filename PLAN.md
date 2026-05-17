# Pilotage Scolaire — Plan d'Implémentation v2

> **Source de vérité fonctionnelle:** `rapport_pilotage_scolaire_detaille.pdf` (cahier des charges v1.0, 10 mai 2026, 16 pages).
> **Mise à jour v2 (2026-05-15):** 3 portails distincts (/admin /teacher /parent), plateforme hyper-customizable, PostgreSQL 15, features enrichies au-delà du MVP cahier, livraison Docker à la fin.
> **Statut:** plan v2 — à valider; aucune ligne de code écrite avant validation.

---

## 1. Résumé exécutif

Plateforme web **mobile-first, multi-tenant, hyper-customizable** structurée autour de **3 portails distincts** partageant un seul backend.

### 1.1 Trois portails, un seul cœur
| Portail | URL | Public | Login/Register |
|---|---|---|---|
| **Public Landing** | `/` | Visiteurs | — (entrée vers les 3 portails) |
| **Administrateur** | `/admin` | Direction école, gestionnaires | `/admin/login`, `/admin/register` (sur invitation) |
| **Professeur** | `/teacher` | Enseignants | `/teacher/login`, `/teacher/register` (sur invitation) |
| **Parent** | `/parent` | Familles | `/parent/login`, `/parent/register` (self-service avec code école) |

**Harmonisé** côté design system (même tokens, même composants); **distinct** côté navigation, scope, copy, ergonomie (ex. parent = mobile prioritaire, admin = desktop prioritaire).

**Connecté** côté données: même API REST `/api/v1/*`, mêmes événements métier, mêmes contraintes RBAC/ABAC/RLS. Quand un prof publie une note, le parent la voit en temps réel via SSE; quand un admin valide une inscription, le parent reçoit notification.

### 1.2 Trois axes d'amélioration v2

1. **3 portails séparés** avec leurs propres flux d'authentification (1 realm Keycloak, 3 clients).
2. **Customization de bout en bout** (white-label, custom fields, custom alert rules, custom report templates, custom roles, custom dashboards, custom forms).
3. **Features anticipées** au-delà du cahier: présences, emploi du temps, cahier de texte, communication, disciplinary records, bulk imports, calendrier scolaire, library de documents, etc.

### 1.3 Objectifs MVP étendu (cahier §13.3 + ajouts v2)

Critères du cahier (déjà couverts):
- [x] Admin → arborescence école complète + affectation prof
- [x] Parent → demande rattachement, ne voit rien tant que non validé
- [x] Prof → planifie, saisit, publie
- [x] Parent → notes/moyennes/tendances après publication
- [x] Alertes explicables avec recommandation
- [x] Audit append-only
- [x] Isolation rôle/école stricte
- [x] Export PDF synthèse parent

Ajouts v2 (anticipations):
- [x] Prise de présence par session de cours (présent/absent/retard/excusé)
- [x] Emploi du temps drag-and-drop
- [x] Cahier de texte (lessons + ressources partagées)
- [x] Annonces & communications par broadcast
- [x] Bulk imports CSV (élèves, profs, classes, notes)
- [x] White-label par école (logo, couleurs, nom, favicon)
- [x] Custom fields dynamiques sur entités
- [x] Custom roles avec permission builder
- [x] Custom alert rules avec rule builder UI
- [x] Custom report templates
- [x] Tableau de bord admin avec widgets customisables
- [x] Library de documents (règlement intérieur, formulaires)
- [x] Calendrier scolaire (jours fériés, événements)
- [x] Notifications digest (préférences utilisateur)
- [x] Recherche globale (cmdk) sur chaque portail
- [x] PWA installable + offline shell
- [x] i18n FR par défaut, EN extensible

---

## 2. Stack technique (v2 ajustements)

### 2.1 Stack confirmée

| Couche | Technologie | Version | Note v2 |
|---|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | turbo 2.x, pnpm 9 | inchangé |
| Frontend | Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui | Next 15, React 19, Tailwind v4 | inchangé |
| Backend | NestJS + TypeScript | NestJS 11 | inchangé |
| ORM | Prisma | Prisma 6 | inchangé |
| **Base de données** | **PostgreSQL 15** | **15** | **ajusté (machine utilisateur)** |
| Cache/Jobs | Redis + BullMQ | Redis 7, BullMQ 5 | inchangé |
| Identité | **Keycloak — 1 realm + 3 clients (admin/teacher/parent)** | Keycloak 26 | **étendu pour 3 portails** |
| Fichiers | MinIO (dev) / S3 (prod) | S3 v4 API | inchangé |
| Notifications | Resend (email) + Web Push (PWA) + Twilio (SMS futur) | — | étendu (push PWA) |
| PDF | @react-pdf/renderer | — | inchangé |
| Recherche full-text | Postgres `tsvector` + GIN index | — | nouveau (recherche globale) |
| File upload | UploadThing pattern via S3 + presigned URL | — | inchangé |
| Validation | Zod (schémas partagés client/serveur) | Zod 3 | inchangé |
| Forms | React Hook Form + Zod resolver | — | inchangé |
| State client | TanStack Query v5 + Zustand | — | inchangé |
| Charts | Recharts | — | inchangé |
| i18n | next-intl | — | inchangé |
| Email templates | react-email | — | inchangé |
| Storybook | Storybook 8 (design system) | — | **nouveau** (developer experience) |
| Tests | Vitest + Jest + Playwright + Pact + @axe-core | — | inchangé |
| Observabilité | OpenTelemetry → Grafana stack | OTel 1.x | inchangé |
| Conteneurs | Docker Compose (dev + prod), images multi-stage | — | **livrables à la fin** |
| CI/CD | GitHub Actions | — | inchangé |

### 2.2 Décisions architecturales v2 (ADRs)

Liste des ADRs (voir `docs/adr/`):

| ADR | Titre | Status |
|---|---|---|
| ADR-001 | Modular monolith NestJS | Accepted |
| ADR-002 | Multi-tenancy via RLS Postgres | Accepted |
| ADR-003 | **3 portails dans un seul Next.js avec préfixes de routes** | **Accepted (v2)** |
| ADR-004 | Auth Keycloak — 1 realm, 3 clients | Accepted |
| ADR-005 | Snapshots analytics via jobs BullMQ idempotents | Accepted |
| ADR-006 | PDF via @react-pdf/renderer côté worker | Accepted |
| ADR-007 | Event bus interne via outbox + BullMQ | Accepted |
| ADR-008 | Cache Redis + cache HTTP NestJS | Accepted |
| ADR-009 | i18n next-intl, FR par défaut | Accepted |
| ADR-010 | Realtime via SSE | Accepted |
| ADR-011 | Forms React Hook Form + Zod partagé | Accepted |
| ADR-012 | Pyramide tests: unit → contract → E2E | Accepted |
| ADR-013 | **Customization layer: settings + custom fields + JSONB + rule engine** | **Accepted (v2)** |
| ADR-014 | **PostgreSQL 15 + extensions (uuid-ossp, pg_trgm, citext, pgcrypto)** | **Accepted (v2)** |
| ADR-015 | **Permission model: RBAC roles + ABAC policies + custom roles** | **Accepted (v2)** |
| ADR-016 | **Storybook obligatoire pour tout composant du design system** | **Accepted (v2)** |
| ADR-017 | **Stratégie de bulk import CSV: upload → validate → preview → confirm** | **Accepted (v2)** |

---

## 3. Architecture 3 portails (ADR-003 détaillé)

### 3.1 Pourquoi un seul Next.js (pas 3 apps séparées)

Choix: **1 application Next.js, 3 préfixes de routes** (`/admin`, `/teacher`, `/parent`) avec route groups Next.js (`(admin)`, `(teacher)`, `(parent)`).

**Avantages:**
- Design system partagé (tokens, composants, primitives)
- Build/déploiement unique
- Bundle splitting par route groups (chaque portail charge seulement ses chunks)
- Navigation cross-portail facile pour utilisateurs multi-rôles (un prof peut aussi être parent)
- Coût ops minimal

**Alternatives rejetées:**
- 3 apps Next.js → triplication design system, builds séparés, complexité ops
- Sous-domaines (admin.app, teacher.app, parent.app) → infra complexe, CORS, gestion certificats

### 3.2 Structure des routes Next.js

```
apps/web/src/app/
├── layout.tsx                        # root layout (providers, theme)
├── globals.css
├── (marketing)/                      # landing publique
│   ├── page.tsx                      # /
│   ├── about/page.tsx                # /about
│   ├── pricing/page.tsx              # /pricing (futur)
│   ├── legal/
│   │   ├── privacy/page.tsx
│   │   ├── terms/page.tsx
│   │   └── cookies/page.tsx
│   └── layout.tsx
│
├── admin/                            # PORTAIL ADMIN
│   ├── (auth)/
│   │   ├── login/page.tsx            # /admin/login
│   │   ├── register/page.tsx         # /admin/register (invitation)
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   ├── accept-invite/page.tsx
│   │   └── layout.tsx                # auth layout (centered, branding)
│   ├── (app)/                        # admin authentifié
│   │   ├── layout.tsx                # sidebar + topbar
│   │   ├── dashboard/page.tsx        # /admin/dashboard
│   │   ├── school/                   # /admin/school/...
│   │   │   ├── settings/page.tsx
│   │   │   ├── branding/page.tsx
│   │   │   ├── grading-scale/page.tsx
│   │   │   └── calendar/page.tsx
│   │   ├── academic-years/
│   │   ├── terms/
│   │   ├── cycles/
│   │   ├── grade-levels/
│   │   ├── classes/
│   │   ├── subjects/
│   │   ├── teachers/
│   │   ├── students/
│   │   ├── parents/
│   │   ├── enrollment-requests/
│   │   ├── enrollments/
│   │   ├── teaching-assignments/
│   │   ├── schedule/                 # emploi du temps
│   │   ├── attendance/
│   │   ├── disciplinary/
│   │   ├── documents/                # library
│   │   ├── announcements/
│   │   ├── alert-rules/              # rule builder
│   │   ├── custom-fields/            # custom fields management
│   │   ├── custom-forms/             # form builder
│   │   ├── roles/                    # custom roles & permissions
│   │   ├── users/
│   │   ├── audit/
│   │   ├── imports/                  # bulk CSV
│   │   ├── exports/
│   │   ├── notifications-templates/
│   │   ├── reports/
│   │   ├── integrations/
│   │   ├── analytics/                # global analytics
│   │   ├── settings/
│   │   └── profile/
│   ├── error.tsx
│   └── not-found.tsx
│
├── teacher/                          # PORTAIL PROFESSEUR
│   ├── (auth)/
│   │   ├── login/page.tsx            # /teacher/login
│   │   ├── register/page.tsx         # /teacher/register (invitation)
│   │   ├── forgot-password/page.tsx
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx                # bottom-tabs mobile, sidebar desktop
│   │   ├── dashboard/page.tsx        # /teacher/dashboard
│   │   ├── classes/
│   │   │   ├── page.tsx              # liste classes
│   │   │   └── [classId]/
│   │   │       ├── students/page.tsx
│   │   │       ├── assessments/page.tsx
│   │   │       ├── gradebook/page.tsx
│   │   │       ├── attendance/page.tsx
│   │   │       ├── lessons/page.tsx       # cahier de texte
│   │   │       ├── disciplinary/page.tsx
│   │   │       ├── distribution/page.tsx
│   │   │       ├── at-risk/page.tsx
│   │   │       ├── wall/page.tsx          # mur de classe
│   │   │       └── resources/page.tsx
│   │   ├── assessments/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── edit/page.tsx
│   │   │       ├── grade-entry/page.tsx   # grille saisie
│   │   │       └── publish/page.tsx
│   │   ├── schedule/page.tsx              # mon emploi du temps
│   │   ├── students-at-risk/page.tsx
│   │   ├── messages/page.tsx
│   │   ├── announcements/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── profile/page.tsx
│   │   └── settings/page.tsx
│   ├── error.tsx
│   └── not-found.tsx
│
├── parent/                           # PORTAIL PARENT
│   ├── (auth)/
│   │   ├── login/page.tsx            # /parent/login
│   │   ├── register/page.tsx         # /parent/register (self-service)
│   │   ├── verify-email/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx                # bottom-tabs mobile, sidebar desktop
│   │   ├── dashboard/page.tsx        # /parent/dashboard (sélecteur enfant)
│   │   ├── children/
│   │   │   ├── page.tsx              # liste enfants rattachés
│   │   │   ├── claim/page.tsx        # revendiquer un enfant
│   │   │   └── [childId]/
│   │   │       ├── page.tsx          # /parent/children/:id → overview
│   │   │       ├── overview/page.tsx
│   │   │       ├── subjects/
│   │   │       │   ├── page.tsx
│   │   │       │   └── [subjectId]/page.tsx
│   │   │       ├── calendar/page.tsx     # examens à venir
│   │   │       ├── attendance/page.tsx
│   │   │       ├── alerts/page.tsx
│   │   │       ├── reports/page.tsx      # bulletins, exports PDF
│   │   │       ├── disciplinary/page.tsx
│   │   │       ├── lessons/page.tsx      # cahier de texte
│   │   │       └── resources/page.tsx
│   │   ├── announcements/page.tsx
│   │   ├── messages/page.tsx
│   │   ├── notifications/page.tsx
│   │   ├── documents/page.tsx            # documents école
│   │   ├── profile/page.tsx
│   │   └── settings/page.tsx
│   ├── error.tsx
│   └── not-found.tsx
│
├── api/                              # route handlers Next.js (proxy → NestJS)
│   ├── auth/[...nextauth]/route.ts   # adapter Keycloak via Auth.js
│   ├── trpc-or-proxy/                # optionnel
│   └── webhooks/
│
├── error.tsx
├── not-found.tsx
└── manifest.ts                       # PWA manifest
```

### 3.3 Flux d'authentification par portail

1. Utilisateur arrive sur `/admin/login` (ou /teacher/login, /parent/login).
2. Page de login portail-spécifique avec branding subtil (logo de l'école si tenant détecté via cookie ou subdomain).
3. Submit → redirect Keycloak avec `client_id=portal-admin` (ou portal-teacher / portal-parent).
4. Auth Code + PKCE chez Keycloak; MFA si rôle admin/teacher.
5. Callback `/api/auth/callback` valide JWT + crée session (cookie `__Host-session` httpOnly secure).
6. Server-side: vérification rôle Keycloak correspond au portail demandé. Si pas le bon rôle → 403 + redirect vers portail correct.
7. Redirect vers `/[portal]/dashboard`.

**Dual-role users (ex. prof aussi parent):** Header affiche un `RoleSwitcher` qui change le cookie de portail actif et redirige vers le bon dashboard. Session unique, portail actif dans le cookie.

### 3.4 Stratégie Keycloak: 1 realm, 3 clients

- Realm: `pilotage-scolaire`
- Clients OIDC:
  - `portal-admin` (Authorization Code + PKCE, redirect URIs `/admin/*`, **MFA required**)
  - `portal-teacher` (idem, **MFA required**)
  - `portal-parent` (idem, MFA recommended but optional)
- Rôles realm: `super_admin`, `school_admin`, `teacher`, `parent`, et **custom roles** (créés dynamiquement, voir §6 customization).
- Password policy: ≥ 12 caractères, complexité, HIBP check.
- Sessions: SSO entre portails (un user multi-rôle ne se relogue pas), mais portail actif via cookie.
- Identity providers futurs: Google, Microsoft, France Connect (Phase 5).

---

## 4. Customization Layer (ADR-013 détaillé)

L'admin doit pouvoir **tout** customiser. Découpage:

### 4.1 Branding (white-label)
- Logo (upload S3, formats SVG/PNG)
- Favicon
- Nom de l'établissement
- Couleur primaire + accent (génère palette OKLCH automatiquement)
- Police optionnelle (Google Fonts allow-list)
- URL custom (Phase 5)
- Email "From" personnalisé (avec DKIM, DMARC, SPF de l'école)

Table `branding`:
- `school_id`, `logo_file_id`, `favicon_file_id`, `display_name`, `primary_color`, `accent_color`, `font_family`, `email_from`, ...

Frontend récupère via `GET /api/v1/branding/me` au boot, applique CSS variables sur `<html>` data-attributes.

### 4.2 Settings école
Configurables sans toucher au code:
- Système de notation: `/20`, `/100`, `/10`, A-F, ou custom scale (table `grading_scale` avec mapping)
- Périodes: trimestres, semestres, custom
- Coefficients: défauts par niveau et override
- Seuils d'alerte: `LOW_SUBJECT_AVG` seuil par défaut (10/20 ou X/échelle), `NEGATIVE_TREND` delta points, `REPEATED_FAILURE` count
- Préférences notifications: canaux, fréquence (digest/instant), heures de silence
- Politique parents: auto-approve guardianship? require school code? domain whitelist email?
- Politique enseignants: peuvent publier eux-mêmes ou admin valide?
- Politique notes: notes négatives autorisées? notes >max autorisées?
- Politique présences: types (présent/absent/retard/excusé), couleur, sanction auto si > X

### 4.3 Custom fields
Admin peut ajouter des champs sur:
- Students (ex. allergies, contact urgence, transport scolaire)
- Teachers (ex. spécialités, IBAN…)
- Parents (ex. profession, second contact)
- Classes (ex. devise, projet annuel)
- Assessments (ex. lieu, surveillance)

Tables:
- `custom_field_definition` (id, scope='student'|'teacher'|..., key, label, type=text|number|date|select|multi|boolean|file, required, options jsonb, visibility jsonb)
- `custom_field_value` (entity_id, definition_id, value jsonb)

Frontend: Formulaires dynamiques rendus depuis definitions (composant `<DynamicFormFields>`).

### 4.4 Custom alert rules
Au-delà des 5 règles MVP cahier, admin compose ses propres règles via UI:
- Builder visuel: `IF [moyenne_matière] < [seuil] AND [tendance] = [baisse] THEN raise alert [code] severity [medium]`
- Stockage en `alert_rule.rule_definition` JSONB.
- Worker `alerting.processor` interprète l'AST à l'évaluation.

### 4.5 Custom roles & permissions
- Admin crée des rôles (ex. "comptable", "surveillant", "infirmier").
- Permission matrix: chaque combinaison `(action, resource_type)` cochable.
- Custom roles assignables aux user_profile en + des rôles realm Keycloak.
- Garde NestJS `@RequiresPermission('attendance.write')` vérifie permissions effectives.

Table `permission` (catalog), `role`, `role_permission`, `user_role`.

### 4.6 Custom dashboard widgets
- Admin compose son dashboard avec widgets prédéfinis:
  - KPI cards (nb élèves, nb profs, taux présence, alertes ouvertes)
  - Charts (distribution moyennes, tendance par classe)
  - Recent activity feed
  - At-risk students list
  - Upcoming events
- Layout grid (react-grid-layout) sauvegardé en `dashboard_layout` par utilisateur.

### 4.7 Custom report templates
- Template engine: handlebars-like sur structures de données scolaires.
- Admin uploade ou édite un template (Markdown + variables `{{student.firstName}}`, `{{subject.average}}`).
- Génération PDF via @react-pdf/renderer depuis template compilé.
- Stocké dans `report_template`.

### 4.8 Custom forms (form builder)
- Admin crée des formulaires custom (autorisation sortie, dossier médical, inscription event).
- Drag-and-drop fields (TextInput, Select, Date, Signature, File upload).
- Soumissions visibles dans le portail admin, exportables.

### 4.9 Custom notifications & email templates
- Templates email/SMS éditables par l'admin (variables + preview).
- Multilingue.
- Stockés en `notification_template`.

### 4.10 Custom localization
- Override des libellés clés par école (ex. "trimestre" → "module").
- Table `i18n_override`.

---

## 5. Features par portail (enrichi v2)

### 5.1 Portail ADMIN — `/admin`

| Catégorie | Pages / Fonctionnalités |
|---|---|
| **Auth** | Login (avec MFA TOTP), Register sur invitation, Forgot/Reset password, Accept invite |
| **Dashboard** | Widgets KPI customisables (élèves/profs/alertes/taux présence), feed activité récente, à-risque, événements à venir |
| **École** | Settings général (nom, logo, locale, fuseau, contact); Branding (couleurs, police); Grading scale (échelles personnalisées); Calendrier scolaire (jours fériés, vacances, événements) |
| **Hiérarchie** | Cycles, Niveaux, Classes (avec capacité, dérogations), Matières (avec coefficients par niveau) |
| **Personnes** | Profs (CRUD + invitation), Élèves (CRUD + custom fields), Parents (CRUD + guardianship), Users tous rôles |
| **Inscriptions** | File d'attente requests (approve/reject + commentaire); Inscriptions actives par classe/année |
| **Affectations** | Teaching assignments (drag-drop par classe), Substituts |
| **Emploi du temps** | Drag-drop horaires par classe/prof/salle, gestion conflits, export PDF |
| **Évaluations** | Vue globale planning évaluations toutes classes |
| **Présences** | Vue globale taux présence par classe/élève, alertes absentéisme |
| **Discipline** | Disciplinary records (incidents, sanctions, remédiations); workflows configurables |
| **Annonces** | Diffusion ciblée (école/classe/niveau/utilisateurs); historique; programmation |
| **Communications** | Conversations parent-prof modérées (Phase 5 préparé) |
| **Alertes** | Règles d'alerte (5 MVP + custom builder); alertes ouvertes globales |
| **Customization** | Custom fields, Custom forms, Custom roles, Custom report templates, Notification templates |
| **Imports** | Bulk CSV (élèves, profs, classes, notes, présences) avec validation, preview, dry-run, rollback |
| **Exports** | Bulletins, listes notes classe, présences mensuelles, audit CSV |
| **Documents** | Library (règlement, formulaires, FAQ) avec versions et permissions |
| **Audit** | Explorer avec filtres avancés, export CSV, intégrité (hash chain optionnel) |
| **Intégrations** | OneRoster, LTI, Google Workspace, Microsoft 365 (Phase 5) |
| **Analytics** | Tendances globales école, comparaisons par classe/niveau, exports |
| **Notifications center** | Préférences digest, canaux |
| **Profil** | Mon profil, MFA, sessions actives, mots de passe app |
| **Settings** | Tous paramètres tenants/écoles, feature flags |

### 5.2 Portail PROFESSEUR — `/teacher`

| Catégorie | Pages / Fonctionnalités |
|---|---|
| **Auth** | Login (MFA TOTP), Register sur invitation, Forgot/Reset password |
| **Dashboard** | Mes classes du jour, évaluations à venir, élèves à risque, tâches à faire (publier, corriger, prendre présence) |
| **Mes classes** | Liste classes + matières affectées; chaque classe: élèves, évaluations, gradebook, présences, cahier de texte, distribution, à-risque, mur de classe, ressources |
| **Évaluations** | Liste mes évaluations; créer une évaluation (titre, type, date, barème, poids, visibilité); voir détail; éditer (tant que draft) |
| **Gradebook** | Grille de saisie par évaluation (clavier-friendly); statuts (absent/exempt/missing); commentaires; brouillon → publier; revisions historisées |
| **Présences** | Prendre présence par session de cours (timeline du jour); statuts custom configurables; commentaire; export |
| **Cahier de texte (Lessons)** | Saisir cours du jour: titre, objectifs, contenu, devoirs, ressources jointes; visible parents si publié |
| **Mur de classe** | Posts (annonces, ressources, devoirs) visibles élèves/parents de la classe |
| **Ressources** | Bibliothèque de fichiers (PDF, images, liens vidéos) partagés par classe ou matière |
| **Disciplinary** | Enregistrer incident; consulter sanctions; communiquer admin |
| **Mon emploi du temps** | Vue semaine; détails session (classe, matière, salle); export .ics |
| **À risque** | Liste élèves à risque sur mes classes; détail règle déclenchée |
| **Messages** | Inbox messages parents (Phase 5, lecture seule au MVP) |
| **Annonces** | Diffuser à mes classes |
| **Reports** | Mes rapports générés (bulletins partiels, statistiques) |
| **Notifications** | Alertes, publications réussies, échecs imports |
| **Profil** | Photo, infos, MFA, préférences notifications |
| **Settings** | Préférences UI (densité, dark mode), raccourcis clavier |

### 5.3 Portail PARENT — `/parent`

| Catégorie | Pages / Fonctionnalités |
|---|---|
| **Auth** | Login, Register (avec code école + email vérification), Forgot/Reset |
| **Dashboard** | Sélecteur enfant (si plusieurs); vue globale enfant actif (moyenne, tendance, alertes ouvertes, récentes notes, examens à venir) |
| **Mes enfants** | Liste; demander rattachement (claim child); statut demandes |
| **Enfant — Overview** | Carte synthèse: moyenne globale, tendance, nb alertes, dernière publication |
| **Enfant — Matières** | Grid matières (moyenne, dernière note, tendance, coefficient, commentaire récent); détail matière (timeline, distribution classe anonyme) |
| **Enfant — Calendrier** | Mois courant; évaluations passées/futures; events école; export .ics |
| **Enfant — Présences** | Vue mensuelle; détail; justifier une absence (Phase 5) |
| **Enfant — Alertes** | Liste alertes (sévérité, explication, recommandation); marquer traité; archiver |
| **Enfant — Rapports** | Bulletins, synthèses période, génération à la demande, historique |
| **Enfant — Discipline** | Historique disciplinary records (lecture) |
| **Enfant — Cahier de texte** | Cours et devoirs publiés par les profs |
| **Enfant — Ressources** | Ressources partagées par les profs |
| **Annonces école** | Feed des annonces qui concernent l'enfant |
| **Messages** | Inbox (Phase 5) |
| **Notifications** | Centre de notifs avec filtres |
| **Documents école** | Library publique (règlement, formulaires) |
| **Profil** | Infos, photo, 2nd contact, MFA optionnel |
| **Settings** | Préférences notification (digest/instant, canaux), langue, fuseau, mode sombre, app install PWA |

---

## 6. Structure monorepo (mise à jour)

```
pilotage-scolaire/
├── apps/
│   ├── api/                          # NestJS backend
│   ├── worker/                       # NestJS workers BullMQ
│   └── web/                          # Next.js — landing + 3 portails
│       └── src/app/
│           ├── (marketing)/
│           ├── admin/
│           ├── teacher/
│           ├── parent/
│           └── api/
│
├── packages/
│   ├── contracts/                    # types TS + Zod + OpenAPI partagés
│   ├── ui/                           # composants partagés cross-portail (Storybook)
│   ├── design-tokens/                # tokens CSS variables
│   ├── i18n/                         # messages traduits
│   ├── eslint-config/
│   └── tsconfig/
│
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.worker
│   │   └── Dockerfile.keycloak       # custom theme
│   ├── docker-compose.yml            # dev local complet
│   ├── docker-compose.prod.yml       # prod single-host
│   ├── docker-compose.override.yml   # devs custom
│   ├── nginx/                        # reverse proxy prod
│   ├── keycloak/
│   │   └── realm-export.json         # bootstrap realm + clients
│   ├── postgres/
│   │   └── init/
│   │       └── 01-extensions.sql     # uuid-ossp, citext, pg_trgm, pgcrypto
│   └── grafana/
│       └── dashboards/
│
├── docs/
│   ├── adr/                          # 17 ADRs
│   ├── spec/
│   │   ├── spec.md
│   │   ├── data-model.md
│   │   ├── clarifications.md
│   │   ├── tasks.md
│   │   └── features/                 # une spec par feature
│   ├── screens/
│   │   ├── landing-and-auth.md
│   │   ├── admin-portal.md
│   │   ├── teacher-portal.md
│   │   └── parent-portal.md
│   ├── design-system.md
│   ├── api/
│   └── runbooks/
│
├── .github/workflows/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
└── README.md
```

---

## 7. Modèle de données v2 (extensions customization)

Référence: `docs/spec/data-model.md` (mis à jour v2). Ajouts:

### 7.1 Tenancy étendu
- `tenant_settings` JSONB pour flags multi-tenant (max_schools, plan features)

### 7.2 Branding & Settings
- `branding` (school_id PK, logo_file_id, favicon_file_id, display_name, primary_color, accent_color, font_family, email_from, email_reply_to)
- `school_settings` étendu: `grading_scale_id`, `period_structure`, `alert_thresholds JSONB`, `notification_preferences JSONB`, `policies JSONB`
- `grading_scale` (id, school_id, name, max_score, mapping JSONB, is_default)
- `school_calendar_event` (id, school_id, type, date_from, date_to, label, color)

### 7.3 Custom fields
- `custom_field_definition` (id, scope, key, label, type, required, options JSONB, validation JSONB, visibility JSONB, order_index)
- `custom_field_value` (id, definition_id, entity_id, value JSONB)
- Index unique `(definition_id, entity_id)`

### 7.4 Custom alert rules
- `alert_rule` étendu: `rule_definition JSONB` (AST de la règle), `description`, `severity_default`

### 7.5 Custom forms
- `custom_form_definition` (id, school_id, slug, title, schema JSONB, status)
- `custom_form_submission` (id, definition_id, submitted_by, data JSONB, files JSONB, status)

### 7.6 Custom roles & permissions
- `permission` (id, code, label, resource_type, action, description)
- `role` (id, school_id NULL=global, name, slug, description, is_system)
- `role_permission` (role_id, permission_id)
- `user_role` (user_profile_id, role_id, school_id, granted_by, granted_at)

### 7.7 Templates customisables
- `notification_template` (id, school_id, event_type, channel, locale, subject, body_html, body_text, variables JSONB)
- `report_template` (id, school_id, name, type, template_source TEXT, variables JSONB)
- `i18n_override` (id, school_id, locale, key, value)

### 7.8 Dashboard layout
- `dashboard_layout` (id, user_profile_id, portal, layout JSONB)

### 7.9 Présences
- `attendance_session` (id, class_section_id, subject_id, teacher_id, scheduled_at, duration_min)
- `attendance_record` (id, session_id, student_id, status, comment, marked_by, marked_at)

### 7.10 Emploi du temps
- `timetable` (id, school_id, academic_year_id, name)
- `timetable_slot` (id, timetable_id, day_of_week, start_time, end_time, class_section_id, subject_id, teacher_id, room)

### 7.11 Cahier de texte
- `lesson` (id, teaching_assignment_id, scheduled_at, title, content, homework, status)
- `lesson_resource` (id, lesson_id, file_id, label)

### 7.12 Discipline
- `disciplinary_record` (id, student_id, reporter_id, type, severity, date, description, sanction, status)

### 7.13 Communications
- `announcement` (id, school_id, audience JSONB, title, body, published_at, scheduled_at, attachments JSONB)
- `announcement_read` (announcement_id, user_id, read_at)
- `conversation` (id, school_id, type, participants JSONB, subject, status) → Phase 5
- `message` (id, conversation_id, sender_id, body, attachments JSONB, sent_at) → Phase 5

### 7.14 Documents
- `document_library_item` (id, school_id, folder, title, file_id, version, visibility, tags)

### 7.15 Bulk imports
- `import_batch` (id, school_id, type, file_id, status, summary JSONB, started_at, completed_at)
- `import_row` (id, batch_id, row_index, status, payload JSONB, errors JSONB)

### 7.16 Recherche
- `search_index` (entity_type, entity_id, tenant_id, school_id, content_tsv tsvector) — alimenté par triggers

### 7.17 Sessions & device
- `user_session` (id, user_profile_id, device, ip, user_agent, created_at, last_seen_at)
- `webpush_subscription` (id, user_profile_id, endpoint, p256dh, auth, created_at)

### 7.18 Extensions Postgres 15 utilisées
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
```

---

## 8. Modules backend (v2 enrichi)

| Module | v1 | v2 ajouts |
|---|---|---|
| Identity | OIDC, RBAC | Custom roles, permission catalog, sessions, WebPush subscriptions |
| School Structure | écoles, années, classes, matières | Branding, grading_scale, school_calendar_event |
| Enrollment | élèves, parents, guardianship | Bulk import |
| Teaching | affectations | Substitut |
| Assessment | planification | Templates configurables |
| Gradebook | saisie/publish/revise | Bulk import notes, lock global |
| Analytics | snapshots | Custom KPIs, dashboard layouts |
| Alerting | 5 règles MVP | Rule engine custom (AST JSONB) |
| Notification | email + SSE | WebPush, templates customisés, digest scheduler |
| Audit | append-only | Recherche, integrity hash chain |
| **Attendance** | — | **Sessions, records, stats, alertes absentéisme** |
| **Timetable** | — | **CRUD slots, conflict detection, export .ics** |
| **Lessons** | — | **Cahier de texte, resources** |
| **Discipline** | — | **Records, sanctions, workflows** |
| **Communications** | — | **Annonces, conversations (Phase 5)** |
| **Documents** | — | **Library tagged, versionning** |
| **Customization** | — | **Custom fields, forms, templates, i18n overrides** |
| **Imports** | — | **Bulk CSV pipeline (upload → validate → preview → apply)** |
| **Search** | — | **Postgres tsvector multi-entity** |

---

## 9. Design system harmonisé (résumé — détail dans docs/design-system.md)

Tous les portails partagent:
- Mêmes tokens couleur (avec override branding par école)
- Même typo Inter + même échelle
- Mêmes composants shadcn + composants métier
- Mêmes patterns (skeletons, toasts, dialogs, sheets)
- Mêmes microcopy bienveillant
- Même PWA shell

Différences par portail:
- **Admin** → Layout sidebar fixe + topbar + densité élevée; primary couleur projet (slate-blue)
- **Teacher** → Layout bottom-tabs mobile + sidebar desktop; primary teacher (teal vert pédagogique)
- **Parent** → Layout bottom-tabs prioritaire mobile; primary parent (chaleureux bleu confiance); densité faible, gros boutons tactiles

Stratégie d'implémentation: même `<DesignSystemProvider>` qui injecte les CSS variables; chaque portail a son theme overlay via attribute `data-portal="admin|teacher|parent"`.

Storybook obligatoire pour chaque composant: stories par portail + dark mode + variations sémantiques.

---

## 10. APIs & contrats (v2 enrichi)

Même versionning `/api/v1`. Nouveaux endpoints (résumé):

```
# Branding
GET  /api/v1/branding/me                       # branding du tenant courant (public)
PUT  /api/v1/schools/:id/branding              # admin only

# Custom fields
GET    /api/v1/custom-fields?scope=student
POST   /api/v1/custom-fields
PATCH  /api/v1/custom-fields/:id
DELETE /api/v1/custom-fields/:id

# Custom forms
GET   /api/v1/custom-forms
POST  /api/v1/custom-forms
POST  /api/v1/custom-forms/:slug/submit
GET   /api/v1/custom-forms/:id/submissions

# Roles & permissions
GET    /api/v1/roles
POST   /api/v1/roles
POST   /api/v1/roles/:id/permissions
POST   /api/v1/users/:id/roles

# Présences
POST  /api/v1/attendance/sessions
POST  /api/v1/attendance/sessions/:id/records  # batch
GET   /api/v1/students/:id/attendance?from&to

# Emploi du temps
POST  /api/v1/timetables
POST  /api/v1/timetables/:id/slots
GET   /api/v1/teachers/:id/schedule
GET   /api/v1/classes/:id/schedule
GET   /api/v1/timetables/:id/export.ics

# Lessons
POST  /api/v1/lessons
GET   /api/v1/classes/:id/lessons?from&to

# Discipline
POST  /api/v1/disciplinary-records
GET   /api/v1/students/:id/disciplinary-records

# Annonces
POST  /api/v1/announcements
GET   /api/v1/announcements/feed

# Documents
POST  /api/v1/documents
GET   /api/v1/documents?folder

# Imports
POST  /api/v1/imports/:type/upload             # upload CSV
GET   /api/v1/imports/:batchId/preview
POST  /api/v1/imports/:batchId/apply
POST  /api/v1/imports/:batchId/rollback

# Search
GET   /api/v1/search?q=...                     # global search avec ranking

# WebPush
POST  /api/v1/webpush/subscribe
DELETE /api/v1/webpush/subscriptions/:id

# Dashboard layouts
GET   /api/v1/dashboard-layouts/me?portal=admin
PUT   /api/v1/dashboard-layouts/me

# Templates
GET   /api/v1/notification-templates
PUT   /api/v1/notification-templates/:id
GET   /api/v1/report-templates
PUT   /api/v1/report-templates/:id
```

---

## 11. Sécurité v2 (renforcé)

Ajouts par rapport à v1:
- **Per-portal client_id Keycloak** isolation tokens
- **Audit hash-chain** optionnel: chaque ligne audit_log signe la précédente (SHA-256), détection altération
- **Rate-limit per-portal** différencié (parent plus libéral que admin)
- **Brute force detection** sur login (par compte + par IP)
- **Suspicious activity alerts** côté admin (login from new country, MFA disabled, role escalation)
- **WebPush subscriptions** chiffrement bout-en-bout par défaut
- **CSP par portail** (admin peut avoir whitelist plus permissive si nécessaire)
- **Session management UI** côté user (sessions actives, revoke remote)
- **Bulk import** validations: schema Zod + business rules + diff-preview + rollback
- **DPIA Phase 4** documentée pour conformité enfants

---

## 12. Tests & qualité (v2 ajustements)

- Storybook + Chromatic (visual regression) sur tous composants design system
- Tests E2E par portail:
  1. Admin: créer école, branding, custom field, valider inscription
  2. Teacher: planifier, saisir grille, prendre présence, cahier texte
  3. Parent: register avec code école, claim child, voir dashboard, alerte
- Tests d'intégration Postgres 15 via testcontainers-node
- Tests RLS: 2 tenants → cross-tenant denial
- Tests permissions: custom role → action autorisée/refusée
- Tests imports: CSV malformé → erreurs lisibles
- Tests accessibilité: axe-core sur 100% des pages publiques et 1ère page de chaque section

---

## 13. DevOps & Docker (livré à la fin)

### 13.1 Stratégie containerisation
- Images multi-stage (build → runtime)
- Base: `node:22-alpine` slim
- Non-root user, healthchecks
- Tags semver + sha
- Pas de secrets dans les images
- Multi-arch (linux/amd64, linux/arm64) pour Apple Silicon dev

### 13.2 `docker-compose.yml` (dev complet, one-command up)

Services prévus:
- `postgres` (image `postgres:15-alpine`) + init SQL extensions
- `redis` (image `redis:7-alpine`)
- `keycloak` (image `quay.io/keycloak/keycloak:26` + theme custom + realm import)
- `minio` (image `minio/minio:latest`) + mc init bucket
- `maildev` (image `maildev/maildev`) — dev SMTP
- `jaeger` (image `jaegertracing/all-in-one:latest`) — OTel
- `prometheus` + `grafana` + `loki` + `tempo` (Phase 4 ajout)
- `api` (build from Dockerfile.api)
- `worker` (build from Dockerfile.worker)
- `web` (build from Dockerfile.web)
- `nginx` (prod profile only)

Volumes nommés pour persistence; networks isolés; env via `.env`.

### 13.3 Profils Docker Compose
- `dev` (défaut): tous services en mode développement avec hot-reload
- `prod` (`docker compose --profile prod up`): mode production, nginx, optimisations
- `obs`: ajoute Grafana stack
- `minimal`: postgres + redis + api seulement (pour tests CI)

### 13.4 Healthchecks
- Tous les services ont un healthcheck Docker
- `api`: `GET /healthz` retourne 200 si DB + Redis + Keycloak accessibles
- `worker`: heartbeat file
- `web`: `GET /` SSR

### 13.5 Migrations
- Service `migrator` one-shot: `pnpm prisma migrate deploy`
- Lancé avant `api` via `depends_on: condition: service_completed_successfully`

### 13.6 Bootstrap Keycloak
- Service `keycloak-init` one-shot: import realm-export.json
- Crée realm `pilotage-scolaire`, 3 clients OIDC, rôles realm

### 13.7 Bootstrap S3
- Service `minio-init` one-shot: crée bucket `pilotage`, policy public-read sur logos publics

### 13.8 Bootstrap données
- Service `seed` one-shot (dev uniquement): seed un tenant démo + école + classes + comptes test

---

## 14. Méthode de travail (v2 améliorée)

### 14.1 Cadence
- **Sprints d'1 semaine** avec démo interne fin de semaine
- **Stand-up async** quotidien dans GitHub Discussions
- **Spec-first**: pas une ligne de code sans spec dans `docs/spec/features/`
- **PRs petites** (< 500 lignes) avec checklist Definition of Done

### 14.2 Definition of Done
- [ ] Spec à jour (`features/<feature>.md`)
- [ ] Tests unitaires + intégration + E2E (sur parcours critiques)
- [ ] Storybook stories pour nouveaux composants
- [ ] Accessibilité (axe-core) ≥ AA
- [ ] OpenAPI mis à jour si endpoint ajouté/modifié
- [ ] Docs utilisateur mis à jour si feature visible
- [ ] Audit log si action sensible
- [ ] i18n FR (et EN si packagé pour cette release)
- [ ] Lighthouse ≥ 90 sur la nouvelle page
- [ ] Pas de regression Chromatic (visual)
- [ ] Code review approuvée

### 14.3 Outils
- GitHub Projects (board kanban) + Issues
- GitHub Actions (CI/CD)
- Chromatic ou Playwright snapshots (visual)
- Lighthouse CI (perf/a11y)
- CodeQL + Trivy (sécurité)

### 14.4 Documentation continue
- Chaque feature: 1 spec, 1 ADR si décision structurante, 1 Storybook, 1 doc utilisateur
- Runbooks ops vivants
- Glossaire métier dans `docs/spec/glossary.md`

---

## 15. Roadmap v2 (réajustée)

| Phase | Durée | Périmètre |
|---|---|---|
| **0 — Fondations** | 1-2 sem | Monorepo, docker-compose, CI, healthchecks, design tokens, Storybook, landing publique, 3 stubs portail |
| **1 — Auth + Identity + Customization base** | 3-5 sem | 3 portails auth (login/register/reset), Keycloak realm + 3 clients, profils utilisateurs, custom roles + permissions catalog, branding + school settings |
| **2 — Structure école + Hiérarchie + Bulk imports** | 3-4 sem | Schools, academic_years, terms, cycles, grade_levels, classes, subjects, coefficients, calendrier scolaire, bulk import CSV avec preview |
| **3 — Personnes + Inscriptions + Affectations + Custom fields** | 3-4 sem | Profs, élèves, parents, guardianship workflow, enrollment workflow, teaching assignments, custom_field_definition + value, formulaires dynamiques |
| **4 — Évaluations + Gradebook + Snapshots + Alertes** | 4-5 sem | Assessments, gradebook avec grille saisie, draft/publish, score_revision, snapshots, alert engine (5 MVP + custom rule builder), notifications email + SSE + WebPush |
| **5 — Présences + Emploi du temps + Cahier de texte** | 3-4 sem | Attendance sessions/records, timetable drag-drop + .ics, lessons + resources, disciplinary records |
| **6 — Dashboards + Reports + Documents + Annonces** | 3-4 sem | Parent dashboard complet, Teacher dashboard, Admin dashboard customisable widgets, Report templates + PDF generation, Annonces, Documents library |
| **7 — Hardening + A11y + Perf + Sécurité** | 2-3 sem | Audit OWASP ASVS, audit accessibilité, perf budget Lighthouse ≥ 90, DPIA, drill backup/restore, observabilité complète |
| **8 — Docker + Déploiement** | 1-2 sem | **Dockerfile prod-grade, docker-compose prod, nginx, scripts deploy, runbooks ops** |
| **9 — Extensions** | itératif | Paiement, Messagerie, Tutorat, Intégrations OneRoster/LTI, App mobile native |

**Total MVP fonctionnel v2:** ~22-30 semaines (≈ 5-7 mois). Au lieu de 14-22 semaines du v1 mais avec **beaucoup plus de features**.

---

## 16. Risques v2 (ajouts)

| Risque | Mitigation |
|---|---|
| Customization → scope creep | MVP customisation = branding + custom fields + custom alert rules + custom roles uniquement; reste en Phase 9 |
| 3 portails → triplication code | Composants partagés `packages/ui`, Storybook obligatoire, design system centralisé |
| Postgres 15 vs 16 features | Vérifier que features utilisées sont compatibles 15 (vérifié: gin partitionnement, JSONB, RLS — OK) |
| Bulk import → corruption données | Pipeline validate → preview → apply avec rollback transactionnel |
| Custom roles → confusion permissions | Permission matrix lisible + audit role changes; rôles système non-modifiables |
| Schedule/timetable conflict detection | Algo de détection conflits classe/prof/salle + UI montrant collisions |
| Docker prod sans K8s | Compose prod + nginx + scripts deploy + monitoring; clair que c'est single-host pour 1 école pilote |

---

## 17. Critères d'acceptation v2

Cahier (v1) ✓ + ajouts:
- [ ] 3 portails accessibles à `/admin`, `/teacher`, `/parent` avec leur propre login/register
- [ ] User multi-rôle peut basculer entre portails via `RoleSwitcher`
- [ ] Admin peut customiser branding (logo, couleurs), Custom field "Allergies" apparaît sur fiche élève
- [ ] Admin peut créer un rôle "comptable" avec permissions choisies
- [ ] Admin peut créer une règle d'alerte custom et la voir se déclencher
- [ ] Prof peut prendre la présence sur sa classe
- [ ] Prof peut saisir le cahier de texte
- [ ] Parent voit présences + bulletins de son enfant
- [ ] Bulk import 100 élèves CSV → preview → apply → succès
- [ ] PWA installable sur mobile (manifest + service worker)
- [ ] Postgres 15 démarré via docker-compose
- [ ] `docker compose up` lance tout en < 60s
- [ ] Lighthouse ≥ 90 sur les 3 dashboards portails

---

## 18. Revue itérative du plan v2 (5 passes)

**Pass 1 — Cohérence cahier:** Toutes sections cahier couvertes + ajouts v2 explicites. ✓

**Pass 2 — Edge cases métier nouveaux:**
- Multi-rôle utilisateur (prof + parent): cookie portail actif, session unique, RoleSwitcher
- Custom role avec permissions conflictuelles: validation à la création
- Bulk import partiel: option "apply lignes valides" ou "all-or-nothing"
- Suppression custom field utilisé: soft-delete + archive valeurs
- Branding non-renseigné: fallback design system par défaut

**Pass 3 — Edge cases sécurité:**
- Tentative de bypass portail (ex. prof accédant `/admin`): server-side check rôle → 403 + log
- WebPush subscription revoked: cleanup automatique
- Custom alert rule infinie: timeout évaluation 1s, désactivation auto si erreurs répétées
- Bulk import: scan antivirus sur upload via ClamAV (Phase 7)
- Audit hash chain: si rupture détectée → alerte super-admin

**Pass 4 — Edge cases UX/A11y:**
- Mobile parent dans transports (4G saturée): PWA offline cache dernière vue, queue mutations
- Tablette tactile prof en classe: GradeMatrix touch-friendly, autosave debounce
- Daltonisme: présences statut = forme + couleur + texte
- Parent dyslexique: option police "Atkinson Hyperlegible"
- Lecteur d'écran: skip-links, ARIA, focus management dans sheets

**Pass 5 — Edge cases ops:**
- Restore depuis backup: scripts testés en CI mensuel
- Migration Postgres 15→16 future: documenter compatibilité (déjà OK)
- Rotation Keycloak realm export: snapshot mensuel
- Reset démo: script `pnpm seed:reset` pour environnements test
- Migration en prod: pattern expand-and-contract + feature flags

---

## 19. Prochaines étapes immédiates (après validation plan v2)

1. **Phase 0** — Initialiser monorepo Turborepo + pnpm; créer apps/api, apps/worker, apps/web, packages/contracts, packages/ui, packages/design-tokens, packages/i18n
2. **docker-compose.yml dev** complet
3. **NestJS skeleton** avec Identity module + healthcheck
4. **Next.js skeleton** avec landing publique + 3 layouts portail vides
5. **Keycloak realm + 3 clients** bootstrap
6. **Prisma schema initial** (tenant, school, user_profile, branding, role, permission)
7. **CI GitHub Actions** lint + typecheck + test + Storybook build
8. **Storybook** initialisé avec premiers tokens
9. **README + docs/CONTRIBUTING.md**
10. **Première feature spec** : `docs/spec/features/F001-admin-login.md`
