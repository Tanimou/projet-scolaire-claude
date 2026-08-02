# Lakoli — Deep bundle audit: Orientation / Conformité / Vie scolaire

**Method.** Static reverse-engineering of the shipped Vite build (149 minified chunks + `lakoli-main.js`),
extracted with targeted `node` slices. Every quoted French string below was **found verbatim in the bundle**
(CONFIRMED). Anything marked INFERRED is a deduction, not a string.

**Source files used**

| File | Role |
|---|---|
| `lakoli-main.js` | router, sidebar registry, RBAC role arrays, module gating, product tours |
| `chunks/index-cRnMt47W.js` (27 668 B) | **Orientation DOB** page (`/orientation`) |
| `chunks/index-Ddm3x_E9.js` (49 545 B) | **Conformité** page (`/conformite`) — 3 sub-features |
| `chunks/discipline-C7kKJw5r.js` (11 176 B) | **Discipline** (`/vie-scolaire/discipline`) |
| `chunks/activites-DfOC8o0u.js` (15 302 B) | **Activités & clubs** (`/vie-scolaire/activites`) |
| `chunks/suivi-sensible-BAUvSgV2.js` (17 150 B) | **Suivi protégé** (`/vie-scolaire/suivi-sensible`) |
| `lakoli-endpoints.txt` | pre-extracted endpoint list (incomplete — see §1.1) |

---

## 0. HEADLINE CORRECTIONS TO THE EARLIER SHALLOW AUDIT

| Shallow claim | Bundle reality |
|---|---|
| "`/app/orientation` renders nothing / is blank" | **FALSE.** `/orientation` is a full 4-stage DOB orientation workflow: versioned school referential (XLSX/CSV import + publish-and-lock), campaign lifecycle with 4 scheduled gates, per-pupil *vœux* (7 ranked choices across 3 branches: 3 Général + 2 Technique tertiaire + 2 Technique industriel), eligibility engine, bulk class apply with preview/confirmation token, snapshot freeze with SHA hash, 3 XLSX exports + per-pupil PDF *quitus*. **18 API operations.** It only *looks* blank when `GET /module-access?module=orientation_dob` returns `accessible:false` → renders the copy `"Module bientôt disponible"`. That is a **tenant entitlement gate, not an unbuilt page**. |
| "`/app/conformite` is a coming-soon placeholder" | **FALSE.** Same gate (`module=conformite`) with the same `"Module bientôt disponible"` fallback. Behind it are **three** distinct sub-products in one page: (a) *Documents officiels* — versioned administrative-form profiles with data snapshot, blocking controls, direction-only freeze, XLSX/PDF artifact generation; (b) *Import et rapprochement externe* — immutable external-register reconciliation with SHA-256 fingerprint, anomaly workflow and audit journal; (c) *Assistant ActuMoyenne* — a 100 %-client-side column pre-qualification assistant with a 27-field canonical schema and level/série-scoped aliases. **16 API operations.** |
| "~15 endpoints in the whole platform" | This domain **alone** has **60** operations under `orientation` / `conformite` / `vie-scolaire`. |
| "Never opened tabs, modals or Nouveau… forms" | Recovered below: 5 modals (`Vœux de …`, `Nouveau dossier protégé`, `Dossier protégé #…`, `Habilitations nominatives`, `Membres/Participants`), 3 export tabs, 4 anomaly filter options, and 3 `window.prompt()` micro-forms in Discipline. |

**Two capabilities that no UI walkthrough could ever have found**
1. A hidden orientation profile `ci-dob-affectation-6e-session-2026` exists server-side and is **explicitly filtered out** of the campaign-creation dropdown (`.filter(t=>t.code!=="ci-dob-affectation-6e-session-2026")`) — a 6e-affectation campaign type that is built but suppressed.
2. `GET /conformite/imports/{id}/source` re-downloads the **original archived import file**, gated to `direction`/`super_admin` only ("Source archivée"). Never surfaced except on that role.

---

## 1. API SURFACE

### 1.1 Extraction note
`lakoli-endpoints.txt` under-reports this domain: it lists **45** operations, but it misses every
`getBlob()` download call and every query-string-only list route. Direct AST-free grep of the 5 chunks
for `x.(get|post|put|patch|getBlob)(` yields **60**. All 15 extras are marked ➕ below.

### 1.2 Orientation — 18 operations (chunk `index-cRnMt47W.js`)

```
GET    /orientation/profile                                  → { profiles: [{code,label}] }
GET    /orientation/referentiels                             → { referentiels: [...] }
POST   /orientation/referentiels                             body {code,version,libelle,sourceReference}
POST   /orientation/referentiels/{id}/publier                body {}
POST   /orientation/referentiels/{id}/etablissements         body {etablissements:[...]}  (batched 500/req)
GET    /orientation/campaigns                                → { campagnes: [...] }
POST   /orientation/campaigns                                body {nom,profileCode,anneeScolaireId,referentielId,ouvertureAt,controleAt,validationAt,exportAt}
GET    /orientation/campaigns/{id}                           → { campagne, dossiers[], etablissements[] }
POST   /orientation/campaigns/{id}/sync-eleves               body {}
POST   /orientation/campaigns/{id}/status                    body {statut,motif}
POST   /orientation/campaigns/{id}/valider                   body {}
POST   /orientation/campaigns/{id}/bulk-preview              body {classeId,voeux[]}
POST   /orientation/campaigns/{id}/bulk-apply                body {classeId,voeux[],confirmationToken}
GET  ➕ /orientation/campaigns/{id}/export/{type}             blob → orientation-{type}-{id}.xlsx
GET  ➕ /orientation/campaigns/{id}/export/quitus?dossierId=  blob → quitus-orientation-{dossierId}.pdf
PUT    /orientation/dossiers/{id}                            body {residence,serieDemandee,observations,officialBepcCandidate,orientationAverage,version,voeux[]}
POST   /orientation/dossiers/{id}/valider                    body {version}
POST   /orientation/dossiers/{id}/reouvrir                   body {version,motif}
```
Also consumed: `GET /annees-scolaires`, `GET /module-access?module=orientation_dob`.

### 1.3 Conformité — 16 operations (chunk `index-Ddm3x_E9.js`)

```
--- (a) Documents officiels / exécutions ---
GET    /conformite/profiles                                  → { profiles:[{version_id,nom,niveau_autorite}] }
GET    /conformite/executions                                → { executions:[...] }
POST   /conformite/executions                                body {versionId,yearId,niveauInterface}
GET    /conformite/executions/{id}                           → { execution, responses[], artifacts[] }
PATCH  /conformite/executions/{id}/responses                 body {responses:[{fieldCode,confirmed?,value}]}
POST   /conformite/executions/{id}/validate                  body {}
POST   /conformite/executions/{id}/generate                  body {format}      // format ∈ data_snapshot.outputFormats, default ["xlsx"]
GET  ➕ /conformite/executions/{id}/artifacts/{artifactId}/download   blob

--- (b) Import & rapprochement externe ---
GET    /conformite/imports/profile                           → { profile:{code,maxBytes,...} }
GET  ➕ /conformite/imports?niveauInterface=                  → { imports:[...] }
POST   /conformite/imports                                   body {profileCode,anneeScolaireId,niveauInterface,fileName,mimeType,contentBase64}
GET  ➕ /conformite/imports/{id}?niveauInterface=             → { import:{...anomalyStatuses} }
GET  ➕ /conformite/imports/{id}/anomalies?niveauInterface=&limit=25&offset=&statut=
PATCH  /conformite/imports/{id}/anomalies/{anomalyId}        body {statut,note,niveauInterface}
GET  ➕ /conformite/imports/{id}/anomalies.xlsx?niveauInterface=   blob → rapprochement-{id8}.xlsx
GET  ➕ /conformite/imports/{id}/source?niveauInterface=      blob → source-{id8}   (direction/super_admin only)
```
Also consumed: `GET /annees-scolaires`, `GET /module-access?module=conformite`.
Sub-feature (c) **Assistant ActuMoyenne makes zero network calls** — see §5.3.

### 1.4 Vie scolaire — 26 operations

**Discipline (8)** — `discipline-C7kKJw5r.js`
```
GET  ➕ /vie-scolaire/options?anneeScolaireId=&niveauInterface=      → { classes[], eleves[{id,classeId,parents[]}] }
GET  ➕ /vie-scolaire/incidents?anneeScolaireId=&niveauInterface=
POST   /vie-scolaire/incidents                    body {classeId,eleveId,dateIncident,heureIncident,typeIncident,gravite,lieu,faits}
PATCH  /vie-scolaire/incidents/{id}/statut        body {statut}
POST   /vie-scolaire/incidents/{id}/mesures       body {typeMesure,description}
PATCH  /vie-scolaire/mesures/{id}/statut          body {statut}
POST   /vie-scolaire/incidents/{id}/convocations  body {rendezVousAt,objet,parentId?}
PATCH  /vie-scolaire/convocations/{id}/statut     body {statut}
```

**Activités & clubs (9)** — `activites-DfOC8o0u.js`
```
GET  ➕ /vie-scolaire/activites/options?anneeScolaireId=&niveauInterface=   → { eleves[], personnel[] }
GET  ➕ /vie-scolaire/activites/clubs?anneeScolaireId=&niveauInterface=
GET  ➕ /vie-scolaire/activites?anneeScolaireId=&niveauInterface=
POST   /vie-scolaire/activites/clubs              body {nom,typeClub,cycleScope,responsablePersonnelId,description}
POST   /vie-scolaire/activites                    body {titre,domaine,cycleScope,clubId,dateDebut,dateFin,lieu,objectifs,acteurs,publicCible}
PUT    /vie-scolaire/activites/clubs/{id}/membres      body {eleveIds[]}
PUT    /vie-scolaire/activites/{id}/participants       body {eleveIds[]}
PATCH  /vie-scolaire/activites/{id}/statut        body {statut}
PATCH  /vie-scolaire/activites/{id}/publication   body {publier:boolean}
```

**Suivi protégé (9)** — `suivi-sensible-BAUvSgV2.js`
```
GET    /vie-scolaire/suivi-sensible/permissions/me   → { actif, lectureScopes[], ecritureScopes[], exportScopes[] }
GET  ➕ /vie-scolaire/suivi-sensible/options?anneeScolaireId=&niveauInterface=
GET  ➕ /vie-scolaire/suivi-sensible?anneeScolaireId=
GET    /vie-scolaire/suivi-sensible/{id}             (decrypt-on-read)
GET  ➕ /vie-scolaire/suivi-sensible/summary?anneeScolaireId=   → { threshold, cells:[{typeDossier,classeNom,sexe,statut,count,suppressed}] }
GET    /vie-scolaire/suivi-sensible/permissions      (direction/super_admin, lazy — only when modal open)
POST   /vie-scolaire/suivi-sensible                  body {anneeScolaireId,eleveId,classeId,typeDossier,dateSignalement,baseLegale,consentementStatut,consentementAt,conservationJusquau,details:{probleme,observations,mesureSuivi,besoinSpecifique}}
PATCH  /vie-scolaire/suivi-sensible/{id}/statut      body {statut,motif}
PUT    /vie-scolaire/suivi-sensible/permissions/{utilisateurId}  body {lectureScopes[],ecritureScopes[],exportScopes[],motif,valableJusquau,actif}
```

---

## 2. ROUTING, RBAC AND MODULE GATING (from `lakoli-main.js`)

Role constants (CONFIRMED verbatim):
```js
jt = ["super_admin","direction","scolarite"]
An = ["super_admin","direction"]
b0 = ["permanent"]
```

Route guards:
```js
<Route path="/conformite">                    allowedRoles:["super_admin","direction","scolarite"]
<Route path="/orientation">                   allowedRoles:["super_admin","direction","scolarite"]
<Route path="/vie-scolaire/discipline">       allowedRoles:["super_admin","direction","scolarite","enseignant"]
<Route path="/vie-scolaire/activites">        allowedRoles:["super_admin","direction","scolarite","enseignant"]
<Route path="/vie-scolaire/suivi-sensible">   allowedRoles:["super_admin","direction","scolarite","permanent"]
```

Sidebar registry entries (CONFIRMED):
```js
{name:"Orientation DOB",   path:"/orientation",                 section:"scolarite", group:"Orientation et examens", roles:jt, gatedModule:"orientation_dob"}
{name:"Conformité",        path:"/conformite",                  section:"gerer",     group:"Documents officiels",    roles:jt, gatedModule:"conformite", keywords:["conformité administrative"]}
{name:"Discipline",        path:"/vie-scolaire/discipline",     section:"scolarite", group:"Vie scolaire", roles:[...jt,"enseignant"]}
{name:"Activités et clubs",path:"/vie-scolaire/activites",      section:"scolarite", group:"Vie scolaire", roles:[...jt,"enseignant"]}
{name:"Suivi protégé",     path:"/vie-scolaire/suivi-sensible", section:"scolarite", group:"Vie scolaire", roles:[...jt,...b0]}
```

Module-code map (`t3`, path → module code):
```
"/orientation":"orientation_dob"   "/conformite":"compliance"
"/vie-scolaire/discipline":"discipline"
"/vie-scolaire/activites":"activities_clubs"
"/vie-scolaire/suivi-sensible":"sensitive_followup"
```
> **Discrepancy worth flagging:** the sidebar entry declares `gatedModule:"conformite"` and the page queries
> `/module-access?module=conformite`, but the fallback path map `t3` says `"/conformite":"compliance"`.
> `lm(e){return e.gatedModule ?? t3[e.path]}` — the explicit `gatedModule` wins, so `"compliance"` is dead
> for this route. Only `discipline`, `activities_clubs`, `sensitive_followup` resolve via `t3` (they carry no
> `gatedModule`, so those three are **ungated** in practice — see §2.1).

**Entitlement plumbing** (CONFIRMED): the app shell calls `GET /module-access/catalog` →
`{catalog:[{code,…}], effectiveModules:[…]}`. Any catalog code not in `effectiveModules` is rendered
locked; the command-palette badge for a locked module is the literal string **`"À venir"`** and the item is
`aria-disabled` / `opacity-55`.

### 2.1 Gating summary
| Page | Gate query | Locked copy |
|---|---|---|
| `/orientation` | `GET /module-access?module=orientation_dob` (`retry:!1`, `staleTime:3e5`) | `"Module bientôt disponible"` + `"Le module Orientation DOB est en cours de finalisation. Il sera accessible dès son ouverture officielle."` |
| `/conformite` | `GET /module-access?module=conformite` | `"Module bientôt disponible"` + `"Le module Conformité est en cours de finalisation. Il sera accessible dès son ouverture officielle."` |
| both | — | `"Votre administrateur Lakoli pourra vous informer de la date de disponibilité."` |
| discipline / activités / suivi protégé | none | ungated; suivi protégé instead uses a **nominative grant** (§6) |

### 2.2 Product tours (`lakoli-main.js`) — CONFIRMED verbatim
```
id:"orientation-dob"        label:"Orientation DOB"      route:"/orientation"        target:"ptour-orientation-main"
   step1 "Préparer une campagne DOB" — "Créez une campagne, choisissez le référentiel applicable, puis complétez les vœux des élèves concernés."
   step2 "Contrôler avant l'export" — "Traitez les anomalies bloquantes, validez les dossiers et produisez les listings ou quitus depuis la campagne."
id:"compliance-center"      label:"Conformité"           route:"/conformite"         target:"ptour-compliance-main"
   step1 "Centre de conformité administrative" — "Rapprochez les données Lakoli d'un fichier officiel et classez les écarts à corriger."
   step2 "Importer, rapprocher, résoudre" — "Chaque campagne conserve son fichier source, ses anomalies et les décisions prises jusqu'à l'export du rapport."
id:"discipline"             label:"Discipline"           route:"/vie-scolaire/discipline"        target:"ptour-discipline-main"
   step1 "Incidents et convocations" — "Enregistrez les incidents, les mesures prises et les convocations sans les mélanger aux absences ordinaires."
   step2 "Suivre chaque situation" — "Filtrez les dossiers et ouvrez une situation pour consulter son historique."
id:"activities"             label:"Activités et clubs"   route:"/vie-scolaire/activites"         target:"ptour-activities-main"
   step1 "Organiser la vie extrascolaire" — "Planifiez les activités, gérez les participants et conservez le bilan de chaque action."
   step2 "Du planning au bilan" — "Utilisez les onglets pour passer de la préparation à la participation, puis au rapport final."
id:"protected-monitoring"   label:"Suivi protégé"        route:"/vie-scolaire/suivi-sensible"    target:"ptour-protected-monitoring-main"
   step1 "Un registre à accès limité" — "Les dossiers de santé et de protection sont accessibles uniquement aux personnes nominativement habilitées."
   step2 "Traçabilité obligatoire" — "Chaque consultation et modification est tracée. Les exports disponibles restent agrégés ou anonymisés."
```

### 2.3 `niveauInterface` scoping (cross-cutting)
Every discipline / activités / suivi-sensible / conformite-import call carries
`niveauInterface=${encodeURIComponent(niveau)}`. From `lakoli-main.js`:
```js
fu = ["maternelle","primaire"]; Tp = ["college","lycee","superieur"];
z5 = { primaire: fu, secondaire: Tp };
L5 = { primaire:{label:"Primaire", badge:"Primaire (Maternelle + CM2)", color:"teal", emoji:"🏫"},
       secondaire:{label:"Secondaire", badge:"Secondaire (Collège + Lycée)", color:"violet", emoji:"🎓"} }
```
So the domain is **cycle-partitioned at the API layer**, not just visually.

---

## 3. ORIENTATION DOB — `/orientation`

### 3.1 Page hero & standing disclaimer (CONFIRMED verbatim)
```
Scolarité
Orientation et vœux DOB
Campagnes, référentiels, contrôles, quitus et exports depuis les élèves de troisième de Lakoli.
```
Blue info panel, heading **"À propos de cet espace"**:
> "Lakoli applique automatiquement les **critères officiels DOB Seconde 2026** (BEPC exigé, âge ≤ 20 ans au
> 31/12/2026, moyenne d'orientation ≥ 10/20) et détecte les anomalies de dossier. Les quitus et exports
> générés constituent votre base de travail interne ; la **transmission finale** reste à effectuer dans le
> canal officiel de votre DRENA ou IEPP."
>
> "Toutes les données restent dans Lakoli — aucun envoi automatique vers l'administration."

### 3.2 Section 1 — "1. Référentiel versionné des établissements"
Form (4-column grid, placeholders are the only labels):
| Field | Widget | Default in state |
|---|---|---|
| `code` | text, placeholder `Code` | `dob-historique-test` |
| `version` | text, placeholder `Version` | `1.0.0` |
| `libelle` | text (col-span-2), placeholder `Libellé` | `Référentiel DOB historique de test` |
| `sourceReference` | *not rendered* — sent anyway | `Référence SPIDER nettoyée` |

Button **"Créer une version brouillon"** → `POST /orientation/referentiels`.
Per-referential card actions: `"Importer CSV/XLSX nettoyé"` (`<input type=file accept=".csv,.xlsx">`),
`"Publier et verrouiller"` → `POST …/publier`. Card shows `"{n} établissement(s)"` and a status pill.

**Referential import parsing (client-side, XLSX lib) — business rules CONFIRMED:**
- Hard reject on any formula cell: **`"Les formules sont interdites dans le référentiel importé."`**
- Header matching is accent/case/punctuation-insensitive (`NFD` strip + `[^a-z0-9]` removal), against these alias sets:
  - `code` ← `code`, `code établissement`, `code_etablissement`
  - `nom` ← `nom`, `établissement`, `etablissement`, `nom établissement`
  - `drena` ← `drena`, `dren`, `direction régionale`
  - `localite` ← `localité`, `localite`, `ville`, `commune`
  - `genre` ← `genre`, `mixité`, `mixite` → normalised to `filles` | `garcons` | `mixte` | `non_renseigne`
  - `series` ← `séries`/`series`/`série`/`serie` (split on `; , | /`, upper-cased, de-duped)
  - `filieres` ← `filières`/`filieres`/`filière`/`filiere` (same splitter)
- Rows without both `code` and `nom` are dropped. If none survive:
  **`"Aucune ligne avec code et nom d'établissement n'a été trouvée."`**
- Duplicate codes abort: **``Codes d'établissements dupliqués : ${…slice(0,10).join(", ")}.``**
- Provenance is preserved per row: `source:{fileName, sheetName, rowNumber: index+2}`.
- **Upload is chunked 500 rows per POST**, response `count` summed.

### 3.3 Section 2 — "2. Créer une campagne"
| Field | Widget | Notes |
|---|---|---|
| `nom` | text | default `"Campagne d'orientation DOB"` |
| `anneeScolaireId` | select `/annees-scolaires` | option label `` `${libelle}${active?" · active":""}` ``; auto-selects the active year |
| `referentielId` | select | placeholder option `"Référentiel publié…"`; **filtered to `statut==="publie"`**; auto-selects first published |
| `profileCode` | select `/orientation/profile` | **`.filter(t => t.code !== "ci-dob-affectation-6e-session-2026")`** ← hidden profile |
| `ouvertureAt` / `controleAt` / `validationAt` / `exportAt` | `datetime-local`, labels `Ouverture *` `Contrôle *` `Validation *` `Export *` | sent as ISO |

Selecting profile `ci-dob-session-2026` (constant `A`) **auto-fills the four gates**:
```js
ouvertureAt:"2026-07-14T12:00", controleAt:"2026-07-20T12:00",
validationAt:"2026-07-25T12:00", exportAt:"2026-07-27T23:00"
```
and shows the blue callout:
> **"Session 2026‑2027 :"** " contrôle du statut de candidat officiel au BEPC, de l'âge au 31 décembre 2026
> et de la moyenne d'orientation minimale de 10/20. La transmission officielle reste à effectuer dans le
> canal DOB autorisé."

Submit **"Créer la campagne"** is disabled unless year + referential + all four dates are set.

### 3.4 Campaign list & detail
List card shows `{nom}`, status pill, `` `${anneeScolaire} · ${dossierCount} dossiers` ``, and a provenance line:
`"Règles publiques DOB Seconde 2026"` when `profileCode === "ci-dob-session-2026"`, otherwise
**`"Profil historique non homologué"`**. Empty state: `"Aucune campagne."`

Detail header shows `Ouverture … · contrôle … · validation … · export …` (`Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"})`,
fallbacks `"non planifiée"` / `"date invalide"`) and the badge line
`"Critères publics DOB Seconde 2026 · export non homologué"` / `"Profil historique de test · export non homologué"`.

3 KPI tiles: **`Dossiers`**, **`Validés`**, **`Avec blocage`**.

### 3.5 Campaign state machine (CONFIRMED from the button guards)
```
brouillon --[Ouvrir la saisie]--> ouverte --[Passer au contrôle]--> controle --[Valider et figer]--> validee
                                     ^                                  |
                                     +------[Reprendre la saisie]-------+
```
- All transitions except the final freeze go through `POST /orientation/campaigns/{id}/status {statut,motif}`.
- **"Valider et figer"** calls `POST …/valider` and is `disabled` unless
  `campagne.validatedCount === campagne.dossierCount && campagne.dossierCount > 0`
  → **you cannot freeze a campaign while any dossier is unvalidated, nor an empty campaign.**
- `"Synchroniser les 3èmes"` (`POST …/sync-eleves`) pulls the cohort from Lakoli enrolments.
- Once `validee`: `"Campagne figée. Tous les exports utilisent l'empreinte "` + `<code>{snapshotHash.slice(0,16)}…</code>`.

Status colour map `K()` (shared by campaign / dossier / referential):
```js
["validee","valide","publie"] → emerald ;  ["annulee","annule"] → slate ;
["controle","pret"]           → blue    ;  everything else (brouillon, ouverte, …) → amber
```

### 3.6 Exports (freeze-gated) — the three "tabs"
Only rendered when `campagne.statut === "validee"`:
| Button | `type` sent | Result |
|---|---|---|
| `Listing` | `listing` | `orientation-listing-{campaignId}.xlsx` |
| `Statistiques` | `statistiques` | `orientation-statistiques-{campaignId}.xlsx` |
| `Export DOB historique` | `export-administratif` | `orientation-export-administratif-{campaignId}.xlsx` |

Per-dossier **`Quitus`** button (also freeze-gated) → `quitus-orientation-{dossierId}.pdf`.

### 3.7 Dossier list (grouped by class)
Row: `{nom} {prenoms}` / `` `${matricule} · ${sexe} · Série ${serieDemandee || "non renseignée"}` ``.
Eligibility line (only for the official profile):
`"Éligibilité 2026 : "` + `"critères remplis"` (eligible) | `"critères non remplis"` (ineligible) | `"à compléter"` (other).
Anomaly line: `` `${n} contrôle(s), dont ${m} bloquant(s)` `` where `m = anomalies.filter(a=>a.severity==="blocking").length`.

Row actions (RBAC `c = ["direction","super_admin"].includes(user.role)`):
| Button | Condition |
|---|---|
| `Saisir` | `campagne.statut !== "validee" && dossier.statut !== "valide"` |
| `Valider` | `c && dossier.statut === "pret"` |
| `Réouvrir` | `c && dossier.statut === "valide" && campagne.statut !== "validee"` |
| `Quitus` | `campagne.statut === "validee"` |

**Réouvrir** uses a native prompt: `"Motif de réouverture (10 caractères minimum)"`, prefilled
`"Correction demandée après contrôle"`. Optimistic-concurrency `version` is sent on validate/reopen/save.

Dossier statuses observed: `brouillon` (implied default) → `pret` → `valide` (+ `annule` in the colour map).

### 3.8 Modal — "Vœux de {nom} {prenoms}" (`max-w-4xl`, `max-h-[92vh]`)
Top row (3 cols): `Résidence *`, `Série demandée *` (placeholder `A, C, D…`), `Observations`.

Eligibility block **"Éligibilité DOB Seconde 2026"**:
- `"Date de naissance Lakoli : {birthDate || "non renseignée"} · limite : 20 ans au 31 décembre 2026."`
- `Candidat officiel au BEPC 2026 *` — select `À confirmer` (null) / `Oui` / `Non`
- `Moyenne d'orientation /20 *` — `<input type=number min=0 max=20 step=0.01 placeholder="10,00">`
- Verdict box: **`"Critères publics remplis."`** or **`"Contrôle à corriger."`**, then `eligibility.reasons[].message`.

**Vœux structure — 7 ranked choices across 3 branches (CONFIRMED):**
```js
[{key:"general",     label:"Général",              count:3},
 {key:"tertiaire",   label:"Technique tertiaire",  count:2},
 {key:"industrielle",label:"Technique industriel", count:2}]
```
Each row: `Choix {rang}` · establishment select (`Sélectionner…`, option `` `${code} · ${nom}${localite?" · "+localite:""}` ``) ·
for `general` a read-only `` `Série ${serieDemandee||"—"}` ``, for the two technical branches a free
`Série/filière` text input **force-upper-cased on change**.
Only `voeux.filter(v=>v.etablissementId)` is submitted.

**Bulk apply to the whole class** (two-phase with confirmation token):
- Button `"Aperçu : appliquer ces choix à la classe"` → `POST …/bulk-preview {classeId,voeux}` (disabled if not `direction`/`super_admin`).
- Preview panel **"Aperçu classe :"** — `` `${candidateCount} dossier(s) encore sans vœux ; ${readyCount} prêts et ${blockingCount} conserveront des contrôles bloquants.` ``
  then *"Seuls les choix d'établissements seront dupliqués. Résidence et série restent individuelles."*
- Confirm `"Confirmer l'application à la classe"` → `POST …/bulk-apply {classeId,voeux,confirmationToken}`.
- **Hard rule:** when the campaign runs the official profile, bulk is replaced by the text
  **`"Le traitement de masse est désactivé : l'éligibilité doit être vérifiée individuellement."`**

Footer: **`"Enregistrer et contrôler"`** → `PUT /orientation/dossiers/{id}`.

---

## 4. VIE SCOLAIRE — DISCIPLINE (`/vie-scolaire/discipline`)

Hero: `Vie Scolaire` / **`Discipline et convocations`** /
*"Signalement factuel, instruction, décision humaine et convocation contrôlée."*

Standing amber footer rule (CONFIRMED verbatim, the single most important business rule on the page):
> **"Aucun retard ou signalement ne produit automatiquement une sanction. Toute mesure reste proposée puis
> validée par la Direction."**

### 4.1 Enums
```js
typeIncident : ["indiscipline","violence","harcelement","fraude","degradation","autre"]
gravite      : ["mineur","important","critique"]        // colour: critique=red, important=amber, mineur=blue
typeMesure   : ["rappel_regle","retenue","avertissement","blame","exclusion_temporaire","conseil_discipline","autre"]
incident.statut     : signale → en_instruction → clos
mesure.statut       : proposee → validee → executee   (| annulee)
convocation.statut  : brouillon → validee → honoree | absent   (| annulee)
```

### 4.2 Form "Signaler un incident"
| Label (verbatim) | Widget | Rule |
|---|---|---|
| `Classe *` | select, `Sélectionner…` | drives student list |
| `Élève *` | select | filtered `eleves.filter(e=>e.classeId===Number(classeId))`; auto-cleared when class changes |
| `Date *` | date | **clamped to the active school year** `[dateDebut, dateFin]` on load |
| `Heure` | time | optional |
| `Type *` | select (6 values) | default `indiscipline` |
| `Gravité observée *` | select (3 values) | default `mineur` |
| `Lieu` | text | optional |
| `Faits observés * (10 caractères minimum)` | textarea `maxLength=4000` | submit disabled while `faits.trim().length < 10` |

Submit `"Enregistrer le signalement"` / pending `"Enregistrement…"`. Error fallback `"Signalement impossible."`

### 4.3 RBAC inside the page
```js
g = ["super_admin","direction","scolarite"].includes(role)   // may act at all
m = ["super_admin","direction"].includes(role)               // Direction-only decisions
```
| Action | Guard |
|---|---|
| `Instruire` (signale→en_instruction) | `g` |
| `Clore` (en_instruction→clos) | `g && m` |
| `Proposer une mesure`, `Convoquer` | `g`, only while `en_instruction` |
| Mesure `Valider` (proposee→validee) | **`m` only** |
| Mesure `Annuler` | `m`, from `proposee` or `validee` |
| Mesure `Marquer exécutée` | `g`, from `validee` |
| Convocation `Valider et publier` (brouillon→validee) | **`m` only** |
| Convocation `Annuler` | `m`, from `brouillon`/`validee` |
| Convocation `Honorée` / `Parent absent` | `g`, from `validee` |

### 4.4 Recovered micro-forms (native `window.prompt`, invisible to a UI crawl)
1. `` `Type de mesure : ${["rappel_regle","retenue","avertissement","blame","exclusion_temporaire","conseil_discipline","autre"].join(", ")}` `` — default `rappel_regle`; input is validated against the enum, otherwise aborted.
2. `"Description de la mesure proposée (la Direction devra la valider)"`
3. `` `Date et heure du rendez-vous avec ${parent.prenoms} ${parent.nom} (AAAA-MM-JJTHH:MM)` `` — default `` `${dateIncident}T10:00` ``
4. `"Objet de la convocation"`

Convocation targets `eleve.parents[0]`; if absent → error **`"Aucun parent lié à cet élève."`**
Convocation date rendered with `toLocaleString("fr-CI")`.

Empty state: `"Aucun incident dans ce périmètre."`

---

## 5. VIE SCOLAIRE — ACTIVITÉS ET CLUBS (`/vie-scolaire/activites`)

Hero: `Vie Scolaire` / **`Activités et clubs`** /
**"Registre para-scolaire conforme aux canevas primaire et secondaire."**

### 5.1 Enums (CONFIRMED, verbatim arrays)
```js
typeClub (18) = ["cooperative","association_parents","ase","messagers_paix",
  "sante_hygiene_environnement","vih_ist","genre_equite","meres_eleves_filles",
  "protection_enfant","citoyennete","sport","photo","theatre","danse","cinema",
  "cuisine","chorale","autre"]

domaine (16)  = ["socioculturelle","sportive","environnementale","cooperative",
  "conference","formation","sensibilisation","journee_carriere","journee_priere",
  "action_sociale","bilan","agropastorale","artisanale","hygiene_sanitaire",
  "civisme_citoyennete","autre"]

cycleScope    = ["primaire","secondaire","tous"]   // labels Primaire / Secondaire / Tous
activite.statut = brouillon → planifiee → realisee
```
Labels are generated, not stored: `x = h => h.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase())`
(so `journee_carriere` renders as `Journee carriere`).

### 5.2 Forms
**"Créer un club ou une association"** — `Nom *`, `Type *` (18 values), `Cycle *`,
`Animateur / responsable` (select over `personnel`, placeholder option `À définir`, option label
`` `${nom} — ${fonction}` ``), `Description` (textarea). Submit `"Créer le club"`.
Error `"Création du club impossible."`

**"Enregistrer une activité"** — `Intitulé *`, `Domaine *` (16 values), `Cycle *`,
`Club porteur` (placeholder option `Aucun / établissement`, list filtered to `statut==="actif"`),
`Date début *`, `Date fin *` (both default today), `Lieu`, `Acteurs` (placeholder
`Animateurs, partenaires…`), `Objectifs`, `Public cible`. Submit `"Créer l'activité"`.
Error `"Création de l'activité impossible."`

### 5.3 Registre des activités — lifecycle & publication
Card badges: domaine (outline), statut (`default` when `realisee`, else `secondary`), plus a blue
**`Familles`** badge when `publieeAt` is set. Metrics: `{participants} participant(s)` and `{filles} F · {garcons} G`.
Club card metrics: `membres` / `filles` / `garçons`.

| Button | Guard |
|---|---|
| `Participants` | `g` and statut ∈ {`brouillon`,`planifiee`} — **participants are locked once realised** |
| `Planifier` (brouillon→planifiee) | `g` |
| `Marquer réalisée` (planifiee→realisee) | `g` |
| `Publier aux familles` / `Retirer du portail` | **Direction/super_admin only, and only when `statut === "realisee"`** |
| `Gérer les membres` (clubs) | `g` |

where `g = ["super_admin","direction","scolarite"]`, `direction-only = ["super_admin","direction"]`.

Member/participant picker modal (`max-w-2xl`) — title `` `Membres — ${club.nom}` `` or
`` `Participants — ${activite.titre}` ``; search box `"Rechercher un élève, une classe ou un matricule…"`
matching on `` `${nom} ${prenoms} ${matricule} ${classeNom}` ``; checkbox list; footer `{n} sélectionné(s)`,
`Annuler`, `Enregistrer`. Sends the whole `eleveIds[]` set via `PUT` (full replace semantics).
Error `"Enregistrement impossible."`

### 5.4 Printed statistical report (button "Imprimer le récapitulatif")
Pure client-side A4-portrait HTML print, title
**"Récapitulatif chiffré des activités para-scolaires réalisées"**, subtitle `Année scolaire {libelle}`.
Table headers: **`N°` | `Types d'activités` | `Nombre`**. One row **per `domaine` in the fixed 16-value order**
(zero-filled), counting **only `statut === "realisee"`**, plus a `Total` row = number of realised activities.
This is a canevas-shaped official return, generated without any server call.

Empty state: `"Aucune activité enregistrée pour cette année."`

---

## 6. VIE SCOLAIRE — SUIVI PROTÉGÉ (`/vie-scolaire/suivi-sensible`)

The most policy-dense screen in the domain.

Hero: `Vie Scolaire` / **` Suivi protégé`** (lock icon) /
**"Hygiène, santé et cas sociaux — accès nominatif tracé et données chiffrées."**
Amber standing notice: **"Ne saisissez que les informations strictement nécessaires. Chaque consultation est journalisée."**

### 6.1 Enums (CONFIRMED)
```js
domaines (scopes)   R  = ["sante","social","grossesse"]
typeDossier         ce = ["maladie","accident","handicap","psychosocial","grossesse","abandon","deces","autre"]
baseLegale          ue = ["consentement","obligation_legale","protection_mineur","urgence","mission_educative"]
consentementStatut  me = ["non_requis","a_obtenir","obtenu","refuse","retire"]
dossier.statut         = ouvert → en_suivi → clos → archive
```

**Type → domain derivation rule (CONFIRMED, verbatim):**
```js
pe = n => n === "grossesse" ? "grossesse"
        : ["psychosocial","abandon"].includes(n) ? "social"
        : "sante"
```
So `maladie`, `accident`, `handicap`, `deces`, `autre` ⇒ domain `sante`.

### 6.2 The habilitation wall (unauthorised view)
Rendered when `!(grant.actif && grant.lectureScopes.length)`:
> **"Accès sensible non habilité"**
> "Ce registre contient des données de santé et de protection de l'enfant. Votre rôle dans Lakoli ne suffit
> pas : une habilitation nominative, limitée dans le temps et par domaine est obligatoire."
> "Les comptes de démonstration et le portail parent n'y ont jamais accès."

Loading copy: `"Vérification de l'habilitation…"`

### 6.3 Grant model — three orthogonal scope sets
Per user: `lectureScopes[]`, `ecritureScopes[]`, `exportScopes[]`, each a subset of `["sante","social","grossesse"]`,
plus `motif` and `valableJusquau` (time-boxed). Three tiles on the page show per-domain badges
**`Lecture` / `Écriture` / `Agrégats`** (`default` = granted, `secondary` = not).

**Modal "Habilitations nominatives"** (direction/super_admin, lazy-loaded):
> "La lecture, l'écriture et l'export agrégé sont attribués séparément. Les comptes de démonstration restent bloqués."

Per-user row: name, `{email} · {Role}`, a `Compte démo protégé` badge (row becomes read-only),
a 3×3 checkbox matrix, `Motif obligatoire` text (default `"Responsabilité fonctionnelle documentée"`),
a date defaulting to `` `${currentYear+1}-12-31` ``, and `Enregistrer`.

**Save is disabled unless all of (CONFIRMED):**
```js
motif.trim().length >= 5
&& ecritureScopes.every(s => lectureScopes.includes(s))
&& exportScopes.every(s  => lectureScopes.includes(s))
```
→ **write and export scopes are strict subsets of read scope.** Error: `"Habilitation invalide ou refusée."`

### 6.4 Table columns (verbatim `<th>`)
`Signalement` | `Élève` | `Type` | `Statut` | `Conservation` | *(actions: `Consulter`)*
Empty: **`"Aucun dossier dans les domaines autorisés."`** (list is scope-filtered server-side).

### 6.5 Modal "Nouveau dossier protégé"
| Label (verbatim) | Widget | Rule |
|---|---|---|
| `Élève *` | select, option `` `${classeNom} — ${nom} ${prenoms} (${matricule})` `` | required |
| `Type *` | select (8) | shows live hint `` `Domaine : ${derivedDomain}` `` |
| `Date du signalement *` | date | defaults today |
| `Base légale *` | select (5) | default `mission_educative` |
| `Consentement` | select (5) | default `non_requis` |
| `Date du consentement *` | date | **conditional — only rendered when `consentementStatut === "obtenu"`**; otherwise `consentementAt` is forced to `null` on submit |
| `Conserver jusqu'au *` | date | **defaults to `` `${currentYear + 2}-12-31` `` (2-year retention default)** |
| `Problème ou besoin strictement nécessaire *` | textarea | required |
| `Mesure de suivi` | textarea | optional |
| `Observations nécessaires` | textarea | optional |

Free-text goes into a nested `details:{probleme,observations,mesureSuivi,besoinSpecifique}` object
(**`besoinSpecifique` is in the payload but has no input** — dead/reserved field).

Domain write-guard message: **`"Vous n'avez pas l'habilitation d'écriture pour le domaine {Domaine}."`**
Submit label: **`"Enregistrer de façon chiffrée"`**, disabled unless student + `probleme` + write scope.

### 6.6 Modal "Dossier protégé #{id}"
Loading `"Lecture sécurisée en cours…"`; failure
**`"Le dossier n'a pas pu être déchiffré ou l'accès a été refusé."`** (confirms server-side encryption at rest).
Shows `Base légale`. Transitions (`PATCH …/statut` with auto-motif `` `Passage au statut ${Label}` ``):
`ouvert` → `Démarrer le suivi` (`en_suivi`) or `Clore`; `en_suivi` → `Clore`; `clos` → `Archiver`.

### 6.7 "Synthèse anonymisée" — k-anonymity export
`GET /vie-scolaire/suivi-sensible/summary` → `{threshold, cells[]}`; printed A4 **landscape**:
> **"Synthèse anonymisée — santé et cas sociaux"**
> `` `Année {libelle} · les cellules de moins de ${threshold} dossiers sont masquées.` ``

Columns `Type | Classe | Sexe | Statut | Nombre`; suppressed cells render `` `&lt;${threshold}` ``.
Empty body row: `"Aucune donnée publiable."` Denial: **`"Export agrégé non autorisé."`**
> This is a genuine small-cell-suppression disclosure control, driven by a **server-supplied threshold**.

---

## 7. CONFORMITÉ — `/conformite` (three products in one page)

Hero: `Administration` / **`Documents officiels et contrôle des écarts`** + an amber pill
`` `Modèle ${data_snapshot.authorityLevel ?? profile.niveau_autorite ?? "en vigueur"}` `` /
*"Préparez un fichier administratif ou comparez Lakoli avec un fichier reçu de l'administration."*

Blue explainer **"À quoi sert cet espace ?"**:
> "Il évite de recopier manuellement les élèves, moyennes et statistiques dans les canevas administratifs,
> et signale les différences avec un fichier officiel avant l'envoi par votre établissement."

3-step strip: **`1. Choisir`** *le document attendu* · **`2. Vérifier`** *les données et les écarts* ·
**`3. Télécharger`** *le fichier à transmettre*.
Footnote: *"Le rapprochement avec un fichier externe reste facultatif : utilisez-le seulement si vous avez
reçu un export AGFNE, CIO ou un autre registre officiel."*

Profile selector option label: `` `${nom} - ${niveau_autorite}` ``; primary action **"Préparer ce profil"**
→ `POST /conformite/executions {versionId, yearId(active), niveauInterface}` →
success message `"Brouillon créé depuis les données Lakoli."`

### 7.1 (a) Exécutions — "Préparations"
Sidebar `Préparations` / `{n} exécution(s)`; per-item subtitle `authority_level ?? "Modèle en vigueur"`.
Empty: `"Aucune préparation"` + *"Choisissez un profil en haut de la page et cliquez sur **« Préparer ce profil »** pour commencer."*
Detail empty: `"Créez une préparation pour contrôler les données."`

**Status enum + labels (CONFIRMED):** `draft` → `"Brouillon"` (amber), `validated` → `"Validé"` (blue),
`generated` → `"Fichier prêt"` (green).

Detail sections: year label + `` `Cycles : ${scopeCycles.join(", ") || "aucun"}` ``; a card per
`data_snapshot.fields[]` (`{code} · {label}` + value, objects pretty-printed as JSON);
`` `Empreinte données : ${data_hash}` ``.

**`Contrôles`** section lists `anomalies[]` — red when `severity === "blocking"`, amber otherwise;
clean state `"Aucun contrôle en anomalie."`

**`Confirmations et compléments`** (only while `draft`) renders the fields whose
`inputMode ∈ ["manual","annual_confirmation"]`:
- `annual_confirmation` → checkbox `` `Je confirme le bloc ${code} - ${label} pour cette année scolaire.` ``
  + (for `object`/`table` valueTypes) a structured editor labelled
  *"Données préremplies — corrigez uniquement si la situation réelle le nécessite"*.
- `manual` → textarea placeholder **"Renseignez toutes les rubriques applicables de ce bloc. Indiquez explicitement « néant » lorsqu'il n'y a aucune donnée."**

Buttons: `Enregistrer les contrôles` (all roles on the page) and **`Valider et figer`** —
**disabled when `anomalies.filter(a=>a.severity==="blocking").length > 0`**, and rendered only for
`direction`/`super_admin`; otherwise the line **`"La Direction doit effectuer la validation finale."`**
Success: `"Confirmation enregistrée et contrôles recalculés."` / `"Exécution validée : le snapshot est désormais figé."`

Post-validation section **"Snapshot validé et figé"**:
> "Le fichier sera généré depuis cette version exacte, même si les données Lakoli évoluent ensuite."

Generate buttons are `` `Générer ${format.toUpperCase()}` `` for each
`data_snapshot.outputFormats ?? ["xlsx"]` **not already produced**; success
`` `Fichier ${FMT} généré et conservé dans le stockage privé.` ``. Then `` ` Télécharger {file_name}` ``.

#### 7.1.1 Recovered canevas field dictionary (the actual administrative form)
Label map `Pe` (CONFIRMED verbatim):
```
etablissement→Établissement   drenet_ddenet→DRENET / DDENET   iepp→IEPP   ville→Ville
adresse→Adresse   telephone→Téléphone   email→E-mail   chef_etablissement→Chef d'établissement
annee_scolaire→Année scolaire   date_reference→Date de référence   niveau→Niveau   cycle→Cycle
nombreClasses→Classes   classesDoubleVacation→Double vacation   attendus→Attendus   presents→Présents
pourcentage→% présents   couvertureAppel→% appel saisi   discipline→Discipline   cycles→Cycles
personnelActifLakoli→Personnel actif Lakoli   besoinsPremierCycle→Besoins 1er cycle
besoinsSecondCycle→Besoins 2nd cycle   couverturePointage→% pointage saisi   fonction→Fonction
besoins→Besoins   classesPedagogiques→Classes pédagogiques   classesPhysiques→Classes physiques
elevesParClasseAnneeEnCours→Élèves / classe (année en cours)
effectifPrevisionnelAttenduParClasse→Prévision / classe   redoublantsProbables→Redoublants probables
effectifTotalAttendu→Total attendu   observations→Observations
```

**Block codes and their editable columns (`re()`, CONFIRMED):**
| Block | Editable fields (everything else is Lakoli-derived and greyed) |
|---|---|
| `H.1` | *all* |
| `ER.1` | `classesDoubleVacation` |
| `ER.2` | `attendus`, `presents` |
| `ER.3` | `attendus`, `presents`, `besoinsPremierCycle`, `besoinsSecondCycle` |
| `ER.4` | `attendus`, `presents`, `besoins` |
| `CAP.1` | `classesPhysiques`, `effectifPrevisionnelAttenduParClasse`, `redoublantsProbables`, `observations` |

Grey-cell explainer (verbatim): **"Les cellules grisées proviennent de Lakoli. Corrigez-les dans les écrans
métier correspondants ; seules les données de terrain peuvent être complétées ici."**
Empty table: *"Aucune ligne préremplie. Ajoutez d'abord les classes ou affectations correspondantes dans Lakoli."*

**Two live computation rules (CONFIRMED, `Me()`):**
```
pourcentage           = attendus>0 ? round(presents/attendus*10000)/100 : (presents===0 ? 0 : null)
effectifTotalAttendu  = effectifPrevisionnelAttenduParClasse * classesPedagogiques - redoublantsProbables
```

Typed-value coercion errors: `"Un entier est attendu."`, `"Le tableau doit commencer par [ et finir par ]."`,
`"L'objet doit commencer par { et finir par }."`, `` `Donnée structurée invalide : ${msg}` ``,
`"La donnée enregistrée n'est pas encore structurée. Corrigez-la avant de confirmer."`
Numeric-field regex `Z` (17 fields) forces `Number()` coercion on save.

### 7.2 (b) Import et rapprochement externe
Section title **" Import et rapprochement externe"**, subtitle:
> **"Parcours secondaire : comparez un registre externe aux inscriptions validées de Lakoli. L'import ne
> crée, ne remplace et ne corrige aucun élève automatiquement."**

Amber caveat with a `profil de test` chip:
> **"Important :"** " ce profil générique sert à la recette interne. Il ne prétend pas reproduire un canevas
> AGFNE 2026 officiel. Seuls CSV et XLSX sans macro ni formule sont acceptés."
+ link **"Télécharger le modèle CSV générique"** → client-generated `modele-registre-conformite-generique.csv`
with BOM and header row (CONFIRMED verbatim):
```
matricule;nom;prenoms;classe;niveau;statut_preinscription;statut_actualisation
```

Form: `Année scolaire comparée` (select, option `` `${libelle}${active?" — active":""}` ``) and
**`Registre CSV ou XLSX — colonne Matricule obligatoire`**
(`accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`).
Submit **`Comparer`**. File is base64-encoded client-side and posted whole.

**Server error-code → French message dictionary (CONFIRMED — this is the actual validation contract):**
| code | message |
|---|---|
| `profil_import_non_autorise` | "Le profil choisi n'est pas autorisé." |
| `type_fichier_interdit` | "Utilisez uniquement un fichier CSV ou XLSX sans macro." |
| `fichier_trop_volumineux` | "Le fichier dépasse la taille maximale autorisée." |
| `colonne_matricule_requise` | "Le fichier doit contenir une colonne Matricule." |
| `formule_interdite` | "Le classeur contient une formule. Remplacez-la par une valeur avant l'import." |
| `macro_interdite` | "Les macros sont interdites dans le Centre de conformité." |
| `signature_xlsx_invalide` | "Le contenu du fichier ne correspond pas à un véritable classeur XLSX." |
| `signature_csv_invalide` | "Le contenu du fichier ne correspond pas à un CSV texte autorisé." |
| `aucune_ligne_acceptee` | "Aucune ligne exploitable n'a été trouvée." |

Client pre-check: `` `Le fichier dépasse ${Math.round(profile.maxBytes/1024/1024)} Mo.` ``

**Idempotency / immutability (CONFIRMED):**
- Re-uploading the same bytes in the same context returns `reused:true` →
  **"Ce même fichier avait déjà été rapproché dans ce contexte : le résultat existant a été réutilisé."**
- Otherwise: **"Import analysé. Les données Lakoli n'ont pas été modifiées ; vérifiez les anomalies."**
- List header: `Imports contrôlés` / **`{n} résultat(s) immuable(s)`**; card subtitle
  `{acceptedCount} acceptée(s) · {rejectedCount} rejetée(s) · {anomalyCount} anomalie(s)`.
  Empty: `"Aucun rapprochement enregistré."`

4 KPI tiles: **`Lignes acceptées`** (emerald) · **`Lignes rejetées`** (amber if >0) ·
**`Matricules rapprochés`** (blue) · **`Anomalies ouvertes`** (red if >0).
Fingerprint line `` `Empreinte comparaison : ${comparisonSha256}` ``.

Two downloads: **` Source archivée`** (direction/super_admin only) and
**` Exporter anomalies et rejets`** → `rapprochement-{id8}.xlsx`.

**Anomaly workflow.** Filter select options: `Ouvertes` (`ouverte`) · `Résolues` (`resolue`) ·
`Ignorées` (`ignoree`) · `Toutes` (`toutes`). Paginated **25/page**, header
`` `Anomalies · {from}–{to} sur {total} · {n} bloquante(s) sur cette page` ``; nav `aria-label="Pagination des anomalies"`,
`Page {i} sur {n}`, `` ` Précédente` `` / `` `Suivante ` ``.
Card: `` `${type.replaceAll("_"," ")} · ${matricule || "sans matricule"}` `` + `message`, severity red/amber, statut pill.
Decision controls appear only when `statut === "ouverte"` **and** the user is `direction`/`super_admin`:
input `Motif obligatoire de la décision`, buttons **`Marquer résolue`** / **`Ignorer avec motif`**.
Client-side rule: **motif must be ≥ 5 characters** → `"Ajoutez un motif d'au moins cinq caractères."`
Success: **"Décision enregistrée dans le journal de conformité."**; resolved cards show `` `Décision : ${resolution_note}` ``.
Empty/failed: `" Aucune anomalie dans ce filtre."` / `" Impossible de charger les anomalies."` /
`"Sélectionnez ou créez un rapprochement."`

### 7.3 (c) Assistant ActuMoyenne — 100 % client-side, **zero endpoints**
Header: **`Assistant ActuMoyenne`** with three chips **`Interne / test`**, **`Aucun import`**, **`Non homologué`**;
right-hand `Profil 1.0.0-test` / `Référence historique interne`.
> "Préqualifiez uniquement les titres de colonnes d'une copie CSV ou XLSX. L'analyse reste dans ce navigateur :
> aucune donnée ni aucun fichier n'est envoyé à Lakoli."
Amber caveat: **"Cet assistant ne garantit ni compatibilité avec un canevas officiel actuel, ni import, ni
export, ni transmission administrative."**

Frozen profile object (CONFIRMED verbatim):
```js
Object.freeze({
  code:"lakoli-actumoyenne-prequalification", version:"1.0.0-test",
  authorityLevel:"interne_test", qualification:"workflow_atteste_format_non_qualifie",
  officialCompatibilityClaimAllowed:false, officialTransmissionSupported:false,
  currentOfficialTemplateAvailable:false,
  supportedLevels:["6e","5e","4e","3e","2nde","1ere","tle"]
})
```

Inputs: `Copie du fichier` (helper **"CSV ou XLSX, 5 Mo maximum, sans macro ni formule."**),
`Niveau concerné` (`6e,5e,4e,3e,2nde,1re,Terminale`), and
`` `Série ${isLycee ? "(si applicable)" : "(non applicable)"}` `` (disabled below 2nde; first option `Non précisée`).

Local validation messages: `"Choisissez un fichier CSV ou XLSX sans macro."`,
`"Le fichier dépasse la limite locale de 5 Mo."`, `"Les fichiers contenant des macros sont refusés."`,
`"Le fichier contient une formule. Fournissez une copie en valeurs uniquement."`,
`"Le fichier ne contient aucune feuille."`, `"La première ligne ne contient aucun en-tête."`,
`"Analyse locale impossible."`; untitled columns become `` `(colonne ${i+1} sans titre)` ``.

**Canonical field dictionary — 27 keys** (`student.*`, `school.*`, `period.*`, `result.*`, `subject.*`),
only `student.national_id` (`Matricule`) is `required:true`. Each has accent-insensitive `aliases[]`, and
some have **level/série-scoped aliases** (a real subtlety):
```js
subject.mathematics    scopedAliases:[{levels:["3e"], aliases:["maths 3e","moy maths 3e"]},
                                      {levels:["tle"], series:["c","d"], aliases:["maths tle","maths terminale","moy maths tle"]}]
subject.physics_chemistry scopedAliases:[{levels:["3e"], aliases:["physique chimie 3e","moy pc 3e"]},
                                      {levels:["2nde","1ere","tle"], series:["c","d"], aliases:["sciences physiques","moy sciences physiques"]}]
```
Subjects covered: Français, Composition française, Orthographe-Grammaire, Expression orale, Mathématiques,
Anglais, Langue vivante 2, Histoire-Géographie, SVT, Physique-Chimie, Philosophie, EDHC, Arts plastiques,
Informatique (`subject.ict`), EPS (`subject.sport`), Conduite.

Result panel: `` `Feuille : {sheetName}` ``, `{n} colonne(s)`, `aria-live="polite"`; 4 counters
**`Correspondances`** · **`Inconnues`** (neutral) · **`Conflits`** (warning) · **`Obligatoires manquantes`** (danger).
Table `` <caption class="sr-only">Correspondances proposées entre les en-têtes du fichier et les champs internes Lakoli</caption> ``
with headers **`Colonne source` | `Champ interne proposé` | `Clé technique`**.
Diagnostic lists: `Colonnes inconnues`, `En-têtes ambigus` (`` `${sourceHeader} → ${candidates.join(" / ")}` ``),
`Correspondances en double` (`` `${canonicalLabel} ← ${sourceHeaders.join(", ")}` ``), `Champs obligatoires manquants`.
Verdict: **"Proposition utilisable après contrôle humain"** vs **"Corrigez les conflits avant de confirmer"**.
Mandatory attestation checkbox:
> **"Je confirme que cette correspondance est interne, non officielle, et que les conflits et colonnes
> inconnues ont été vérifiés."**
then `` ` Confirmer la proposition locale` `` → **"Correspondance confirmée localement. Aucun import ni aucune
transmission n'a été effectué."**

---

## 8. CROSS-CUTTING BUSINESS RULES (verbatim French, ranked by weight)

1. **"Aucun retard ou signalement ne produit automatiquement une sanction. Toute mesure reste proposée puis validée par la Direction."** (discipline)
2. "Lakoli applique automatiquement les critères officiels DOB Seconde 2026 (BEPC exigé, âge ≤ 20 ans au 31/12/2026, moyenne d'orientation ≥ 10/20) et détecte les anomalies de dossier. Les quitus et exports générés constituent votre base de travail interne ; la transmission finale reste à effectuer dans le canal officiel de votre DRENA ou IEPP." (orientation)
3. "Toutes les données restent dans Lakoli — aucun envoi automatique vers l'administration." (orientation)
4. **"Le traitement de masse est désactivé : l'éligibilité doit être vérifiée individuellement."** (orientation, official profile)
5. "Seuls les choix d'établissements seront dupliqués. Résidence et série restent individuelles." (orientation bulk)
6. "Campagne figée. Tous les exports utilisent l'empreinte {snapshotHash}" (orientation)
7. "Les formules sont interdites dans le référentiel importé." (orientation import)
8. "Parcours secondaire : comparez un registre externe aux inscriptions validées de Lakoli. L'import ne crée, ne remplace et ne corrige aucun élève automatiquement." (conformité)
9. "Ce même fichier avait déjà été rapproché dans ce contexte : le résultat existant a été réutilisé." (conformité, idempotent import)
10. "Import analysé. Les données Lakoli n'ont pas été modifiées ; vérifiez les anomalies." (conformité)
11. "Décision enregistrée dans le journal de conformité." + "Ajoutez un motif d'au moins cinq caractères." (conformité)
12. "Le fichier sera généré depuis cette version exacte, même si les données Lakoli évoluent ensuite." (conformité snapshot)
13. "La Direction doit effectuer la validation finale." (conformité)
14. "Les cellules grisées proviennent de Lakoli. Corrigez-les dans les écrans métier correspondants ; seules les données de terrain peuvent être complétées ici." (conformité canevas)
15. "Renseignez toutes les rubriques applicables de ce bloc. Indiquez explicitement « néant » lorsqu'il n'y a aucune donnée." (conformité)
16. **"Ce registre contient des données de santé et de protection de l'enfant. Votre rôle dans Lakoli ne suffit pas : une habilitation nominative, limitée dans le temps et par domaine est obligatoire."** (suivi protégé)
17. "Les comptes de démonstration et le portail parent n'y ont jamais accès." (suivi protégé)
18. "Ne saisissez que les informations strictement nécessaires. Chaque consultation est journalisée." (suivi protégé)
19. "La lecture, l'écriture et l'export agrégé sont attribués séparément. Les comptes de démonstration restent bloqués." (suivi protégé)
20. "les cellules de moins de {threshold} dossiers sont masquées." (suivi protégé, k-anonymity)
21. "Le dossier n'a pas pu être déchiffré ou l'accès a été refusé." (suivi protégé, encryption at rest)
22. "Registre para-scolaire conforme aux canevas primaire et secondaire." (activités)
23. "Préqualifiez uniquement les titres de colonnes d'une copie CSV ou XLSX. L'analyse reste dans ce navigateur : aucune donnée ni aucun fichier n'est envoyé à Lakoli." (ActuMoyenne)
24. "Cet assistant ne garantit ni compatibilité avec un canevas officiel actuel, ni import, ni export, ni transmission administrative." (ActuMoyenne)
25. "Il ne prétend pas reproduire un canevas AGFNE 2026 officiel. Seuls CSV et XLSX sans macro ni formule sont acceptés." (conformité import)
26. "Le rapprochement avec un fichier externe reste facultatif : utilisez-le seulement si vous avez reçu un export AGFNE, CIO ou un autre registre officiel." (conformité)
27. "Module bientôt disponible … Votre administrateur Lakoli pourra vous informer de la date de disponibilité." (gating)

**Recurring editorial doctrine (INFERRED from the corpus, but grounded in 8+ verbatim strings):**
Lakoli systematically positions itself as a *preparation* tool, never a *transmission* channel to the
Ivorian administration (DRENA / IEPP / DOB / AGFNE / CIO). Every export is labelled
"non homologué" / "interne" and every screen restates that the official submission stays outside the product.

---

## 9. STATUS / ENUM CATALOGUE (single table)

| Entity | Values |
|---|---|
| Orientation campaign `statut` | `brouillon`, `ouverte`, `controle`, `validee` (+ `annulee` in colour map) |
| Orientation dossier `statut` | `brouillon`, `pret`, `valide` (+ `annule`) |
| Orientation referential `statut` | `brouillon`, `publie` |
| Orientation eligibility `status` | `eligible`, `ineligible`, *(other → "à compléter")* |
| Anomaly `severity` (orientation & conformité) | `blocking`, *(non-blocking)* |
| Orientation export types | `listing`, `statistiques`, `export-administratif`, `quitus` |
| Orientation vœu branches | `general`(3), `tertiaire`(2), `industrielle`(2) |
| Orientation profiles | `ci-dob-session-2026`, `lakoli-dob-historique-v1`, `ci-dob-affectation-6e-session-2026` *(hidden)* |
| Conformité execution `statut` | `draft`→Brouillon, `validated`→Validé, `generated`→Fichier prêt |
| Conformité field `inputMode` | `manual`, `annual_confirmation` (+ derived/read-only) |
| Conformité field `valueType` | `text`, `integer`, `object`, `table` |
| Conformité block codes | `H.1`, `ER.1`, `ER.2`, `ER.3`, `ER.4`, `CAP.1` |
| Conformité import anomaly `statut` | `ouverte`, `resolue`, `ignoree` (+ filter `toutes`) |
| Conformité import error codes | 9 codes, see §7.2 |
| ActuMoyenne levels | `6e,5e,4e,3e,2nde,1ere,tle` |
| Incident `typeIncident` | `indiscipline, violence, harcelement, fraude, degradation, autre` |
| Incident `gravite` | `mineur, important, critique` |
| Incident `statut` | `signale, en_instruction, clos` |
| Mesure `typeMesure` | `rappel_regle, retenue, avertissement, blame, exclusion_temporaire, conseil_discipline, autre` |
| Mesure `statut` | `proposee, validee, executee, annulee` |
| Convocation `statut` | `brouillon, validee, honoree, absent, annulee` |
| Club `typeClub` | 18 values, see §5.1 |
| Activité `domaine` | 16 values, see §5.1 |
| Activité `statut` | `brouillon, planifiee, realisee` (+ `publieeAt` flag) |
| `cycleScope` | `primaire, secondaire, tous` |
| Suivi sensible domain scopes | `sante, social, grossesse` |
| Suivi sensible `typeDossier` | `maladie, accident, handicap, psychosocial, grossesse, abandon, deces, autre` |
| Suivi sensible `baseLegale` | `consentement, obligation_legale, protection_mineur, urgence, mission_educative` |
| Suivi sensible `consentementStatut` | `non_requis, a_obtenir, obtenu, refuse, retire` |
| Suivi sensible `statut` | `ouvert, en_suivi, clos, archive` |
| `niveauInterface` | `primaire`, `secondaire` |

---

## 10. WORKFLOWS (ordered stages)

1. **Orientation DOB** — Créer version brouillon du référentiel → Importer CSV/XLSX nettoyé (batch 500) →
   Publier et verrouiller → Créer la campagne (4 gates) → Synchroniser les 3èmes → Ouvrir la saisie →
   Saisir les vœux (per pupil, optional class bulk preview/apply) → Passer au contrôle → Valider chaque
   dossier → **Valider et figer** (blocked unless 100 % validated) → Listing / Statistiques / Export DOB
   historique / Quitus per pupil.
2. **Conformité — document officiel** — Choisir un profil → « Préparer ce profil » (snapshot from Lakoli) →
   lire les Contrôles → Confirmations et compléments (`Enregistrer les contrôles`) → **Valider et figer**
   (Direction only, blocked by blocking anomalies) → `Générer XLSX/PDF` → `Télécharger`.
3. **Conformité — rapprochement externe** — Choisir l'année + registre → `Comparer` (immutable, idempotent by
   file hash) → lire KPI + `Empreinte comparaison` → filtrer les anomalies → `Marquer résolue` /
   `Ignorer avec motif` (motif ≥ 5 car., Direction only) → `Exporter anomalies et rejets` (+ `Source archivée`).
4. **ActuMoyenne** — Copie du fichier → Niveau + Série → correspondances/conflits → cocher l'attestation →
   `Confirmer la proposition locale`. **No network I/O at any step.**
5. **Discipline** — Signaler un incident (faits ≥ 10 car.) → `Instruire` → `Proposer une mesure` (prompt) →
   Direction `Valider` → `Marquer exécutée`; parallel branch `Convoquer` (prompt date + objet) →
   Direction `Valider et publier` → `Honorée` / `Parent absent`; finally Direction `Clore`.
6. **Activités & clubs** — Créer un club → Gérer les membres → Enregistrer une activité → `Participants` →
   `Planifier` → `Marquer réalisée` → Direction `Publier aux familles` (revocable) → `Imprimer le récapitulatif`.
7. **Suivi protégé** — Direction grants nominative `Lecture/Écriture/Agrégats` per domain with motif + expiry →
   habilitated user creates `Nouveau dossier protégé` (encrypted) → `Démarrer le suivi` → `Clore` → `Archiver`;
   `Synthèse anonymisée` printable with small-cell suppression.

---

## 11. THINGS A UI-ONLY PASS WOULD HAVE MISSED (evidence-backed)

1. `/orientation` and `/conformite` are fully built but **entitlement-gated**; the "blank/coming-soon" reading was an artefact of the demo tenant's `module-access` response.
2. Hidden orientation profile `ci-dob-affectation-6e-session-2026` filtered out of the UI dropdown.
3. Bulk vœux application is a **two-phase commit with `confirmationToken`**, and is *disabled entirely* under the official 2026 profile.
4. Campaign freeze is arithmetic-gated: `validatedCount === dossierCount && dossierCount > 0`.
5. Referential import is **client-parsed**, formula-rejecting, accent-insensitive, duplicate-code-rejecting, and **POSTed in 500-row batches** with per-row `{fileName,sheetName,rowNumber}` provenance.
6. Two blob export routes (`/export/{type}`, `/export/quitus`) exist that the endpoint extractor never saw.
7. `GET /conformite/imports/{id}/source` re-downloads the original archived upload — direction/super_admin only.
8. Conformité imports are **content-addressed and idempotent** (`reused:true`) and carry a `comparisonSha256`.
9. Anomaly decisions require a ≥ 5-character motif and are written to a "journal de conformité".
10. The conformité canevas has real computed columns (`% présents`, `Total attendu`) with exact formulas, and a per-block whitelist of humanly-editable fields (`H.1/ER.1..4/CAP.1`).
11. **ActuMoyenne is an entirely offline sub-product** with a 27-field canonical schema and level/série-scoped column aliases — invisible to any network-trace-based audit.
12. Suivi protégé enforces `ecritureScopes ⊆ lectureScopes` and `exportScopes ⊆ lectureScopes` client-side, plus time-boxed grants and a `protectedDemoAccount` hard block.
13. Suivi protégé aggregate export implements **server-driven k-anonymity** (`threshold`, `suppressed` cells).
14. Suivi protégé payload carries a `details.besoinSpecifique` field with **no corresponding input** (dead/reserved).
15. Discipline's mesure and convocation creation are **native `window.prompt()` dialogs**, including an enum-validated prompt listing all 7 `typeMesure` values — no crawler would ever record them.
16. Discipline auto-clamps the incident date into the active school year's `[dateDebut, dateFin]`.
17. Activity participants become **immutable once the activity is `realisee`**; only publication remains toggleable.
18. The activities "Récapitulatif" print is a fixed 16-row canevas (zero-filled by domain) built **entirely client-side**.
19. Every discipline/activités/suivi/import call is scoped by `niveauInterface` (`primaire` | `secondaire`) — the domain is cycle-partitioned server-side.
20. Locked modules surface as `À venir` in the ⌘K command palette with `aria-disabled`, not as 404s.
21. Sidebar/`t3` mismatch: `/conformite` declares `gatedModule:"conformite"` while the path map says `"compliance"` — the latter is dead code.
22. Optimistic concurrency: orientation dossiers carry a `version` on save/validate/reopen.

---

*Compiled from static analysis only. No Lakoli instance was contacted.*
