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

| Gate | Command | Who / when |
|---|---|---|
| **Typecheck** (primary) | `pnpm typecheck` | the **Murat** agent, **once** per sprint — the reliable cheap gate |
| Diff hygiene | `git diff --check` | Murat, with the typecheck gate |
| Targeted unit tests | `pnpm --filter @pilotage/api test -- <pattern>` | only for changed behavior |
| Lint (targeted) | `pnpm --filter <ws> lint` | only if quick & relevant |
| **Build (v3)** | `pnpm build` (Turbo, **affected** packages) | the **orchestrator session ONCE**, after the Workflow, while it holds the write lock (§4b). NOT the agents. |

**Still FORBIDDEN in the routine (heavy / the user batches these via `scripts/dev.sh` / `scripts/deploy-prod.sh`):** `docker build`, `docker compose build|up --build`, `infra/pilotage.sh update|rebuild|reset`, any full container/image rebuild. Only the single Turbo `pnpm build` above is allowed, and only the orchestrator runs it — **agents never build.**

UI verification = screenshots **only if the app is already running** at `http://localhost:3100` (desktop 1680×944 + mobile 390×844). Never rebuild the stack just for screenshots.

### 4a. Resource budget (CPU / RAM / disk — hard ceiling)

The Workflow may run **up to 5–6 agents in parallel** (the runtime additionally caps at `cpu-2`). This does **not** raise machine load, because the budget is enforced by *role*, not by count:

- **Exactly ONE agent (Murat, the test-architect gate) runs `pnpm typecheck`** — the single heavy local command — per sprint. No other agent runs typecheck, tests, lint, or any build. Reviewers read the diff (API-bound), they do not invoke the toolchain.
- **No agent ever builds.** Builds are done **once per sprint by the orchestrator session**, not by any agent (`docker`/`infra` rebuilds stay forbidden — see §4).
- **Implement agents edit disjoint file sets** — `apps/web` (FE) vs `apps/api`+`apps/worker` (BE) vs `packages/ui` (DS) — so there is **one checkout**, no parallel `node_modules`/`.next`, and zero edit conflicts. Disk and RAM stay flat regardless of how many reviewers run.
- If the host is under load, prefer fewer concurrent reviewers over skipping the gate — the typecheck gate (Murat) is the one step that must always run.

### 4b. Concurrency & disk guard (v3 — the build/pileup fix)

Builds are slow, and the routine fires **hourly**, so overlapping runs could pile up builds and exhaust CPU/RAM/disk C:. v3 enforces a **machine-wide lock** via `bmad/scripts/routine-lock.sh` (the runtime-authoritative copy lives outside the repo at `~/.claude/scheduled-tasks/daily-improvement-v2/routine-lock.sh`, so it survives any `git checkout`). Rules:

- **Single writer.** Each run works on a feature branch **inside the main checkout** (no `git worktree add`), serialized by one `write.lock`. So there is **never more than one edit/build at a time**, and build artifacts (`.next`/`dist`/`.turbo`) are **never duplicated across worktrees** → disk C: stays bounded. (The Workflow is invoked with `args.worktree` = the main checkout path; the agents-edit-the-checkout behavior becomes intentional.)
- **Exactly one `pnpm build` per run**, by the lock-holder, run with the Turbo cache warm (affected packages only).
- **≤ 2 in-flight routine PRs** (`MAX_INFLIGHT`). A run that finds 2 routine `ci/*` PRs already open **skips** — that is the throttle. Merge one to unblock.
- **Auto-cleanup.** Each run first deletes routine `ci/*` branches (and any linked worktrees) whose PR is **MERGED/CLOSED**, then prunes — "merge a PR → its branch/worktree disappears next run."
- **Crash safety.** A crashed run's `write.lock` is reclaimed after `STALE_MIN` (60 min) and its leftover tracked changes are salvaged to a `git stash`.
- The cron stays **hourly**; ticks that can't get the lock (or hit the in-flight cap) exit in seconds. Tunable via env: `ROUTINE_MAX_INFLIGHT`, `ROUTINE_STALE_MIN`, `ROUTINE_BUILD_WAIT`.

## 5. Project state & backlog (prioritize from here)

> **North star (from the cahier de charges).** Pilotage Scolaire is a *decision-oriented* school-monitoring platform, **not** a digital gradebook. The **parent dashboard is the core**: it must answer five questions in <2 s — *where is my child overall, which subjects are struggling, which are improving, which assessments are coming, and what concrete action should I take?* The platform's defining promise is **"turn information into action"**: every alert is explainable (rule, subject, threshold, trend) and leads to a next step (contact the teacher, reinforce a subject, find tutoring). Tone is factual, kind, non-stigmatising — it manipulates children's data, so RGPD-level governance, minimal access, and append-only audit are non-negotiable. Build the **modular monolith** out toward the future modules (messaging, tutoring, payments, student portal, OneRoster/LTI) without premature microservices.

**Ambition source = [`bmad/roadmap.md`](./roadmap.md)** — the prioritized backlog of **medium-to-large epics** derived from the cahier de charges. The routine advances ONE epic at a time via **vertical slices** (each slice = one shippable PR spanning DB + API + UI + worker). Prefer epic slices over polish; polish is filler.

Current state (redesign **R0→R5 complete** — design system, AppShell, 3 dashboards). Foundation backlog still relevant:
- **R6 — Alert engine**: the 7 explainable rules + BullMQ evaluation engine on `GradePublished`/recompute, admin-configurable thresholds, parent action.
- **R7 — Async exports**: `ExportJob` worker → XLSX/PDF (parent term-summary, class grid, bulletins) to MinIO, audited.
- **R8 — Notifications**: dedicated dispatcher (email/push) + channels + digest + per-user preferences; parent email on published grades/alerts/absences.
- **R9 — Accessibility** WCAG 2.2 AA · **R10 — E2E** Playwright (smoke + a11y).
- Per-portal polish + customization (branding, themes, density, dashboard prefs).

**Spec-kit convention (BMAD spec-driven).** A new epic gets a spec folder `docs/spec/features/<epic-id>/` with `spec.md` (vision/users/scenarios/acceptance/non-goals), `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `tasks.md` (slice backlog), `quickstart.md`, `PROGRESS.md`. The routine writes this on the epic's **spec run**, then implements slices from `tasks.md`.

Source of truth: `bmad/roadmap.md`, the cahier de charges PDF (`~/Downloads/rapport_pilotage_scolaire_detaille.pdf`), `PLAN.md`, `docs/spec/REDESIGN-PROGRESS.md`, `docs/spec/data-model.md`.

## 6. Git & PR workflow (reconciled — use these exact values)

- Remote `origin` → `github.com/Tanimou/projet-scolaire-claude`, default branch **`main`**. PRs are squash-merged.
- **Branch prefix `ci/YYYY-MM-DD-short-feature`** (this is what the history actually uses — *not* `continuous-improvement/`).
- **Worktrees live under `.claude/worktrees/`** in the repo (the old `E:\projects\pilotage-scolaire-worktrees\*` path is gone — project moved back to `C:\Users\HP\Downloads\pilotage-scolaire-claude` on 2026-06-02). Keep ≤ 5; never delete a dirty worktree; `git worktree prune` after removals.
- **Login (demo) for screenshots**: admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage` (full `voltaire-demo` data). Simple per-portal: `admin|teacher|parent@pilotage.local` / `Changeme123!`.
