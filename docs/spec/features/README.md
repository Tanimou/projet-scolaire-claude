# Feature spec-kit (per-epic)

Each medium-to-large **epic** from [`bmad/roadmap.md`](../../../bmad/roadmap.md) gets its own
folder here, written on the epic's **spec run** by the Daily-Improvement routine (BMAD
spec-driven, mirroring the cahier de charges §12). Subsequent runs implement the epic
**one vertical slice at a time**, reading these files.

```
docs/spec/features/<epic-id>/
├── spec.md                 # vision, users, scenarios, acceptance criteria, non-goals
├── plan.md                 # technical approach, modules touched, dependencies, risks
├── data-model.md           # Prisma models/relations/constraints + non-destructive migration plan
├── contracts/openapi.yaml  # endpoints, payloads, errors, RBAC/ABAC per route
├── tasks.md                # ORDERED vertical-slice backlog (S1, S2, …) — what runs implement
├── quickstart.md           # how to run / seed / test this feature locally
└── PROGRESS.md             # per-slice status + "next slice" pointer
```

`<epic-id>` is the lowercased roadmap id (e.g. `e1`, `e2`). A slice is one capability a user
can now *do*, demoable end-to-end, that fits one PR + one build.
