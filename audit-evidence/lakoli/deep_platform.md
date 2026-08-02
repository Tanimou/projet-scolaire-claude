# Lakoli — Deep bundle audit: domain **PLATFORM**

(auth · multi-tenant/multi-espace · abonnement & billing · module gating · setup/onboarding ·
établissement & paramètres · dashboard · utilisateurs & RBAC · journal d'audit · contrôle IA ·
documents · storage · export de résiliation · suppressions · bannières système · aide)

Reverse-engineered from the shipped Vite build. **Every French string quoted below is verbatim from
the minified bundle.** Anything not directly observed is explicitly tagged `INFERRED`.

**Source files analysed**

| File | Size | What it implements |
|---|---|---|
| `lakoli-main.js` | 730 570 B | routing table, RBAC guard, sidebar + module gating, login/forgot-password, `/espaces`, `/setup`, `/demo`, `/presenter`, onboarding checklist, 63 guided tours, system banners, telemetry, generated Orval API client |
| `chunks/dashboard-DWiDn6JR.js` | 92 867 B | `/` — dashboard (3 variants: direction, enseignant, groupe multi-établissements) |
| `chunks/index-D0ZnJiDL.js` | 15 078 B | `/abonnement` — plans, CGU/CGV, rétractation 60 j, factures |
| `chunks/index-tlkR-z6E.js` | 9 291 B | `/utilisateurs` — liste + modal « Nouvel utilisateur » |
| `chunks/index-D08hVBlK.js` | 9 629 B | `/audit` — journal d'audit + diff avant/après |
| `chunks/index-OkuR4RrX.js` | 14 983 B | `/audit-ia` — Contrôle qualité / Coach IA |
| `chunks/index-BGdvfv-z.js` | 52 302 B | `/documents` — 10 générateurs PDF + registre bulletins |
| `chunks/infos-generales-yXdBOVsG.js` | 25 833 B | `/parametres/infos-generales` — identité école, logos, matricule |
| `chunks/index-DW1DbOGP.js` | 5 458 B | `/parametres` — hub de configuration (17 cartes) |
| `chunks/export-resiliation-UWOqb8G-.js` | 7 644 B | `/parametres/export-resiliation` — archive de portabilité SHA-256 |
| `chunks/suppressions-C8af2J3c.js` | 6 080 B | `/admin/suppressions` — workflow demande/validation |
| `chunks/index-DoCGklrB.js` | 4 954 B | `/conditions-et-tarifs` — comparatif des 4 agrégateurs |
| `chunks/index-BT4yo3uy.js` | 112 473 B | `/aide` — centre d'aide, **73 articles** en 16 sections |
| `chunks/index-BwE_tiBb.js` | 28 379 B | `/periodes` — clôture + polling `generation-jobs` |
| `chunks/detail-6Bu9thd6.js` | — | `/eleves/:id` — onglets Fichiers (documents-eleve) et Services (subscriptions) |
| `chunks/upload-Bf80nB6t.js` | 497 B | helper d'upload direct storage |

> **Missing from the corpus**: `callback-CL1YT0yK.js` (route `/abonnement/callback`) is referenced by
> the router but was not downloaded. Its content is unknown.

---

## 0. CORRECTIONS to the earlier shallow audit — all CONFIRMED against the bundle

| Shallow claim | Reality (evidence) |
|---|---|
| "Lakoli has ~15 API endpoints" | **92 distinct operations touch the platform roots alone** (see §1). The whole app has 339+. The shallow pass missed the **generated Orval client embedded in `lakoli-main.js`**, which declares `/api/*` URLs as *functions* (`const qR=()=>"/api/utilisateurs"`) and the method separately (`method:"POST"`), so a naive `.post("/x")` grep finds nothing. |
| "`/app/orientation` and `/app/programmes` render nothing / are blank" | `/orientation` = `index-cRnMt47W.js` with **20 operations** (campagnes DOB, référentiels, vœux, bulk-preview/bulk-apply, quitus, exports). `/programmes` = `index-CFewQxy_.js` with **5 operations**. `/orientation` is additionally **module-gated**: it renders only when `GET /module-access?module=orientation_dob` returns `accessible:true`; otherwise the page shows a real gate screen — not a blank page. |
| "`/app/conformite` is a coming-soon placeholder" | **False.** `/conformite` = `index-Ddm3x_E9.js`, 49 545 B, **18 operations** (imports, rapprochement, anomalies paginées, export .xlsx, exécutions, artefacts signés). What the shallow pass saw is the **module-access gate**, verbatim: `"Module bientôt disponible"` / `"Le module Conformité est en cours de finalisation. Il sera accessible dès son ouverture officielle."` / `"Votre administrateur Lakoli pourra vous informer de la date de disponibilité."` The gate is *tenant-scoped entitlement*, not an unbuilt feature. |
| "Never opened tabs, modals or Nouveau… forms" | Recovered below: « Nouvel utilisateur » modal (§5), setup wizard 4 steps (§4), `/documents` 2 tabs + 10 types (§9), `/audit` diff viewer (§6), `/abonnement` CGU gate + plan cards (§3), export-résiliation confirmation form (§10), demandes de suppression (§11), support modal (§13). |

---

## 1. API surface — 92 platform operations (CONFIRMED)

Extracted by scanning **all 149 chunks + `lakoli-main.js`** for `.get/.post/.put/.patch/.delete/.getBlob(` and
raw `fetch(` calls, filtered to the platform roots. `${…}` marks a path parameter.

### 1.1 Auth & session (19)

| # | Operation | Where |
|---|---|---|
| 1 | `POST /api/auth/login` (op `login`) | lakoli-main.js |
| 2 | `POST /api/auth/logout` (op `logout`) | lakoli-main.js |
| 3 | `GET /api/auth/me` | lakoli-main.js |
| 4 | `POST /api/auth/forgot-password` | lakoli-main.js |
| 5 | `POST /api/auth/reset-password` | lakoli-main.js |
| 6 | `GET /api/auth/mes-espaces` | lakoli-main.js |
| 7 | `GET /auth/mes-espaces` | lakoli-main.js (sidebar widget) |
| 8 | `POST /api/auth/switch-space` | lakoli-main.js |
| 9 | `POST /auth/logout` | lakoli-main.js (setup wizard pre-clears session) |
| 10 | `GET /auth/establishments` | dashboard-DWiDn6JR.js, lakoli-main.js |
| 11 | `POST /auth/switch-establishment` | lakoli-main.js |
| 12 | `POST /auth/demo` | lakoli-main.js (`/demo` route) |
| 13 | `POST /auth/presenter` | lakoli-main.js (`/presenter` route) |
| 14 | `GET /auth/group-summary` | dashboard-DWiDn6JR.js |
| 15 | `GET /auth/group-snapshots?limit=5` | dashboard-DWiDn6JR.js |
| 16 | `POST /auth/group-snapshots` | dashboard-DWiDn6JR.js |
| 17 | `GET /auth/group-snapshots/${id}` | dashboard-DWiDn6JR.js |
| 18 | `POST /auth/group-publications` | dashboard-DWiDn6JR.js |
| 19 | `GET /auth/group-publications/${id}` | dashboard-DWiDn6JR.js |

### 1.2 Billing / abonnement (4)
`GET /billing/status` · `GET /billing/plans` · `GET /billing/factures` · `POST /billing/subscribe`

### 1.3 Module access / entitlements (3)
`GET /module-access/catalog` (lakoli-main.js, drives the whole sidebar) ·
`GET /module-access?module=conformite` · `GET /module-access?module=orientation_dob`

### 1.4 Setup / provisioning / onboarding (5)
`POST /setup/init` · `GET /setup/ready/${tenantSlug}` (polled every 2 500 ms) ·
`GET /onboarding/status` (refetch 60 s) · `POST /onboarding/bienvenue-vu` · `POST /onboarding/portail-teste`

### 1.5 Établissement & paramètres (5)
`GET /etablissement` (**called from 20 different chunks** — the single most-shared endpoint in the app) ·
`PUT /etablissement` · `GET /payment-config` · `PUT /payment-config` · `POST /payment-config/valider` · `DELETE /payment-config`

### 1.6 Dashboard (12)
`GET /dashboard/stats?…` · `/dashboard/todo?…` · `/dashboard/effectifs?…` · `/dashboard/effectifs?cycles=…` ·
`/dashboard/cumul-par-categorie?…` · `/dashboard/recettes-mensuelles?…` · `/dashboard/repartition-modes?…` ·
`/dashboard/repartition-paiements?…` · `/dashboard/finance-avancee?…` · `/dashboard/derniers-versements?limit=20&…` ·
`/dashboard/bilan?…` · `/dashboard/alertes-fraude-recentes` (refetch 30 s)

### 1.7 Audit & contrôle IA (3)
`GET /api/audit/logs?page&limit` · `POST /audit-ia/run` · `GET /eleves/${id}/audit`

### 1.8 Utilisateurs (3)
`GET /api/utilisateurs` · `POST /api/utilisateurs` (op `createUtilisateur`) ·
`POST /api/utilisateurs/${id}/toggle-actif` (op `toggleUtilisateurActif`)

### 1.9 Documents (8)
`POST /documents/finaliser` (6 chunks) · `GET /documents?type=bulletin&eleveId=&limit=100` ·
`GET(blob) /documents/${id}/download` · `GET(blob) /documents/${id}/export.xlsx` ·
`fetch GET /api/documents/${id}/download` (5 chunks) · `POST /api/documents/finaliser-cartes-classe` ·
`GET(blob) /rentree-documents/export?kind&format&anneeScolaireId&niveauInterface[&classeId]`

### 1.10 Documents élève (4)
`GET /documents-eleve?eleveId=` · `POST /documents-eleve` · `PATCH /documents-eleve/${id}/controle` ·
`DELETE /documents-eleve/${id}`

### 1.11 Abonnements aux services (subscriptions) (9)
`POST /subscriptions` · `GET /subscriptions?eleveId=&anneeScolaireId=` ·
`GET /subscriptions/global?serviceType=&anneeScolaireId=` · `GET /subscriptions/access-list?serviceType=&anneeScolaireId=` ·
`PATCH /subscriptions/${id}` · `POST /subscriptions/${id}/cancel` · `POST /subscriptions/${id}/resume` ·
`POST /subscriptions/${id}/suspend-mois` · `POST /subscriptions/sms-relance`

### 1.12 Portabilité / sortie de tenant (3)
`GET /tenant-exit-exports` (refetch 5 s tant qu'un export est `queued`/`processing`) ·
`POST /tenant-exit-exports` (avec en-tête `Idempotency-Key`) · `GET(blob) /tenant-exit-exports/${id}/download`

### 1.13 Suppressions (4)
`GET /demandes-suppression` · `POST /demandes-suppression` · `PATCH /demandes-suppression/${id}/approuver` ·
`PATCH /demandes-suppression/${id}/rejeter`

### 1.14 Jobs asynchrones (1)
`GET /generation-jobs/${jobId}` — polled every 2 000 ms until `statut ∈ {succeeded, failed}`

### 1.15 Plateforme transverse (5)
`fetch GET /api/system-banners` · `POST /api/storage/upload-direct` · `GET /api/storage/objects/${objectPath}` ·
`POST /api/support/request` · `POST /api/growth/track`

---

## 2. Routing, RBAC and module gating (CONFIRMED)

### 2.1 Complete route → chunk → allowedRoles map (86 routes)

Extracted from `_L()` in `lakoli-main.js`. **Public routes** (no guard):
`/login`, `/espaces`, `/setup`, `/demo`, `/presenter`, `/payer`, `/paiements-en-ligne/portail`,
`/paiements-en-ligne/callback`.

Guarded routes worth noting for the platform domain:

| Route | Chunk | allowedRoles |
|---|---|---|
| `/` | dashboard-DWiDn6JR.js | all 8 roles |
| `/utilisateurs` | index-tlkR-z6E.js | *(no explicit list — guard falls back to non-`enseignant`)* |
| `/audit` | index-D08hVBlK.js | *(none listed)* |
| `/audit-ia` | index-OkuR4RrX.js | *(none listed)* |
| `/abonnement` | index-D0ZnJiDL.js | *(none listed)* |
| `/abonnement/callback` | callback-CL1YT0yK.js | *(none listed — chunk missing)* |
| `/parametres` | index-DW1DbOGP.js | *(none listed)* |
| `/parametres/infos-generales` | infos-generales-yXdBOVsG.js | *(none listed)* |
| `/parametres/paiement` | paiement-DWvhp1Tm.js | *(none listed)* |
| `/parametres/rh` | rh-C0NIV5Bw.js | *(none listed)* |
| **`/parametres/export-resiliation`** | export-resiliation-UWOqb8G-.js | `"super_admin","direction"` |
| `/conditions-et-tarifs` | index-DoCGklrB.js | *(none listed)* |
| `/documents` | index-BGdvfv-z.js | `"super_admin","direction","scolarite","comptable"` |
| `/conformite` | index-Ddm3x_E9.js | `"super_admin","direction","scolarite"` |
| `/orientation` | index-cRnMt47W.js | `"super_admin","direction","scolarite"` |
| `/aide` | index-BT4yo3uy.js | all 8 roles |
| `/admin/suppressions` | suppressions-C8af2J3c.js | *(none listed; page self-checks `super_admin`/`direction`)* |
| `/periodes` | index-BwE_tiBb.js | *(none listed)* |

### 2.2 The route guard `de()` — three independent gates, in order (CONFIRMED)

```
1. if (user.role === "enseignant" && !allowedRoles)  → "Accès non autorisé"
2. if (allowedRoles && !allowedRoles.includes(role)) → "Accès non autorisé"
3. if (!gateExempt && email !== "demo@lakoli.com" && billingBlocked(status)) → suspension screen
```

**Billing block predicate** (verbatim logic of `xL`):
`statut==="archived"` **OU** `statut==="suspended"` **OU** (`statut==="trial"` ET `dateFinEssai < now`)
**OU** (`statut==="active"` ET `planExpireLe < now`).

Screens:
- `"Compte archivé"` → `"Cet établissement a été archivé. Contactez le support Lakoli si vous pensez qu'il s'agit d'une erreur."`
- `"Accès suspendu"` → `"Votre période d'essai ou votre abonnement Lakoli est arrivé à échéance. Choisissez une formule pour réactiver l'accès à votre espace."` + bouton `"Voir les formules d'abonnement"`
- RBAC → `"Accès non autorisé"` / `"Vous n'avez pas les droits nécessaires pour accéder à cette page. Contactez votre administrateur."`

> Note: `demo@lakoli.com` **bypasses the billing gate entirely**.

### 2.3 The 8 roles (CONFIRMED)

`super_admin`, `direction`, `comptable`, `caissier`, `scolarite`, `enseignant`, `auditeur`, `permanent`
(+ `parent` exists in the users dropdown but is not an app role).

Role groups used by the sidebar:
```
im = tous les 8
om = super_admin, direction, comptable
ti = super_admin, direction, comptable, caissier
jt = super_admin, direction, scolarite
An = super_admin, direction
b0 = permanent
```

Role descriptions verbatim from the « Nouvel utilisateur » modal (§5) — these ARE the permission spec.

### 2.4 Sidebar: 5 sections × 15 groups × 47 entries (CONFIRMED)

Sections (`cm`): 
| id | label | description |
|---|---|---|
| `piloter` | **Piloter** | `"Synthèse et organisation"` |
| `scolarite` | **Scolarité** | `"Parcours et pédagogie"` |
| `finance-services` | **Finance & services** | `"Encaissements et prestations"` |
| `communiquer` | **Familles** | `"Portail et messages"` |
| `gerer` | **Administration** | `"Équipe, documents et compte"` |

Groups observed: `Aujourd’hui`, `Admissions`, `Dossiers élèves`, `Orientation et examens`, `Paiements`,
`Suivi financier`, `Analyse`, `Organisation pédagogique`, `Vie scolaire`, `Cours et évaluations`,
`Exports administratifs`, `Organisation`, `Familles`, `Campagnes`, `Compte`, `Services aux élèves`,
`Documents officiels`, `Équipe`, `Outils avancés`.

Administration section entries (my domain): `Trombinoscope`, `Documents`, `Conformité` *(gated)*,
`Personnel & RH`, `Pointage du personnel`, `Utilisateurs`, `Abonnement`, `Paramètres`, `Contrôle IA`,
`Journal d'audit`, `Suppressions`, `Mode d'emploi` (placement `footer`).

**Searchable keywords** are attached to entries (Ctrl/⌘+K palette), e.g. `Documents` →
`["documents scolaires"]`, `Conformité` → `["conformité administrative"]`, `Contrôle IA` →
`["contrôle qualité IA"]`, `Suppressions` → `["suppressions d’élèves"]`.
Palette empty state: `"Aucune page autorisée ne correspond à cette recherche."`

### 2.5 Module catalog — 47 module codes (CONFIRMED)

Path → module code map (`t3`), used as the entitlement key:

```
/ → dashboard                       /inscriptions → enrollments
/reinscriptions/suivi → reenrollments  /eleves → student_records
/espace-enseignant/listes → teacher_class_lists
/affectations-etat → state_assignments /orientation → orientation_dob
/inscriptions/fin-annee → year_end_decisions
/paiement-parent → payment_entry     /paiements-en-ligne → online_payments
/caisse → cash                       /creances → receivables
/rapports → financial_reports        /analytics → financial_analytics
/affectations-enseignants → teacher_assignments
/emploi-du-temps → timetable         /suivi-enseignants → teacher_sessions
/presences → student_attendance      /vie-scolaire/discipline → discipline
/vie-scolaire/activites → activities_clubs
/vie-scolaire/suivi-sensible → sensitive_followup
/cahier-textes → teaching_log        /notes → gradebook
/exports-cio → cio_exports           /planification-evaluations → exam_planning
/bulletins → report_cards            /examens-nationaux → national_exams
/calendrier → calendar               /portail-parent → parent_portal
/messagerie → sms_messaging          /whatsapp → whatsapp
/credit-communication → communication_credit
/cantine → cafeteria                 /transport → transport
/autres-services → other_services    /trombinoscope → yearbook
/documents → school_documents        /conformite → compliance
/rh → personnel_hr                   /rh/pointages → staff_attendance
/utilisateurs → users                /abonnement → subscription
/parametres → school_settings        /audit-ia → ai_audit
/audit → audit_log                   /admin/suppressions → deletions
/aide → help
```

Two entries carry an explicit `gatedModule` override:
`Orientation DOB → "orientation_dob"`, `Conformité → "conformite"`.

**Gating algorithm (verbatim logic):**
```
he = new Set(catalog.effectiveModules ?? [])            // modules the tenant HAS
_e = new Set(catalog.catalog.map(c=>c.code)             // modules that exist in the catalog
              .filter(c => !he.has(c)))                 //   but the tenant does NOT have
```
Anything in `_e` renders **disabled, opacity-40, with the badge `"À venir"`** — in the desktop sidebar,
in the ⌘K palette (`aria-disabled`, `cursor-default opacity-55`) and in the mobile bottom nav (the label
itself is replaced by `"À venir"`). Clicking is a no-op.

> **Key business insight**: Lakoli ships a **single binary with per-tenant module entitlements**. The sidebar
> is the same for everyone; unavailable modules are visibly teased as `"À venir"` rather than hidden — an
> intentional upsell surface.

### 2.6 Per-role mobile quick-nav (`x0`, 4 items each) (CONFIRMED)

| Role | Items |
|---|---|
| `super_admin` / `direction` | Accueil `/` · Élèves `/eleves` · Encaisser `/paiement-parent` · Créances `/creances` |
| `scolarite` | Accueil · Inscrire `/inscriptions/nouvelle` · Élèves · Présences |
| `comptable` | Accueil · Encaisser · Créances · Rapports |
| `caissier` | Accueil · Encaisser · Créances · Caisse |
| `enseignant` | Accueil · Appel `/presences` · Notes · Listes `/espace-enseignant/listes` |
| `permanent` | Accueil · Inscrire · Suivi `/vie-scolaire/suivi-sensible` · Calendrier |
| `auditeur` | Accueil · Rapports · Analyse · Audit |

### 2.7 Interface Primaire / Secondaire (CONFIRMED)

```
fu (primaire)   = ["maternelle","primaire"]
Tp (secondaire) = ["college","lycee","superieur"]
L5 = { primaire:  {label:"Primaire",  badge:"Primaire (Maternelle + CM2)",  emoji:"🏫"},
       secondaire:{label:"Secondaire",badge:"Secondaire (Collège + Lycée)", emoji:"🎓"} }
```
- Available interfaces = intersection of `etablissement.cyclesActifs` and `user.niveauAcces`.
- `canSwitch` only if role ∈ {`direction`,`super_admin`} **ou** `niveauAcces === "tous"`, **et** ≥2 interfaces.
- Persisted in `localStorage["edugest_niveau"]`.
- Top-bar badge: `"Cycle primaire"` / `"Cycle secondaire"`.
- Tour copy: *« Ce sélecteur adapte toute l'application à votre structure scolaire : Primaire (Maternelle → CM2) ou Secondaire (6ème → Terminale / BTS). Les classes, cycles et menus affichés changent selon l'interface choisie. Votre choix est mémorisé d'une connexion à l'autre. »*

---

## 3. `/abonnement` — Abonnement Lakoli (CONFIRMED, full page recovered)

Header: `"Administration"` / `"Abonnement Lakoli"` /
`"Gérez la formule de votre établissement et consultez votre historique de facturation."`

### 3.1 Tenant status enum
`tenant.statut ∈ { trial, active, suspended, archived }`

### 3.2 Invoice status enum
`facture.statut ∈ { payee → "Payée", en_attente → "En attente", … }`
(other values fall through and are rendered raw, in red)

### 3.3 Export/job status enums used elsewhere in the domain
- tenant-exit-export: `queued → "En attente"` · `processing → "Génération"` · `ready → "Prêt"` · `failed → "Échec"`
- generation-job: `succeeded` · `failed` · (autre = en cours)
- demande de suppression: `en_attente → "En attente"` · `approuvee → "Approuvée — élève supprimé"` · `rejetee → "Rejetée"`
- document élève (contrôle): `a_controler → "À contrôler"` · `conforme → "Conforme"` · `a_corriger → "À corriger"`
- subscription: `active → "Actif"` · `suspended → "Suspendu"` · `cancelled → "Résilié"`;
  access: `allowed → "Accès autorisé"` · `blocked → "Accès bloqué"`;
  paiement: `paid → "Payé"` · `partial → "Part. payé"` · `unpaid → "Non payé"`

### 3.4 Business rules stated in UI copy (verbatim — all CONFIRMED)

1. `"Accès suspendu"` → `"Votre essai ou votre abonnement est arrivé à échéance. Choisissez une formule ci-dessous pour réactiver l'accès à Lakoli."`
2. `"Période d'essai — {n} jour(s) restant(s)"` / `"Période d'essai terminée"` ; le bandeau passe en **ambre dès `joursRestants ≤ 7`**.
3. `"Choisissez une formule pour continuer à utiliser Lakoli sans interruption après votre essai."`
4. **Pas de prélèvement automatique** : `"Expire dans {n} jour(s) — aucun prélèvement automatique, pensez à repayer avant cette date pour éviter la suspension."` puis `"Échéance dépassée"`.
5. **Rétractation 60 jours** : `"Vous êtes dans le délai de rétractation de 60 jours."` `"Si vous souhaitez un remboursement intégral, envoyez votre demande à remboursement@lakoli.com"`. Hors délai : `"Le délai légal de rétractation de 60 jours est dépassé. Consultez nos CGU/CGV pour les modalités de résiliation."` Cartes `"Premier paiement"` et `"Date limite de rétractation"`.
6. **CGU/CGV bloquantes** : tant que `tenant.cguAccepteLe` est vide, une case à cocher obligatoire précède tout achat — `"J'ai lu et j'accepte les Conditions Générales d'Utilisation et de Vente de Lakoli, y compris la politique de remboursement (droit de rétractation de 60 jours à compter du premier paiement)."` + `"⚠️ Cochez cette case pour pouvoir choisir une formule."` Erreur si non cochée : `"Veuillez cocher la case d'acceptation des CGU/CGV avant de continuer."` Après acceptation : `"CGU/CGV acceptées le {date} (version {cguVersion})"`.
7. **Upsell par effectif** : `"Mise à niveau requise"` — `"Votre établissement compte {eleveCount} élèves inscrits, au-delà du seuil de votre formule actuelle. Passez à la formule {suggestedPlan.nom} pour rester dans les limites de votre plan."` Bandeau global (toutes pages) : `"Votre effectif ({n} élèves) dépasse votre formule actuelle — Passez à {plan} dans les 7 jours."` + lien `"Mettre à niveau"`.
8. **Tarification par tranche d'effectif** : chaque plan a `seuil_eleves_min` / `seuil_eleves_max` / `prix_mensuel`. Libellés : `"{min}–{max} élèves"` ou `"À partir de {min} élèves"`. Prix : `"{montant} F CFA /mois"` ou `"Sur devis"` (quand `prix_mensuel === 0`).
9. **Coût unitaire calculé côté client** : `"À {seuil_max} élèves : environ {prix/seuil} F CFA par élève/mois"` (le mot `"environ "` est **omis pour le plan `code === "premium"`**). Sans plafond : `"Tarif personnalisé selon l’effectif de l’établissement"`.
10. Simulateur au clic sur une carte : `"Pour vos {n} élèves : environ {x} F CFA par élève/mois"` · `"Pour vos {n} élèves : tarif personnalisé sur devis"` · `"Cette formule ne correspond pas à votre effectif actuel."` · `"Ajoutez vos élèves pour obtenir votre coût réel par élève."`
11. Boutons de carte : `"Formule actuelle"` (badge) / `"Formule active"` (désactivé) / `"Demander un devis"` (plan gratuit=devis) / `"Choisir cette formule"`.
12. `POST /billing/subscribe {planCode, cguAccepted:true}` ; si la réponse contient `paymentUrl` → redirection ; sinon message serveur, défaut : `"Demande enregistrée, notre équipe vous contactera."`
13. Remboursement : `"Dans le délai de 60 jours suivant votre premier paiement, vous pouvez demander un remboursement intégral en écrivant à remboursement@lakoli.com avec votre identifiant d'école et la date du paiement concerné."`

### 3.5 Table « Historique de facturation » — colonnes
`Référence` · `Formule` · `Montant` · `Date` · `Statut` · *(colonne action « Payer » si `en_attente` et `lien_paiement`)*
Empty state : `"Aucune facture pour le moment."`
Pied de page : `"Besoin d'aide avec votre abonnement ? Consultez notre guide"` → `/aide`.

---

## 4. `/setup` — Wizard d'auto-provisioning (CONFIRMED)

**4 étapes** (`["ecole","cycles","admin","done"]` + états `preparing`) — steppers : `"Votre école"`, `"Cycles"`, `"Votre compte"`.

Landing copy: `"Votre école mérite le meilleur outil de gestion."` /
`"En 3 minutes, votre espace Lakoli est prêt. Gestion des élèves, des paiements, des bulletins — tout en un."` /
`"Données 100% sécurisées"`.

### Étape 1 — « Votre établissement » / « Informations générales de l'école »
| Champ | Placeholder |
|---|---|
| Nom de l'établissement | `Ex : École Privée Excellence` |
| Sigle | `Ex : EPE` |
| Ville | `Abidjan` |
| Téléphone | `+225 07 XX XX XX XX` |
| Email de l'école | `contact@monecole.ci` |

### Étape 2 — « Cycles d'enseignement » / `"Cochez les cycles proposés par votre établissement"`
| key | label | desc |
|---|---|---|
| `maternelle` | Maternelle | `Petite Section → Grande Section` |
| `primaire` | Primaire | `CP1 → CM2` |
| `college` | Collège | `6ème → 3ème` |
| `lycee` | Lycée | `2nde → Terminale` |
| `superieur` | Supérieur | `BTS, L1/L2/L3, M1/M2...` |

Si rien coché : `"Aucun cycle sélectionné — vous pourrez le configurer plus tard."`

### Étape 3 — « Votre compte administrateur » / `"Identifiants de connexion pour la direction"`
Champs : `Votre fonction dans l'établissement (optionnel)` (select, placeholder `Sélectionnez votre fonction…`),
`Nom` (`KONAN`), `Prénoms` (`Ama`), `Email` (`direction@monecole.ci`), `Mot de passe` (`Min. 8 caractères`),
`Confirmer le mot de passe` (`Répétez le mot de passe`).

**Liste des fonctions** (`j6`, CONFIRMED): `Directeur`, `Fondateur`, `Promoteur`, `Gestionnaire administratif`,
`Comptable`, `Secrétaire`, `Enseignant`, `Responsable informatique`, `Autre`.

**Validation client (verbatim messages)**
- `"Le nom est requis."` · `"Les prénoms sont requis."` · `"L'adresse email est requise."`
- `"Veuillez saisir une adresse email valide (ex : direction@monecole.ci)."` (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)
- `"Le mot de passe est requis."` · **`"Le mot de passe doit contenir au moins 8 caractères."`** · `"Les mots de passe ne correspondent pas."`

**Payload `POST /setup/init`** (CONFIRMED, exact keys):
`nomEcole, sigle, ville, telephone, emailEcole, adminNom, adminPrenoms, adminEmail, adminMotDePasse,
adminFonction, ga_client_id, prospect_ref, cyclesActifs`
(`ga_client_id` est extrait du cookie `_ga`; `prospect_ref` de `localStorage["lk_utm"].prospect_ref`).

**Provisioning asynchrone** : si `data.provisioning` → écran `preparing`, poll `GET /setup/ready/{slug}` toutes les 2,5 s.
Copie : `"Votre établissement est en cours de préparation"` / `"Nous configurons votre espace. Cette opération prend généralement 15 à 20 secondes."`
Sous-étapes affichées : `Compte créé` → `Création de votre espace` → `Configuration des modules` → `Finalisation`.
Time-out : `"La préparation prend plus de temps que prévu. Ne fermez pas cette page : aucune seconde inscription n'est nécessaire."`

**Erreurs** : `"Une erreur est survenue lors de la création de votre espace."` ·
`"La création de votre espace a échoué. Aucune donnée n'a été enregistrée."` ·
code `deja_initialise` → **`"Cette instance Lakoli appartient déjà à une école. Pour obtenir votre propre espace, contactez-nous sur WhatsApp : +225 01 01 54 51 62"`**

**Succès** : `"Votre espace est prêt !"` / `"{nom} est maintenant configuré sur Lakoli."` +
` " Un guide de démarrage vous attendra sur le tableau de bord."` **ou** (si `sessionAvailable === false`)
`" Votre compte est bien créé. Connectez-vous pour poursuivre la configuration."`

**Télémétrie du funnel** (`POST /api/growth/track`) : `signup_started`, `signup_step_1_completed`,
`signup_admin_email_entered`, `signup_step_2_completed`, `signup_completed`, `signup_failed`,
`demo_opened`, `app_module_click`, `app_action_support_sent`. Mappés vers GA4
(`signup_completed→sign_up`, `signup_started→start_trial`, `send_to:"G-03PF3VNJCF"`) et Meta Pixel
(`CompleteRegistration`, content_name `"Lakoli Trial Account"`, dédupliqué par `localStorage["meta_creg_{email}"]`).

---

## 5. `/utilisateurs` — Utilisateurs système (CONFIRMED, modal recovered)

Header : `"Administration"` / `"Utilisateurs système"` / `"{n} compte(s)[ — filtre actif]"`.
Boutons : `"Affectations"` (→ `/affectations-enseignants`) et **`"Nouvel utilisateur"`**.

### 5.1 Filtre par query-string
`?filtre=inactifs` → bandeau `"Filtre actif : Comptes désactivés uniquement"` + `"Voir tous les utilisateurs"`.

### 5.2 Rôles et **descriptions de permissions** (verbatim — la spec RBAC de facto)

| valeur | libellé | description affichée sous le select |
|---|---|---|
| `super_admin` | Super Admin | `"Accès complet à tout le système"` |
| `direction` | Direction | `"Gestion complète, filtrée par niveau si besoin"` |
| `comptable` | Comptable | `"Finance, rapports, caisse — sans RH ni paramètres"` |
| `caissier` | Caissier(ère) | `"Caisse, créances, paiements — sans rapports ni campagnes SMS"` |
| `scolarite` | Scolarité / Secrétaire | `"Inscriptions, élèves, présences, notes — sans budget ni RH"` |
| `enseignant` | Enseignant | `"Présences et notes selon ses affectations classe–matière–année"` |
| `parent` | Parent | `"Portail parent uniquement"` |
| `auditeur` | Auditeur | `"Lecture seule — rapports et journal d'audit"` |
| `permanent` | Responsable de permanence | `"Inscriptions uniquement"` |

### 5.3 Niveau d'accès
`primaire → "Primaire uniquement"` · `secondaire → "Secondaire uniquement"` · `tous → "Les deux niveaux"`

### 5.4 Modal « Nouvel utilisateur » — inventaire complet des champs

| Label | Type | Requis | Placeholder / options |
|---|---|---|---|
| `Nom *` | text | oui | `NOM` |
| `Prénoms *` | text | oui | `Prénom(s)` |
| `Email *` | email | oui | `email@epa.ci` |
| `Mot de passe *` | password | oui | `••••••••` |
| `Rôle *` | select | (défaut `scolarite`) | les 9 rôles ci-dessus |
| `Téléphone` | tel | non | `+225 07 XX XX XX XX` |
| `Accès interface *` | select | (défaut `tous`) | `Primaire uniquement (Maternelle → CM2)` · `Secondaire uniquement (6ème → Tle)` · `Les deux niveaux (Direction / Admin)` |

Aide sous le champ : `"Définit quelle interface (Primaire / Secondaire) cet utilisateur peut voir"`.
Encart conditionnel si rôle = enseignant : **`"Créez d'abord le compte. Vous pourrez ensuite attribuer précisément ses matières, classes, volumes horaires et droits d'appel depuis Pédagogie → Affectations."`**
Boutons : `Annuler` / `Créer` (`"Création..."`).
Toasts : `"Utilisateur créé avec succès"` / `"Erreur lors de la création"` / `"Erreur lors de la modification"`.

### 5.5 Ligne de liste
Avatar initiales · nom+prénoms · email · `"Dernière connexion: dd/MM/yyyy HH:mm"` · badge rôle ·
badge niveau (si ≠ `tous`) · lien `"Gérer les affectations"` (enseignants) · badge `Actif`/`Inactif` ·
bouton toggle (`POST /api/utilisateurs/{id}/toggle-actif`). Comptes inactifs rendus `opacity-60`.

> **Pas de suppression d'utilisateur** dans l'UI — uniquement désactivation. (CONFIRMED par absence
> de tout `DELETE /api/utilisateurs`.)

---

## 6. `/audit` — Journal d'audit (CONFIRMED)

Header : `"Administration"` / `"Journal d'audit"` /
`"Traçabilité complète — {total} action(s) enregistrée(s) (page x/y)"`. Pagination 50/page.
Filtre client : `"Filtrer par action, entité, utilisateur…"` (action, entité, nom/prénoms, entiteId).
Empty state : `"Aucune entrée dans le journal"`.

### 6.1 Catalogue des actions auditées — **35 codes** (CONFIRMED)

| Code | Libellé FR |
|---|---|
| `LOGIN` | Connexion |
| `LOGIN_FAILED` | Échec connexion |
| `LOGOUT` | Déconnexion |
| `CREATE_ELEVE` | Élève créé |
| `UPDATE_ELEVE` | Élève modifié |
| `CREATE_PAIEMENT` | Paiement créé |
| `ANNULER_PAIEMENT` | Paiement annulé |
| `VALIDER_PAIEMENT` | Paiement validé |
| `CREATE_INSCRIPTION` | Inscription créée |
| `VALIDER_INSCRIPTION` | Inscription validée |
| `CREATE_UTILISATEUR` | Utilisateur créé |
| `TOGGLE_UTILISATEUR_ACTIF` | Accès modifié |
| `RECONCILIER_PAIEMENT` | Réconciliation |
| `CREATE_CREANCE` | Créance créée |
| `UPDATE_CREANCE` | Créance modifiée |
| `ANNULATION_MASSE_CREANCES` | Annulation masse |
| `ANNULATION_MASSE_CREANCES_VALIDATED` | Annulation validée |
| `ANNULER_CREANCE` | Créance annulée |
| `CREATE_DEPENSE` | Dépense créée |
| `VALIDER_DEPENSE` | Dépense validée |
| `REJETER_DEPENSE` | Dépense rejetée |
| `REINSCRIPTION` | Réinscription |
| `UPDATE_ETABLISSEMENT` | Établissement modifié |
| `CREATE_PARENT` | Parent créé |
| `UPDATE_PARENT` | Parent modifié |
| `CREATE_PERSONNEL` | Personnel créé |
| `SAISIE_NOTES` | Notes saisies |
| `SAISIE_PRESENCES` | Présences saisies |
| `CREATE_PERIODE` | Période créée |
| `changement_classe` | Changement de classe |
| `UPDATE_CATEGORIE_FRAIS` | Catégorie modifiée |
| `CREATE_CATEGORIE_FRAIS` | Catégorie créée |
| `CREATE_VENTE_ADDITIONNELLE` | Vente additionnelle |
| `PAYER_VENTE_ADDITIONNELLE` | Vente payée |
| `CREATE_CANTINE_ABONNEMENT` | Abonnement cantine |
| `DELETE_CANTINE_ABONNEMENT` | Abonnement supprimé |
| `PAY_CANTINE_ABONNEMENT` | Cantine payée |
| `CLOTURE_CAISSE` | Clôture caisse |
| `CREATE_PREINSCRIPTION` | Préinscription créée |
| `VALIDER_PREINSCRIPTION` | Préinscription validée |

### 6.2 Diff viewer avant/après (CONFIRMED)
Chaque entrée porte `ancienneValeur` / `nouvelleValeur` (JSON). L'UI calcule le diff champ par champ :
`"Modifications ({n} champ(s))"` avec ancienne valeur barrée en rouge → nouvelle valeur en vert ;
ou `"Données enregistrées"` (max 12 champs) pour une création.

**Champs masqués du diff** (`b`, liste noire) : `updatedAt`, `updated_at`, `createdAt`, `created_at`,
**`motDePasseHash`**, **`mot_de_passe_hash`**.

**Traduction des noms de champs** : `statut→Statut`, `montantDu→Montant dû`, `montantPaye→Montant payé`,
`remise→Remise`, `dateEcheance→Échéance`, `motifModification→Motif`, `nom→Nom`, `prenoms→Prénoms`,
`email→Email`, `role→Rôle`, `actif→Actif`, `telephone→Téléphone`, `notes→Notes`, `amount→Montant`,
`reference→Référence`, `raison→Raison`, `count→Nombre`, `anneeScolaireId→Année scolaire`.

Métadonnées par entrée : auteur (`{prenoms} {nom}` ou **`"Système"`**), entité, `#entiteId`,
**`"IP : {ipAddress}"`**, horodatage `dd/MM/yyyy HH:mm:ss`.

---

## 7. `/audit-ia` — Contrôle qualité de l'établissement (CONFIRMED)

Titre : `"Contrôle qualité de l'établissement"` / sous-titre `"Vérifications automatiques, expliquées règle par règle"`.
Un seul appel : `POST /audit-ia/run` (aucun paramètre). Score persisté dans `localStorage["lakoli_audit_last"]`.

### 7.1 Barème du score global (CONFIRMED)
| Score | Libellé | Couleur |
|---|---|---|
| ≥ 95 | `Excellent` | emerald |
| ≥ 85 | `Très bon` | teal (`#10b981`) |
| ≥ 70 | `Bon` | blue (`#3b82f6`) |
| ≥ 55 | `Correct` | amber (`#f59e0b`) |
| < 55 | **`Critique`** | red (`#ef4444`) |

Jauge SVG `/ 100`. Compteurs : `{n} anomalie(s)` · `{n} critique(s)` · `{n} important(s)`.

### 7.2 Priorités d'anomalie (enum, CONFIRMED)
`critique → "Critique"` · `important → "Important"` · *(défaut)* `optimisation → "Optimisation"`
Sections : `"Critique (n)"`, `"Important (n)"`, `"Optimisations (n)"`.

### 7.3 Structure d'une anomalie (CONFIRMED via le rendu)
`{ id, priorite, titre, description, impact, solution, actionHref, actionLabel }`
Le détail dépliable affiche deux blocs libellés **`"Risque"`** (= `impact`) et **`"Solution"`** (= `solution`),
plus un lien d'action. Bouton `"Voir la solution"` / `"Réduire"`.

### 7.4 Catégories scorées (icônes déclarées, donc catégories attendues)
`wallet`, `users`, `message`, `zap`, `shield` — bloc `"Par catégorie"`, chaque catégorie ayant `{label, score, icon}`.

### 7.5 Étapes de l'analyse (animation, révèle l'ordre des contrôles serveur)
```
"Analyse des finances…"
"Vérification des dossiers élèves…"
"Contrôle des contacts parents…"
"Audit de la communication…"
"Vérification de l'automatisation…"
"Calcul du score de santé…"
```

### 7.6 Modes de réponse (CONFIRMED)
- **`donneesInsuffisantes: true`** → `"Données insuffisantes"` / `"Un score de santé fiable nécessite des données réelles sur vos classes, vos élèves et vos frais."` + `"Prochaines étapes recommandées"` (liste numérotée `recommandations`).
- **`modeInstallation.actif: true`** → bandeau `"Assistant d'installation"` avec `prochaineEtape {label, href}` et bouton `"Continuer"`.
- sinon bandeau `"Contrôle qualité Lakoli"` + `coachMessage` + `"Analyse du {date longue}"`.
- 0 anomalie → `"Aucune anomalie détectée"` / `"Votre établissement est parfaitement configuré. Revenez la semaine prochaine pour suivre l'évolution de votre score."`
- Premier lancement → `"Contrôle qualité Lakoli"` / `"Lancez votre premier audit pour obtenir un bilan complet de votre établissement — finances, élèves, communication et sécurité analysés en quelques secondes."` + `"Lancer les contrôles"`.
- Erreur → `"Une erreur est survenue lors de l'audit. Réessayez dans quelques instants."`

### 7.7 Règle métier documentée dans `/aide` (article `coach-ia-overview`, verbatim)
> *« Tant que votre école est en cours de mise en route (essai gratuit), le Coach IA se concentre sur les
> étapes essentielles à terminer pour être pleinement opérationnel… Une fois l'installation terminée, le
> Coach IA bascule en mode suivi habituel (Lakoli AI Coach) et surveille votre activité au quotidien
> (impayés, réinscriptions en retard, anomalies) »* ; *« Un score de 100% ne veut pas dire qu'il n'y a plus
> rien à faire dans Lakoli — cela signifie que votre installation de base est complète et fiable. »*

---

## 8. `/` — Dashboard : **trois dashboards distincts** (CONFIRMED)

`dashboard-DWiDn6JR.js` contient trois vues, choisies selon le rôle :

### 8.1 Dashboard Direction / Finance
12 requêtes parallèles (§1.6), refetch 60 s (30 s pour les alertes fraude).
Bloc **« Priorités à traiter »** (`/dashboard/todo`) — 4 tuiles, masquées si `count === 0` :
| Libellé | Sous-titre | Lien | Champ |
|---|---|---|---|
| `Créances en retard` | `à régulariser` | `/creances` | `creancesEnRetard` |
| `Paiements à valider` | `Mobile Money` | `/paiements-en-ligne` | `paiementsEnLigneAValider` |
| `Préinscriptions en attente` | `à traiter` | `/preinscriptions` | `preinscriptionsEnAttente` |
| `Réinscriptions à suivre` | `parents et dossiers` | `/reinscriptions/suivi` | `parentsAContacter + aRelancer` |

Alertes fraude critiques : action de masse `POST /anti-fraude/bulk-resolve` derrière la confirmation
`"Classer ces {n} alerte(s) critique(s) en faux positif ? Cette action sera journalisée."`

### 8.2 Dashboard Enseignant
`GET /espace-enseignant/accueil` — `"Résumé de mes affectations"`, `"Cours aujourd’hui"`, `"Appels à faire"`,
`"Faire l’appel"` / `"Appel saisi"` / `"Consulter l’appel"`, `"Outils pédagogiques"`, `"Compléter le cahier"`,
priorités `correction demandée` / `séance à rédiger` / `brouillon à finaliser`. Fuseau `Africa/Abidjan`, locale `fr-CI`.

### 8.3 **Dashboard Groupe multi-établissements — la plus grosse découverte du domaine**

Panneau `"Vue groupe · {group.nom}"`, sous-titre :
`"Effectifs agrégés en lecture seule[ · période {periodLabel}], uniquement sur vos établissements autorisés."`

**Consolidations affichées** (chacune avec sa propre couverture et sa propre preuve SHA-256) :

| Bloc | Métriques |
|---|---|
| Effectifs | `{students} élèves` · `{boys} G · {girls} F` · `{classes} classes` |
| **Finances consolidées** | `Attendu net` · `Encaissé` · `Reste à percevoir` · `Recouvrement %` · `"{n} paiement(s) à rapprocher dans le périmètre."` |
| **Assiduité consolidée** | `Présences` · `Absences` · `Retards` · `Absences excusées` · `{records} saisies · {students} élèves concernés · {recordedDays} journées-écoles renseignées[ · {lateMinutes} minutes de retard cumulées]` · `Assiduité normalisée %` · `Complétude des appels %` · `{effective} présences effectives · {entered} saisies / {possible} sessions attendues[ · arrêt au {date}]` |
| **Résultats consolidés** | `Moyenne groupe /20` · `Taux ≥ 10 %` · `Élèves classés` · `Non classés` · `{n} avec moyenne · {n} entre 8,5 et 10 · {n} sous 8,5` — libellé de période : `"{name} · bulletins clôturés et publiés"` |
| **Affectés de l'État** | `{n} confirmée(s) · {n} à vérifier` par école ; `"{n} déclaration(s) retirée(s), conservée(s) dans les historiques."` |
| **Références territoriales déclarées** | listes DRENA et IEPP avec `{schools} école(s) · {students} élèves` ; badge **`"Référentiel interne · non officiel"`** ; `"Aucune DRENA déclarée."` / `"Aucune IEPP déclarée."` ; `"Données à compléter : {n} établissement(s) sans DRENA · {n} sans IEPP."` |

**Statuts par établissement** : `available` · `period_mismatch` → `"Période {X} absente dans cet établissement"` ·
sinon `"Données momentanément indisponibles"`.

**Messages d'exclusion du périmètre (règles de couverture, verbatim)** :
- `"Le total exclut {n} établissement(s) indisponible(s)."`
- `"Le total exclut {n} établissement(s) sans période {X} correspondante."`
- `"…faute de rôle financier ou de données disponibles."`
- `"…faute de rôle autorisé ou de données disponibles."`
- `"…sans historique d'inscription exploitable ou momentanément indisponible."`
- `"…n'a aucune session attendue avant la date d'arrêt ; son taux n'est pas calculé."`
- `"…faute de rôle, publication correspondante ou données disponibles."`
- `"Les affectations de l’État excluent {n} établissement(s) faute de rôle, de période correspondante ou de registre disponible."`

**Preuves cryptographiques** (pied de panneau, monospace) :
`{proof.profile.code}@{proof.profile.version} · SHA-256 {sha256:0..16}…` répété pour `financeProof`,
`attendanceProof`, `attendanceRateProof`, `resultsProof`, `administrativeProof`, `stateAssignmentProof`.

**Actions** :
- `"Preuve JSON"` → téléchargement local du summary.
- **`"Figer cet état"`** → `POST /auth/group-snapshots` → `"État figé · preuve {sha:12}…"` ou `"État inchangé · snapshot existant {sha:12}…"` (idempotent). Erreur : `"Impossible de figer cet état pour le moment."`
- `"Télécharger le snapshot"` → fichier `lakoli-snapshot-groupe-{periodLabel}-{sha:12}.json`.
- **`"Publier au groupe"`** → confirmation bloquante verbatim : **`"Publier cet état agrégé à toutes les Directions du groupe ? Cette publication interne est immuable et ne constitue pas une transmission IEPP/DRENA."`** → `POST /auth/group-publications {snapshotId, confirmation:true}` → `"Publication interne créée · preuve {sha:12}…"` / `"Publication interne déjà existante · {sha:12}…"`.
- `"Publication interne au groupe"` → `lakoli-publication-groupe-{periodLabel}-{sha:12}.json`.

> **Insight** : Lakoli embarque un **niveau organisationnel « groupe scolaire »** au-dessus du tenant, avec
> agrégation lecture-seule à ABAC (chaque bloc peut être exclu « faute de rôle »), gel d'état immuable
> horodaté et publication interne — une brique de gouvernance/conformité que rien dans le sidebar ne trahit.

### 8.4 Bandeau essai sur le dashboard (CONFIRMED)
`"Essai gratuit"` — `"Il vous reste {n} jour(s) · École configurée à {score}%"`.
Seuils de couleur : `≤ 3 j` = rouge (CTA **`"Passer au forfait"`**), `≤ 7 j` = orange, sinon teal (CTA `"Découvrir les tarifs"`).

---

## 9. `/documents` — Documents & PDF (CONFIRMED, onglets + catalogue récupérés)

Header : `"Administration"` / `"Documents & PDF"` / `"Générez les documents officiels aux formats ivoiriens"`.
**2 onglets** : **`Génération`** | **`Registre bulletins`**.

### 9.1 Catalogue — 10 types de documents (CONFIRMED)

| id | Libellé | Description | Contexte requis |
|---|---|---|---|
| `attestation` | Attestation de scolarité | `Atteste la présence régulière d'un élève` | élève |
| `carte_scolaire` | Carte d'identité scolaire | `Carte officielle à découper et plastifier` | élève |
| `situation_financiere` | Situation financière (PDF) | `PDF officiel avec QR code et récapitulatif complet` | élève (download) |
| `fiche_inscription` | Fiche d'inscription | `Dossier d'inscription avec rubriques et parents` | élève (download) |
| `fiche_individuelle` | Fiche individuelle | `Fiche complète multi-années avec historique scolaire` | élève (download) |
| `fiche_eleve` | Fiche scolaire rapide | `Aperçu rapide (impression directe)` | élève |
| `fiche_notation` | Fiche de notation | `Grille de notes de toute la classe par période` | classe + période |
| `liste_classe` | Liste nominative de classe | `Matricules, identité, naissance et effectifs G/F/Total` | classe |
| `liste_appel` | Feuille d'appel | `Grille de présence quotidienne ou hebdomadaire (paysage)` | classe |
| `effectifs` | Effectifs par genre | `Tableau récapitulatif par classe et genre` | — |

Filtres : `Par élève` / `Par classe` / `Global` ; `Toutes les périodes` / `Toutes les classes` ;
recherche `Nom, prénom ou matricule...` ; sélection de masse `Tout sélectionner` / `Tout désélectionner`
(+ compteurs `cartes`, `pages A4`, `sans photo`).

### 9.2 En-tête officiel généré (CONFIRMED, gabarit HTML imprimé)
Si `etablissement.enteteObjectPath` existe → image d'en-tête. Sinon, en-tête tri-colonnes :
armoiries CI · `Ministère de l'Education Nationale` / `et de l'Alphabétisation` / `DRENA: {drena}` /
`IEPP: {iepp}` / nom école / `Contacts: {telephone}` · `République de Côte d'Ivoire` /
`Union - Discipline - Travail` / `Année scolaire: {annee}`.
Corps de l'attestation : *« est régulièrement inscrit(e) dans les registres de l'établissement **{école}**
pour l'année scolaire **{année}** et fréquente régulièrement la classe de **{classe}**. »* +
*« En foi de quoi la présente attestation est établie pour servir et valoir ce que de droit. »* +
`Fait à {ville}, le {date}` / `Le Directeur` / `(Signature et cachet)`.

### 9.3 Onglet « Registre bulletins »
`GET /pedagogie/bulletins-registre?periodeId=&classeId=` — colonnes incluant `Élève`, `Classe`, `Période`,
`Moyenne`, `Mention`, `Statut`. Statuts : `Provisoire` · `Clôturé` · `Publié`.
Empty : `"Aucun bulletin archivé[ pour ces filtres | — clôturez une période depuis Paramètres › Périodes]."`
Note d'export : `"Les deux formats utilisent exactement le même instantané de données Lakoli."` et
`"Ce tableau est généré automatiquement à partir de toutes les inscriptions de l'année en cours."`

### 9.4 Guided tour `/documents` (verbatim)
> *« Chaque document porte automatiquement le logo, la signature et le cachet de votre école. »*
> *« Chaque document reçoit un numéro unique et un QR Code d'authenticité. En scannant ce code, n'importe qui peut vérifier l'authenticité du document sur le site de votre école. »*
> *« L'onglet « Registre » liste tous les documents générés : date, type, élève et statut. Vous pouvez re-télécharger un document à tout moment. »*

### 9.5 Documents élève (onglet « Fichiers » de `/eleves/:id`) — CONFIRMED
Types (`Fr`) : `acte_naissance → "Pièce d'état civil"`, `photo → "Photo d'identité"`, `bulletin → "Bulletin scolaire"`,
`certificat_scolarite → "Certificat de scolarité"`, `carte_identite → "Carte d'identité"`,
`certificat_medical → "Certificat médical"`, `justificatif_domicile → "Justificatif de domicile"`, `autre → "Autre document"`.

Formulaire d'upload : `{type, natureEtatCivil (défaut "extrait_naissance"), numeroPiece, dateDelivrance, lieuDelivrance}`
— les 4 derniers champs ne sont envoyés **que si `type === "acte_naissance"`**.

**Workflow de contrôle documentaire** (`PATCH /documents-eleve/{id}/controle`) :
statuts `a_controler` / `conforme` / `a_corriger`. Passer à `a_corriger` **exige un motif** —
prompt `"Indiquez la correction demandée :"`, refus si vide (`"Motif requis"`).
Toasts : `"Pièce déclarée conforme"` / `"Correction demandée"` / `"Contrôle impossible"`.
Suppression : confirmation `"Supprimer ce fichier ?"`.

---

## 10. `/parametres/export-resiliation` — Export de résiliation (CONFIRMED, page complète)

**Rôles** : `super_admin`, `direction` uniquement.
Header : `"Paramètres"` / `"Export de résiliation"` / `"Préparez une copie portable des données et documents de l’établissement."`

**3 garanties affichées** :
| Titre | Détail |
|---|---|
| `Tenant isolé` | `Aucune donnée d’une autre école` |
| `Archive vérifiable` | `Manifeste et empreintes SHA-256` |
| `Sans effet automatique` | `Ni suppression, ni blocage des accès` |

**Avertissement légal (verbatim)** :
> **`Important :`** *« générer cette archive ne résilie pas l’abonnement et ne modifie aucune donnée. La décision de résiliation reste une procédure séparée. »*

**Formulaire** :
| Champ | Contrainte |
|---|---|
| `Motif de la demande` (textarea) | `maxLength 1000`, placeholder `"Expliquez le contexte de cette demande (10 caractères minimum)."`, **min 10 caractères** |
| `Confirmation` (input) | `"Recopiez exactement : {nom exact de l'établissement}"` — doit **égaler strictement** `etablissement.nom.trim()` |

Bouton `"Générer l’archive"` désactivé si : nom école non chargé **OU** confirmation ≠ nom **OU** motif < 10 car.
**OU** un export est déjà `queued`/`processing` → libellé `"Export déjà en cours"` (**un seul export concurrent**).
Requête : `POST /tenant-exit-exports {reason, confirmation, idempotencyKey}` + en-tête `Idempotency-Key` (UUID).
Toast succès : `"Export demandé"` / `"L’archive est générée en arrière-plan. Vous pouvez rester sur cette page."`

**Restriction de portée (règle métier majeure, verbatim)** :
> *« Les données santé et sociales protégées nécessitent une procédure habilitée distincte. »*

**Historique des exports** : statut, date `fr-FR`, nom de fichier ou motif, puis pour `ready` :
`"{taille} · {tableCount} tables · {rowCount} lignes · {documentCount} documents"` ;
pour `failed` : `"Code : {errorCode|erreur_inconnue}"` ; sinon `"Traitement en arrière-plan"`.
Empreinte affichée : `"SHA-256 {archiveSha256}"`. Téléchargement : `export-resiliation-lakoli.zip` par défaut.
Empty : `"Aucun export demandé."` Erreur : `"Impossible de charger les exports."` / `"Téléchargement impossible"`.

> **Insight** : c'est une **fonctionnalité de portabilité RGPD-like** (droit de récupération) avec archive
> vérifiable, manifeste et hachage — rarissime dans un SaaS scolaire régional.

---

## 11. `/admin/suppressions` — Demandes de suppression (CONFIRMED)

Accessible uniquement à `super_admin` / `direction` (self-check dans le composant).
Statuts : `en_attente → "En attente"` · `approuvee → "Approuvée — élève supprimé"` · `rejetee → "Rejetée"`.
Deux listes : en attente / traitées. Champ commentaire (textarea) par demande.
Approbation : `PATCH /demandes-suppression/{id}/approuver {commentaire}` derrière la confirmation
`"Confirmer la suppression définitive de {nom} {prenoms} ?"` → toast `"Élève supprimé définitivement"` /
`"La demande a été approuvée et exécutée."`
Rejet : `PATCH /demandes-suppression/{id}/rejeter {commentaire}` — **commentaire obligatoire** →
toast `"Demande rejetée"` / `"Le demandeur sera informé."`
Erreurs : `"Impossible d'approuver"` / `"Impossible de rejeter"`.
Tour verbatim : *« Les suppressions sensibles passent par une demande, une justification et une validation séparée. »*

> **Séparation des pouvoirs** : la demande est créée ailleurs (`POST /demandes-suppression` depuis
> `/eleves/:id`), l'exécution est validée ici par un autre rôle. Suppression à deux mains.

---

## 12. `/parametres` et `/parametres/infos-generales` (CONFIRMED)

### 12.1 Hub `/parametres` — 17 cartes d'accès rapide
`"Ces modules ne sont pas dans le menu principal. Accédez-y ici quand nécessaire."`

| Libellé | Description | Cible |
|---|---|---|
| Paiement en ligne | `Paystack / CinetPay de l'école` | `/parametres/paiement` |
| RH & Paie | `Barèmes CNPS/CMU/IRPP, rubriques` | `/parametres/rh` |
| Abonnement Lakoli | `Formule, facturation, historique` | `/abonnement` |
| Classes | `Gérer les classes et niveaux` | `/classes` |
| Catégories de frais | `Frais scolarité, transport…` | `/categories-frais` |
| Remises & Bourses | `Réductions accordées` | `/remises` |
| Périodes d'évaluation | `Trimestres et semestres` | `/periodes` |
| Années scolaires | `Gérer les années actives` | `/annees-scolaires` |
| Parents | `Fichier des parents/tuteurs` | `/parents` |
| Budget prévisionnel | `Objectifs financiers` | `/budget` |
| Paiements (liste) | `Historique des versements` | `/paiements` |
| Matières | `Matières et coefficients par niveau` | `/programmes` |
| Alertes absences | `Seuils et notifications` | `/presences?onglet=alertes` |
| Anti-Fraude | `Détection d'anomalies` | `/anti-fraude` |
| Réconciliation | `Contrôle comptable` | `/reconciliation` |
| Journal SMS | `Historique des messages` | `/sms-logs` |
| **Export de résiliation** | `Archive portable et vérifiable` | `/parametres/export-resiliation` — **visible seulement pour `direction`/`super_admin`** |

Carte principale : `"Informations générales de l'école"` / `"Nom, adresse, logo, signature, en-tête des documents"`.

### 12.2 `/parametres/infos-generales` — payload `PUT /etablissement` (18 champs, CONFIRMED)

```
nom, sigle, adresse, telephone, email, ville, siteWeb, iepp, drena, nomDirecteur,
logoUrl, logoObjectPath, signatureObjectPath, cachetObjectPath, enteteObjectPath,
piedDePage, matriculePrefix (défaut "EG"), matriculeAnneeFormat (défaut "court")
```

| Label affiché | Placeholder |
|---|---|
| `Nom complet de l'établissement *` | `Ex: Groupe Scolaire Excellence` |
| `Sigle / Acronyme` | `Ex: GS-SP` |
| `Adresse complète` | `Ex: Quartier Riviera 3, Cocody, Abidjan` |
| `Ville` | `Ex: Abidjan` |
| `Téléphone principal` | `Ex: 0101545162 / 0707123456` |
| `Adresse e-mail` | `Ex: direction@ecole.ci` |
| *(site web)* | `Ex: www.mon-ecole.ci` |
| `IEPP` | `Ex: Abobo-Gare ou Plateau` |
| `DRENA` | `Ex: ABIDJAN 1 ou AGBOVILLE` |
| *(directeur)* | `Ex: M. KOUADIO Jean-Baptiste` |
| `Préfixe (2–6 caractères)` | `Ex: EG, SP, GS` |
| `Ou URL externe du logo` | `https://votre-ecole.ci/logo.png` |

**Matricule** : `matriculePrefix` (2–6 car.) + `matriculeAnneeFormat` ∈ {`court` (2 chiffres), `Long (4 chiffres)`}
+ séquence sur 5 chiffres (`padStart(5,"0")`). Aperçu live via `GET /eleves/prochain-matricule`.

**4 images téléversables** : `Téléverser le logo`, `Signature du Directeur`,
`Cachet / Tampon de l'établissement`, `Image de l'en-tête du document`.
Copie : `"Ce logo sera affiché sur les attestations, bulletins et fiches élèves."` ·
`"Cliquez sur Supprimer pour en téléverser une nouvelle"` · `"En-tête personnalisée activée."`
Aperçus : `"Aperçu de l'en-tête des documents"`, `"Aperçu bas de document :"`, blocs
`RÉPUBLIQUE DE CÔTE D'IVOIRE`, `Union - Discipline - Travail`, `Ministère de l'Éducation Nationale`, `DOCUMENT OFFICIEL`.
Pied de page : `"Texte affiché en bas de chaque document imprimé (règlement, adresse, mentions légales...)."`

**Cycles verrouillés par l'abonnement (règle métier, verbatim)** :
> **`"Les cycles déterminés par votre abonnement Lakoli. Contactez le support pour les modifier."`**
> (sinon : `"Tous les cycles disponibles (non restreint)"`)

Actions : `"Enregistrer les modifications"`, toasts `"Informations générales enregistrées"` /
`"Erreur lors de l'enregistrement"` / `"Image enregistrée"` ; erreur de chargement :
`"Impossible de charger les informations de votre établissement. Veuillez réessayer."` + `"Réessayer"`.
Après sauvegarde : `"Votre école est entièrement configurée."` ou bloc « Prochaine étape ».

### 12.3 Storage (CONFIRMED)
```
POST /api/storage/upload-direct
  headers: Content-Type: <mime>, X-File-Name: <encodeURIComponent(name)>, X-Resource-Type: <resourceType>
  credentials: include ; body = File (raw)
  → { objectPath }
GET  /api/storage/objects/{objectPath sans le préfixe /objects/}
```
Erreur : `"Upload échoué"`.

---

## 13. Authentification, multi-espace et modes spéciaux (CONFIRMED)

### 13.1 `/login`
Marketing panel : `"Gérez votre école simplement."` /
`"Lakoli est la plateforme africaine de gestion scolaire — conçue pour les établissements ivoiriens."`
Formulaire : `Connexion` / `"Accédez à votre espace d'administration."`
- `Adresse email` (`admin@ecole.ci`) — zod `email("Email invalide")`
- `Mot de passe` (`••••••••`) — zod `min(1,"Mot de passe requis")`, toggle visibilité
- `"Mot de passe oublié ?"` · bouton `"Se connecter"`
Toasts : `"Connexion réussie"` / `"Bienvenue, {prenoms}"` ; `"Échec de la connexion"` / `"Identifiants invalides"`.

### 13.2 Récupération de mot de passe — **OTP 6 chiffres SMS + email** (CONFIRMED)
- Étape `forgot` : `"Mot de passe oublié"` / **`"Saisissez votre email. Un code à 6 chiffres vous sera envoyé par SMS et par email."`** ; champ `Email administrateur` ; bouton `"Envoyer le code"` ; erreur `"Erreur lors de l'envoi"`.
- Étape `verify` : `"Nouveau mot de passe"` / `"Code envoyé par SMS et par email. Saisissez-le ci-dessous."` ; champs `Code à 6 chiffres` (`inputMode numeric`, `maxLength 6`, placeholder `123456`), `Nouveau mot de passe`, `Confirmer le mot de passe` ; bouton `"Réinitialiser le mot de passe"` ; erreur `"Code invalide ou expiré"` ; lien `"Renvoyer le code"`.
- Validation zod : `code.length(6,"Le code doit contenir 6 chiffres").regex(/^\d+$/,"Chiffres uniquement")`.

> **Contradiction interne à signaler** : l'article d'aide `demarrage-connexion` affirme
> *« En cas d'oubli de mot de passe, contactez votre administrateur. Il n'existe pas de réinitialisation
> automatique par e-mail. »* — alors que le self-service OTP existe bel et bien dans le bundle. La doc est en retard.

### 13.3 `/espaces` — sélection d'espace (multi-tenant, CONFIRMED)
Déclenché quand `login` répond `selectionRequise === true` (avec `selectionToken` + `espaces[]`).
Titre : `"Choisir un espace"` / `"Votre compte a accès à plusieurs espaces. Lequel souhaitez-vous ouvrir ?"`
Chaque carte : nom, badge **productType** (`higher_education → "Supérieur"`, sinon `"Scolaire"`),
rôle (`super_admin→Super Admin`, `direction→Direction`, `scolarite→Scolarité`, `enseignant→Enseignant`,
`caissier→Caissier`), marqueur `"• Actuel"`.
`POST /api/auth/switch-space {tenantId[, selectionToken]}` → redirection `data.redirectUrl ?? "/app/"`.
Erreur : `"Impossible d'ouvrir cet espace."` Bouton `"Se déconnecter"`.

> **Deux produits distincts partagent le même code** : `Scolaire` et `Supérieur` (`higher_education`).

### 13.4 Bascule d'établissement dans la sidebar (CONFIRMED)
Widget affiché **seulement si ≥ 2 établissements** (`GET /auth/establishments`) →
`POST /auth/switch-establishment {tenantSlug}` puis `window.location.reload()`.
Erreur : `"Changement d'établissement impossible"`.
Widget `"Changer d'espace"` → `/espaces`, affiché si `espaces.length > 1`.

### 13.5 `/demo` — mode démonstration (CONFIRMED)
`POST /auth/demo` → `"Connexion à l'espace démo…"` / `"Un environnement de démonstration avec des données fictives est en cours de chargement."` ; erreur `"Impossible de démarrer la démo."`
Redirection vers `?to=` + `skipTour=1`.
Bandeau permanent (compte `demo@lakoli.com`, masqué si `?screenshot`) :
**`"MODE DÉMO — Données fictives · École Privée Excellence d'Abidjan · Réinitialisation toutes les 4h"`** + `"Créer mon école"` → `/commencer`.

### 13.6 `/presenter` — mode présentateur (CONFIRMED)
`POST /auth/presenter` → nettoie l'état local : marque toutes les suggestions comme rejetées
(`["__decouvrir_parametres__","collaborateurInvite","premierSms","paiementEnLigne","portailParentTeste"]`),
`lk_done_expanded=0`, et force tous les `lakoli_tour_*` à `"seen"`. Erreur : `"Impossible de démarrer le mode présentateur."`
> C'est un **mode démo « propre » pour commerciaux** : aucun tour ni nudge d'onboarding ne s'affiche.

### 13.7 Autres bandeaux globaux (CONFIRMED)
- Mode test paiement : **`"MODE TEST — Aucun paiement réel n'est encaissé tant que les clés de production ne sont pas activées"`** + `"Activer le mode production"` → `/parametres/paiement` (affiché si `payment-config.configured && actif && mode==="test"`).
- Upsell effectif (§3.4 pt 7).
- **Bannières système** : `fetch GET /api/system-banners` → `{banners:[{id,type,titre,message}]}`.
  Types : `info`, `warning`, `error`, `maintenance`, `sms`, `success`. Rejet mémorisé dans
  `sessionStorage["sb_dismissed_v1"]`. Bouton `"Fermer"`.
  > **Canal de communication produit → tenants, piloté côté serveur.**

### 13.8 Support intégré (CONFIRMED)
Modal `"Contacter le support Lakoli"` / `"Décrivez votre besoin. Le message s'ouvrira dans WhatsApp, déjà pré-rempli avec votre école et votre page actuelle."`
Placeholder : `"Ex : je n'arrive pas à enregistrer un paiement..."` ; bouton `"Envoyer sur WhatsApp"`.
`POST /api/support/request {tenant_slug, user_id, user_nom, user_role, canal:"whatsapp", message, page_url}`
puis ouverture de `wa.me` sur **+225 01 01 54 51 62** avec le message pré-rempli
(`[Lakoli — {école}] / Utilisateur : {nom} ({role}) / Page : {path} / Message : …`).

---

## 14. Onboarding — checklist « Assistant de prise en main » (CONFIRMED, 10 étapes)

`GET /onboarding/status` (refetch 60 s) → `{bienvenueVu, steps[{key,done}], score, essai:{joursRestants}, remaining[]}`.
Modal de bienvenue : `"Démarrer la visite guidée"` / `"Ignorer pour l'instant"` → `POST /onboarding/bienvenue-vu`.
`POST /onboarding/portail-teste` marque l'étape portail.

| idx | id | onboardingKey | Titre | Route | Astuce (verbatim, extrait) |
|---|---|---|---|---|---|
| 0 | `parametres-ecole` | `infosGenerales` | Informations générales de l'école | `/parametres/infos-generales` | `"Un logo bien défini est automatiquement imprimé sur tous vos documents PDF."` |
| 1 | `classes` | `classesCreees` | Créez vos classes | `/classes` | `"6ème A et 6ème B sont deux classes distinctes."` |
| 2 | `categories-frais` | `categoriesFrais` | Renseignez vos frais scolaires | `/categories-frais` | périmètre `Toutes les classes` / `Par cycles` / `Classes précises` |
| 3 | `import-eleves` | `elevesImportes` | Inscrivez vos élèves | `/inscriptions/nouvelle` | **`"Vous pouvez importer jusqu'à 2 000 élèves d'un coup."`** |
| 4 | `periodes-cours` | `periodesEvaluation` | Configurez vos périodes | `/periodes` | `"Lakoli a déjà créé 3 trimestres."` |
| 5 | `collaborateur` | `collaborateurInvite` | Invitez un collaborateur | `/utilisateurs` | `"Le rôle Caissier permet à votre comptable de gérer les paiements sans accès à la configuration générale."` |
| 6 | `encaissement` | `premierEncaissement` | Effectuez votre premier encaissement | `/inscriptions` | **`"Tant qu'aucun paiement n'a été enregistré, vous pouvez corriger librement. Après le premier encaissement, le dossier financier est verrouillé."`** |
| 7 | `premier-sms` | `premierSms` | Envoyez votre premier SMS | `/messagerie` | onglet `Message individuel` vs `Campagnes` |
| 8 | `paiement-en-ligne` | `paiementEnLigne` | Activez les paiements en ligne | `/parametres/paiement` | `"Cette étape est optionnelle"` |
| 9 | `portail-parent` | `portailParentTeste` | Découvrir le Portail Parent | `/portail-parent` | **`"Les parents n'ont pas besoin de créer un compte : un code OTP envoyé sur leur téléphone suffit."`** |

Étapes considérées **optionnelles/suggestions** (`eMc`) : `collaborateurInvite`, `premierSms`,
`paiementEnLigne`, `portailParentTeste`.
Bandeau : `"{n} complétée — encore {n} à compléter"` ; boutons `"Démarrer"` / `"Faire"` ;
note : `"Cliquez sur Démarrer pour être guidé directement sur la page concernée."`
Bouton sidebar prioritaire tant que la config n'est pas finie : **`"Continuer la configuration de l’école"`**.

Règles métier clés (verbatim, étape 2) :
> *« Lakoli a déjà créé les frais les plus courants (inscription, scolarité, cantine, transport). Cliquez sur
> « Renseigner » pour y ajouter les montants et la périodicité. Pour chaque frais, vous pouvez préciser le
> périmètre : « Toutes les classes » (défaut), « Par cycles » (Maternelle, Primaire, Collège…) ou
> « Classes précises ». Utilisez « Nouvelle catégorie » uniquement pour des frais supplémentaires propres à votre école. »*

Étape 6 (verbatim) :
> *« Après la création du dossier, un bouton « Modifier l'inscription avant encaissement » vous permet de
> corriger la classe, les informations de l'élève ou les frais sélectionnés — sans créer un nouvel élève. »*

**Reset des tours par le serveur** : si `etablissement.toursResetAt` > `localStorage["lakoli:tours_cleared_at"]`,
tous les tours locaux sont effacés (permet à Lakoli de re-jouer l'onboarding après une mise à jour produit).

---

## 15. Système de visites guidées — 63 tours (CONFIRMED)

Catalogue `Vc` — un tour par page, chacun avec `id`, `label`, `route`, `steps[{title, description, targetId}]`.
Bouton persistant : `"Revoir le guide"` ; tour copy : *« Sur n'importe quelle page de Lakoli, vous pouvez
relancer le guide en cliquant sur ce bouton « Revoir le guide » dans l'en-tête. Chaque page a son propre
guide adapté à sa fonctionnalité. »* État stocké par clé `localStorage["lakoli_tour_{id}"]`.

Liste complète (id | label | route) :
```
dashboard|Tableau de bord|/            inscriptions|Gérer les inscriptions|/inscriptions
eleves|Gérer les élèves|/eleves        reinscriptions|Suivi des réinscriptions|/reinscriptions/suivi
fin-annee|Clôture de l'année scolaire|/inscriptions/fin-annee
creances|Suivre les créances|/creances paiement-parent|Encaisser un paiement|/paiement-parent
paiements-en-ligne|Paiements Mobile Money|/paiements-en-ligne
caisse|Gérer la caisse|/caisse         rapports|Rapports financiers|/rapports
analytics|Analyse financière|/analytics presences|Gérer les présences|/presences
notes|Saisir les notes|/notes          bulletins|Générer les bulletins|/bulletins
calendrier|Calendrier scolaire|/calendrier  messagerie|Envoyer des SMS|/messagerie
whatsapp|Envoyer via WhatsApp|/whatsapp credit-communication|Crédit SMS|/credit-communication
cantine|Gérer la cantine|/cantine      transport|Gérer le transport|/transport
autres-services|Autres services|/autres-services  trombinoscope|Trombinoscope|/trombinoscope
documents|Documents officiels|/documents  rh|Gérer le personnel|/rh
utilisateurs|Gérer les accès|/utilisateurs  portail-parent|Portail parent|/portail-parent
audit-ia|Audit IA anti-fraude|/audit-ia parametres-portail|Paramètres de l'école|/parametres
classes|Créer vos classes|/classes     parametres-paiement|Paiement en ligne|/parametres/paiement
parametres-rh-baremes|RH & Paie — Barèmes|/parametres/rh  abonnement|Abonnement Lakoli|/abonnement
categories-frais-intro|Catégories de frais|/categories-frais  remises|Remises & Bourses|/remises
periodes|Périodes d'évaluation|/periodes  categories-frais|Catégories de frais|/categories-frais
parametres-infos|Informations générales|/parametres/infos-generales
annees-scolaires|Années scolaires|/annees-scolaires  parents|Fichier parents|/parents
budget|Budget prévisionnel|/budget     paiements-liste|Paiements — liste|/paiements
programmes|Matières & programmes|/programmes  anti-fraude|Anti-Fraude|/anti-fraude
reconciliation|Réconciliation comptable|/reconciliation  sms-logs|Journal SMS|/sms-logs
teacher-class-lists|Mes listes de classe|/espace-enseignant/listes
state-assignments|Affectés de l'État|/affectations-etat  orientation-dob|Orientation DOB|/orientation
teacher-assignments|Affectations enseignants|/affectations-enseignants
timetable|Emploi du temps|/emploi-du-temps  teacher-monitoring|Cours réalisés|/suivi-enseignants
discipline|Discipline|/vie-scolaire/discipline  activities|Activités et clubs|/vie-scolaire/activites
protected-monitoring|Suivi protégé|/vie-scolaire/suivi-sensible  lesson-book|Cahier de textes|/cahier-textes
cio-exports|Exports CIO & StatCIO|/exports-cio  exam-planning|Compositions|/planification-evaluations
national-exams|Examens nationaux|/examens-nationaux  compliance-center|Conformité|/conformite
staff-attendance|Pointage du personnel|/rh/pointages  audit-log|Journal d'audit|/audit
deletion-requests|Suppressions|/admin/suppressions
```

Tours du domaine plateforme (verbatim) :
- **abonnement** — *« Cette page affiche votre formule actuelle, votre date de renouvellement et l'historique de vos factures. Lakoli propose des formules adaptées à la taille de votre école. »* / *« Si votre effectif augmente ou si vous souhaitez accéder à des fonctionnalités supplémentaires, vous pouvez upgrader votre abonnement ici à tout moment. »* / *« Retrouvez et téléchargez toutes vos factures Lakoli. Utile pour la comptabilité de votre établissement. »*
- **parametres-portail** — *« Cette grille donne accès aux modules de configuration qui ne sont pas dans le menu principal : paiements en ligne, RH & paie, classes, catégories de frais, périodes, anti-fraude… »*
- **utilisateurs** — *« Chaque utilisateur a un rôle : Super Admin (tout), Direction (gestion générale), Scolarité (inscriptions/notes), Caissier (paiements uniquement), Comptable (finance), Enseignant (sa classe uniquement). Attribuez le rôle minimal nécessaire. »*
- **audit-log** — *« Le journal rassemble les actions sensibles réalisées dans l'établissement avec leur auteur et leur date. »*
- **audit-ia** — *« Lakoli analyse en continu les paiements et encaissements de votre école pour détecter des anomalies inhabituelles : annulations suspectes, montants hors norme, doublons… »*
- **compliance-center** — *« Rapprochez les données Lakoli d'un fichier officiel et classez les écarts à corriger. »* / *« Chaque campagne conserve son fichier source, ses anomalies et les décisions prises jusqu'à l'export du rapport. »*
- **orientation-dob** — *« Créez une campagne, choisissez le référentiel applicable, puis complétez les vœux des élèves concernés. »* / *« Traitez les anomalies bloquantes, validez les dossiers et produisez les listings ou quitus depuis la campagne. »*
- **deletion-requests** — *« Les suppressions sensibles passent par une demande, une justification et une validation séparée. »*

---

## 16. `/aide` — Mode d'emploi : **73 articles, 16 sections** (CONFIRMED)

Chunk le plus lourd de l'application hors dashboard (112 KB). Recherche plein texte côté client sur
titre + résumé + tous les blocs. Feuille de style dédiée `@media print` (les articles sont imprimables).
Types de blocs : `p`, `h3`, `ul`, `ol`, `step{num,title,desc}`, `table{headers,rows}`, `faq{question,answer}`,
`badge{label,desc}`, `tip`, `warning`, `info`, `success`. Chaque article a `roles[]` et `relatedIds[]`.

Sections : `demarrage`, `eleves`, `parents`, `inscriptions` (✍️), `reinscriptions`, `finance`, `paiements`,
`whatsapp`, `portail-parent`, `administration` (⚙️), `rapports`, `procedures`, `faq` (❓), `depannage`,
`glossaire`, `guides-metiers`, `checklists` (✅), `fonctionnalites-cles` (⭐).

Articles notables pour la plateforme :
`demarrage-presentation`, `demarrage-connexion`, `demarrage-interface`, `demarrage-roles`,
`admin-classes`, `admin-annees`, `admin-utilisateurs`, `admin-audit`,
`guide-secretaire` / `guide-assistant` / `guide-comptable` / `guide-direction` (guides métier),
`checklist-ouverture` / `checklist-fermeture` / `checklist-hebdo` / `checklist-rentree`,
`coach-ia-overview`, `wallet-sms-overview`, `preinscriptions-overview`, `portail-parent-overview`,
`glossaire-termes`, `depannage-connexion` / `-import` / `-impression` / `-paiement`.

### Matrice RBAC officielle (article `demarrage-roles`, table verbatim)
| Rôle | Accès principal |
|---|---|
| Direction / Super Admin | Accès complet à tous les modules |
| Scolarité | Élèves, Inscriptions, Réinscriptions, Présences, Notes |
| Comptable / Finance | Paiements, Créances, Rapports, Élèves (lecture) |
| Caissier | Encaissement manuel, Créances, Réceptions Mobile Money uniquement |
| Enseignant | Présences, Notes, Bulletins, Calendrier |
| Auditeur | Rapports, Journal d'audit (lecture seule) |

### Carte des espaces (article `demarrage-presentation`, table verbatim)
| Espace | Contenu | Rôles |
|---|---|---|
| *(inscription)* | *(…)* | `Scolarité, Direction` |
| Nouveau paiement | Encaissements au guichet et reçus | `Finance, Caissier, Direction` |
| Paiements en ligne | Réceptions Mobile Money | `Finance, Caissier, Direction` |
| Créances | Suivi des impayés | `Finance, Direction` |
| Cours et évaluations | Appels, cahiers, notes, compositions et bulletins | `Scolarité, Enseignant, Direction` |
| Familles | Portail Parent, SMS et WhatsApp | `Scolarité, Direction` |
| Administration | Personnel, documents, conformité et paramètres | `Direction` |

+ `"Votre accès dépend de votre rôle. Certains menus peuvent ne pas apparaître si vous n'avez pas les permissions correspondantes."`

### Ce qui est tracé au journal d'audit (article `admin-audit`, verbatim)
`Création/modification/suppression d'élève` · `Enregistrement d'un paiement` · `Annulation d'une créance` ·
`Modification d'une remise` · `Réinscription d'un élève` · `Connexion des utilisateurs`
+ *« En cas de litige sur un paiement, consultez le journal d'audit pour voir qui a enregistré quoi et quand. »*

### Règles métier ailleurs dans l'aide
- `eleves-creer` : **`"Il n'y a pas de bouton « Nouvel élève » dans la section Élèves. La création d'un élève est intégrée au processus d'inscription : l'élève est créé au moment où on l'inscrit dans une classe."`** et **`"Le nom doit être saisi EN MAJUSCULES. Le système détecte les doublons (même nom + mêmes prénoms) pour éviter les fiches en double."`**
- `eleves-modifier` : `"Les modifications sont tracées dans le journal d'audit."`
- `demarrage-interface` : *« Utilisez Rechercher une page (ou Ctrl/⌘ + K) »* ; *« Tant que la configuration de l'école n'est pas terminée, le bouton Continuer la configuration reste prioritaire en haut du menu et ouvre directement la prochaine étape. »*

---

## 17. `/conditions-et-tarifs` — 4 agrégateurs de paiement (CONFIRMED)

Header : `"Finance"` / `"Conditions et tarifs des paiements en ligne"` /
`"Lakoli propose plusieurs agrégateurs de paiement. Chaque école choisit et configure son propre compte marchand."`

Colonnes : `Agrégateur` · `Frais indicatifs` · `Délai de versement` · `Mode test` · `Documentation`.

| Agrégateur | Statut | Frais indicatifs | Délai | Mode test |
|---|---|---|---|---|
| **Paystack** | `Recommandé` | `≈ 1,5% par transaction (voir grille Paystack à jour)` | `24 à 48h ouvrées sur votre compte bancaire ou mobile money` | `Oui — clés de test disponibles avant activation` |
| **CinetPay** | `Disponible` | `Variable selon opérateur mobile money (voir grille CinetPay)` | `Selon configuration de votre compte marchand CinetPay` | **`Non — CinetPay ne propose pas de mode test, tout paiement est réel`** |
| **PayDunya** | `Disponible` | `Variable selon moyen de paiement (voir grille PayDunya)` | `Selon configuration de votre compte marchand PayDunya` | `Oui — mode test/production déclaré manuellement lors de la configuration` |
| **Hub2** | **`Bêta`** | `Variable selon opérateur (voir grille Hub2)` | `Selon configuration de votre compte marchand Hub2` | `Oui — clés de test disponibles avant activation` |

**Règle métier majeure (verbatim)** :
> *« Les informations ci-dessous sont fournies à titre indicatif. Les frais, délais de versement et conditions
> contractuelles exactes dépendent de votre propre contrat avec l'agrégateur choisi… **Lakoli ne perçoit, ne
> détient et ne reverse jamais les fonds de vos paiements : ils vont directement de votre parent d'élève à
> votre compte marchand.** »*

> **Insight modèle économique** : Lakoli est un pur SaaS par abonnement — **aucune commission sur le GMV**,
> aucun rôle de PSP. C'est explicitement décharge de responsabilité réglementaire.

---

## 18. Jobs asynchrones & polling (CONFIRMED)

| Job | Endpoint | Intervalle | Condition d'arrêt |
|---|---|---|---|
| Provisioning tenant | `GET /setup/ready/{slug}` | 2 500 ms | `ready` ou `failed` |
| Génération bulletins (clôture période) | `GET /generation-jobs/{jobId}` | 2 000 ms | `statut ∈ {succeeded, failed}` |
| Export de résiliation | `GET /tenant-exit-exports` | 5 000 ms | plus aucun `queued`/`processing` |
| Dashboard | 12 requêtes | 60 000 ms | — |
| Alertes fraude | `/dashboard/alertes-fraude-recentes` | 30 000 ms | — |
| Alertes absences | `/presences/alertes?seuil=5&limit=6` | 300 000 ms | — |
| Onboarding | `GET /onboarding/status` | 60 000 ms | — |

`generation-jobs` renvoie `{statut, progress (0-100), derniereErreur}` — messages :
`"{période} : bulletins publiés"` / `"{période} : génération interrompue"` / `"{période} : génération des PDF …"`.

---

## 19. Détails techniques utiles au comparatif

- **Client API généré (Orval/react-query)** embarqué dans `lakoli-main.js` pour un sous-ensemble
  d'endpoints `/api/*` (auth, utilisateurs, audit/logs, classes, eleves, parents, reconciliation,
  annees-scolaires/active). Les noms d'opérations sont conservés en clair dans les `mutationKey` :
  `login`, `logout`, `createUtilisateur`, `toggleUtilisateurActif`, `createParent`, `reconcilierPaiement`.
  **C'est cette couche que le premier audit a manquée**, d'où le « ~15 endpoints ».
- Deux préfixes coexistent : `/api/...` (client généré + fetch bruts) et des chemins **sans** `/api`
  (client axios `ut`/`v`/`c`, avec baseURL implicite). Base app : `/app/`.
- `Idempotency-Key` observé **uniquement** sur `POST /tenant-exit-exports`.
- Locale : `fr-FR` majoritairement, `fr-CI` dans le dashboard groupe ; fuseau `Africa/Abidjan` ;
  devise `F CFA` / `FCFA`, `maximumFractionDigits: 0`.
- Normalisation téléphone CI côté client (`Q5`) : `00225…→225…`, `0XXXXXXXXX (10)→225…`, `8 chiffres→2250…`.
- Offline enseignant : file locale par identité `Cw(tenantSlug,userId)`, purgée au logout
  (logs `[teacher-offline]`).
- Persistance locale observée : `edugest_niveau`, `lk_desktop_sidebar_open_v1`, `lakoli_tour_*`,
  `lakoli_dismissed_suggestions`, `lk_done_expanded`, `lakoli_audit_last`, `lakoli:tours_cleared_at`,
  `lk_sid` / `lk_vid` / `lk_utm` (télémétrie), `meta_creg_*`, `sb_dismissed_v1` (bannières).

---

## 20. Ce qu'un audit UI superficiel rate systématiquement (résumé)

1. **La couche d'entitlements par module** (`/module-access/catalog`) : 47 codes, badge `"À venir"`, écran `"Module bientôt disponible"`. Un module absent ≠ un module non développé.
2. **Le dashboard groupe multi-établissements** : agrégation finance/assiduité/résultats/affectations, snapshots immuables, publications internes, preuves SHA-256 avec profil versionné — invisible depuis un tenant mono-école.
3. **L'export de résiliation** : portabilité vérifiable, une seule instance concurrente, confirmation par recopie du nom exact, exclusion explicite des données santé/sociales.
4. **Le workflow de suppression à deux mains** (demande → justification → validation par un rôle distinct).
5. **Le journal d'audit avec diff avant/après** et liste noire des champs sensibles (`motDePasseHash`).
6. **La conformité du modèle économique** : « Lakoli ne perçoit, ne détient et ne reverse jamais les fonds », rétractation 60 jours, CGU/CGV versionnées et horodatées, pas de prélèvement automatique.
7. **Le self-service signup complet** (`/setup`) avec provisioning asynchrone et funnel télémétrique GA4 + Meta.
8. **Deux produits sur le même binaire** (`Scolaire` / `Supérieur` = `higher_education`) et deux interfaces (`Primaire` / `Secondaire`) sélectionnables.
9. **Un centre d'aide de 73 articles** et **63 visites guidées** — plusieurs centaines de règles métier écrites, réinitialisables à distance par le serveur (`toursResetAt`).
10. **Le mode présentateur** (`/presenter`) : outil commercial dédié, distinct du mode démo.
11. **Les bannières système pilotées côté serveur** (6 types) — canal produit → tenants.
12. **La contradiction doc/produit** sur la réinitialisation de mot de passe (§13.2) — signal que la doc n'est pas régénérée avec le code.
