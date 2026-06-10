# E10 — Contracts index

> **E10 ships NO new REST endpoint.** It is a quality-bar epic (authenticated E2E harness + WCAG 2.2
> AA remediation). So the `contracts/` folder is deliberately *not* a new public API surface — it is
> the **harness contract** (how a test authenticates, what locators it may rely on, what an a11y scan
> asserts) plus a **traceability map** of the *existing* product endpoints each journey exercises.

| File | What it pins | Audience |
|---|---|---|
| [`auth-fixture.contract.md`](./auth-fixture.contract.md) | the per-portal authenticated-session (`storageState`) fixture — inputs, the real login call, outputs, lifecycle, RBAC/ABAC posture | the dev agent writing `auth.setup.ts` / `portal-fixtures.ts` |
| [`a11y-scan.contract.md`](./a11y-scan.contract.md) | the axe-core WCAG 2.2 AA scan contract — tag set, severity gate, scope-by-slice, the shared `axe.ts` helper | the dev agent writing the a11y sweep + the remediation reviewer |
| [`journeys.contract.md`](./journeys.contract.md) | the three critical journeys (J1/J2/J3) as Given/When/Then specs + the **existing** `/api/v1` endpoints each drives (traceability, no new endpoint) | every implementer + the test-architect |
| [`openapi.yaml`](./openapi.yaml) | a machine-readable map of the **existing, reused** endpoints the journeys exercise — marked `x-reused: true`, `x-e10-new: false`. **Documents, never defines.** | tooling / drift checks |

**Hard rule for reviewers:** any `x-e10-new: true` operation, any new schema model, or any `db push`
appearing in an E10 PR is **out of scope** — E10 adds tests/fixtures/config/CI/one ADR only
(see `../data-model.md` §0/§2).
