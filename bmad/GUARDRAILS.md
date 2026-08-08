# GUARDRAILS — the hard constraints every agent obeys

> **What this file is.** The distilled, *complete* set of hard constraints for an implementing or reviewing agent.
> It replaces the mandatory broadcast of `project-context.md` (11.6 KB) + `roadmap.md` (158 KB) in the sprint
> Workflow's `GUARD`, which every agent was reading in full on every run — ~177 KB × ~15–20 agents ≈ **3 MB of
> identical re-reading per run, before any work happened**.
>
> **Nothing here is a relaxation.** Every rule below is carried over verbatim in force from
> [`project-context.md`](./project-context.md) and the guardrails section of [`roadmap.md`](./roadmap.md). Those two
> files remain authoritative and unchanged — read them when you need the *why*, the full stack detail, or the epic
> backlog. This file is what you must obey *always*; those are what you consult *when relevant*.

---

## 1. North star (never trade this away)

Pilotage Scolaire is a **decision-oriented school-monitoring platform, not a digital gradebook**. The **parent
dashboard is the core**: it answers five questions in under 2 s — where is my child overall, which subjects are
struggling, which are improving, which assessments are coming, what concrete action should I take?

Defining promise: **turn information into action.** Every alert is explainable (rule, subject, threshold, trend) and
leads to a next step. Tone is factual, kind and **non-stigmatising** — never compare a child by name to peers.

It handles **children's data**: RGPD-level governance, minimal access and append-only audit are non-negotiable.

## 2. Architecture — the shape you must not silently change

- **Modular monolith** (ADR-001). Build toward future modules; no premature microservices.
- **Four portals** as Next.js route prefixes: `/admin`, `/teacher`, `/parent`, `/student` (+ public `/`). Keep a
  feature inside its portal route group.
- **Multi-tenant**: every query and mutation is scoped by `tenant_id` (ADR-002). **Never write a query that can cross
  tenants.**
- **AuthZ**: RBAC + ABAC + custom roles (ADR-015). Parent access goes through `StudentAccessService`. Preserve auth,
  tenant boundaries and append-only audit on **every** backend change.
- **Server/client boundary** (Next 15): data-fetching in server components; `'use client'` only where interactivity is
  genuinely required.
- **Reuse `@pilotage/ui` first.** A new shared component only when it improves consistency. Frontend work must be
  premium, colourful, responsive, animated and accessible.
- **Aggregate endpoints**: dashboards read pre-aggregated `/api/v1/analytics/*`. **Never N+1 from the client.**
- **`packages/contracts` builds to CJS** (`main → dist/index.js`). **Never** revert it to a source-only `main`.
- **No secrets and no build artefacts** committed — no `node_modules`, `.next`, `dist`, `*.vhdx`, generated noise, or
  unrelated formatting churn.

**ADR rule.** A change introducing a *new* architectural decision (new HTTP style, new state library, off-convention
path, new cross-cutting pattern) is a **blocking finding**. It must either revert to the documented convention, or land
**with a new ADR** in `docs/adr/`.

Existing ADRs: 001 modular monolith · 002 multi-tenancy (shared DB + `tenant_id` + RLS) · 003 portals via route
prefixes · 004 Keycloak 1 realm / N clients · 013 customization layer · 014 Postgres 15 · 015 permission model ·
016 Storybook · 017 bulk import pipeline · 018 finance (deferred) · 021 student role & self-ABAC · 022 child claim ·
023 authenticated e2e + a11y · 024 async import & idempotent reconciliation. **Read the relevant ADR before touching
its area.**

## 3. Stack (pinned — do not drift)

| Package | Pinned facts |
|---|---|
| Monorepo | Turborepo + **pnpm 9.12.3**, **Node 22** (`.nvmrc`). Node ≥ 23 breaks the local run |
| `apps/web` | Next.js 15 App Router · React 18.3 · TS 5.6 · Tailwind v4 · next-auth 5 beta · next-intl · lucide-react · recharts · framer-motion. **Dev port 3100**, not 3000 |
| `apps/api` | **NestJS 10 (pinned)** · Prisma 5.22 · Keycloak (passport-jwt + jwks-rsa) · BullMQ · Zod · class-validator · Swagger. REST under `/api/v1/*`. Port **4000** |
| `apps/worker` | NestJS + BullMQ + exceljs + @react-pdf/renderer + nodemailer |
| `packages/ui` | design system, CVA + tailwind-merge, consumed as **raw TS source** |
| `packages/contracts` | shared Zod/TS types, **built to CJS** |
| `packages/design-tokens` | OKLCH tokens, per-portal `data-portal` theming |

## 4. Resource budget — enforced by role, not by count

- **Exactly ONE agent (the test-architect) runs `pnpm typecheck`**, once per sprint. No other agent runs typecheck,
  tests, lint or any build. Reviewers **read the diff**; they do not invoke the toolchain.
- **No agent ever builds.** The orchestrator session runs at most one `pnpm build` per run, while holding the write
  lock. **Agents never run** `pnpm build`, `next build`, `docker build`, `docker compose build|up --build`, or
  `infra/pilotage.sh update|rebuild|reset`.
- **Implement agents edit disjoint file sets** — `apps/web` (FE) vs `apps/api`+`apps/worker` (BE) vs `packages/ui` (DS).
  One checkout, zero edit conflicts.
- Under host load, prefer fewer concurrent reviewers over skipping the gate. The typecheck gate always runs.

## 5. Working rules

- **Work only inside the checkout you were given.** Never touch unrelated areas. Never remove a working feature.
- **One coherent improvement per run.** Never widen a change to "finish the feature" — sequence it across runs.
- **Diagnose at the right layer** (intent → spec → code). Never blind-retry.
- **Never `git add .claude/`.**
- Branch prefix `ci/YYYY-MM-DD-…`; PRs are squash-merged to `main`.

## 6. Where to look when this file is not enough

| You need | Read |
|---|---|
| The story you are implementing | the `hint` you were given, and `docs/spec/features/<epic>/` |
| Gate definitions and evidence bar | the routine prompt's Step 5, and `docs/daily-improvement-v3/` |
| Open findings only | `docs/daily-improvement-v3/traceability/OPEN.md` (**not** the full matrix) |
| Do-not-copy rules | `docs/daily-improvement-v3/audit-findings-index.md` §5 |
| Full stack detail / rationale | [`project-context.md`](./project-context.md) |
| Epic backlog and ambition | [`roadmap.md`](./roadmap.md) |
| Agent personas | [`agents.md`](./agents.md) |

**Read those on demand. Do not read them reflexively — that reflex is what made every run 3–4 hours long.**
