# Evidence — Lakoli complete route table and route→role RBAC matrix

**Method (confirmed):** the SPA entry bundle `https://lakoli.com/app/assets/main-<hash>.js` (732 780 bytes) was downloaded and the router configuration extracted with `grep`. These are the literal `path:` values and the literal role arrays that guard them, as shipped to the browser. This is *client-side* routing metadata; it proves what the UI exposes per role but does **not** prove server-side enforcement (see caveat at the end).

## 1. Technology fingerprint (confirmed)

| Observation | Value |
|---|---|
| Entry bundle | `assets/main-BrRHA3iq.js` — Vite build naming, single entry + hashed lazy chunks |
| `__NEXT_DATA__` present | No → **not** Next.js |
| Route-level code splitting | Yes — e.g. failure message referenced `assets/dashboard-DWiDn6JR.js` |
| Framework | React SPA under `/app/` (client-side router with `path:` + role guard objects) |
| `<html lang>` | `fr` |
| Analytics | Google Analytics 4, measurement id `G-03PF3VNJCF` |
| `og:url` meta | `https://gssv.fr/` (points at a different domain than the product — likely the publisher's site) |
| API style | REST under `/api/...`, cookie/session based (`/api/auth/me`, `/api/auth/logout`) |

## 2. Role model (confirmed — 8 roles)

Extracted from the route guard arrays:

```
super_admin, direction, comptable, caissier, scolarite, enseignant, auditeur, permanent
```

Plus two portal-side actor strings: `parent_portal`, `payment_entry`.

The widest guard seen (all 8 roles) is used for `/calendrier` and `/aide`.

## 3. Route → role matrix (confirmed, from bundle)

| Route (under `/app`) | Roles allowed |
|---|---|
| `/calendrier`, `/aide` | super_admin, direction, comptable, caissier, scolarite, enseignant, auditeur, permanent |
| `/trombinoscope` | super_admin, direction, comptable, caissier, scolarite, auditeur, permanent |
| `/paiements`, `/paiements/session`, `/cloture-caisse` | super_admin, direction, comptable, caissier, auditeur |
| `/paiement-parent`, `/creances`, `/paiements-en-ligne` | super_admin, direction, comptable, caissier |
| `/caisse`, `/rapports`, `/analytics`, `/budget` | super_admin, direction, comptable, auditeur |
| `/categories-frais`, `/reconciliation` | super_admin, direction, comptable |
| `/documents` | super_admin, direction, scolarite, comptable |
| `/presences`, `/emploi-du-temps`, `/planification-evaluations`, `/cahier-textes`, `/notes`, `/vie-scolaire/discipline`, `/vie-scolaire/activites`, `/suivi-enseignants` | super_admin, direction, scolarite, enseignant |
| `/vie-scolaire/suivi-sensible` | super_admin, direction, scolarite, permanent |
| `/presences/alertes`, `/examens-nationaux`, `/affectations-etat`, `/eleves/:id/cursus`, `/bulletins`, `/exports-cio`, `/conformite`, `/orientation`, `/portail-parent`, `/portail-parent/dossier/:id`, `/portail-parent/preinscriptions` | super_admin, direction, scolarite |
| `/inscriptions/fin-annee`, `/annees-scolaires`, `/remises`, `/affectations-enseignants`, `/rh/pointages`, `/parametres/*`, `/portail-parent/parametres` | super_admin, direction |
| `/espace-enseignant/classes/:id`, `/espace-enseignant/listes` | **enseignant only** |

**Inference (high confidence):** the sidebar is rendered from the same role metadata — the Super Admin account sees every section, so the sidebar map captured in `lakoli_navigation_sidebar-map-01.md` is the maximal navigation.

## 4. Complete route inventory (90 paths, confirmed)

Routes marked ★ are **not reachable from the admin sidebar** and were only discovered in the bundle.

### Public / unauthenticated
`/login` · `/setup` ★ · `/demo` ★ · `/presenter` ★ · `/payer` ★ · `/paiements-en-ligne/portail` ★ · `/paiements-en-ligne/callback` ★ · `/abonnement/callback` ★ · `/conditions-et-tarifs` ★ · `/espaces` ★ (space/tenant switcher)

### Students & admissions
`/eleves` · `/eleves/:id` ★ · `/eleves/:id/cursus` ★ (multi-year school career) · `/eleves/nouveau` ★ · `/eleves/import` ★ (bulk import) · `/inscriptions` · `/inscriptions/nouvelle` · `/inscriptions/masse` ★ (mass enrolment) · `/inscriptions/fin-annee` · `/reinscriptions/suivi` · `/preinscriptions` ★ · `/preinscriptions/nouvelle` ★ · `/affectations-etat` · `/orientation` ★ · `/examens-nationaux`

### Parents / families
`/parents` ★ · `/parents/:id` ★ · `/parents/nouveau` ★ · `/portail-parent` · `/portail-parent/preinscriptions` ★ · `/portail-parent/dossier/:id` ★ · `/portail-parent/parametres` ★

### Pedagogy
`/classes` ★ · `/matieres` ★ · `/programmes` ★ (curricula) · `/periodes` ★ · `/annees-scolaires` ★ · `/affectations-enseignants` · `/emploi-du-temps` · `/cahier-textes` · `/notes` · `/planification-evaluations` · `/bulletins` · `/trombinoscope` · `/suivi-enseignants` · `/presences` · `/presences/alertes` ★ · `/exports-cio`

### School life
`/vie-scolaire/discipline` · `/vie-scolaire/activites` · `/vie-scolaire/suivi-sensible` ★ (sensitive-case tracking, restricted role set)

### Teacher space (separate UI, `enseignant` only)
`/espace-enseignant/listes` ★ · `/espace-enseignant/classes/:id` ★

### Finance
`/paiement-parent` · `/paiements` ★ · `/paiements/session` ★ · `/paiements-en-ligne` · `/caisse` · `/cloture-caisse` ★ · `/creances` · `/categories-frais` ★ · `/remises` ★ · `/budget` ★ · `/reconciliation` ★ · `/anti-fraude` ★ · `/rapports` · `/analytics` · `/cantine` · `/transport` · `/autres-services`

### Communication
`/messagerie` · `/messagerie/campagnes` ★ · `/sms-logs` ★ · `/whatsapp` · `/credit-communication`

### HR
`/rh` · `/rh/:id` ★ · `/rh/pointages`

### Administration & platform
`/documents` · `/conformite` · `/utilisateurs` · `/audit` · `/audit-ia` · `/admin/suppressions` · `/abonnement` · `/parametres` · `/parametres/infos-generales` ★ · `/parametres/paiement` ★ · `/parametres/rh` ★ · `/parametres/export-resiliation` ★ · `/calendrier` · `/aide`

## 5. API endpoints observed in the bundle (confirmed strings)

```
/api/auth/login              /api/auth/logout            /api/auth/me
/api/auth/forgot-password    /api/auth/reset-password
/api/auth/mes-espaces        /api/auth/switch-space
/api/annees-scolaires/active /api/classes                /api/parents
/api/eleves/search           /api/eleves/{id}            /api/eleves/{id}/situation-financiere
/api/utilisateurs            /api/utilisateurs/{id}/toggle-actif
/api/audit/logs              /api/reconciliation/file-attente
/api/reconciliation/{id}/reconcilier
/api/system-banners
```

**Inference (high confidence):** `/api/auth/mes-espaces` + `/api/auth/switch-space` + the `/espaces` route indicate **multi-establishment ("espaces") membership per user with in-session switching** — consistent with the sidebar showing group « EPV » while the active school is « Mafara Ecole ».

**Inference (medium confidence):** most module endpoints live in the lazy chunks, not the entry bundle, so the list above is a lower bound on the API surface, not the whole API.

## 6. Caveat on this evidence

Client-side route guards demonstrate **intended** authorisation. They are not proof of server-side enforcement. No attempt was made to call the API with a modified role or to bypass any guard — that would be outside the authorised scope of this audit. Server-side enforcement is therefore listed as **requires validation**, not as a finding.
