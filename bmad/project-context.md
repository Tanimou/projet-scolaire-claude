# Project Context — Pilotage Scolaire

> **What this file is.** The single source of truth for *how* this codebase is
> built — its stack, conventions, architectural decisions and quality gates.
> It is the BMAD "consistency guardrail": **every** automated agent (every
> phase of the Daily-Improvement v2 pipeline) must read this file first and
> treat it as a hard constraint, so parallel agents never diverge on technical
> decisions. Keep it short, factual and current. (Mirrors BMAD's
> `_bmad-output/project-context.md`.)

## 1. Stack (pinned)

- **Monorepo**: Turborepo + **pnpm 9.12.3**, **Node 22** (`.nvmrc` — Node ≥ 23 breaks the local run because workspace packages are consumed as TS source; use Docker on newer Node).
- **`apps/web`** — Next.js 15 App Router · React 18.3 · TypeScript 5.6 · Tailwind v4 · `@pilotage/ui` · next-auth 5 (beta) · next-intl · lucide-react · recharts · framer-motion. **Dev port `3100`** (`next dev --port 3100`), **not** 3000.
- **`apps/api`** — NestJS 11/10 · Prisma 5.22 · Keycloak (passport-jwt + jwks-rsa) · BullMQ · Zod · class-validator · Swagger. REST under **`/api/v1/*`**. Modular monolith. Port **4000**.
- **`apps/worker`** — NestJS + BullMQ + exceljs + @react-pdf/renderer + nodemailer (async exports/PDF/email — partly stubbed).
- **`packages/ui`** — design system (~30 components), CVA + tailwind-merge, consumed as **raw TS source**.
- **`packages/contracts`** — shared Zod/TS types, **built to CJS** (`dist/`, `main → dist/index.js`, `types → src`) so Node can load it at runtime. **Never** revert it to source-only `main`.
- **`packages/design-tokens`** — OKLCH tokens, per-portal `data-portal` theming. `packages/i18n`, `packages/eslint-config`, `packages/tsconfig`.

## 2. Critical implementation rules

- **Three portals** = Next.js route prefixes: `/admin`, `/teacher`, `/parent` (+ public `/`). Keep features inside the right portal route group.
- **Multi-tenant**: every query/mutation is scoped by `tenant_id` (Postgres RLS, ADR-002). Never write a query that can cross tenants.
- **AuthZ**: RBAC + ABAC + custom roles (ADR-015). Parent access is enforced via `StudentAccessService`. Preserve auth, tenant boundaries, audit (append-only) on every backend change.
- **Server/client boundary** (React 19/Next 15): data-fetching in server components; `'use client'` only where interactivity is required.
- **Reuse `@pilotage/ui` first.** Add a new shared component only when it improves consistency/quality. Frontend changes must be premium, colorful, responsive, animated, accessible.
- **Aggregate endpoints**: dashboards read pre-aggregated analytics endpoints (`/api/v1/analytics/*`) — do not N+1 from the client.
- **No secrets, no build artifacts** committed (no `node_modules`, `.next`, `dist`, `*.vhdx`, generated noise, unrelated formatting churn).

## 3. Architecture decisions (ADRs — read before touching the area)

`docs/adr/`: 001 modular monolith · 002 multi-tenancy (shared DB + `tenant_id` + RLS) · 003 three portals via route prefixes · 004 Keycloak 1 realm / 3 clients · 013 customization layer (settings + custom fields + JSONB + rule engine) · 014 Postgres 15 + extensions · 015 permission model (RBAC+ABAC+custom roles) · 016 Storybook mandatory · 017 bulk import pipeline (upload→validate→preview→apply) · 018 finance module (Phase 9, deferred).

**Rule:** a change that introduces a *new* architectural decision (new HTTP style, new state lib, off-convention path, new cross-cutting pattern) is a **blocking finding** — it must either be reverted to the documented convention, or land **with a new ADR** in `docs/adr/`.

## 4. Quality gates (what the automated routine is allowed to run)

| Gate | Command | Use |
|---|---|---|
| **Typecheck** (primary) | `pnpm typecheck` | the reliable cheap gate — run on every sprint |
| Diff hygiene | `git diff --check` | whitespace/conflict markers |
| Targeted unit tests | `pnpm --filter @pilotage/api test -- <pattern>` | only for changed behavior |
| Lint (targeted) | `pnpm --filter <ws> lint` | only if quick & relevant |

**FORBIDDEN in the routine (slow / the user runs these via `scripts/dev.sh` / `scripts/deploy-prod.sh` after batching changes):** `pnpm build`, `next build`, `docker build`, `docker compose build|up --build`, `infra/pilotage.sh update|rebuild|reset`, any full container rebuild.

UI verification = screenshots **only if the app is already running** at `http://localhost:3100` (desktop 1680×944 + mobile 390×844). Never rebuild the stack just for screenshots.

### 4a. Resource budget (CPU / RAM / disk — hard ceiling)

The Workflow may run **up to 5–6 agents in parallel** (the runtime additionally caps at `cpu-2`). This does **not** raise machine load, because the budget is enforced by *role*, not by count:

- **Exactly ONE agent (Murat, the test-architect gate) runs `pnpm typecheck`** — the single heavy local command — per sprint. No other agent runs typecheck, tests, lint, or any build. Reviewers read the diff (API-bound), they do not invoke the toolchain.
- **No agent ever builds** (`pnpm build` / `next build` / `docker build` stay forbidden — see §4 above).
- **Implement agents edit disjoint file sets** — `apps/web` (FE) vs `apps/api`+`apps/worker` (BE) vs `packages/ui` (DS) — so there is **one checkout**, no parallel `node_modules`/`.next`, and zero edit conflicts. Disk and RAM stay flat regardless of how many reviewers run.
- If the host is under load, prefer fewer concurrent reviewers over skipping the gate — the typecheck gate (Murat) is the one step that must always run.

## 5. Project state & backlog (prioritize from here)

Redesign **R0→R5 complete** (design system, AppShell, the 3 dashboards). Open backlog by value:
- **R6 — Alert engine (~20%)**: UI stub only. Needs `AlertRule`/`AlertInstance` Prisma models + BullMQ evaluation engine + the 7 documented rules.
- **R7 — Async exports (~25%)**: deps installed, `ExportJob` model exists, worker not built. XLSX/PDF generation.
- **R8 — Notifications (~70%)**: bell works off `AnnouncementReceipt`; needs a dedicated `Notification` dispatcher + parent email on published grades/alerts/absences.
- **R9 — Accessibility (~50%)** WCAG 2.2 AA · **R10 — E2E (~30%)** Playwright (smoke + a11y only).
- Per-portal polish + customization (school branding, themes, density, dashboard prefs) per the routine's UI/UX mandate.
Source of truth: `PLAN.md`, `docs/spec/REDESIGN-PROGRESS.md`, `docs/spec/REDESIGN-PLAN.md`, the cahier de charges PDF.

## 6. Git & PR workflow (reconciled — use these exact values)

- Remote `origin` → `github.com/Tanimou/projet-scolaire-claude`, default branch **`main`**. PRs are squash-merged.
- **Branch prefix `ci/YYYY-MM-DD-short-feature`** (this is what the history actually uses — *not* `continuous-improvement/`).
- **Worktrees live under `.claude/worktrees/`** in the repo (the old `E:\projects\pilotage-scolaire-worktrees\*` path is gone — project moved back to `C:\Users\HP\Downloads\pilotage-scolaire-claude` on 2026-06-02). Keep ≤ 5; never delete a dirty worktree; `git worktree prune` after removals.
- **Login (demo) for screenshots**: admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage` (full `voltaire-demo` data). Simple per-portal: `admin|teacher|parent@pilotage.local` / `Changeme123!`.
