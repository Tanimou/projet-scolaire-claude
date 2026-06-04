# E2 — Quickstart (run / seed / test locally)

> How to exercise Parent ↔ Teacher Messaging locally. Assumes the hybrid setup from
> `bmad/project-context.md` (infra in Docker, web on `:3100`, api on `:4000`). **Do NOT
> rebuild the stack** — these are dev/run + DB-apply steps only.

## 1. Apply the schema (after S1's schema edit)

The repo uses `prisma db push` (no SQL `migrations/` folder). After the `schema.prisma` edit:

```bash
pnpm --filter @pilotage/api prisma:generate   # regenerate the client (REQUIRED pre-typecheck)
pnpm --filter @pilotage/api prisma:push       # apply additive tables to the dev DB
```

Then re-seed the new permissions (`messaging.read|write`, and `messaging.moderate` at S4) so the
RBAC gate resolves — same pattern as E1-S3's `meeting_requests.*`:

```bash
pnpm --filter @pilotage/api seed:permissions  # (or the repo's permission-seed script)
```

> The worker shares the same DB + the same `schema.prisma`, so its generated client picks up the
> new models automatically — no second schema to edit.

## 2. Demo accounts (from project-context §6)

- **Full demo data:** admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage` (the `voltaire-demo`
  tenant — real guardianships, teaching assignments, alerts to seed threads from).
- **Simple per-portal:** `parent@pilotage.local` / `teacher@pilotage.local` / `admin@pilotage.local`,
  password `Changeme123!`.

To exercise the **dual-wall ABAC** you need a parent who guards a child AND a teacher who teaches
that child's current class — the `voltaire-demo` tenant already has this wiring.

## 3. Happy-path walkthrough

1. Log in as the **parent** → `/parent/messages` → "Nouveau message".
2. The teacher picker is server-filtered to the child's **current** teachers
   (`GET /api/v1/messaging/eligible-teachers?studentId=…`). Pick one, type, send.
3. Log in as that **teacher** → `/teacher/messages` → the new thread appears (separate from
   announcements), with the alert context if it was alert-seeded. Reply.
4. Back as the parent → the reply shows, unread badge clears on open (read-receipt).

**Alert-seeded path (Scenario B):** as the parent, open `/parent/recommendations`, expand an
alert's "Que puis-je faire ?" panel, click **« En parler à l'enseignant »** → a thread opens
pre-seeded with the alert (rule chip + subject + child) in the header.

## 4. Targeted API checks (curl-style; replace `$TOKEN`)

```bash
# Eligible teachers for a child
curl -H "Authorization: Bearer $PARENT_TOKEN" \
  "http://localhost:4000/api/v1/messaging/eligible-teachers?studentId=$CHILD_ID"

# Create/reuse a thread (idempotent on re-POST with same parent/teacher/child)
curl -X POST -H "Authorization: Bearer $PARENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"studentId":"'$CHILD_ID'","teacherId":"'$TEACHER_ID'","body":"Bonjour, …"}' \
  "http://localhost:4000/api/v1/conversations"

# Send a message
curl -X POST -H "Authorization: Bearer $PARENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"Merci pour votre retour."}' \
  "http://localhost:4000/api/v1/conversations/$CONV_ID/messages"
```

**Negative ABAC checks (must fail closed):**
- Parent + a child they do **not** guard → **403**.
- Parent + a teacher who does **not** teach the child → **403**.
- Any id from **another tenant** → **404** (no existence leak).
- A teacher who **stopped** teaching the child sending → **403** (thread `read_only`).

## 5. Tests

```bash
# Targeted backend specs for the messaging module (the only gate agents run via Murat is typecheck)
pnpm --filter @pilotage/api test -- messaging
```

The load-bearing specs: create-ABAC (the two 403s + the 404), idempotent create-or-reuse, send
re-check + read_only lapse, tenant isolation, inbox aggregate (no N+1), alert-seed access guard.

## 6. Gotchas
- `pnpm typecheck` is **red** until `prisma:generate` runs after the schema edit (stale client).
- `WEB_PUBLIC_URL` defaults dev-wrong (`:3000`); app runs on `:3100` — same pre-existing parity
  note as E1; cosmetic for notification links.
- Email channel is **opt-in OFF** by default (RGPD) — enable it in the parent/teacher preferences
  to test the S4 email path.
