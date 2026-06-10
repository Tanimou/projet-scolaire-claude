# E9 — Quickstart (manual demo)

> How to exercise the parent child-claim → admin approval loop once S1/S2 ship. Docs-only this run; this is
> the demo script for the implementation runs. App runs locally at `http://localhost:3100` (web) / `:4000`
> (api). Demo logins: admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`; simple parent
> `parent@pilotage.local` / `Changeme123!`.

## Prerequisites (operator, once)

- Apply the additive S1 schema: `pnpm --filter @pilotage/api prisma db push` (creates the
  `guardianship_claim` table + the `GuardianshipClaimStatus` enum + the boot-applied partial-unique
  open-claim index; **no new `NotificationKind`** — approve/reject reuse the existing `enrollment_status`).
  **Additive, non-destructive** — safe on existing data.
- Re-seed permissions so `guardianships.claim` exists and is granted to `parent` (`pnpm --filter
  @pilotage/api prisma db seed`, or the seed step the routine runs).
- Have a **parent account with NO active guardianship** (a fresh onboarded parent) and a **known student**
  in that parent's school whose `firstName`/`lastName` + `birthDate` (or `externalRef`) you know.

## S1 — Parent self-claims a child

1. Log in as the unlinked **parent**, open `/parent/children` (or the dashboard empty-state). The portal
   shows **no children** and a **"Rattacher mon enfant"** CTA.
2. Open the form, enter the known child's **prénom + nom + date de naissance** (and optionally the **pupil
   reference**), pick the **lien de parenté**, submit.
3. **Confident match:** you see the calm *"Demande envoyée — l'établissement va la vérifier"* confirmation.
   **The matched child's name is NOT echoed back** (echoing a roster-resolved name would itself be an
   enumeration oracle — the anti-enumeration wall, `ux.md` Principles / `data-model.md` §3); you only ever
   see your own typed input. The child's dashboard tile is **still absent** (no access yet).
   `GET /parent/child-claims` lists the claim as `submitted`.
4. **No-match path:** repeat with a **mistyped surname**. You get the **byte-identical** confirmation panel
   (same copy, icon, timing and layout as step 3) — **no** link created, **no** hint that a near-match
   exists, **no** way to tell a match from a non-match. `GET /parent/child-claims` lists it as `match_failed`
   (visible only to you, the submitter).
5. **Idempotency:** submit the **same confident claim again** → you get the existing `pending` status, **not**
   a second claim. (If the child were already `active`, you'd see *"déjà rattaché·e"*.)
6. **(Optional) Withdraw:** cancel the still-pending claim from the status surface → it disappears (the link
   goes `revoked`, claim `withdrawn`).

## S2 — Admin approves / rejects

7. Log in as the **admin**, open **"Demandes de rattachement"** (`/admin/child-claims`). The parent's
   pending claim is listed with the **submitted evidence**, the **matched student**, and the **requesting
   parent**.
8. **Approve** it. A toast confirms *"Rattachement validé — le parent a été notifié."*
9. Back as the **parent**: the bell shows *"Votre rattachement à {Prénom} a été validé"*; the child's
   **dashboard now appears** (the parent ABAC reads the now-`active` guardianship). The status chip reads
   *"Validé"*.
10. **Reject path:** submit another claim as the parent, then as admin **reject** it with a reason (*"La date
    de naissance ne correspond pas…"*). The parent sees *"À corriger"* + the reason + a **"Renvoyer une
    demande"** button; correcting and re-submitting reuses the row back to `pending`.

## What to verify (the RGPD / governance wall)

- A **no-match never** reveals a near-match or returns a student the parent didn't fully identify.
- A claim **never grants access** until an admin approves (the child's dossier stays hidden while `pending`).
- A parent **cannot** see another parent's claims; an admin **cannot** see another tenant's claims.
- Every transition leaves an **append-only `AuditLog`** row (`claim_submitted` / `claim_match_failed` /
  `claim_approved` / `claim_rejected` / `claim_withdrawn`) — check `/admin` audit or the DB.
- The match endpoint is **rate-limited** — rapid repeated attempts return `429`.

## API smoke (curl, optional)

```bash
# Parent self-claim (confident match) — replace $PARENT_JWT, names, DOB.
curl -X POST http://localhost:4000/api/v1/parent/child-claims \
  -H "Authorization: Bearer $PARENT_JWT" -H 'Content-Type: application/json' \
  -d '{"firstName":"Awa","lastName":"Diallo","birthDate":"2015-03-12","relationship":"mother"}'

# Parent reads own claim status.
curl http://localhost:4000/api/v1/parent/child-claims -H "Authorization: Bearer $PARENT_JWT"

# Admin queue.
curl http://localhost:4000/api/v1/admin/child-claims?status=submitted -H "Authorization: Bearer $ADMIN_JWT"

# Admin approve.
curl -X POST http://localhost:4000/api/v1/admin/child-claims/$CLAIM_ID/approve -H "Authorization: Bearer $ADMIN_JWT"

# Admin reject (reason required).
curl -X POST http://localhost:4000/api/v1/admin/child-claims/$CLAIM_ID/reject \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"reason":"La date de naissance ne correspond pas — merci de vérifier."}'
```
