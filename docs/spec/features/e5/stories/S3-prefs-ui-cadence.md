# E5-S3 — Dedicated parent/teacher notification-preferences UI (cadence + channels + mute)

> **Self-contained story spec** (John / BMAD PM). A developer implements this slice from
> THIS file alone. One shippable vertical slice, ONE PR. `apps/web` only.
> Companion docs: [`../spec.md`](../spec.md) (FR/AC), [`../ux.md`](../ux.md) (UX contract §2.1/§4),
> [`../plan.md`](../plan.md) (architecture), [`../tasks.md`](../tasks.md) (slice backlog),
> [`../data-model.md`](../data-model.md) (the `cadence` field, §1.2 composition truth table).

- **Risk tier:** P2 · **Tags:** `[web][a11y]`
- **Touches:** UI ✅ · Backend ❌ · Worker ❌
- **Portal:** parent **and** teacher
- **No schema · no new endpoint · no new permission · no new BullMQ queue · no fork of the shared panel.**

---

## 1. Why this slice (intent)

S2 shipped the cadence **engine** end-to-end (the additive `NotificationPreference.cadence`
field, the FR-2 dispatcher gate, the daily-digest cron) but left it **invisible** — there is no
control to pick a cadence. S3 ships the **self-service control** that turns the cadence engine
into a felt promise: *"no fatigue, full control."* A parent/teacher opens their own settings,
and **per kind** chooses **Instant · Résumé quotidien · Off**, flips the In-app/Email channels,
or mutes everything at once — persisted through the **already-extended** `PATCH
/notifications/preferences/:kind` (which has accepted + returned `cadence` since S2).

This is `apps/web` only: the entire server-side contract already exists.

## 2. What already exists (DO NOT rebuild — verified in the tree)

| Capability | Where | S3 stance |
|---|---|---|
| `GET /notifications/preferences` returns `cadence` per row | `apps/api/.../notifications/preferences.service.ts` (`PreferenceDto.cadence`) | **consume** — already in the payload |
| `PATCH /notifications/preferences/:kind` accepts `cadence` (validated `@IsIn(NOTIFICATION_CADENCE)`) | `apps/api/.../notifications/preferences.controller.ts` | **consume** — already accepts it |
| `NOTIFICATION_CADENCE = ['instant','daily_digest','off']` + `NotificationCadence` type | `packages/contracts/src/enums/index.ts` (L63-64) | **import** the const for the select options + validation type |
| Shared `PreferencesPanel` (channel switches, bulk per-channel toggle, optimistic, error revert, weekly-digest-distinct row) | `apps/web/src/app/admin/settings/PreferencesPanel.tsx` | **EXTEND in place** (cadence-aware) — do **not** fork |
| Self-scoped server actions (`updatePreferenceAction`, `setChannelForKindsAction`, `UpdatePreferencePatch`, `NotificationKindCode`) | `apps/web/src/app/admin/settings/preferences-actions.ts` | **extend** the patch type + add a cadence bulk action |
| Parent settings page — mounts `PreferencesPanel` in the **Notifications** tab + reassurance banner | `apps/web/src/app/parent/settings/page.tsx` (L143-177) | **unchanged mount** (fetch already returns `cadence`; just widen the `PreferenceRow` fetch type) |
| Teacher settings page — mounts `PreferencesPanel` in the **Notifications** tab | `apps/web/src/app/teacher/settings/page.tsx` (L171-173) | **unchanged mount** |
| Admin settings page — mounts the same panel | `apps/web/src/app/admin/settings/page.tsx` (L133) | **must keep working unchanged** (same component → it inherits cadence too; acceptable) |
| E3-S3 severity **segmented-control radiogroup** (roving tabindex, arrow keys, `role=radio`, icon+text, `min-h-[44px]`, visible focus) | `apps/web/src/app/admin/alerts/RuleConfigEditor.tsx` (L188-235) | **copy the pattern** for `CadenceSelect` |

**Mount decision (resolves the carried-forward S3 open item):** keep the **existing
Notifications tab** on `/parent/settings` + `/teacher/settings` (the lower-churn option the UX
spec prefers — it reuses the tab + the parent reassurance banner). Do **NOT** add new
`/settings/notifications` sub-pages. No routing change.

## 3. Scope — exact file changes

All under `apps/web`. Three edited files + one new component file.

### 3.1 `apps/web/src/app/admin/settings/preferences-actions.ts` (edit)
- Import the cadence type from contracts and add it to the patch:
  ```ts
  import { type NotificationCadence } from '@pilotage/contracts';
  // ...
  export interface UpdatePreferencePatch {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    pushEnabled?: boolean;
    cadence?: NotificationCadence; // E5-S3
  }
  ```
  `updatePreferenceAction(kind, patch)` already forwards the whole patch body to the PATCH, so a
  `{ cadence }` patch round-trips with **zero** action-body change.
- Add a **cadence bulk action** mirroring `setChannelForKindsAction` (same `Promise.allSettled`
  partial-failure contract, same `succeededKinds` reconcile):
  ```ts
  export async function setCadenceForKindsAction(
    kinds: NotificationKindCode[],
    cadence: NotificationCadence,
  ): Promise<BulkChannelResult> { /* identical shape to setChannelForKindsAction, body { cadence } */ }
  ```
  Reuse `BulkChannelResult` (rename is **not** needed — it already carries `succeededKinds`).
- `revalidateSettings()` already revalidates all three settings paths — no change.
- Verify `@pilotage/contracts` is importable from this file (it is — used elsewhere in `apps/web`;
  the package builds to CJS with `types → src`).

### 3.2 `apps/web/src/app/admin/settings/PreferencesPanel.tsx` (edit — the headline)
Extend the existing panel cadence-aware. Concretely:

1. **`PreferenceRow` interface:** add `cadence: NotificationCadence;` (import the type from
   `@pilotage/contracts`). The server already sends it; the parent/teacher/admin pages already
   `safe()`-fetch the full row — only the **TS type** must widen (see §3.4).
2. **Lifted state:** `rows` already holds the full row; `cadence` rides along automatically. Add a
   `flipCadence(kind, next)` handler structurally identical to `flipCell` (optimistic set →
   `updatePreferenceAction(kind, { cadence: next })` → revert-this-control-only on `!res.ok`,
   reusing the existing `busy`/`error` state; busy key e.g. `${kind}:cadence`).
3. **`CadenceSelect`** (new local component in this file, **or** a sibling app-level file
   `CadenceSelect.tsx` in the same folder — implementer's call; do **not** add to `packages/ui`
   without DS Guardian sign-off, which is out of scope here). A 3-option radiogroup copied from the
   E3-S3 severity pattern:
   - Options (label · icon · cadence value):
     - **Instant** · `Zap` · `'instant'`
     - **Résumé quotidien** · `CalendarClock` · `'daily_digest'`
     - **Off** · `BellOff` · `'off'`
   - `role="radiogroup"` with `aria-label={`Fréquence email pour ${row.label}`}`; each option
     `role="radio"` + `aria-checked` + **roving tabindex** (`tabIndex={active ? 0 : -1}`) +
     `ArrowRight/Down → next`, `ArrowLeft/Up → prev` (wrap with modulo, guard the index for
     `noUncheckedIndexedAccess`), `Enter`/`Space` selects (native button click covers Space; add the
     arrow handler exactly like `RuleConfigEditor`).
   - Each option renders **icon + text** (never colour-alone, SC 1.4.1). Selected = portal-accent
     fill (`border-blue-500 bg-blue-50 text-blue-700` — reuse the panel's existing blue, which is the
     portal accent token already used by the switches); unselected = quiet outline.
   - `min-h-[44px]` touch target (SC 2.5.8 / 2.5.5), `focus-visible:ring-2 ring-blue-500/40` visible
     focus (SC 2.4.7).
4. **Disabled-with-hint when Email is off (FR-2 composition):** cadence governs **email frequency**,
   so it is meaningful only when `emailEnabled` is on. When `!row.emailEnabled`:
   - render `CadenceSelect` with `aria-disabled` + the options non-interactive (`disabled` on each
     radio, `pointer-events-none` not enough alone — also `disabled`), and
   - show a programmatic hint *"Activez l'email pour choisir la fréquence"* tied via
     `aria-describedby` (not visual-dim only — SC 1.4.1 / 4.1.2).
5. **Collapse the two "no-email" states into one calm Off affordance (preserve server state):**
   the UI presents a single **Off** state when **either** `cadence === 'off'` **or**
   `emailEnabled === false`. Critically — **do not mutate the other field** to achieve this:
   - When the user picks **Off** in the selector: PATCH `{ cadence: 'off' }` **only** (leave
     `emailEnabled` as-is — a reversible snooze, per data-model §1.2). The selector then shows Off.
   - When `emailEnabled === false`: the selector reads as Off **disabled-with-hint** (the email is
     simply not on yet); flipping Email **on** restores the real `cadence` value the row carries
     (instant by default), so the selector becomes live again. Server `cadence` is **never**
     overwritten by the channel toggle.
   - i.e. the displayed "Off" is `emailEnabled === false || cadence === 'off'`; the underlying
     `cadence` field is only ever changed by an explicit cadence selection.
6. **Header "Tout mettre en sourdine" mute:** add a header control (next to / under the existing
   channel-bulk header band) that sets **every per-event kind** to `cadence: 'off'` via
   `setCadenceForKindsAction(targetKinds, 'off')`, with an inverse **"Tout réactiver"** that sets
   them back to `'instant'`. Reuse the existing bulk optimistic + partial-failure reconcile idiom
   from `bulkChannel`. **Exclude `weekly_digest`** from the mute target list (it is the email-only
   summary, excluded from cadence — exactly as it is excluded from the in-app bulk today). Add a
   small cadence total chip (e.g. *"4/7 instantané"*) alongside the existing channel totals.
   - Mute button label reflects resulting state (accessible name), e.g. when all per-event kinds are
     already off → "Tout réactiver", else "Tout mettre en sourdine". Real `<button>`, keyboard-operable.
7. **Per-row layout (mobile-first):** keep the existing left label/description block. On the right,
   render **`CadenceSelect` first (primary control)**, then the existing channel switches band. On
   narrow screens the row stacks (label → cadence selector wraps under → channels) — no horizontal
   scroll. The cadence selector is **not** rendered on the `weekly_digest` row (it stays the distinct
   violet email-only summary row exactly as today; cadence does not apply to it).
8. **Saved micro-hint (optional, nice-to-have):** when a kind's cadence is `daily_digest` and email
   on, show a calm hint *"Résumé quotidien · prochain envoi ce soir"* (analogous to the existing
   weekly *"Activé · prochain envoi lundi"* badge). Pure copy; no behaviour.
9. **`prefers-reduced-motion`:** any settle/transition on the selector must be skipped under reduced
   motion (use the existing `transition-colors`-only approach — colour transitions are fine; avoid
   transform-based motion, or gate it behind `motion-safe:`).

### 3.3 No page-mount changes beyond the fetch type
- `apps/web/src/app/parent/settings/page.tsx` and `.../teacher/settings/page.tsx` mount the panel
  unchanged. The only edit is the **fetch generic** type already references the exported
  `PreferenceRow` (imported from `PreferencesPanel`), so widening `PreferenceRow` in §3.2 propagates
  automatically — **no further edit** to the pages should be required (verify: they
  `api<{ data: PreferenceRow[] }>(...)`). The reassurance banner on the parent page stays unchanged.

### 3.4 Admin page (no behaviour change required, must not break)
- `apps/web/src/app/admin/settings/page.tsx` mounts the **same** component, so the admin panel also
  gains the cadence selector. This is **acceptable** (AC says "admin panel keeps working unchanged"
  — meaning no regression / no broken behaviour, not "must look pixel-identical"). The admin's own
  prefs are still self-scoped (`profile.*.self`). No admin-specific branching is required. If a
  reviewer insists the admin panel stay cadence-free, that is a follow-up — **not** in this slice's
  scope (do not fork the panel to achieve it).

## 4. Contract (no new types shipped; consumes existing)
- **Imported, not authored:** `NOTIFICATION_CADENCE` (const) + `NotificationCadence` (type) from
  `@pilotage/contracts` (`packages/contracts/src/enums/index.ts`). No change to `packages/contracts`.
- **API contract:** unchanged — `GET /notifications/preferences` already returns `cadence`;
  `PATCH /notifications/preferences/:kind` already accepts `{ cadence }`. No OpenAPI delta.

## 5. Functional requirements (this slice)
- **FR-S3-1** — Both `/parent/settings` and `/teacher/settings` Notifications tabs render, per kind,
  a **cadence selector** (Instant / Résumé quotidien / Off) + the existing channel switches.
- **FR-S3-2** — Selecting a cadence PATCHes `{ cadence }` only; the change persists and survives a
  page reload (the server snapshot drives the next render).
- **FR-S3-3** — The cadence selector is **disabled with a programmatic hint** when `emailEnabled` is
  off (*"Activez l'email pour choisir la fréquence"*); the underlying server `cadence` is never
  mutated by a channel toggle.
- **FR-S3-4** — `emailEnabled === false` **or** `cadence === 'off'` both present as a single calm
  **Off** affordance, while the richer server state (the real `cadence`, the `emailEnabled` boolean)
  is preserved untouched.
- **FR-S3-5** — A header **"Tout mettre en sourdine"** sets every **per-event** kind to `cadence:'off'`
  (excluding `weekly_digest`); an inverse **"Tout réactiver"** restores them to `'instant'`. Optimistic
  with per-kind partial-failure reconcile.
- **FR-S3-6** — The `weekly_digest` row stays the **distinct** email-only summary row (no cadence
  selector, kept its violet accent) and is **excluded** from the cadence mute.
- **FR-S3-7** — Every read/write is the caller's **own** prefs via the existing self-scoped endpoints
  (`profile.read.self` / `profile.write.self`); no cross-user access, no new permission, no identity
  read from input.

## 6. Acceptance criteria (folds spec AC-4 + ux S3 + tasks S3)
- **AC-1** Both parent and teacher Notifications tabs render every kind with a cadence selector +
  channel switches + a header mute; changes **persist and survive reload**.
- **AC-2** Selecting **Off** in the cadence selector PATCHes `{ cadence: 'off' }` and does **not**
  flip `emailEnabled`; flipping Email **off** does **not** overwrite `cadence`; both states still
  display as one calm **Off**.
- **AC-3** Cadence selector is **disabled-with-hint** (programmatic, `aria-describedby`/`aria-disabled`,
  not colour/dim alone) whenever Email is off.
- **AC-4** **"Tout mettre en sourdine"** sets all per-event kinds to `off` (weekly_digest excluded);
  **"Tout réactiver"** restores `instant`; a partial bulk failure reverts only the failed kinds
  (reuse the existing `succeededKinds` reconcile).
- **AC-5 (WCAG 2.2 AA):** cadence selector is a keyboard **radiogroup** — arrow keys move selection,
  Enter/Space selects, **roving tabindex**, **visible focus ring**, **≥44px** touch targets, each
  option **icon + text** (not colour-alone), `aria-checked` reflects state; rows stack on mobile with
  no horizontal scroll; `prefers-reduced-motion` honoured; selected fill + all text meet **4.5:1**.
- **AC-6** The admin `PreferencesPanel` mount and the parent reassurance banner keep working (no
  regression); the panel is **not forked**.
- **AC-7** **No schema change, no new endpoint, no new permission, no `packages/contracts` change,
  no new BullMQ queue.** Only `apps/web` files change.
- **AC-8 (gate):** `pnpm typecheck` clean (Murat, once); `git diff --check` clean.

## 7. Out of scope (non-goals for THIS slice)
- Admin-imposed / org-wide cadence policy (E5 is per-user self-service).
- Push / SMS controls (`pushEnabled` stays the disabled "Bientôt" chip, unchanged).
- Per-user scheduling / quiet-hours / custom send windows.
- Any backend, worker, schema, contracts or endpoint change.
- Reworking the daily-digest email template or the dispatcher (S1/S2, shipped).
- Promoting `CadenceSelect` into `packages/ui` (needs DS Guardian sign-off — a possible follow-up).

## 8. Test / verification guidance (Murat-light; no heavy local runs by agents)
- **Targeted unit test (most valuable):** a `CadenceSelect` keyboard + a11y test (React Testing
  Library) — renders 3 `role="radio"`, arrow keys move `aria-checked`, Enter/Space selects, roving
  tabindex (only the active option is `tabIndex=0`), and the disabled-when-email-off path exposes the
  programmatic hint. (Pure component test — no API, no SMTP, no build.)
- **Manual proof (only if app already running at :3100):** log in as parent
  (`parent@pilotage.local` / `Changeme123!`), open `/parent/settings` → Notifications; set **Notes
  publiées** to *Résumé quotidien*; toggle **Alertes** Email off → cadence shows disabled-with-hint;
  click **Tout mettre en sourdine** → all per-event kinds read Off, weekly digest unchanged; reload →
  state persists. Repeat as teacher (`teacher@pilotage.local`) on `/teacher/settings`. Screenshots at
  1680×944 + 390×844.

## 9. Implementer decisions to record on land (autonomous — no AskUserQuestion)
- Mount = existing Notifications tab (no new sub-page) — chosen for lowest churn + banner reuse.
- `CadenceSelect` lives app-level (in `PreferencesPanel.tsx` or a sibling file), **not** in
  `packages/ui` (DS Guardian sign-off out of scope).
- Admin panel inherits the cadence selector (acceptable; no fork) — record if a reviewer disagrees.
