# E11 — Quickstart (run & demo)

> How to demo each E11 slice against the **already-running** local stack (`http://localhost:3100` web,
> `:4000` api, the worker, Postgres + Redis via infra). **No build/rebuild** is part of any E11 path
> (project-context §4). Each schema slice carries an **additive `db push`** that an **operator** applies
> (the routine can't run infra — the E7/E8/E9 precedent); surfaces degrade kindly until then.

## 0. Operator pre-reqs (gate demoability, not merge)

| Slice | Additive `db push` |
|---|---|
| S1 | `ImportStatus += queued` |
| S2 | `ReconciliationClass` enum + `ImportRow.reconciliation` + `conflictFields` + index |
| S3 | `RosterSourceKind`/`RosterSyncStatus`/`ImportOrigin` enums + `RosterSource` model + `ImportBatch.origin`/`rosterSourceId` |
| S4 | none (reuses S1–S3) |

Apply with the standard additive `prisma db push` against dev/prod (operator step). The worker must be
running with the **third queue** registered (S1) to drain `imports` jobs. `REDIS_URL` is the existing
BullMQ connection (shared with `exports`/`notifications-email`).

## 1. Login

Admin (rich `voltaire-demo` data): `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`. Simple admin:
`admin@pilotage.local` / `Changeme123!`. E11 is **admin-only** (`imports.execute` for CSV import,
`integrations.write` for OneRoster — both already on the admin role).

## 2. Demo — S1 (async apply, no frozen request)

1. `/admin/imports` → choose **Élèves**, download the template, upload a CSV (a few hundred rows for a
   visible async effect), **Valider** (unchanged, sync).
2. On the preview, click **Appliquer** → the call returns **immediately**; the batch detail page shows
   **`queued`** then a live **"X / N lignes traitées"** strip ticking up as the worker drains.
3. Close the tab, re-open the batch — the state is accurate (worker writes progress to the batch). It
   reaches **`applied`**. **No request was held open for the apply.**
4. (Crash-safety, dev) re-deliver/re-run the job → the batch does **not** re-apply already-applied rows
   (resumes from per-row status). The `import.apply` audit row is written once.

## 3. Demo — S2 (the reconciliation panel)

1. Apply a batch containing **both new and already-existing** students (e.g. re-upload some rows from a prior
   import) → the **"Bilan d'import & synchronisation"** panel shows **Créés / Mis à jour / Inchangés / À
   vérifier**.
2. Drill into a row → see *what changed* (`updated`) or *source vs current* (`conflict`), in calm,
   non-stigmatising copy ("à vérifier", never a red error on a child).
3. The **24h rollback** is one click away.

## 4. Demo — S3 (connect a OneRoster source)

1. `/admin/integrations` → **Connecter une source** → name it, choose **OneRoster · Bundle CSV**, save. (A
   REST source asks for a base-url + an optional **write-only** key — sealed server-side, shown
   "Identifiant sécurisé", never echoed — but REST live-pull is the recorded stretch; CSV-bundle ships now.)
2. On the source card click **Synchroniser** → the drawer file-loads the OneRoster CSV bundle
   (`users.csv`/`classes.csv`/`enrollments.csv`). The API maps + validates it (reusing each type handler's
   `validateRow`) into one normal **`origin=oneroster`** `ImportBatch` per type in **`validated`**, then
   navigates you to the produced (students) batch's preview/health surface — inheriting S1's async apply +
   S2's panel. The OneRoster `sourcedId` rides `externalRef` (the idempotency anchor — S4 re-run converges).

## 5. Demo — S4 (idempotent sync + conflicts + rollback)

1. Apply the OneRoster batch (async, S1) → the panel classifies via S2.
2. **Re-run the same sync** → it **converges**: **"Aucune modification — votre roster est déjà à jour"**
   (0 created, no duplicate children) — the idempotency invariant.
3. Resolve a **conflict** in the drawer (**Garder l'actuel** / **Prendre la source**) → the choice is
   audited, never a silent overwrite.
4. **Annuler la synchronisation** within 24h → reverse-order compensation, `rolled_back`, audited.

## 6. The standing pattern (for future interop work)

A new OneRoster entity type, or the OneRoster **REST** pull, or a later **LTI** surface, all plug into the
**same** spine: **map → `ImportRow` → the validated `ImportBatch` → the async worker apply → the
reconciliation panel → the 24h rollback**. There is **one** async-apply engine and **one** reconciliation
panel; interop breadth grows by adding **mappers**, not pipelines (ADR-024).

## 7. Invariants the demo proves (and the suite asserts)

- Apply/rollback/sync **never hold a request** for the operation (enqueue → poll).
- A retried/re-claimed job **never double-applies**; a re-sync **never duplicates** (converges).
- Every mutation is **tenant + school scoped** + **append-only audited**; OneRoster ingests **roster only**.
- The panel is **non-stigmatising**; the **24h rollback** works on imports and syncs.
- **No build/rebuild** anywhere in the E11 path.
