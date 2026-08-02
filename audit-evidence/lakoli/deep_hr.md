# Lakoli — Deep bundle audit: domain **HR / Personnel & Paie**

Reverse-engineered from the shipped Vite chunks. Every French string below is **verbatim** from the
minified bundle unless explicitly marked `INFERRED`.

**Source files analysed**

| File | Size | Page it implements |
|---|---|---|
| `chunks/index-CIUSPHL3.js` | 35 845 B | `/rh` — Ressources Humaines (list + KPIs + "Nouveau personnel" modal + monthly batch-payroll modal + 3 print generators) |
| `chunks/detail-B2sayMo3.js` | 48 007 B | `/rh/:id` — personnel detail, 4 tabs, payslip generator |
| `chunks/pointages-C0oS50fn.js` | 40 680 B | `/rh/pointages` — Pointage du personnel, 6 tabs |
| `chunks/rh-C0NIV5Bw.js` | 7 422 B | `/parametres/rh` — RH & Paie, barèmes Côte d'Ivoire |
| `lakoli-main.js` | 732 780 B | routing, RBAC, sidebar, module gating, guided tours |

> **Correction to the earlier shallow audit.** The shallow pass reported "~15 endpoints total" for the
> whole platform. The HR domain **alone** carries **42 distinct API operations**. It also reported
> `/conformite` as a "coming soon placeholder" — see §11: `/conformite` is a working compliance-report
> engine that consumes HR data fields (`personnelActifLakoli`, `couverturePointage`).

---

## 1. API surface — 42 operations (CONFIRMED)

### 1.1 In `lakoli-endpoints.txt` (37)

| # | Method + path | Chunk |
|---|---|---|
| 1 | `GET /personnel` | index-CIUSPHL3.js |
| 2 | `GET /personnel/stats` | index-CIUSPHL3.js |
| 3 | `GET /personnel/{id}` | detail-B2sayMo3.js |
| 4 | `GET /personnel/{id}/contrats` | detail-B2sayMo3.js |
| 5 | `GET /personnel/{id}/contrats-prestation` | detail-B2sayMo3.js |
| 6 | `GET /personnel/{id}/paies` | detail-B2sayMo3.js |
| 7 | `GET /personnel/{id}/paies/{id}/lignes` | detail-B2sayMo3.js |
| 8 | `GET /personnel/presences/audit` | pointages-C0oS50fn.js |
| 9 | `GET /personnel/presences/terminaux` | pointages-C0oS50fn.js |
| 10 | `GET /rh/bareme-anciennete` | rh-C0NIV5Bw.js |
| 11 | `GET /rh/bareme-irpp` | rh-C0NIV5Bw.js |
| 12 | `GET /rh/parametres-paie` | rh-C0NIV5Bw.js |
| 13 | `GET /rh/rubriques` | rh-C0NIV5Bw.js |
| 14 | `POST /personnel` | index-CIUSPHL3.js |
| 15 | `POST /personnel/paies/lot` | index-CIUSPHL3.js |
| 16 | `POST /personnel/paies/lot/apercu` | index-CIUSPHL3.js |
| 17 | `POST /personnel/presences/ajustements` | pointages-C0oS50fn.js |
| 18 | `POST /personnel/presences/manuel` | pointages-C0oS50fn.js |
| 19 | `POST /personnel/presences/manuel/lot` | pointages-C0oS50fn.js |
| 20 | `POST /personnel/{id}/contrats` | detail-B2sayMo3.js |
| 21 | `POST /personnel/{id}/contrats/{id}/renew` | detail-B2sayMo3.js |
| 22 | `POST /personnel/{id}/contrats/{id}/resume` | detail-B2sayMo3.js |
| 23 | `POST /personnel/{id}/contrats/{id}/suspend` | detail-B2sayMo3.js |
| 24 | `POST /personnel/{id}/contrats/{id}/terminate` | detail-B2sayMo3.js |
| 25 | `POST /personnel/{id}/contrats-prestation` | detail-B2sayMo3.js |
| 26 | `POST /personnel/{id}/contrats-prestation/{id}/paiements` | detail-B2sayMo3.js |
| 27 | `POST /personnel/{id}/paies` | detail-B2sayMo3.js |
| 28 | `POST /personnel/{id}/paies/apercu` | detail-B2sayMo3.js |
| 29 | `PATCH /personnel/paies/lot/valider` | index-CIUSPHL3.js |
| 30 | `PATCH /personnel/presences/ajustements/{id}/decision` | pointages-C0oS50fn.js |
| 31 | `PATCH /personnel/presences/manuel/lots/{id}/decision` | pointages-C0oS50fn.js |
| 32 | `PUT /personnel/{id}` | detail-B2sayMo3.js |
| 33 | `PUT /personnel/{id}/paies/{id}` | detail-B2sayMo3.js |
| 34 | `PUT /rh/bareme-anciennete/{id}` | rh-C0NIV5Bw.js |
| 35 | `PUT /rh/bareme-irpp/{id}` | rh-C0NIV5Bw.js |
| 36 | `PUT /rh/parametres-paie/{id}` | rh-C0NIV5Bw.js |
| 37 | `PUT /rh/rubriques/{id}` | rh-C0NIV5Bw.js |

### 1.2 **MISSING from `lakoli-endpoints.txt`** — recovered by grepping raw URL template literals (5)

The extractor dropped these because the path is glued to a query string in the template literal.
All 5 are **CONFIRMED** (exact source literal quoted).

| # | Method + path | Source literal | Chunk |
|---|---|---|---|
| 38 | `GET /personnel/paies/lot` | `` `/personnel/paies/lot?periode=${x}` `` | index-CIUSPHL3.js |
| 39 | `GET /personnel/presences/jour` | `` `/personnel/presences/jour?date=${c}` `` | pointages-C0oS50fn.js |
| 40 | `GET /personnel/presences/anomalies` | `` `/personnel/presences/anomalies?date=${c}` `` | pointages-C0oS50fn.js |
| 41 | `GET /personnel/presences/manuel/lots` | `"/personnel/presences/manuel/lots?status=PENDING_REVIEW"` | pointages-C0oS50fn.js |
| 42 | `GET /personnel/presences/rapport-mensuel` | `` `/personnel/presences/rapport-mensuel?month=${H}` `` | pointages-C0oS50fn.js |

Also confirmed: `GET /personnel?statut=actif` (same op as #1, filtered) — used by the pointage page to
populate the "Membre du personnel" select.

**No DELETE operation exists anywhere in the HR domain.** Personnel are never hard-deleted; they move to
statut `sorti`. Contracts are `terminate`d, not deleted. (CONFIRMED by absence — full sweep of every
`/personnel*` and `/rh*` string literal across all 149 chunks returned no DELETE call site.)

---

## 2. Routing, RBAC & module gating (from `lakoli-main.js`)

```
{name:"Personnel & RH", path:"/rh", section:"gerer", group:"Équipe", roles:An}
{name:"Pointage du personnel", path:"/rh/pointages", section:"gerer", group:"Équipe",
 keywords:["présence physique personnel","arrivée départ salariés","pointage RH"], roles:An}
```
with `An=["super_admin","direction"]`.

Route guards:
```
<Route path="/rh"           component={Uz} />            // no allowedRoles at route level
<Route path="/rh/:id"       component={Iz} />            // no allowedRoles at route level
<Route path="/rh/pointages" component={Bz} allowedRoles={["super_admin","direction"]} />
<Route path="/parametres/rh" component={zz} />
```

**Module-gate keys** (map `t3`, path → module code):
```
"/rh":"personnel_hr", "/rh/pointages":"staff_attendance"
```
`lm(e){return e.gatedModule ?? t3[e.path]}`. Effective entitlement comes from the API at runtime:
`GET /module-access/catalog` → `{effectiveModules:[...], catalog:[{code,...}]}`. There is **no static
plan-tier table in the bundle** — HR and staff-attendance are sellable/gateable modules resolved
server-side. (Contrast: `/conformite` and `/orientation` carry an explicit `gatedModule:"conformite"` /
`gatedModule:"orientation_dob"` literal.)

**Guided tour** `{id:"rh", label:"Gérer le personnel", route:"/rh"}` — 3 steps, verbatim:
1. *"Gestion du personnel"* — "Cette page regroupe toutes les fiches du personnel de votre école : enseignants, directeurs, agents administratifs. Pour chaque employé, vous gérez le contrat, la classe assignée et les accès au logiciel."
2. *"Ajouter un employé"* (`targetId:"ptour-rh-add"`) — "Cliquez sur « Ajouter » pour créer la fiche d'un nouvel employé. Vous pourrez lui attribuer un rôle (enseignant, comptable, directeur…) et lui donner accès à Lakoli."
3. *"Assigner les classes"* (`targetId:"ptour-rh-liste"`) — "Pour chaque enseignant, définissez les classes dont il/elle est responsable. Cela détermine les pages et les données qu'il verra dans Lakoli."

**Guided tour** `{id:"staff-attendance", label:"Pointage du personnel", route:"/rh/pointages"}` — 2 steps:
1. *"Pointage manuel ou automatique"* — "Enregistrez les arrivées, départs, absences et missions, avec ou sans terminal de pointage."
2. *"Contrôler les preuves"* (`targetId:"ptour-staff-attendance-main"`) — "Consultez les anomalies, validations, badges, terminaux et rapports sans effacer les événements d'origine."

---

## 3. Page `/rh` — Ressources Humaines (`index-CIUSPHL3.js`)

### 3.1 Hero
```
Eyebrow : "Administration"
H1      : "Ressources Humaines"
Sub     : "Gestion du personnel et des paies"
Buttons : "Fiches de paie du mois"   |   "Nouveau personnel" (data-tour-id="ptour-rh-add")
```

### 3.2 KPI cards — from `GET /personnel/stats`
| Label (verbatim) | Field | Notes |
|---|---|---|
| `Effectif actif` | `totalActifs` | |
| `Masse salariale brute` | `masseSalariale` | description `"/ mois"` |
| `Départements` | `parDepartement[] {dep,count}` | chips `Libellé (n)` |
| `Contrats expirants` | `contratsExpirants` | description toggles: `"À renouveler dans 60 jours"` when > 0, else `"Aucun contrat à renouveler"`; card turns amber (`bg-amber-50 border-amber-200`, `text-amber-600`) |

> **Business rule (CONFIRMED):** contract-expiry horizon is **60 days**.
> **Gap worth noting:** this is a KPI card only — grepping `alertes-*.js` and `dashboard-*.js` for
> "contrat" returns **zero** hits, so contract expiry never reaches the global alert engine.

### 3.3 Filters
- Search input, placeholder `"Rechercher par nom, matricule..."` — client-side, matches `nom prenoms matricule`.
- Department `<select>`, first option `"Tous les départements"`, then the 9 department labels.
- Both filters are **client-side** (`G=H.filter(...)`); no server query params.

### 3.4 Table columns (verbatim `<th>`)
`Personnel` · `Poste / Département` · `Contrat` · `Salaire brut` (right-aligned) · `Statut` · (empty actions col → link `Voir →` to `/rh/{id}`)

Empty state: `"Aucun personnel enregistré"`. Loading: `"Chargement..."`.

### 3.5 Enumerations (verbatim maps)

**Départements** (`X`) — 9 values:
```js
{direction:"Direction", enseignement:"Enseignement", administration:"Administration",
 comptabilite:"Comptabilité", surveillance:"Surveillance", entretien:"Entretien",
 cantine:"Cantine", securite:"Sécurité", autre:"Autre"}
```

**Type de contrat** (`le`) — 6 values:
```js
{cdi:"CDI", cdd:"CDD", vacataire:"Vacataire", stagiaire:"Stagiaire",
 benevole:"Bénévole", prestataire:"Prestataire"}
```

**Statut personnel** (`we` = colour map; labels from the ternary in the table cell) — 4 values:
```js
{actif:"bg-green-100 text-green-700", suspendu:"bg-yellow-100 text-yellow-700",
 en_conge:"bg-blue-100 text-blue-700", sorti:"bg-gray-100 text-gray-500"}
```
Labels: `actif → "Actif"`, `suspendu → "Suspendu"`, `en_conge → "En congé"`, else → `"Sorti"`.

**Rôles Lakoli attribuables depuis RH** (`Ee`) — 7 values:
```js
{enseignant:"Enseignant", permanent:"Personnel", scolarite:"Scolarité",
 comptable:"Comptable", caissier:"Caissier", direction:"Direction", auditeur:"Auditeur"}
```
(Note the mapping `permanent → "Personnel"` — the internal role code is `permanent`.)

### 3.6 Modal **"Nouveau membre du personnel"** — `POST /personnel`

Fields (verbatim labels; `*` = required marker present in the label string):

| Field key | Label | Control | Required |
|---|---|---|---|
| `nom` | `Nom*` | text | yes (submit disabled) |
| `prenoms` | `Prénoms*` | text | yes |
| `poste` | `Poste*` | text | yes |
| `telephone` | `Téléphone` | text | no |
| `departement` | `Département` | select (9 opts) | no |
| `typeContrat` | `Type de contrat` | select (6 opts) | no |
| `salaireBrut` | `Salaire brut mensuel (FCFA)` | number, col-span-2 | no (coerced `Number(...)\|\|0`) |
| `creerAcces` | `Créer aussi son accès Lakoli` | checkbox | — |
| `email` | `Adresse e-mail de connexion *` | email, placeholder `nom@ecole.ci`, `autoComplete:"off"` | if `creerAcces` |
| `role` | `Rôle *` | select (7 role opts) | if `creerAcces` |
| `niveauAcces` | `Cycle accessible *` | select: `Tous les cycles` / `Primaire seulement` / `Secondaire seulement` (values `tous`/`primaire`/`secondaire`) | if `creerAcces` |
| `motDePasse` | `Mot de passe temporaire *` | password, placeholder `8 caractères minimum`, `autoComplete:"new-password"` | if `creerAcces` |

Verbatim helper copy:
- under the checkbox: **"Utile uniquement si cette personne doit se connecter au logiciel."**
- under the password: **"Communiquez-le directement à la personne. Il n'est jamais affiché ensuite."**

**Validation rule (CONFIRMED, exact expression):**
```js
disabled: !o.nom || !o.prenoms || !o.poste || U.isPending
       || (o.creerAcces && (!o.email || o.motDePasse.length < 8))
```
Buttons: `Annuler` / `Enregistrer` (pending: `Enregistrement...`).
On success the new row is spliced into the cache and re-sorted with `localeCompare(..., "fr-CI")`.
Error surface: `err.response.data.detail || err.response.data.error || "Erreur…"` rendered in a red banner.

### 3.7 Modal **"Préparer les fiches de paie du mois"** — the batch-payroll workflow

Header copy, verbatim:
> **"Préparer les fiches de paie du mois"**
> **"Lakoli calcule d'abord un aperçu. Aucun bulletin n'est validé ou payé automatiquement."**

Ordered workflow (CONFIRMED from the call sequence):

1. Pick **`Mois concerné`** (`<input type="month">`, defaults to `new Date().toISOString().slice(0,7)`).
2. Click **`Vérifier les variables du mois`** (busy label `Calcul…`) →
   fires **both** `POST /personnel/paies/lot/apercu {periode}` **and** `GET /personnel/paies/lot?periode=` in `Promise.all`.
3. Preview synthesis renders 4 tiles: **`Prêts`** (`synthese.prets`), **`À corriger`** (`synthese.aCorriger`),
   **`Déjà créés`** (`synthese.dejaGeneres`), **`Net estimé`** (`synthese.totalNet`).
4. Per-line list: `nom prenoms`, `matricule`, bullet-listed `warnings[]` (prefix `"• "`), a status pill and `Net : <amount>`.
   Line status enum → labels: `pret → "Prêt"`, `a_corriger → "À corriger"`, else `"Déjà généré"`.
5. **`Créer N brouillon(s)`** → `POST /personnel/paies/lot {periode, previewHash, confirmer:true}`.
   Alert on success: `` `${t.createdCount} bulletin(s) créé(s) en brouillon. Vérifiez-les avant validation.` ``
6. **`Valider tous les brouillons`** → `window.confirm(`Valider ensemble tous les bulletins brouillons de ${x} ?`)`
   then `PATCH /personnel/paies/lot/valider {periode, confirmer:true}`; alert `` `${t.validatedCount} bulletin(s) validé(s).` ``

**Business rules (CONFIRMED):**
- The "Créer" button is **disabled while `synthese.aCorriger > 0`**, with tooltip
  **"Corrigez les dossiers signalés avant de continuer"**.
- Batch creation is **previewHash-gated** — `previewHash` from the `apercu` response is echoed back on
  confirm (optimistic-concurrency / anti-double-submit token).
- The "Valider tous les brouillons" button only renders when `rows.some(r => r.statut === "brouillon")`.

Footer buttons: `Fermer` · `Livre de paie` · `Récapitulatif` · `Fiches complètes (1 par employé)` · `Valider tous les brouillons` · `Créer N brouillon(s)`.

### 3.8 Three **client-side** print generators (no server PDF endpoint)

All three use `window.open("", "_blank")` + `document.write(...)` + `setTimeout(()=>window.print(), 250|300)`.
**There is no server-side PDF/export endpoint for payroll in this bundle.**

**(a) "Livre de paie" / "Récapitulatif"** — same function `oe(data, isLivre)`; the boolean only toggles
whether the per-employee slip sections are appended. Table headers verbatim:
`Personnel` · `Matricule` · `Brut` · `Net` · `Charges employeur` · `Coût employeur` · `Statut`,
with a `TOTAL` row from `totals.totalBrut / totalNet / totalCotisationsEmployeur / coutTotalEmployeur`.
Sub-header: `` `Période : ${v} · ${T.length} salarié(s)` ``.

**(b) "Fiches complètes (1 par employé)"** — function `$e(data, etablissement)`, one CSS
`page-break-after` slip per employee, Ivorian statutory letterhead:
```
MINISTÈRE DE L'ÉDUCATION NATIONALE
et de l'Alphabétisation
DRENA : <drena>
<nom établissement>
<ville>, Côte d'Ivoire
                       RÉPUBLIQUE DE CÔTE D'IVOIRE
                       Union — Discipline — Travail
                       BULLETIN DE PAIE
```
Agent block: `INFORMATIONS AGENT — Période : <periode>`; rows `Nom & Prénoms`, `Matricule`,
`Poste / Emploi`, `Département`, `Type de contrat`, `Date de paiement`, `Heures travaillées`, `Statut`.
Rubric table headers: `N°` · `Désignation` · `Base` · `Taux` · `Gain` · `Ret. Sal.` · `Ret. Pat.`
Totals: `TOTAL BRUT`, `TOTAL COTISATIONS`, `390 — AVANCES SUR SALAIRE`, `Net imposable`,
`Coût total employeur`, `NET À PAYER` (` F CFA`).
Cumuls table: `Cumuls` · `Brut` · `Ch. Salariales` · `Ch. Patronales` · `Avances` · `Net à payer`.
Signatures: `Fait à <ville>, le <date>` / `Signature du Directeur` / `Signature de l'Agent`.
Footer: `` `Génération groupée · ${nom} · Lakoli` ``.

### 3.9 Payroll **rubric code → statutory number/label** table (verbatim, `l` in `index-CIUSPHL3.js`)

This is the Ivorian payslip chart of accounts. 19 codes:

| code | N° | Label |
|---|---|---|
| `salaire_base` | 10 | `SALAIRE DE BASE` |
| `sursalaire` | 20 | `SURSALAIRE` |
| `prime_anciennete` | 100 | `PRIME D'ANCIENNETÉ` |
| `prime_rendement` | 110 | `PRIMES ET INDEMNITÉS` |
| `prime_transport` | 705 | `PRIME DE TRANSPORT` |
| `retenue_absence` | 360 | `RETENUE POUR ABSENCE` |
| `avance_salaire` | 390 | `AVANCE SUR SALAIRE` |
| `autre_retenue` | 999 | `AUTRE RETENUE` |
| `irpp` | 431 | `IMPÔT / TRAITEMENTS & SALAIRES (ITS)` |
| `cnps_employe` | 440 | `C.N.P.S — Retraite (salarié)` |
| `cmu_employe` | 535 | `COTISATION CMU (employé)` |
| `cnps_employeur` | 470 | `RETRAITE GÉNÉRALE (employeur)` |
| `prestations_familiales` | 480 | `PRESTATION FAMILIALE` |
| `assurance_maternite` | 485 | `ASSURANCE MATERNITÉ` |
| `accident_travail` | 490 | `ACCIDENT DE TRAVAIL` |
| `contribution_employeur` | 500 | `PART PATRONALE IS LOCAUX` |
| `taxe_apprentissage` | 520 | `TAXE D'APPRENTISSAGE` |
| `fdfp` | 530 | `TAXE F.P.C (FDFP)` |
| `cmu_employeur` | 536 | `COTISATION CMU (employeur)` |

**Rubric line types:** `gain` | `retenue` | `patronal` (CONFIRMED — `f.filter(r=>r.type==="gain")` etc.).

**Payslip arithmetic (CONFIRMED, verbatim from source):**
```js
y = Math.max(0, brut - cnps_employe - cmu_employe)   // "Net imposable"
J = brut + patronal                                   // "Coût total employeur"
U = heures_travaillees || 173                         // default monthly hours
I = cnps_employe > 0 ? Math.round(cnps_employe / 0.063) : brut   // reconstructed CNPS base
```
- **CNPS employee rate is hard-coded at 6.3 %** in the print path (`/.063`).
- **Default monthly hours = 173.**
- Base/taux columns: `cnps_employe` shows base = reconstructed CNPS base; `irpp` shows base = net imposable.
- Employer-charge base sets: `{cnps_employeur, prestations_familiales, assurance_maternite, accident_travail}`
  use the CNPS base; `{contribution_employeur, taxe_apprentissage, fdfp}` use gross brut.

---

## 4. Page `/rh/:id` — personnel detail (`detail-B2sayMo3.js`)

Route pattern is literally `"/rh/:id"`. Back-link `/rh`. Hero eyebrow `"RH"`, H1 `nom prenoms`,
sub `matricule • poste`. Not-found state: **"Personnel non trouvé"**.

### 4.1 Tabs (verbatim, conditional)
```js
items:[ {id:"profil",     label:"Profil"},
        oe ? {id:"prestation", label:"Contrat de prestation"}
           : {id:"paies",      label:"Paies"},
        {id:"contrats",   label:"Contrats"},
        {id:"presences",  label:"Présences"} ]
```
with `oe = (typeContrat === "prestataire" || typeContrat === "benevole")`.

> **Business rule (CONFIRMED):** a `prestataire` or `benevole` **loses the Paies tab entirely** and gets
> the "Contrat de prestation" tab instead. The payslip-preview query is likewise disabled
> (`enabled: ... && n?.typeContrat !== "prestataire"`).

Tabs lazy-load: contrats query `enabled: !!id && tab==="contrats"`; prestation query
`enabled: !!id && tab==="prestation"`.

### 4.2 Tab **Profil** — 3 cards

**Card "Informations personnelles"** (label → field):
`Nom`, `Prénoms`, `Sexe` (`M → "Masculin"`, else `"Féminin"`), `Téléphone`, `Email`, `Nationalité`,
`Situation matrimoniale`, `Personne à prévenir` (rendered `` `${nom} (${telephone})` ``).

**Card "Informations professionnelles"**:
`Poste`, `Service`, `Fonction`, `Département`, `Type de contrat` (uppercased), `Date d'embauche`,
`Statut`, `Salaire brut de base`.

**Card "Dossier administratif"** + `Modifier` button:
`Numéro CNPS`, `Numéro CMU`, `Parts fiscales (IRPP)` (default `"1"`), `Banque`, `RIB`.

**Situation matrimoniale enum** (`he`) — 4 values:
```js
{celibataire:"Célibataire", marie:"Marié(e)", divorce:"Divorcé(e)", veuf:"Veuf/Veuve"}
```

**Modal "Modifier le dossier administratif"** → `PUT /personnel/{id}`. Fields (verbatim labels):
`Service`, `Fonction`, `Situation matrimoniale` (select, blank option `"—"`), `Parts fiscales`
(`type="number" step="0.5"`), `Numéro CNPS`, `Numéro CMU`, `Banque`, `RIB`, `Personne à prévenir`,
`Téléphone à prévenir`. Buttons `Annuler` / `Enregistrer` (`Enregistrement...`).

> Note the **`step="0.5"` on parts fiscales** — half-parts, matching the Ivorian IRPP quotient familial.

### 4.3 Tab **Paies**

Header `Historique des paies`; button `Générer la paie`. Empty: **"Aucune paie enregistrée pour cet agent"**.

Per-payslip card shows period as `<Mois> <année>` (French month array
`["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]`)
and inline chips: `Brut total :`, `Sursalaire : +`, `Ancienneté : +`, `Primes : +`, `IRPP : -`,
`CNPS : -`, `Avances : -`.

**Statut paie enum (3 values, CONFIRMED)** — `payee → "Payée"` (green), `validee → "Validée"` (blue),
else `brouillon → "Brouillon"` (yellow).

**State machine (CONFIRMED):** row actions are strictly conditional —
- `statut === "brouillon"` → button title **"Valider la paie"** → `PUT /personnel/{id}/paies/{paieId} {statut:"validee"}`
- `statut === "validee"` → button title **"Marquer comme payée"** → `PUT ... {statut:"payee"}`
- always → button title **"Imprimer le bulletin de paie"** (fetches `GET /personnel/{id}/paies/{id}/lignes` first, swallows errors)

There is **no transition back** from `validee`/`payee` to `brouillon` in the UI. One-way ratchet.

**Modal "Générer une fiche de paie"** → `POST /personnel/{id}/paies`.
Sub-header: `` `Agent : ${nom} ${prenoms} — Brut de base : ${u(R)}` ``.

Field groups (verbatim section headings):
- `Période *` (`type="month"`), `Heures travaillées` (placeholder `173`)
- **"Éléments de gain (s'ajoutent au brut)"** (green): `sursalaire → "Sursalaire"`,
  `primeAnciennete → "Prime d'ancienneté"`, `primes → "Autres primes / indemnités"`,
  `primeTransport → "Prime de transport"` — all `type="number" min="0" placeholder="0"`, suffix `F`
- **"Retenues salariales (déduites du net)"** (red): `retenueAbsence → "Retenue pour absence"`,
  `irpp → "IRPP (impôt sur salaire)"`, `cnpsEmploye → "CNPS part salariale"`,
  `cmuEmploye → "CMU part salariale"`, `retenues → "Autres retenues"`, `avances → "Avances sur salaire"`
- **"Charges patronales (info bulletin uniquement)"** (purple): `cnpsEmployeur → "CNPS part patronale"`,
  `cmuEmployeur → "CMU part patronale"`
- `Note interne (optionnel)` — placeholder `"Ex: Remplacement partiel, congé..."`

**Auto-calculation checkbox (verbatim, this is the key business rule):**
> **"Calcul automatique via le moteur de paie (CNPS/CMU/IRPP/ancienneté selon barèmes paramétrés)"**

Default `true`. When on, `POST /personnel/{id}/paies/apercu {sursalaire}` drives a live preview:
`NET À PAYER estimé` plus a breakdown line
`` `Ancienneté: … • CNPS employé: … • CMU: … • IRPP: …` ``.
When off, the net is computed client-side as
`brut + sursalaire + primeAnciennete + primes + primeTransport − retenueAbsence − irpp − cnpsEmploye − cmuEmploye − retenues − avances`.
Submit sends `calculAuto: <bool>` alongside every numeric field (`heuresTravaillees` defaulting to `173`).

**Individual payslip print** (function `Me`) — same statutory letterhead as §3.8b, plus rows
`N° Immatriculation CNPS` / `N° CMU` / `Date d'embauche`, an establishment logo pulled from
`/api/storage/objects/<logoObjectPath>` (fallback: embedded `armoiries-ci` asset), sub-totals
`TOTAL BRUT` / `TOTAL RETENUES` / `AVANCES SUR SALAIRE`, and a **year-to-date cumul row**
`` `Cumul ${année}` `` computed from all payslips of the same year with `periode <= current`.
Footer `Note interne : <note>` when present. Signature block is hard-coded `Fait à Abidjan`
(the batch version uses the establishment's city — a small inconsistency).

Inline rubric rows in the individual slip use slightly different numbers than the batch table:
`10 SALAIRE DE BASE`, `20 SURSALAIRE`, `100 PRIME D'ANCIENNETÉ`, `110 PRIMES ET INDEMNITÉS`,
**`120 PRIME DE TRANSPORT`** (vs 705 in batch), **`200 RETENUE POUR ABSENCE`** (vs 360 in batch),
`431 IMPÔT/TRAITEMENTS & SALAIRES (IRPP)`, `440 C.N.P.S (COTISATIONS)`, `535/536 COTISATION CMU`,
`999 AUTRES RETENUES`, then free rubric lines `L1..Ln` from `paies/{id}/lignes`.

### 4.4 Tab **Contrats de prestation** (prestataire / bénévole only)

Verbatim intro:
> **"Ce collaborateur est un prestataire : pas de bulletin de paie, juste un échéancier."**

Empty: **"Aucun contrat de prestation enregistré"**. Button `Nouveau contrat`.
Card line: `` `${montant} / ${periodicite} • Depuis le ${dateDebut}` `` + `` ` jusqu'au ${dateFin}` ``.
Status pill: `actif → "Actif"` (green) else raw value (grey).
When `statut === "actif"`: action link **`Enregistrer un paiement`** →
`POST /personnel/{id}/contrats-prestation/{contratId}/paiements {montant, datePaiement:<today>}`.

**Modal "Nouveau contrat de prestation"** → `POST /personnel/{id}/contrats-prestation`. Fields:
`Objet de la prestation`, `Montant (FCFA)` (number), `Périodicité` (select), `Date de début` (date,
default today), `Date de fin (optionnel)` (date).
**Périodicité enum (3 values):** `mensuel → "Mensuel"`, `forfaitaire → "Forfaitaire"`, `ponctuel → "Ponctuel"`.
Submit disabled unless `montant` is set.

### 4.5 Tab **Contrats** (contrats de travail)

Heading `Contrats de travail`, sub **"Historique des contrats, suspensions et résiliations"**.
Button `Nouveau contrat`. Empty state: **"Aucun contrat enregistré pour cet agent."** +
`'Cliquez sur "Nouveau contrat" pour commencer.'`

**Inline form "Créer un contrat"** → `POST /personnel/{id}/contrats`, with an amber warning banner:
> **"La création d'un nouveau contrat terminera automatiquement le contrat actif en cours."**

Fields: `Type de contrat` (select), `Date de début` (date, default today), `Date de fin prévue (facultatif)`,
`Notes` (placeholder `Remarques...`). Buttons `Annuler` / `Créer le contrat`.

**Contract type options in this form are Title-Case and differ from the personnel-level enum:**
`CDI`, `CDD`, `Stage`, `Vacataire`, `Prestataire` — note `Stage` here vs `stagiaire` on the personnel
record, and no `Bénévole`. (CONFIRMED divergence.)

**Contract status enum (3 values, snake API fields):**
`status === "active" → "Actif"` (emerald) · `"suspended" → "Suspendu"` (amber) · `"terminated" → "Terminé"` (grey, card at 60 % opacity)

Contract card also renders (API fields are snake_case here — `contract_type`, `start_date`, `end_date`,
`suspension_start`, `suspension_end`, `termination_reason`):
- **`Ancienneté nette : X an(s) Y mois`** from `ancienneteAns`/`ancienneteMois`, with the suffix
  **`" (suspension en cours déduite)"`** when `suspension_start && !suspension_end`.
- `Suspendu depuis le <date>` (amber) when suspended.
- `Fin : <termination_reason>` (red) when terminated.

**Lifecycle actions** (hidden entirely once terminated — `!M &&`):
| Button | Shown when | Call |
|---|---|---|
| `Suspendre` | status active | `POST /personnel/{id}/contrats/{cid}/suspend {}` |
| `Reprendre` | status suspended | `POST .../resume {}` |
| `Renouveler` | always (non-terminated) | `POST .../renew {}` |
| `Terminer le contrat` → inline `Motif de fin de contrat...` + `Confirmer` | always (non-terminated) | `POST .../terminate {terminationReason}` |

> **Business rule (CONFIRMED):** seniority (`ancienneté`) is computed **net of suspension periods**, and
> that seniority feeds the `prime_anciennete` payroll rubric via the `bareme-anciennete` table (§6).

### 4.6 Tab **Présences** — deliberately a hand-off, *not* an empty page

Verbatim:
> **"Les arrivées, départs, absences et missions sont regroupés dans le registre RH."**
> **"Ce registre est distinct de l'appel des élèves et des cours réalisés."**
> Button: **"Ouvrir le pointage du personnel"** → `/rh/pointages?personnelId={id}`

(The deep-link query param `personnelId` is emitted but the pointage page does not read it —
INFERRED dead parameter.)

---

## 5. Page `/rh/pointages` — Pointage du personnel (`pointages-C0oS50fn.js`)

Hero: eyebrow `Personnel & RH`, H1 **`Pointage du personnel`**, sub
> **"Enregistrez simplement les arrivées, départs, absences et missions. Les présences des élèves restent dans leur propre module."**

Header button `Ajouter un pointage`. Root `data-tour-id="ptour-staff-attendance-main"`.

**"manual_only" mode banner** (rendered when `GET /personnel/presences/jour` returns `mode:"manual_only"`):
> **"Aucun terminal n'est nécessaire pour commencer"**
> **"Le pointage manuel, les validations et le rapport mensuel restent pleinement disponibles. Une pointeuse pourra être ajoutée plus tard sans perdre cet historique."**

### 5.1 Six tabs (verbatim, `<nav aria-label="Sections du pointage">`)
| id | Label |
|---|---|
| `today` | `Aujourd'hui` |
| `manual` | `Saisie manuelle` |
| `anomalies` | `Anomalies et corrections` |
| `terminals` | `Terminaux` |
| `reports` | `Rapport mensuel` |
| `audit` | `Journal` |

### 5.2 Enumerations

**Event kinds `X` — 6 values (CONFIRMED):**
```js
[["IN","Arrivée"],["OUT","Départ"],["ABSENCE","Absence"],["MISSION","Mission"],
 ["LEAVE","Congé"],["EXIT_AUTHORIZATION","Autorisation de sortie"]]
```
`IN`/`OUT` are timed (`time` sent); the other four are day-level exceptions (`time: undefined`).

**Reason codes `W` — 10 values (CONFIRMED):**
```js
[["BADGE_FORGOTTEN","Oubli de badge"],["BADGE_LOST","Badge perdu"],
 ["DEVICE_FAILURE","Terminal en panne"],["POWER_OUTAGE","Coupure d'électricité"],
 ["INTERNET_OUTAGE","Coupure Internet prolongée"],["EXTERNAL_MISSION","Mission extérieure"],
 ["OFFSITE_ACTIVITY","Activité hors établissement"],["ADMIN_CORRECTION","Correction administrative"],
 ["CONTROL_REGULARIZATION","Régularisation après contrôle"],["OTHER","Autre"]]
```
Default on the manual form: `BADGE_FORGOTTEN`. Default on a correction request: `ADMIN_CORRECTION`.

**Daily row status → badge (function `Ie`):**
`status==="present" → "Pointé"` (emerald) · `status==="exception"` → `"En mission"` if
`exceptions[0].exception_type === "MISSION"` else `"Indisponible"` (amber) · otherwise `"À renseigner"` (slate).

**Anomaly types — 4 values (CONFIRMED):**
`MISSING_OUT → "Départ manquant"`, `OUT_WITHOUT_IN → "Départ sans arrivée"`,
`CONSECUTIVE_IN → "Deux arrivées successives"`, fallback → `"Durée de présence inhabituelle"`.
A fifth value `ADJUSTMENT_PENDING` exists and is **filtered out** of the "Autres anomalies" list
(`anomalies.filter(s => s.anomaly_type !== "ADJUSTMENT_PENDING")`).

**Validation status:** `PENDING_REVIEW` (on events and on batches). **Decision enum:** `VALIDATE` | `REJECT`.

**Audit action codes → French (function `Se`) — 10 values (CONFIRMED):**
```js
MANUAL_EVENT_CREATED        : "Pointage manuel ajouté"
DAY_EXCEPTION_CREATED       : "Absence ou mission ajoutée"
MANUAL_BATCH_SUBMITTED      : "Saisie groupée envoyée pour validation"
MANUAL_BATCH_LINE_VALIDATED : "Ligne groupée validée"
MANUAL_BATCH_LINE_REJECTED  : "Ligne groupée refusée"
MANUAL_BATCH_VALIDATED      : "Saisie groupée validée"
MANUAL_BATCH_REJECTED       : "Saisie groupée refusée"
ADJUSTMENT_REQUESTED        : "Correction demandée"
ADJUSTMENT_VALIDATED        : "Correction validée"
ADJUSTMENT_REJECTED         : "Correction refusée"
// fallback: "Action de pointage enregistrée"
```

### 5.3 Tab `Aujourd'hui`
Date picker labelled **`Journée consultée`** with `max = today` (**no future dates**). `Actualiser` button.
4 summary tiles: **`Personnel actif`**, **`Pointés`**, **`Absence / mission`**, **`Anomalies`**
(fields `summary.total / present / exceptions / anomalies`).
Row layout: name + `poste · matricule`, then `Arrivée` / `Départ` / `Durée`
(times formatted `fr-CI`, `timeZone:"Africa/Abidjan"`; duration `"{h} h {mm}"` or `"{m} min"`).
Action `Renseigner` prefills the manual form for that person.
Event chips: a `PENDING_REVIEW` event renders as non-clickable `Arrivée <hh:mm> · En attente`;
any other event renders as a button `Arrivée <hh:mm> · Corriger`.
Empty state: **"Ajoutez d'abord les membres du personnel dans le module RH."**
Error state: **"Impossible de charger le registre."** + `Réessayer`.

### 5.4 Tab `Saisie manuelle` — single entry → `POST /personnel/presences/manuel`

Verbatim intro:
> **"Le pointage manuel peut être le mode habituel de votre école. Chaque saisie reste datée et attribuée à son auteur."**

Fields: `Membre du personnel` (select, blank option `Choisir une personne`, options `nom prenoms — poste`),
`Date` (max today), `Type` (6 kinds), `Heure` (only when kind ∈ {IN, OUT}), `Motif` (10 reason codes),
`Commentaire (facultatif)` / **`Commentaire (obligatoire)` when `reasonCode === "OTHER"`**,
`maxLength: 1000`, placeholder `"Précisez la situation si nécessaire"`.

Live recap line: `` `Vous allez enregistrer : <nom prenoms> · <type> · <date> à <heure>.` ``

**Validation (CONFIRMED, exact expression):**
```js
xe = !!(personnelId && reasonCode && (!isTimed || time) && (reasonCode!=="OTHER" || comment.trim().length>=3))
```
→ **comment must be ≥ 3 characters when the reason is `OTHER`.**

**Idempotency (CONFIRMED):** the POST body carries
`` idempotencyKey: `web:${date}:${personnelId}:${kind}:${time||"day"}:${Date.now()}` ``.

Success toast: **"Le pointage a été enregistré et ajouté au journal d'audit."**
Error fallback: **"Le pointage n'a pas pu être enregistré."**

### 5.5 Sub-panel **`Saisie groupée`** (collapsible `<details>`, badge **`Prévisualisation obligatoire`**)

Verbatim rule:
> **"Sélectionnez les personnes concernées. Une seule confirmation créera toutes les lignes, ou aucune si l'une d'elles est invalide."**

Common fields: `Date commune`, `Type commun`, `Heure commune` (timed kinds only), `Motif commun`,
`Commentaire`. Roster with `Tout sélectionner` / `Tout désélectionner`, and a **per-person time override**
input (`aria-label="Heure particulière pour <nom> <prenoms>"`).

Two-phase call, both to `POST /personnel/presences/manuel/lot`:
1. `{mode:"preview", date, entries[], idempotencyKey:"web-bulk:<date>:<uuid>"}`
2. `{mode:"confirm", date, entries[], previewHash, idempotencyKey:<same key>}`

Preview banner: `` `${totalRecords} ligne(s) prêtes à être envoyées pour validation` `` (emerald) or
**"La saisie ne peut pas encore être confirmée"** (red) + bulleted `issues[].message` keyed by `code`+`personnelId`.
Buttons `Prévisualiser (N)` and `Envoyer toutes les lignes` (only when `preview.ready`).

Success message (verbatim, this states the four-eyes rule):
> **`${s.totalRecords} ligne(s) ont été enregistrées ensemble. Une autre personne habilitée doit maintenant les valider.`**

Any mutation of a common field or the roster **invalidates the preview** (`f()` resets it to null) —
you cannot confirm a stale hash.

### 5.6 Tab `Anomalies et corrections` — three stacked panels

**(a) Correction request form** ("Demander une correction", opened from a `Corriger` chip):
Fields `Date proposée` (max today), `Heure proposée`, `Type proposé` (only `Arrivée`/`Départ`),
`Motif` (10 codes), **`Pourquoi faut-il corriger ?`** (textarea, maxLength 1000,
placeholder `"Ex. l'heure saisie ne correspond pas au justificatif"`).
Amber notice, verbatim:
> **"Le pointage original restera visible. La proposition ne sera utilisée qu'après la validation d'une autre personne habilitée."**

Submit `Envoyer pour validation`, **disabled while `comment.trim().length < 3`** →
`POST /personnel/presences/ajustements`.
Success: **"La correction a été envoyée. Une autre personne habilitée doit maintenant la vérifier."**

**(b) "Saisies groupées à valider"** — from `GET /personnel/presences/manuel/lots?status=PENDING_REVIEW`
Sub-heading, verbatim:
> **"Chaque ligne conserve son auteur et sa preuve. Le créateur du lot ne peut pas prendre la décision."**
Per-batch line: `` `${total_records} ligne(s) · <date longue fr-CI>` ``, `Saisie par <creator_nom> <creator_prenoms>`.
Atomicity notice, verbatim:
> **"Toutes les lignes seront validées ou refusées ensemble. Aucune écriture partielle n'est possible."**
Badge when you are the author: **`Validation par un collègue requise`**.
Decision textarea placeholder: **`Commentaire de décision (obligatoire pour refuser)`**.
Buttons `Refuser le lot` / `Valider tout le lot` → `PATCH /personnel/presences/manuel/lots/{id}/decision {decision, comment}`.
Empty: **"Aucune saisie groupée n'attend de validation."**
Success copy: VALIDATE → **"Le lot a été validé et les journées concernées ont été recalculées."**;
REJECT → **"Le lot a été refusé. Toutes ses lignes restent visibles dans le journal."**

**(c) "Corrections à vérifier"** — from `GET /personnel/presences/anomalies?date=` → `pendingAdjustments[]`
Sub-heading, verbatim:
> **"Le demandeur ne peut jamais décider sur sa propre correction."**
Side-by-side comparison: **`Pointage original`** (`original_event_type`, `original_occurred_at`,
`Source conservée : <original_source_type>`) vs **`Correction proposée`** (`proposed_value.eventType`,
`proposed_value.occurredAt`, requester comment).
Badge when you are the requester: **`Décision par un collègue requise`**.
Buttons `Refuser` / **`Valider et recalculer`** → `PATCH /personnel/presences/ajustements/{id}/decision`.
Success copy: VALIDATE → **"La correction a été validée et les heures ont été recalculées."**;
REJECT → **"La correction a été refusée. Le pointage original reste retenu."**
Empty: **"Aucune correction n'attend de validation."**

**(d) "Autres anomalies détectées"** — sub-heading verbatim:
> **"Départs manquants, passages incohérents ou durées inhabituelles."**
Empty: **"Aucune autre anomalie pour cette date."**

**Four-eyes enforcement (CONFIRMED, exact expressions):**
```js
// batches
const t = Number(s.created_by)   === Number(user?.id);   // disables textarea + both buttons
// adjustments
const t = Number(s.requested_by) === Number(user?.id);
// REJECT additionally requires
disabled: t || pending || (comment[s.id]||"").trim().length < 3
```
→ **rejection always requires a ≥ 3-character comment; validation does not.**

### 5.7 Tab `Terminaux`
`GET /personnel/presences/terminaux` → `{terminals:[{id,label,status}]}`, rendered `**label** · status`.
Empty state, verbatim:
> **"Aucun terminal n'est installé. Vous pouvez utiliser la saisie manuelle et les rapports dès maintenant."**
> Buttons: `Faire un pointage manuel` · `Voir le rapport mensuel`
> Footnote: **"La connexion EBKN sera activée séparément après validation de la documentation technique du fabricant."**

> **Surprise:** the product has a named hardware-integration roadmap item — **EBKN** biometric/badge
> time-clock terminals — with an explicit "pending manufacturer documentation" caveat.

### 5.8 Tab `Rapport mensuel`
`Mois du rapport` (`type="month"`, `max = current month`) + `Actualiser`.
Banner when `mode === "manual_only"`, verbatim:
> **"Rapport produit à partir des saisies manuelles validées. Aucun terminal n'est requis."**
4 tiles: **`Personnel pointé`** (`summary.personnel_recorded`), **`Sessions validées`** (`summary.sessions`),
**`Heures de présence`** (`Math.round(summary.total_minutes/60)`), **`Absences / missions`** (`summary.exceptions`).
Detail block heading `Détail par membre du personnel`, sub — verbatim, a hard business rule:
> **"Seules les sessions validées sont comptabilisées."**
Rows: `nom prenoms`, `poste · matricule`, `N jour(s)`, formatted duration.
Empty: **"Aucun membre du personnel actif."** Error: **"Impossible de charger le rapport mensuel."**

### 5.9 Tab `Journal`
Heading `Journal du pointage`, sub — verbatim:
> **"Historique non destructif des saisies et décisions RH."**
Rows: `<action label> — <personnel_nom> <personnel_prenoms>` and
`Par <actor_nom> <actor_prenoms> · <date fr-CI medium/short>`.
Empty: **"Aucune action de pointage enregistrée."**

---

## 6. Page `/parametres/rh` — "RH & Paie — Barèmes Côte d'Ivoire" (`rh-C0NIV5Bw.js`)

Hero (back-link to `/parametres`): eyebrow `Paramètres`, H1 **`RH & Paie — Barèmes Côte d'Ivoire`**, sub
> **"Taux CNPS/CMU/IRPP préchargés selon la réglementation ivoirienne, entièrement modifiables."**

**Amber banner — the single most important payroll business rule, verbatim:**
> **"Toute modification s'applique uniquement aux _futurs bulletins générés_. Les bulletins déjà validés ou payés ne sont jamais recalculés rétroactivement."**

### 6.1 Paramètres de paie — `GET/PUT /rh/parametres-paie[/{id}]`
Grouped by `categorie`, label map `T` — **4 categories**:
```js
{cnps:"CNPS", cmu:"CMU", charges_patronales:"Charges patronales", general:"Général"}
```
Row = `libelle` + inline-editable `valeur`. A `%` suffix is appended when
`cle.includes("taux") || cle.includes("part")` (so parameter keys follow a `*_taux_*` / `*_part_*`
naming convention — INFERRED from that test). Rows with `modifiable === false` render read-only
(`valeurTexte ?? valeur`). Body sent: `{valeur}`.

Inline editor: `<input type="number" step="0.01">`, **Enter saves, Escape cancels**, plus check/×buttons.

### 6.2 Barème IRPP — `GET/PUT /rh/bareme-irpp[/{id}]`
Card title **`Barème IRPP (impôt progressif sur salaire)`**.
Columns: **`Tranche min`** · **`Tranche max`** · **`Taux`**.
`trancheMin`/`trancheMax` formatted `fr-FR` + `" FCFA"`; a null `trancheMax` renders **`et plus`**
(open-ended top bracket). Only `taux` is editable; body `{taux}`.

### 6.3 Barème prime d'ancienneté — `GET/PUT /rh/bareme-anciennete[/{id}]`
Card title **`Barème prime d'ancienneté`**.
Columns: **`Années d'ancienneté`** · **`Taux appliqué`**.
Row renders `` `${anneeMin} à ${anneeMax ?? "∞"} ans` `` — null `anneeMax` = open-ended.
Only `tauxPourcent` editable; body `{tauxPourcent}`.

### 6.4 Rubriques de paie — `GET/PUT /rh/rubriques[/{id}]`
Rendered as **three cards, one per type**, in this fixed order:
```js
["gain","retenue","patronal"] → "Rubriques — Gains" | "Rubriques — Retenues" | "Rubriques — Charges patronales"
```
Each row: `libelle` + a meta line built from three booleans (verbatim):
- `imposable ? "Imposable" : "Non imposable"`
- `soumisCnps ? "Soumis CNPS" : "Hors CNPS"`
- `systeme && " · Rubrique système"`

Toggle `Active` = `<input type="checkbox" checked={actif} disabled={systeme}>` → `PUT {actif}`.

> **Business rule (CONFIRMED):** `systeme: true` rubrics are **locked** — the school cannot deactivate
> the statutory rubrics (CNPS/CMU/IRPP etc.), only its own custom ones.

Loading state for the whole page: `"Chargement..."` (spinner).

---

## 7. Consolidated status / enum inventory

| Enum | Values | Source |
|---|---|---|
| Statut personnel | `actif` \| `suspendu` \| `en_conge` \| `sorti` | index-CIUSPHL3 |
| Type de contrat (personnel) | `cdi` \| `cdd` \| `vacataire` \| `stagiaire` \| `benevole` \| `prestataire` | index-CIUSPHL3 |
| Département | `direction` \| `enseignement` \| `administration` \| `comptabilite` \| `surveillance` \| `entretien` \| `cantine` \| `securite` \| `autre` | index-CIUSPHL3 |
| Rôle Lakoli | `enseignant` \| `permanent` \| `scolarite` \| `comptable` \| `caissier` \| `direction` \| `auditeur` (+ `super_admin` in RBAC arrays) | index-CIUSPHL3 / lakoli-main |
| Niveau d'accès | `tous` \| `primaire` \| `secondaire` | index-CIUSPHL3 |
| Statut paie | `brouillon` \| `validee` \| `payee` | detail-B2sayMo3 |
| Statut ligne d'aperçu de lot | `pret` \| `a_corriger` \| (3rd → "Déjà généré", INFERRED code `deja_genere`) | index-CIUSPHL3 |
| Type de ligne de paie | `gain` \| `retenue` \| `patronal` | index-CIUSPHL3 / rh-C0NIV5Bw |
| Catégorie de paramètre de paie | `cnps` \| `cmu` \| `charges_patronales` \| `general` | rh-C0NIV5Bw |
| Contract status | `active` \| `suspended` \| `terminated` | detail-B2sayMo3 |
| Contract type (form) | `CDI` \| `CDD` \| `Stage` \| `Vacataire` \| `Prestataire` | detail-B2sayMo3 |
| Périodicité prestation | `mensuel` \| `forfaitaire` \| `ponctuel` | detail-B2sayMo3 |
| Statut contrat de prestation | `actif` (+ raw fallback) | detail-B2sayMo3 |
| Situation matrimoniale | `celibataire` \| `marie` \| `divorce` \| `veuf` | detail-B2sayMo3 |
| Attendance event kind | `IN` \| `OUT` \| `ABSENCE` \| `MISSION` \| `LEAVE` \| `EXIT_AUTHORIZATION` | pointages |
| Attendance reason code | `BADGE_FORGOTTEN` \| `BADGE_LOST` \| `DEVICE_FAILURE` \| `POWER_OUTAGE` \| `INTERNET_OUTAGE` \| `EXTERNAL_MISSION` \| `OFFSITE_ACTIVITY` \| `ADMIN_CORRECTION` \| `CONTROL_REGULARIZATION` \| `OTHER` | pointages |
| Attendance day status | `present` \| `exception` \| (else "À renseigner") | pointages |
| Anomaly type | `MISSING_OUT` \| `OUT_WITHOUT_IN` \| `CONSECUTIVE_IN` \| `ADJUSTMENT_PENDING` \| (else unusual duration) | pointages |
| Validation status | `PENDING_REVIEW` | pointages |
| Decision | `VALIDATE` \| `REJECT` | pointages |
| Batch mode | `preview` \| `confirm` | pointages |
| Attendance page mode | `manual_only` (+ implied terminal mode) | pointages |
| Audit action | 10 codes, see §5.2 | pointages |
| `rhLinkStatus` (cross-domain) | `linked` \| `auto_linkable` \| `missing` \| `ambiguous` \| `inactive` | index-Bjy9iJVc |

---

## 8. Complete form-field inventory (HR domain)

**`POST /personnel`** — `nom`, `prenoms`, `poste`, `telephone`, `departement`, `typeContrat`,
`salaireBrut`, `creerAcces`, `email`, `motDePasse`, `role`, `niveauAcces`

**`PUT /personnel/{id}`** (dossier administratif) — `service`, `fonction`, `situationMatrimoniale`,
`numeroCnps`, `numeroCmu`, `partsFiscales`, `banque`, `rib`, `personneAPrevenirNom`,
`personneAPrevenirTelephone`

**`POST /personnel/{id}/paies`** — `periode`, `heuresTravaillees` (default 173), `calculAuto`,
`sursalaire`, `primeAnciennete`, `primes`, `primeTransport`, `retenueAbsence`, `irpp`, `cnpsEmploye`,
`cnpsEmployeur`, `cmuEmploye`, `cmuEmployeur`, `retenues`, `avances`, `note`

**`POST /personnel/{id}/contrats`** — `contractType`, `startDate`, `endDate?`, `notes?`
**`POST .../terminate`** — `terminationReason`
**`POST .../suspend` / `.../resume` / `.../renew`** — empty body `{}`

**`POST /personnel/{id}/contrats-prestation`** — `objet`, `montant`, `periodicite`, `dateDebut`, `dateFin?`, `notes?`
**`POST .../paiements`** — `montant`, `datePaiement`

**`POST /personnel/paies/lot/apercu`** — `periode`
**`POST /personnel/paies/lot`** — `periode`, `previewHash`, `confirmer:true`
**`PATCH /personnel/paies/lot/valider`** — `periode`, `confirmer:true`

**`POST /personnel/presences/manuel`** — `personnelId`, `date`, `kind`, `time?`, `reasonCode`, `comment`, `idempotencyKey`
**`POST /personnel/presences/manuel/lot`** — `mode`, `date`, `entries[{personnelId,kind,time?,reasonCode,comment}]`, `previewHash?`, `idempotencyKey`
**`POST /personnel/presences/ajustements`** — `eventId`, `personnelName`, `originalOccurredAt`, `date`, `time`, `eventType`, `reasonCode`, `comment`
**`PATCH .../decision`** (both flavours) — `decision`, `comment`

**`PUT /rh/parametres-paie/{id}`** `{valeur}` · **`PUT /rh/bareme-irpp/{id}`** `{taux}` ·
**`PUT /rh/bareme-anciennete/{id}`** `{tauxPourcent}` · **`PUT /rh/rubriques/{id}`** `{actif}`

---

## 9. Business rules extracted from French UI copy (all CONFIRMED verbatim)

1. **"Toute modification s'applique uniquement aux futurs bulletins générés. Les bulletins déjà validés ou payés ne sont jamais recalculés rétroactivement."** — payroll parameter changes are non-retroactive.
2. **"Lakoli calcule d'abord un aperçu. Aucun bulletin n'est validé ou payé automatiquement."** — preview-first payroll.
3. **"Corrigez les dossiers signalés avant de continuer"** + button disabled while `aCorriger > 0` — batch payroll is blocked by any flagged record.
4. **"La création d'un nouveau contrat terminera automatiquement le contrat actif en cours."** — single active contract invariant.
5. **"Ancienneté nette : … (suspension en cours déduite)"** — seniority is net of suspensions.
6. **"Ce collaborateur est un prestataire : pas de bulletin de paie, juste un échéancier."** — contractors are excluded from payroll.
7. **"Calcul automatique via le moteur de paie (CNPS/CMU/IRPP/ancienneté selon barèmes paramétrés)"** — a real parametric payroll engine exists server-side.
8. **"Une autre personne habilitée doit maintenant les valider."** / **"Le créateur du lot ne peut pas prendre la décision."** / **"Le demandeur ne peut jamais décider sur sa propre correction."** — enforced four-eyes principle across bulk entry and corrections.
9. **"Toutes les lignes seront validées ou refusées ensemble. Aucune écriture partielle n'est possible."** — atomic batch decisions.
10. **"Une seule confirmation créera toutes les lignes, ou aucune si l'une d'elles est invalide."** — all-or-nothing bulk insert.
11. **"Le pointage original restera visible. La proposition ne sera utilisée qu'après la validation d'une autre personne habilitée."** — non-destructive corrections; original event retained (`Source conservée : <source_type>`).
12. **"Historique non destructif des saisies et décisions RH."** — append-only attendance audit log.
13. **"Seules les sessions validées sont comptabilisées."** — monthly hours report counts validated sessions only.
14. **"Les présences des élèves restent dans leur propre module."** / **"Ce registre est distinct de l'appel des élèves et des cours réalisés."** — staff attendance and student attendance are deliberately separate registers.
15. **"Aucun terminal n'est nécessaire pour commencer… Une pointeuse pourra être ajoutée plus tard sans perdre cet historique."** — hardware-optional design with forward-compatible history.
16. **"La connexion EBKN sera activée séparément après validation de la documentation technique du fabricant."** — named terminal vendor on roadmap.
17. **"Utile uniquement si cette personne doit se connecter au logiciel."** — HR record and Lakoli login account are decoupled; account creation is opt-in at hire time.
18. **"Communiquez-le directement à la personne. Il n'est jamais affiché ensuite."** — temporary password is write-once, min 8 chars.
19. **"À renouveler dans 60 jours"** — contract-expiry warning horizon = 60 days.
20. Comment ≥ 3 chars required for `reasonCode === "OTHER"` and for every **REJECT** decision.
21. All attendance date pickers are capped at `max = today` — **no future-dated pointage**.
22. `systeme` rubrics cannot be deactivated (checkbox `disabled`).
23. Payslip statut transitions are one-way: `brouillon → validee → payee`; no UI path back.

---

## 10. Workflows (ordered, CONFIRMED)

**W1 — Monthly batch payroll (`/rh`)**
`Choisir le mois` → `Vérifier les variables du mois` (apercu + existing lot) → review
`Prêts / À corriger / Déjà créés / Net estimé` + per-line warnings → `Créer N brouillon(s)` (previewHash)
→ `Valider tous les brouillons` (confirm dialog) → print `Livre de paie` / `Récapitulatif` / `Fiches complètes`.

**W2 — Individual payslip (`/rh/:id` → Paies)**
`Générer la paie` → period + hours + gains/retenues/patronales (or auto-calc) → live `NET À PAYER estimé`
→ `Générer la paie` → row `Brouillon` → `Valider la paie` → `Validée` → `Marquer comme payée` → `Payée`;
`Imprimer le bulletin de paie` at any stage.

**W3 — Contract lifecycle (`/rh/:id` → Contrats)**
`Créer un contrat` (auto-terminates the previous active one) → `Actif`
→ `Suspendre` → `Suspendu` → `Reprendre` → `Actif`
→ `Renouveler` (in place) — or → `Terminer le contrat` + motif → `Terminé` (all actions then hidden).

**W4 — Contractor (prestataire/bénévole)**
`Nouveau contrat de prestation` (objet, montant, périodicité, dates) → `Actif`
→ `Enregistrer un paiement` (repeatable, dated today). No payslip is ever produced.

**W5 — Manual attendance, single**
`Ajouter un pointage` → person + date + kind + time + reason + comment → `Enregistrer`
(idempotency key) → back to `Aujourd'hui`.

**W6 — Manual attendance, bulk (four-eyes)**
`Saisie groupée` → common fields + roster (+ per-person time overrides) → `Prévisualiser`
→ `Envoyer toutes les lignes` (previewHash) → batch enters `PENDING_REVIEW`
→ **a different user** opens `Anomalies et corrections` → `Valider tout le lot` / `Refuser le lot` (comment ≥3)
→ days recalculated.

**W7 — Attendance correction (four-eyes)**
On a day row, click an event chip `Corriger` → propose date/heure/type/motif + justification (≥3 chars)
→ `Envoyer pour validation` → appears in `Corrections à vérifier`
→ **a different user** → `Valider et recalculer` / `Refuser` → original event preserved either way.

**W8 — Payroll parameterisation (`/parametres/rh`)**
Edit paramètres (CNPS/CMU/charges patronales/général) → IRPP brackets → seniority brackets →
activate/deactivate custom rubrics. Applies to future payslips only.

**W9 — Hire (`/rh`)**
`Nouveau personnel` → identity + poste + département + type de contrat + salaire brut
→ optionally `Créer aussi son accès Lakoli` (email + rôle + cycle accessible + mot de passe ≥8)
→ `Enregistrer` → row appears sorted `fr-CI`.

---

## 11. Cross-domain touch points & corrections to the shallow audit

**`/conformite` is NOT a placeholder.** `index-Ddm3x_E9.js` implements it with 10 operations
(`GET /conformite/executions`, `/executions/{id}`, `/imports/profile`, `/profiles`;
`POST /conformite/executions`, `/executions/{id}/generate`, `/executions/{id}/validate`, `/imports`;
`PATCH /conformite/executions/{id}/responses`, `/imports/{id}/anomalies/{id}`).
It renders **official statistical forms** with a field-label dictionary that includes HR fields:
```js
personnelActifLakoli : "Personnel actif Lakoli"
couverturePointage   : "% pointage saisi"
fonction             : "Fonction"
besoinsPremierCycle  : "Besoins 1er cycle"
besoinsSecondCycle   : "Besoins 2nd cycle"
```
alongside `etablissement`, `drenet_ddenet`, `iepp`, `chef_etablissement`, `annee_scolaire`,
`date_reference`, `classesDoubleVacation`, `redoublantsProbables`, etc. Answers are typed
(`text` / `integer` / `object` / `table`) with validation messages such as
**"Un entier est attendu."**, **"Le tableau doit commencer par [ et finir par ]."**,
**"L'objet doit commencer par { et finir par }."**
→ **HR headcount and pointage-coverage are inputs to a statutory reporting pipeline.** That is a real,
non-obvious capability the shallow audit missed entirely.

**Teacher ↔ HR record linkage** (`index-Bjy9iJVc.js`, `/affectations-enseignants`):
`rhLinkStatus ∈ {linked, auto_linkable, missing, ambiguous, inactive}` with verbatim copy
- `"Fiche RH non liée · Ouvrir Personnel"` (link to `/rh`)
- `"Créez une fiche RH avec la même adresse e-mail avant de poursuivre."`
- `"Plusieurs fiches RH partagent cette adresse e-mail. Corrigez les doublons avant de poursuivre."`
- `"La fiche RH correspondante est inactive. Réactivez-la avant de poursuivre."`
- `" — RH à lier"` suffix in the teacher picker
Assignment save is blocked unless `["linked","auto_linkable"].includes(rhLinkStatus)`.
→ **email is the join key between the teacher record and the HR record.**

**Other consumers of the personnel table:**
- `activites-DfOC8o0u.js` — clubs carry `responsablePersonnelId` (`POST /vie-scolaire/activites/clubs`).
- `index-DEgXnv6X.js` — exam supervision picks `surveillants` from active personnel;
  empty state: `"Aucun surveillant actif disponible. Vérifiez le personnel actif ou le périmètre de cycles."`
- `index-DxBtz_yd.js` — canteen expense category enum includes `personnel:"Personnel"`.
- `index-Bb1qhKZd.js` — fee-reduction motives include `enfant_enseignant` ("Enfant d'enseignant") and
  `personnel_admin` ("Enfant du personnel" / "Enfant de membre du personnel non-enseignant").
- `detail-B2sayMo3.js` / `index-CIUSPHL3.js` — both payslip printers read `GET /etablissement`
  for `nom`, `ville`, `drena`, `logoObjectPath`.

---

## 12. Notable gaps / observations (analytical, marked as such)

- **No leave-request workflow.** `LEAVE` exists only as a day-exception kind on the pointage form and
  `en_conge` as a personnel status. There is no leave balance, no leave request/approval endpoint,
  no `conges` API root anywhere in the bundle. (INFERRED from exhaustive absence.)
- **No DELETE anywhere in HR.** Deactivation only.
- **No server-side payroll export.** All three payroll documents and the individual payslip are
  built in the browser with `document.write` + `window.print()`. No PDF endpoint, no bank-transfer file,
  no CNPS/CMU declaration export.
- **Two divergent payslip rubric numberings** between the batch printer (`prime_transport = 705`,
  `retenue_absence = 360`) and the individual printer (`120`, `200`) — a real inconsistency.
- **CNPS employee rate 6.3 % is hard-coded** in the batch printer's base-reconstruction
  (`Math.round(cnps_employe / .063)`) even though the rate is otherwise a configurable
  `/rh/parametres-paie` value. Editing the parameter would desync the printed "Base" column.
- **`Fait à Abidjan`** is hard-coded in the individual payslip footer while the batch payslip uses the
  establishment's actual `ville`.
- **Contract expiry never reaches the alert engine** — zero "contrat" hits in `alertes-*.js` / `dashboard-*.js`.
- **`/rh` and `/rh/:id` have no route-level `allowedRoles`** while `/rh/pointages` does; access control on
  the personnel list/detail relies on sidebar filtering plus (presumably) server-side authorisation.
- **`?personnelId=` deep link** emitted by the Présences tab is never consumed by the pointage page.
