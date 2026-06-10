# E9 — UX (Sally lens: premium, kind, WCAG 2.2 AA)

> Two surfaces: the **parent claim form + status** (S1) and the **admin approval queue** (S2). Both
> reuse-first on `@pilotage/ui`; mobile-first (the parent path), kind/non-stigmatising copy, RGPD-clean.

## Principles

- **Kind, factual, never blaming.** A no-match says *"Nous n'avons pas pu retrouver cet élève — vérifie le
  nom, la date de naissance et la référence, puis réessaie, ou contacte l'établissement."* — never *"élève
  introuvable / erreur"*. A rejection shows the admin's reason as guidance, with a **re-submit** button.
- **Never leak the roster — and never an enumeration oracle (the security UX wall).** The form **never**
  auto-completes a student name, **never** confirms a near-match, **never** shows a student the parent
  didn't fully identify. **Match and no-match are byte-identical** in the parent UI: the response shapes are
  the same (contracts: `outcome=submitted` vs `outcome=not_found` share one schema), so the confirmation
  copy, icon, timing and layout are **identical** whether a child matched or not. **The success path does
  NOT echo a matched child's name back** — echoing the resolved name would itself be an enumeration oracle
  (a parent fishing with a guessed name+DOB would learn a child exists). The parent only ever sees back
  **their own typed input**, never roster-resolved data. (This is the AC-2 wall rendered — it overrides any
  earlier draft that echoed the matched name.)
- **No access until approved.** A `pending` claim shows *"en cours de validation"* — the child's dashboard
  tile stays absent (no grades preview) until the claim is `active`.

## Parent — "Rattacher mon enfant" (S1)

**Entry points:**
- `/parent/children` — a primary **"Rattacher mon enfant"** button.
- Parent dashboard **empty state** (no active guardianships) — a kind CTA: *"Ajoute ton enfant pour suivre
  sa scolarité."*

**Form (a `Drawer`/`FormDrawer` over `@pilotage/ui`):**
- `Prénom` (required) · `Nom` (required) · `Date de naissance` (date picker, recommended) · `Référence
  élève (facultatif)` with a hint *"sur les documents de l'établissement"* · `Lien de parenté`
  (select → `GuardianRelationship`).
- A short reassurance line: *"L'établissement validera ta demande avant de te donner accès au dossier."*
- Submit → `POST /parent/child-claims`.

**Result states (one screen, the uniform shape — the no-leak contract):**
- **`outcome=submitted` AND `outcome=not_found` render the IDENTICAL confirmation** — *"Demande envoyée —
  l'établissement va la vérifier."* with a neutral/success (never red/danger) panel. **No** matched name,
  **no** "trouvé / introuvable", **no** difference in copy, icon, timing or layout between the two. The
  parent cannot tell a match from a non-match. A secondary **"Voir mes demandes"** link → the status surface.
  *(Open question for the S1 story, UX-preferred answer: the parent should NOT be invited to immediately
  "Réessayer" after a non-match, because a retry loop on a calm-but-failing form is a soft oracle — instead
  route them to "Mes demandes" + "contacter l'établissement". If a correction affordance is kept, it must be
  present **identically** on the matched path too.)*
- **`200` already-linked** → a gentle *"Vous êtes déjà rattaché·e à cet enfant."* (the API returns this only
  for the caller's own existing `active` link) — never confirming any **other** child.
- **`429`** → *"Vous avez envoyé plusieurs demandes récemment — réessayez dans quelques minutes."* (calm, no
  alarm; the copy never exposes the anti-enumeration intent).

**Status surface (`GET /parent/child-claims`):** a list of the parent's claims with status chips:
- `submitted` → neutral *"En cours de validation"*.
- `approved` → success *"Validé"* + a deep-link to `/parent/children/{studentId}`.
- `rejected` → amber *"À corriger"* + the reason + a **"Renvoyer une demande"** action (re-opens the form,
  pre-filled).
- An optional **"Annuler la demande"** on a still-`pending` claim (→ `POST …/withdraw`).

## Admin — "Demandes de rattachement" (S2)

**Page** (`/admin/child-claims`, server component over `GET /admin/child-claims?status=pending`):
- A table/cards list, **newest first**, each row showing:
  - **Élève demandé** — submitted evidence (name, DOB, ref) **and** the matched student (name, DOB, ref) so
    the admin can eyeball the match; a subtle `matchMethod` chip (*"nom + date"* / *"nom + référence"*).
  - **Parent demandeur** — name + email (the requesting `Guardian`/`UserProfile`).
  - **Reçu le** — relative time.
  - **Actions** — **Approuver** (primary) · **Rejeter** (secondary, opens a reason drawer).
- Empty state: *"Aucune demande de rattachement en attente."* (calm, not an error).

**Approve** → `POST /admin/child-claims/:id/approve` → optimistic row removal + a success toast *"Rattachement
validé — le parent a été notifié."* (the parent gets the in-app notification + access).

**Reject** → a `FormDrawer` requiring a **reason** (kind, ≤ 500 chars) → `POST …/reject` → row removal + a
toast *"Demande rejetée — le parent a été informé et peut renvoyer une demande corrigée."*

## Accessibility (WCAG 2.2 AA)

- The reject-reason field is **required** with an associated `aria-describedby` hint; the drawer has a
  focus-trap + focus-restore-to-trigger (the E3-S3 hardened `Drawer` primitive — already shipped, reuse).
- Status chips carry **text + icon** (not colour alone); ≥ 4.5:1 contrast on the `parent`/`admin` token
  ramps; ≥ 44px targets.
- The no-match panel is **neutral/info**, not a `role=alert` danger (a non-match is not an error the parent
  caused).
- Approve/reject results announce via a `role=status` polite live region.

## States matrix (loading / empty / error — every surface)

| Surface | Loading | Empty | Error / edge | Success |
|---|---|---|---|---|
| Parent claim form | button spinner on submit (server-side match) | (n/a — always a form) | `400` kind inline field errors; `429` calm retry copy; network → "Réessayez" | the **identical** confirmation (match = non-match) |
| Parent "Mes demandes" | skeleton rows | "Vous n'avez pas encore rattaché d'enfant" + the **"Rattacher mon enfant"** CTA | degrade to a kind "indisponible" banner, never a crash | status chips + per-status actions (annuler / voir / renvoyer) |
| Admin queue | skeleton table/cards | "Aucune demande de rattachement en attente." | kind banner; queue stays usable | rows with Approuver / Rejeter |
| Admin reject drawer | submit spinner | (n/a) | reason **required** (inline validation) | toast + optimistic row removal |
| **Backend not migrated** (operator pre-req, like E7/E8) | — | parent form shows a graceful **"Le rattachement en ligne n'est pas encore disponible — contactez l'établissement."**; admin queue empty | **no crash** — both surfaces degrade kindly until the additive `db push` is applied | — |

## Responsiveness & performance (mobile-first, parent <2 s)

- **Parent surfaces are phone-primary** (a parent onboarding on a phone): the claim form and "Mes demandes"
  stack to a single column on narrow, native date input, ≥44px targets, no horizontal scroll. The status
  read is a **small self-scoped query** (the caller's own claims) — it holds the **<2 s** budget with no
  heavy aggregate.
- **Admin queue is desktop-primary but responsive:** `Table` on wide → stacked `Card` rows on narrow; the
  reject `FormDrawer` is full-height on mobile. One aggregate read (parent + matched student + class joined
  server-side), **no client N+1**.
- **No new portal / no new token ramp:** E9 lives inside the existing `parent` and `admin` portals,
  reusing their OKLCH token sets. Status colours map to existing semantic tokens — **reject is `warning`
  (soft amber), never the destructive `error` red** (a rejection is "à corriger", not a failure).

## Copy bank (FR, kind)

| State | Copy |
|---|---|
| Form reassurance | L'établissement validera votre demande avant de vous donner accès au dossier. |
| Submitted **and** not-found (IDENTICAL — no leak) | Demande envoyée — l'établissement va la vérifier et vous serez notifié·e dès qu'elle sera validée. |
| Already linked (caller's own active link only) | Vous êtes déjà rattaché·e à cet enfant. |
| Rate-limited | Trop de tentatives — réessaie dans quelques minutes. |
| Approved (notif) | Votre rattachement à {Prénom} a été validé. |
| Rejected (notif) | Votre demande de rattachement n'a pas pu être validée. Voir le détail et renvoyer une demande. |
| Admin approve toast | Rattachement validé — le parent a été notifié. |
| Admin reject toast | Demande rejetée — le parent a été informé et peut renvoyer une demande corrigée. |
