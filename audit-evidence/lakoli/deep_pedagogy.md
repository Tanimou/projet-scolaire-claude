# Lakoli — Deep Evidence: PEDAGOGY domain

**Method.** Static reverse-engineering of the shipped Vite build: 149 minified chunks
(`scratchpad/chunks/*.js`, ~3.7 MB concatenated) + entry bundle `lakoli-main.js` (733 KB).
No UI was driven; every claim below is anchored to a string or code fragment physically
present in the bundle.

**Legend.** `CONFIRMED` = literal string / code fragment found in the bundle (quoted verbatim).
`INFERRED` = deduced from surrounding code, marked explicitly.

**Working files (absolute):**
- Corpus: `C:\Users\HP\AppData\Local\Temp\claude\C--Users-HP-Downloads-pilotage-scolaire-claude--claude-worktrees-youthful-chaum-6aad5c\f222c175-b104-487a-9fac-11f5158eb4f9\scratchpad\chunks\`
- Entry bundle: `...\scratchpad\lakoli-main.js`
- Endpoint list: `...\scratchpad\lakoli-endpoints.txt`

---

## 0. Executive corrections to the earlier shallow audit

| Shallow claim | Reality from the bundle |
|---|---|
| "Lakoli has ~15 API endpoints" | **98 distinct operations in the pedagogy domain alone** (see §1). The extracted global list has 339 lines and is itself *incomplete* — it misses every `getBlob()` download endpoint and every query-string-built GET (e.g. `GET /emploi-du-temps/conflits`, `GET /pedagogie/evaluations/pilotage`, `GET /suivi-enseignants/exports/{type}`). |
| "/app/programmes renders nothing / is blank" | **False.** `/programmes` is the page **« Grilles de programme »** (chunk `index-CFewQxy_.js`, 13.4 KB) with the sub-title *"Programme ivoirien pré-chargé par niveau"* and a banner *"Référentiel officiel actif"*. It has exactly **5 operations** (`GET /programmes`, `POST /programmes/confirmer`, `POST /programmes/reinitialiser`, `POST /programmes/{id}/matieres/ajouter`, `PUT /programmes/{id}/matieres`) — matching the "5 operations" figure. It renders a per-cycle grid of subjects with coefficients, an inline "add subject" row, a bulk "Modifier la liste complète" editor, a cycle filter, and a "Charger les grilles par défaut" seeding action. See §7. |
| "/app/conformite is a coming-soon placeholder" | Out of my domain (chunk `index-Ddm3x_E9.js`), but the bundle contradicts the claim: a real nav entry exists — `{name:"Conformité",path:"/conformite",…,roles:jt,gatedModule:"conformite"}` — plus a full guided tour (`id=compliance-center`) and 4 GET roots (`/conformite/executions`, `/conformite/executions/{id}`, `/conformite/imports/profile`, `/conformite/profiles`). It is **module-gated**, which is very likely what the shallow pass mistook for "coming soon". |
| "Never opened tabs / modals / Nouveau… forms" | Recovered below: 5 presence tabs, 3-step CIO export stepper, and full field inventories for the *Nouvelle période*, *Créer une évaluation*, *Nouvelle séance* (cahier de textes), *Planifier une séance*, *Nouveau créneau*, *Gérer les salles*, *Nouvelle classe*, *Nouvelle matière*, *Nouvel événement*, *Nouvelle année scolaire*, and *Émarger le cours* modals. |
| (new finding, missed entirely) | Lakoli ships a **real offline write-queue** (IndexedDB, 100-op cap, 30-day retention, 409-conflict payloads) covering note entry and attendance. See §14. |
| (new finding, missed entirely) | The bundle embeds a **62-page in-product guided-tour corpus** with long French descriptions that state business rules explicitly. It is the single richest requirements source in the artefact. See §15. |

---

## 1. API surface — pedagogy domain (98 distinct operations) — CONFIRMED

Extracted by regex over `.get|.getBlob|.post|.put|.patch|.delete("…")` across all 150 files,
query strings stripped, `${…}` collapsed to `{id}`.

### 1.1 Années scolaires (5)
```
GET    /annees-scolaires                       [fin-annee, index-CGYPRsFk, index-cRnMt47W, index-Ddm3x_E9, +5]
GET    /annees-scolaires/active                [20 chunks — the most-called endpoint in the app]
POST   /annees-scolaires                       [index-CGYPRsFk.js]
PUT    /annees-scolaires/{id}                  [index-CGYPRsFk.js]
PATCH  /annees-scolaires/{id}/activer          [index-CGYPRsFk.js]
```

### 1.2 Classes (6)
```
GET    /classes                                [index-pRAKLIxG, campagnes, nouvelle-3Y8GKgoA, preinscriptions, …]
POST   /classes                                [index-pRAKLIxG.js]
PUT    /classes/{id}                           [index-pRAKLIxG.js]
DELETE /classes/{id}                           [index-pRAKLIxG.js]
POST   /classes/{id}/dupliquer                 [index-pRAKLIxG.js]
POST   /classes/dupliquer                      [nouvelle-SJQXCeYE.js]   ← bulk "classes standards"
```
Observed query params on `GET /classes`: `anneeScolaireId`, `niveauInterface`, `all=1`,
`usage=presences`. The `usage=presences` variant (CONFIRMED, `alertes-CZg_3Sf0.js`) returns only
classes the caller may take attendance for — server-side ABAC, not client filtering.

### 1.3 Programmes / grilles (5)
```
GET    /programmes                             [index-CFewQxy_.js]
POST   /programmes/confirmer                   [index-CFewQxy_.js]
POST   /programmes/reinitialiser               [index-CFewQxy_.js]
POST   /programmes/{id}/matieres/ajouter       [index-CFewQxy_.js]
PUT    /programmes/{id}/matieres               [index-CFewQxy_.js]
```

### 1.4 Matières (4)
```
GET    /pedagogie/matieres                     [index-D9qIb0I-.js]  (+ ?classeId= variant)
POST   /pedagogie/matieres                     [index-D9qIb0I-.js]
PUT    /pedagogie/matieres/{id}                [index-D9qIb0I-.js]
DELETE /pedagogie/matieres/{id}                [index-D9qIb0I-.js]
```

### 1.5 Périodes d'évaluation (9)
```
GET    /pedagogie/periodes                     [index-BwE_tiBb.js]  (+ ?anneeScolaireId&classeId)
POST   /pedagogie/periodes                     [index-BwE_tiBb.js]
PUT    /pedagogie/periodes/{id}                [index-BwE_tiBb.js]
DELETE /pedagogie/periodes/{id}                [index-BwE_tiBb.js]
GET    /pedagogie/periodes/{id}/pre-cloture-check
POST   /pedagogie/periodes/{id}/cloture
POST   /pedagogie/periodes/{id}/re-cloture
POST   /pedagogie/periodes/{id}/re-ouvrir
PUT    /pedagogie/periodes/ponderation-annuelle
```
Adjacent: `GET /generation-jobs/{id}` polled every 2 s from the périodes page while a bulletin
batch is generating (CONFIRMED: `refetchInterval:t=>{const s=t.state.data?.statut;return p&&!["succeeded","failed"].includes(s)?2e3:!1}`).

### 1.6 Évaluations & notes (11)
```
GET    /pedagogie/evaluations                                 (?classeId&periodeId&matiereId)
POST   /pedagogie/evaluations
PATCH  /pedagogie/evaluations/{id}
POST   /pedagogie/evaluations/{id}/publish
GET    /pedagogie/evaluations/{id}/scores
PUT    /pedagogie/evaluations/{id}/scores
GET    /pedagogie/evaluations/pilotage                        (?periodeId)
GET    /pedagogie/evaluations/examens-blancs/statistiques     (?periodeId)
GET    /pedagogie/evaluations/statistiques                    (?periodeId&classeId)
GET    /pedagogie/evaluations/export-cio                      (?periodeId&classeId&profil&format)  ← blob
GET    /pedagogie/evaluations/export-cio/history              (?periodeId&classeId)
GET    /pedagogie/notes                                       (?classeId&periodeId&limit=2000 | ?eleveId)
```

### 1.7 Bulletins & classement (4)
```
GET    /pedagogie/bulletin/{eleveId}/{periodeId}
GET    /pedagogie/bulletins-classe/{classeId}/{periodeId}
GET    /pedagogie/bulletins-eleve/{eleveId}
GET    /pedagogie/bulletins-registre               (?periodeId&classeId)
GET    /pedagogie/classement/{classeId}/{periodeId}
```

### 1.8 Cahier de textes (6)
```
GET    /pedagogie/cahier-textes                     (?anneeScolaireId&…)
GET    /pedagogie/cahier-textes/options
GET    /pedagogie/cahier-textes/{id}/historique
POST   /pedagogie/cahier-textes
PUT    /pedagogie/cahier-textes/{id}
POST   /pedagogie/cahier-textes/{id}/soumettre
POST   /pedagogie/cahier-textes/{id}/visa
```

### 1.9 Planification des évaluations / compositions (9)
```
GET    /pedagogie/planification-evaluations                       (?anneeScolaireId)
GET    /pedagogie/planification-evaluations/options
POST   /pedagogie/planification-evaluations
PUT    /pedagogie/planification-evaluations/{id}
PATCH  /pedagogie/planification-evaluations/{id}/statut
PATCH  /pedagogie/planification-evaluations/{id}/convocation
POST   /pedagogie/planification-evaluations/{id}/notifications/sms
GET    /pedagogie/planification-evaluations/{id}/notifications/preview
GET    /pedagogie/planification-evaluations/{id}/documents/{type}   ← blob; type ∈ {emargement, pv-surveillance}
```

### 1.10 Examens nationaux (3)
```
GET    /pedagogie/examens-nationaux         (?anneeScolaireId)
POST   /pedagogie/examens-nationaux
POST   /pedagogie/examens-nationaux/{id}/valider
```

### 1.11 Emploi du temps (9)
```
GET    /emploi-du-temps                       (?…)
GET    /emploi-du-temps/options               (?niveauInterface&anneeScolaireId)
GET    /emploi-du-temps/conflits              (?anneeScolaireId&niveauInterface)
POST   /emploi-du-temps
PUT    /emploi-du-temps/{id}
DELETE /emploi-du-temps/{id}
GET    /emploi-du-temps/salles
POST   /emploi-du-temps/salles
PATCH  /emploi-du-temps/salles/{id}/statut
```

### 1.12 Présences élèves (7)
```
GET    /presences                             (?classeId&date&session[&creneauId])
GET    /presences/eleves                      (?classeId&date&session…)
POST   /presences
GET    /presences/stats
GET    /presences/retards                     (?debut&fin&niveauInterface…)
GET    /presences/alertes                     (?seuil&debut&fin[&classeId])
GET    /presences/registre-mensuel/export     (?classeId&month&sessionScope&format&niveauInterface)  ← blob
POST   /presences/preview-absents
POST   /presences/notifier-absents
```

### 1.13 Suivi enseignants / émargement (4)
```
GET    /suivi-enseignants                      (?anneeScolaireId&debut&fin&niveauInterface[&enseignantId])
POST   /suivi-enseignants/emargements
PATCH  /suivi-enseignants/emargements/{id}/validation
GET    /suivi-enseignants/exports/{type}       ← blob; type ∈ {xlsx, pv}
```

### 1.14 Affectations enseignants (4)
```
GET    /affectations-enseignants               (?filters)
GET    /affectations-enseignants/options
POST   /affectations-enseignants
PUT    /affectations-enseignants/{id}
PATCH  /affectations-enseignants/{id}/statut
```

### 1.15 Espace enseignant (3)
```
GET    /espace-enseignant/accueil                      (refetchInterval: 60 000 ms)
GET    /espace-enseignant/classes/{id}/eleves
GET    /espace-enseignant/indicateurs-direction         (?niveauInterface)
```

### 1.16 Calendrier scolaire (4)
```
GET    /calendrier                             (?…)
POST   /calendrier
PATCH  /calendrier/{id}
DELETE /calendrier/{id}
```

---

## 2. Routes, roles and navigation — CONFIRMED

Role constants (verbatim from `lakoli-main.js`):
```js
im = ["super_admin","direction","comptable","caissier","scolarite","enseignant","auditeur","permanent"]
om = ["super_admin","direction","comptable"]
ti = ["super_admin","direction","comptable","caissier"]
jt = ["super_admin","direction","scolarite"]
An = ["super_admin","direction"]
b0 = ["permanent"]
```

Route guards (`allowedRoles` on the router):

| Route | Roles |
|---|---|
| `/classes` | (all authenticated) |
| `/periodes` | (all) |
| `/programmes` | (all) |
| `/matieres` | (all) |
| `/annees-scolaires` | super_admin, direction |
| `/affectations-enseignants` | super_admin, direction |
| `/emploi-du-temps` | super_admin, direction, scolarite, enseignant |
| `/presences` | super_admin, direction, scolarite, enseignant |
| `/presences/alertes` | super_admin, direction, scolarite |
| `/cahier-textes` | super_admin, direction, scolarite, enseignant |
| `/notes` | super_admin, direction, scolarite, enseignant |
| `/bulletins` | super_admin, direction, scolarite |
| `/planification-evaluations` | super_admin, direction, scolarite, enseignant |
| `/examens-nationaux` | super_admin, direction, scolarite |
| `/exports-cio` | super_admin, direction, scolarite |
| `/suivi-enseignants` | super_admin, direction, scolarite, enseignant |
| `/espace-enseignant/listes` | enseignant |
| `/espace-enseignant/classes/:id` | enseignant |
| `/calendrier` | all 8 roles (`im`) |

Sidebar entries (verbatim `name` / `section` / `group`):
```
Affectations              /affectations-enseignants   scolarite / Organisation pédagogique
Emploi du temps           /emploi-du-temps            scolarite / Organisation pédagogique
Cours réalisés            /suivi-enseignants          scolarite / Organisation pédagogique
Présences                 /presences                  scolarite / Vie scolaire
Cahier de textes          /cahier-textes              scolarite / Cours et évaluations
Notes                     /notes                      scolarite / Cours et évaluations
Compositions              /planification-evaluations  scolarite / Cours et évaluations
Bulletins                 /bulletins                  scolarite / Cours et évaluations
Exports CIO & StatCIO     /exports-cio                scolarite / Exports administratifs
Examens nationaux         /examens-nationaux          scolarite / Orientation et examens
Mes classes               /espace-enseignant/listes    scolarite / Dossiers élèves  (roles:["enseignant"])
Calendrier scolaire       /calendrier                 piloter   / Organisation
```
Search keywords attached to nav items (CONFIRMED, used by the ⌘K palette):
`"affectations enseignants"`, `"classe matière professeur"`, `"suivi enseignants"`,
`"émargement professeurs"`, `"présence enseignants"`, `"heures enseignants"`,
`"présences élèves"`, `"appel élèves"`, `"absences élèves"`, `"retards élèves"`,
`"statistiques CIO"`, `"collecte CIO"`, `"moyennes CIO"`, `"export Excel"`, `"listes de classe"`.

**Not in the main sidebar** — reachable only from the Paramètres hub (`index-DW1DbOGP.js`),
verbatim tiles:
```
{label:"Classes",              desc:"Gérer les classes et niveaux",          href:"/classes"}
{label:"Périodes d'évaluation",desc:"Trimestres et semestres",               href:"/periodes"}
{label:"Années scolaires",     desc:"Gérer les années actives",              href:"/annees-scolaires"}
{label:"Matières",             desc:"Matières et coefficients par niveau",   href:"/programmes"}
{label:"Alertes absences",     desc:"Seuils et notifications",               href:"/presences?onglet=alertes"}
```
> This is why a shallow crawl of the sidebar concluded `/programmes` "renders nothing": it is
> filed under Paramètres and labelled **Matières**, not Programmes.

**Module gating** — `GET /module-access/catalog` returns `{effectiveModules, catalog:[{code,…}]}`.
Nav items carry `gatedModule:"…"`. Only two gated modules exist in the whole nav:
`gatedModule:"orientation_dob"` (`/orientation`) and `gatedModule:"conformite"` (`/conformite`).
**No pedagogy page is module-gated.** (CONFIRMED.)

---

## 3. Périodes d'évaluation — `/periodes` (chunk `index-BwE_tiBb.js`)

Header: `"Pédagogie"` / **« Périodes d'évaluation »** /
*"Trimestres, semestres ou mois, selon le rythme de votre école"*.

### 3.1 Enums — CONFIRMED
```js
ne = { sequence:"Séquence", trimestre:"Trimestre", semestre:"Semestre" }   // period type
X  = [{id:"college",label:"Collège"},{id:"lycee",label:"Lycée"}]           // cycle chips
oe = [{nom:"Trimestre 1",ordre:1},{nom:"Trimestre 2",ordre:2},{nom:"Trimestre 3",ordre:3}]
```
Period type enum: `sequence | trimestre | semestre`.

### 3.2 Form « Nouvelle période » / « Modifier la période » — CONFIRMED
Initial state: `{nom:"", type:"trimestre", dateDebut:"", dateFin:"", ordre:"1", cycles:[]}`

| Label (verbatim) | Control | Required |
|---|---|---|
| `Nom*` | text | yes |
| (type) | select over `sequence/trimestre/semestre` | — |
| `Date de début *` | date | yes |
| `Date de fin *` | date | yes |
| `Cycles concernés` | multi-checkbox | no |

Helper: *"Ex : cochez « Primaire » et « Maternelle » si ce trimestre ne s'applique pas au secondaire."*
Validation: *"La date de fin doit être après la date de début."*

### 3.3 "Créer rapidement" quick-create — CONFIRMED
> *"Utilisez les boutons **« Créer rapidement »** ci-dessous pour générer les 3 trimestres
> standards, puis ajustez les dates et les cycles. Vous pouvez aussi créer des périodes
> personnalisées avec le bouton « Nouvelle période »."*

Fields: `Début *`, `Fin *`, cycle chips `Collège` / `Lycée`.

### 3.4 Pondération de la moyenne annuelle — `PUT /pedagogie/periodes/ponderation-annuelle`
Payload: `{anneeScolaireId, periodes:[{id, included, weight}]}` (CONFIRMED).
Restricted to `["super_admin","direction"]` in the component (`$` guard).

Business rules, verbatim:
- *"Choisissez les périodes officielles incluses. Les coefficients sont relatifs : 1 / 1 / 2 donne deux fois plus de poids à la troisième période."*
- *"La formule est gelée dès qu'une décision de fin d'année est validée. Une période incluse sans bulletin officiel publié bloque le calcul au lieu de produire une moyenne partielle."*
- Row states: `"Incluse"` / `"Exclue du calcul annuel"`; error `"Pondération impossible."`
- Per-row numeric input labelled `` `Coefficient ${t.nom}` `` with `min/max/step`.
- Model fields exposed: `compteMoyenneAnnuelle` (bool), `poidsAnnuel` (default `"1"`).

### 3.5 Clôture workflow — CONFIRMED
Pre-check `GET /pedagogie/periodes/{id}/pre-cloture-check` returns
`{ok, totalEleves, totalSansNote, matieresVides?, elevesSansNote}`. UI copy:
- *"Vérification des notes en cours…"*
- *"Toutes les notes sont complètes (N élèves)."*
- *"N élève(s) sans aucune note saisie. Corrigez les données signalées avant de clôturer."*
- badges `" mat. vide"`, `" sans note"`

Clôture confirmation text depends on whether the period was already closed:
- First closure: *"Les bulletins seront générés pour tous les élèves ayant au moins une note. Les notes ne pourront plus être modifiées."*
- Re-closure: *"Une nouvelle version officielle sera générée pour la population figée."*
- Button label switches `"Clôturer et générer"` ⇄ `"Re-clôturer et générer"`; list action `"Clôturer"` ⇄ `"Re-clôturer"` driven by `t.rouverteAt`.
- *"La publication est automatique uniquement lorsque tous les PDF officiels du lot sont générés et vérifiés. Vous pourrez suivre la progression sur cette page."*
- Job statuses observed: `"succeeded"`, `"failed"`; UI strings `": bulletins publiés"`, `": génération interrompue"`, `": génération des PDF officiels"`.

Réouverture (`POST /pedagogie/periodes/{id}/re-ouvrir`):
- *"La réouverture annule la clôture et dépublie les bulletins du portail parent. Les parents ne pourront plus consulter les bulletins jusqu'à la re-clôture."*
- Required field **« Motif de réouverture »**, textarea `rows:3`,
  placeholder *"Ex : Erreur de saisie sur la note de mathématiques de Kofi TRAORE…"*
- *"Ce motif sera enregistré dans l'historique des actions."*
- *"Les notes pourront à nouveau être modifiées"*

Empty state: *"Aucune période créée pour l'instant"* / *"Créez vos trimestres pour commencer la saisie des notes"*.
Warning badge on rows lacking dates: `"Dates à renseigner"`.

Onboarding hook: `{onboardingStatus:xe, currentKey:"periodesEvaluation", successMessage:"Période créée avec succès"}`.

---

## 4. Notes & évaluations — `/notes` (chunk `index-BoaCvxdk.js`, 41 KB)

Header: **« Notes et évaluations »** /
*"Créez une évaluation, saisissez les résultats, puis choisissez quand les rendre visibles aux familles."*

### 4.1 Enums — CONFIRMED (verbatim source)
```js
ye = [["interrogation","Interrogation"],["devoir","Devoir"],["composition","Composition"],
      ["examen_blanc","Examen blanc"],["oral","Oral"],["projet","Projet"],["autre","Autre"]];
function ze(l){return l==="publiee"?"Visible aux familles":l==="retiree"?"Retirée":"À compléter"}
```
- **Evaluation type**: `interrogation | devoir | composition | examen_blanc | oral | projet | autre`
- **Publication status**: `publiee` → "Visible aux familles" (emerald) · `retiree` → "Retirée" (slate) · *anything else* → "À compléter" (amber). Third state is the implicit `brouillon`.

### 4.2 Form « Créer une évaluation » — CONFIRMED
Initial state (both create and edit):
```js
{titre:"", type:"devoir", dateEvaluation:"", noteSur:"20", poids:"1",
 contenu:"", consignes:"", obligatoire:true, motifModification:""}
```
| Label | Control | Constraint / placeholder |
|---|---|---|
| (titre) | text | `maxLength:160`, placeholder `"Ex. Devoir de fractions"` |
| (type) | select | 7 values above |
| (date) | date | must fall inside the period |
| `Barème` | number | default 20 (`noteSur`) |
| (poids) | number | *"Le poids sert uniquement à la moyenne de cette matière."* |
| `Contenu évalué` | text | `"Ex. Fractions, comparaison et opérations"` |
| `Consignes aux familles` | text | `"Ex. Revoir les exercices 4 à 8"` |
| `Évaluation obligatoire pour la période` | checkbox | |
| `Motif de correction de la version publiée` | text | placeholder `"Ex. Barème corrigé après validation pédagogique"` |

Submit label: `"Créer et commencer la saisie"`.

### 4.3 Context gate ("Contexte pédagogique") — 3-step selector
Progressive copy (verbatim, in the order the code emits them):
1. `"Commencez par choisir une classe."`
2. `"Choisissez maintenant la période."`
3. `"Choisissez la matière à évaluer."`
4. `"Le contexte est prêt : créez votre première évaluation."` / `"Choisissez une évaluation pour saisir ou vérifier les résultats."`

Hint: *"Choisissez ces trois informations une seule fois, elles resteront appliquées à la création et à la saisie des résultats."*
Empty-config deep links: *"Aucune période configurée. Contactez la Direction."* → `href:"/periodes"` « Créer des périodes » ; *"Aucune matière configurée."* → `href:"/matieres"` « Configurer les matières ».

### 4.4 Server-side rule catalogue (error-code → French message) — CONFIRMED, high value
This is a literal map of backend rejection codes shipped in the client:
```
affectation_requise   → "Cette classe et cette matière ne sont pas encore affectées à votre compte
                         enseignant. Demandez à la Direction de créer l’affectation."
contexte_incoherent   → "La période choisie ne correspond pas à l’année ou au cycle de cette classe."
periode_cloturee      → "Cette période est clôturée : aucune nouvelle évaluation ne peut être créée."
date_periode          → "La date de l’évaluation doit être comprise dans la période sélectionnée."
evaluations_initialisation
                      → "Le registre termine son initialisation. Réessayez dans quelques secondes."
```

### 4.5 Publication semantics — CONFIRMED
- `"Évaluation publiée. Les familles peuvent maintenant la consulter."`
- Re-edit of a published evaluation: `"Évaluation corrigée. L'ancienne version reste visible jusqu'à la nouvelle publication."`
- `"La version publiée {n} reste visible aux familles jusqu'à la nouvelle publication."` → **versioned publications** (`dernierePublicationVersion`).
- *"Les notes enregistrées restent internes : le portail parent les affichera uniquement après « Publier aux familles »."*
- Button `"Publier aux familles"` ⇄ `"Publié"`.
- `"La publication sera disponible après saisie complète."`
- Correction motive: *"Le motif est conservé dans le journal d'audit. Une évaluation déjà publiée repasse en brouillon."* (textarea `rows:2, maxLength:500`, placeholder `"Ex. Correction après vérification de la copie"`).
- Closed period banner: **« Période clôturée »** / *"Les résultats et leurs publications sont verrouillés par le bulletin officiel."*
- Historical row badge: `"Résultat historique préservé"`.

### 4.6 Score grid — CONFIRMED
Columns: `Élève` · `Note (sur {B})` · `Appréciation`.
Per-row validation: *"La note de {nom} {prenoms} doit être comprise entre 0 et {B}."*
Footer: `"{saisis}/{total} élèves saisis"` · `"Moyenne de la classe : {x} sur {B}"` ·
`"{n} modification(s) non enregistrée(s)"`.
Row summary strings: `"barème {noteSur} points"`, `"{nbSaisis}/{nbEleves} résultats"`.
Score payload items carry `{eleveId, note, appreciation, absenceExamen}` (recovered from the
offline-draft renderer: `i.absenceExamen?"Absent(e)":i.note==null||i.note===""?"Non noté":\`Note : ${i.note}\``).

### 4.7 « Pilotage de la période » KPI strip — `GET /pedagogie/evaluations/pilotage`
*"Suivi des matières sans évaluation, des brouillons à compléter et des publications visibles aux familles."*
KPIs (label ← response field): `Sans évaluation` ← `sansEvaluation` · `Avec brouillon` ← `avecBrouillon`
· `Incomplètes` ← `avecIncomplete` · `Avec publication` ← `avecPublication`.

### 4.8 « Résultats des examens blancs BEPC/BAC » — `GET /pedagogie/evaluations/examens-blancs/statistiques`
Two business rules stated verbatim on this panel:
- *"Inscrits, présents et admis issus des dernières publications actives. **L'admission exige toutes les épreuves et une moyenne d'au moins 10/20.**"*
- *"Le détail Ivoiriens/étrangers est conservé par l'API pour le rapport annuel, aucune nationalité n'est déduite du nom."*

Empty state: *"Aucune évaluation pour ce contexte. Créez le premier devoir ou la première interrogation."*

---

## 5. Bulletins — `/bulletins` (chunk `index-4N_IMKH1.js`)

Header: **« Bulletins de notes »** / *"Consultez et imprimez les bulletins par classe et période"*.

### 5.1 Mentions enum — CONFIRMED
```js
{"Très Bien":…, Bien:…, "Assez Bien":…, Passable:…, Insuffisant:…}
```
→ `Très Bien | Bien | Assez Bien | Passable | Insuffisant`.

### 5.2 Provisional vs official — CONFIRMED
Un-closed period → the printed HTML gets a rotated watermark:
```
PROVISOIRE
NON OFFICIEL
```
plus the banner: *"⚠️ DOCUMENT PROVISOIRE — NON OFFICIEL — La période n'est pas encore clôturée"*.
Tooltip on the disabled official button: *"Période non clôturée — clôturez d'abord depuis Paramètres"*.

Official download is gated in the client on a document row satisfying **all four**:
`est_publie===true && statut_document==="valide" && has_pdf===true && periode_id===periodeId`
(CONFIRMED code), fetched from `/documents?type=bulletin&eleveId=…` and downloaded via
`/documents/{id}/download`. An on-demand alternative posts `/documents/finaliser`
with `{type:"releve_notes", eleveId, periodeId}` → button **« Relevé officiel »**.

### 5.3 Printed bulletin masthead — CONFIRMED (Ivorian statutory layout)
```
Ministère de l'Éducation Nationale, de l'Alphabétisation et de …
République de Côte d'Ivoire
Année scolaire : …
Bulletin de Notes
…
MOYENNE GÉNÉRALE
TOTAL DES POINTS OBTENUS / POSSIBLES
Signature du Directeur
```
Rank formatting helper: `` `${a===1?"1er":`${a}e`} sur ${p} élève${p>1?"s":""} ayant des notes saisies` ``
→ ranking is computed **only over students with entered marks** (business rule).

Score normalisation: `A=(s,d)=>Math.round(s/(d||m)*m*100)/100` with `m = noteSurAffichage || 20`,
and subjects are excluded from the average when `absenceExamen` is true or `note===null`
(CONFIRMED code). Coefficients (`coe…`) are applied to normalised marks.

Table columns: `Matière` · (Note) · `Appréciation` · `Total des points obtenus / possibles`.
Actions: `« Aperçu provisoire »`, `« Aperçu provisoire de la classe (N) »`, `« Relevé officiel »`.
Class print uses `GET /pedagogie/bulletins-classe/{classeId}/{periodeId}` and emits one
`page-break-after:always` block per pupil.

---

## 6. Cahier de textes — `/cahier-textes` (chunk `index-CgutOTv2.js`)

Header: **« Cahier de textes et progression »** /
*"Séances réalisées, contenus, devoirs, observations, avancement et visa."*

### 6.1 Status enum — CONFIRMED
```js
Ne = {brouillon:"Brouillon", soumis:"À viser", vise:"Visé", a_corriger:"À corriger"}
```

### 6.2 Workflow — CONFIRMED
```
brouillon ──[Soumettre]──▶ soumis ──[Viser]──▶ vise
                              └───[Corriger]──▶ a_corriger ──[Modifier]──▶ (re-soumettre)
```
- Teacher actions available only when `statut ∈ {brouillon, a_corriger}`: `Modifier`, `Soumettre`.
- Direction actions only when `statut === "soumis"`: `Viser`, `Corriger`.
- `Corriger` opens `window.prompt("Correction demandée (10 caractères minimum) :")` → **≥10 chars mandatory**, sent as `{decision:"corriger", commentaire}`. `Viser` sends `{decision:"viser"}`.
- Version history modal **« Historique de la séance »** renders `v{version}` and
  `action.replaceAll("_"," ")` → server keeps an append-only action log per séance.

### 6.3 Form « Nouvelle séance » / « Modifier la séance » — CONFIRMED
Defaults:
```js
{affectationId:"", creneauId:"", dateSeance:<today>, heureDebut:"08:00", heureFin:"10:00",
 contenu:"", chapitre:"", objectifs:"", devoirs:"", devoirARendreLe:"",
 observations:"", progressionPct:"0"}
```
| Label (verbatim) | Type | Notes |
|---|---|---|
| `Affectation *` | select | options disabled when `e.anneeCloturee`, suffixed `" — année clôturée"` |
| `Date *` | date | |
| `Créneau habituel` | select | empty option = **« Séance exceptionnelle »**; others `"Jour {jourSemaine} · {heureDebut}–{heureFin}"` |
| `Début *` | time | |
| `Fin *` | time | |
| `Chapitre / séquence` | text | |
| `Avancement (%) *` | number | `min:"0" max:"100"` |
| `Contenu réellement enseigné *` | textarea | submit disabled without it |
| `Objectifs / compétences` | textarea | |
| `Devoir à faire` | textarea | |
| `À rendre le` | date | |
| `Observations` | textarea | |

Save button: `"Enregistrer le brouillon"` (disabled unless `affectationId && contenu`).

### 6.4 Rules & filters — CONFIRMED
- Year-frozen banner: *"Année clôturée : le cahier de textes est consultable, mais aucune saisie, soumission ou décision n’est autorisée."*
- Scope error: *"Cette affectation n’est pas disponible dans votre périmètre."*
- Prefill error: *"Le cours demandé ne peut pas être prérempli. Vérifiez le créneau ou la clôture de l’année."*
- KPI tiles: `Heures réalisées`, and a role-dependent tile `"À viser"` (direction, `summary.aViser`) vs `"À finaliser"` (teacher, `summary.brouillons`).
- Filter bar `aria-label:"Filtrer le cahier de textes"`, year select with `"Toutes"`.
- Direction empty state: *"Aucune séance n’attend votre visa. Le bouton … apparaît dès qu’un enseignant soumet une séance."*
- Panel: **« Avancement du programme »**.
- Deep-link produced by the teacher home:
  `` `/cahier-textes?affectationId=${s.affectationId}&creneauId=${s.id}&dateSeance=${n}` ``

---

## 7. Programmes / Grilles — `/programmes` (chunk `index-CFewQxy_.js`) — the "blank page" that isn't

Header: `"Pédagogie"` / **« Grilles de programme »** / *"Programme ivoirien pré-chargé par niveau"*.

Cycle label maps — CONFIRMED:
```js
_ = {maternelle:"Préscolaire (Maternelle)", primaire:"Primaire", college:"Collège", lycee:"Lycée"}
k = ["maternelle","primaire","college","lycee"]
O = {maternelle:"Préscolaire", primaire:"Primaire", college:"Collège", lycee:"Lycée"}
```

Panels and rules — verbatim:
- **« Référentiel officiel actif »** — *"Les matières, coefficients et barèmes correspondant à vos niveaux sont déjà configurés. Vous pouvez les utiliser tels quels ou les personnaliser librement."*
- **« Filtrer les programmes affichés »** — *"La liste est limitée aux cycles actifs configurés pour votre établissement."* (driven by `cyclesActifs` from context) ; error *"Sélectionnez au moins un cycle pour afficher les matières."*
- Sync action tooltip on `POST /programmes/confirmer`: *"Associe les nouvelles classes à leur programme et synchronise les matières manquantes"*. Its success also invalidates `onboarding-status`.
- Seeding action on `POST /programmes/reinitialiser`: button **« Charger les grilles par défaut »**, shown when `programmes.length === 0` under *"Aucune grille définie pour le moment."*
- Inline add row → `POST /programmes/{id}/matieres/ajouter` with body `{nom, coefficient:parseFloat||1}` ; Enter submits, Escape cancels ; placeholder `"Nom de la matière"`.
- Bulk editor **« Modifier la liste complète »** → `PUT /programmes/{id}/matieres` with
  `{matieres:[{nom, code:code||null, coefficient:parseFloat||1, ordre:index+1}]}`.
- Table header `Matière` ; grids grouped by cycle, sub-grouped by `« Série {r.serie} »` (lycée series A/C/D).
- Coefficient total helper: `P(r)=r.reduce((l,u)=>l+parseFloat(u.coefficient),0)`.
- Error state: *"Erreur lors du chargement des grilles."*

> **Verdict:** `/programmes` is a fully implemented reference-data manager for the Ivorian
> national curriculum, with seeding, per-cycle/serie grids, coefficients, ordering and a
> re-sync action. It is *not* blank.

---

## 8. Matières — `/matieres` (chunk `index-D9qIb0I-.js`)

Header: **« Matières »** / *"Gérez les matières et leurs coefficients par classe"*.
- Filter: `"Filtrer par classe :"` with `"Toutes les classes"` option → `GET /pedagogie/matieres?classeId=`.
- Table column `Matière`. Empty state `"Aucune matière configurée"`.
- Modal **« Nouvelle matière »** / **« Modifier la matière »**: `Nom de la matière` (placeholder `"Ex: Mathématiques"`), coefficient, and an **ordre** field whose helper states the rule:
  *"Détermine l'ordre dans les bulletins. 0 = premier affiché."*
- Buttons `"Créer"` / `"Modifier"`.

---

## 9. Classes — `/classes` (chunk `index-pRAKLIxG.js`)

Header: `"Pédagogie"`; empty state *"Créez la première classe ou générez un ensemble standard en un clic"*.

### 9.1 Cycle enum + level catalogue — CONFIRMED
```js
z = {maternelle:"Maternelle", primaire:"Primaire", college:"Collège", lycee:"Lycée", superieur:"Supérieur"}
v = {
  maternelle:["PS","MS","GS"],
  primaire:["CP1","CP2","CE1","CE2","CM1","CM2"],
  college:["6ème","5ème","4ème","3ème"],
  lycee:["2nde","1ère A","1ère B","1ère C","1ère D","Tle A","Tle B","Tle C","Tle D"],
  superieur:["L1","L2","L3","M1","M2","BTS 1","BTS 2","DUT 1","DUT 2"]
}
```

### 9.2 Form « Nouvelle classe » — CONFIRMED
Defaults `{nom:"", cycle:"", niveau:"", capaciteMax:"30", noteMax:"20", estFinCycle:false}`.

| Label (verbatim) | Notes |
|---|---|
| `Nom de la classe` | placeholder switches by cycle: `"Ex: CP A, CE1, CM2 B"` (primaire) vs `"Ex: 6ème A, 3ème B, Tle C"` |
| (niveau) | select from `v[cycle]` + a `"Personnalisé..."` escape |
| `Capacité maximale (élèves)` | number |
| `Barème de notation` | `"Notes sur {n}"`, helper *"…sur 10, Secondaire … sur 20 (modifiable par classe)"`; `D(n)` returns `"10"` for pre-secondary cycles, `"20"` otherwise |
| `Classe terminale du cycle` | checkbox, helper: *"Permet de délivrer un certificat interne de fin de cycle aux élèves admis, uniquement après gel de l'année."* |

Guard: *"Aucune année scolaire active. Configurez-en une dans Paramètres."*
Delete rule: *"Cette action est irréversible. La classe ne peut être supprimée que si aucun élève n'y est rattaché."*
Card badge: `"Classe terminale du cycle"`.

### 9.3 « Classes standards » bulk generator — CONFIRMED (`POST /classes/dupliquer`)
Tooltip: *"Créer un ensemble de classes standard en une fois"*.
Two seeded template arrays (verbatim, with per-level defaults):
```
Maternelle/Primaire : PS,MS,GS (cap 30, /10) · CP1,CP2,CE1,CE2,CM1,CM2 (cap 40, /10)
                       estFinCycle: GS, CM2
Secondaire          : 6ème,5ème,4ème,3ème (cap 50, /20; estFinCycle: 3ème)
                       2nde (cap 60), 1ère A/C/D, Tle A/C/D (cap 50; estFinCycle: Tle A/C/D)
```
Picker copy: *"Sélectionnez les classes à créer automatiquement. Vous pourrez les modifier ensuite."*,
counter `"{n} / {total} sélectionnée(s)"`, actions `Tout sélectionner` / `Désélectionner`,
submit `"Créer {n} classe(s)"`.
Onboarding chaining after creation: *"Configuration principale terminée — Votre école est entièrement configurée."* / *"Classe enregistrée avec succès"* / *"Prochaine étape : {title}."*

---

## 10. Emploi du temps — `/emploi-du-temps` (chunk `index-Ci6lN5Hq.js`)

Header: `"Mon emploi du temps"` (enseignant) vs `"Emploi du temps"` (direction).
Sub-title, verbatim, by role:
- enseignant: *"Vos cours et les classes couvertes par vos affectations actives."*
- direction: *"Planification hebdomadaire manuelle par affectation, classe, professeur et salle."*

### 10.1 Constants — CONFIRMED
```js
D = [{value:1,label:"Lundi"},{value:2,"Mardi"},{3,"Mercredi"},{4,"Jeudi"},{5,"Vendredi"},{6,"Samedi"},{7,"Dimanche"}]
Ge = {Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}
re = {affectationId:"", salleId:"", jourSemaine:"1", heureDebut:"08:00", heureFin:"09:00"}   // créneau form
timezone: new Intl.DateTimeFormat("en-US",{timeZone:"Africa/Abidjan", weekday:"short"})
```
**Africa/Abidjan is hard-coded** as the school timezone (CONFIRMED).

### 10.2 Créneau modal « Nouveau créneau » / « Modifier le créneau »
Fields: affectation select (`"Choisir une affectation"`), jour (7 options), `Début`, (fin),
salle select with `"Sans salle"`. Row actions: `Modifier le créneau`, `Désactiver le créneau`
with `window.confirm("Désactiver ce créneau ?")`.

### 10.3 Salles modal « Gérer les salles » — CONFIRMED
Form state `{nom:"", code:"", capacite:"", localisation:""}`; label `Capacité`;
placeholder `"Bâtiment A, 1er étage"`; fallback `"Sans précision"`;
empty state *"Aucune salle active."*; deactivation via
`PATCH /emploi-du-temps/salles/{id}/statut` with confirm *"Désactiver la salle « … »"*;
error *"La salle n'a pas pu être désactivée."*

### 10.4 Conflicts & workload rules — CONFIRMED
- `GET /emploi-du-temps/conflits` → banner `"{n} conflit(s) existant(s) à corriger"` and
  *"Les nouvelles saisies conflictuelles sont bloquées automatiquement."*
- The guided tour states the three conflict classes verbatim:
  *"Lakoli détecte trois types de conflits : un professeur qui a deux cours en même temps, une classe avec deux matières simultanément, ou une salle utilisée par deux groupes différents."*
- Volume panel **« Suivi des volumes hebdomadaires »** — *"Comparaison entre les heures affectées dans PED‑02 et les créneaux réellement planifiés."* (**`PED-02` is an internal module code for the Affectations module — the only such code that leaks into the UI.**)
  Overflow warning `" Volume horaire dépassé"` and row text
  `"{label} : {planned} h planifiées pour {expected} h affectées."`
- Drag-and-drop rescheduling: `"Déposer ici"`, `"Relâcher pour déplacer ici"`,
  error *"Le déplacement n'a pas pu être effectué."* Tour: *"L'heure de début et de fin restent inchangées. Lakoli vérifie les conflits avant de valider le déplacement."*
- Separation-of-concerns rule: *"Le calendrier scolaire reste séparé de cet emploi du temps hebdomadaire."*
- Print: A4 landscape, 7 days, with school name + school year header (tour, verbatim).
- View switch: `"Une classe"` / `"Classe affectée"`; teacher view note *"Vos cours, sans professeur à sélectionner."*
- Day picker `data-testid:"teacher-timetable-day-picker"`, `aria-label:"Choisir le jour à afficher"`.

---

## 11. Présences élèves — `/presences` (chunk `index-DzWi0yea.js`, 45 KB)

Header: **« Suivi des Présences »** / *"Saisissez les présences et absences par classe"*.

### 11.1 Tabs — CONFIRMED (verbatim array)
```js
[{id:"saisie",   label:"Saisie du jour"},
 {id:"registre", label:"Registre mensuel"},
 {id:"stats",    label:"Statistiques"},
 {id:"retards",  label:"Rapport retards"},
 {id:"alertes",  label:"Alertes absences"}]     aria-label:"Sections présences"
```
Deep link from Paramètres: `/presences?onglet=alertes`.

### 11.2 Attendance status enum — CONFIRMED
```js
pe = {present:{label:"Présent"}, absent:{label:"Absent"},
      retard:{label:"Retard"},   excuse:{label:"Excusé"}}
```
Session enum: `matin | apres-midi` (rendered `"Matin"` / `"Après-midi"`).
`sessionScope` for the monthly register: `journee` (**"Journée (matin / après-midi)"**), `matin`, `apres-midi` ("Après-midi uniquement").

### 11.3 Business rules — verbatim
- **Late-arrival validation:** *"Chaque retard doit préciser une durée de 1 à 600 minutes et un motif d’au moins 3 caractères."* — enforced client-side too: `!Number.isInteger(r)||r<1||r>600||String(s.motif||"").trim().length<3`.
- **Re-entry audit:** *"Cet appel a déjà été enregistré. Le motif sera conservé dans le journal d’audit."* with field **« Motif de la correction »** (`maxLength:500, rows:2`, placeholder *"Ex. Rectification après contrôle de la feuille d’appel"*).
- **Never-implicit-present:** *"Présences et retards réellement saisis. Une case vide n’est jamais comptée présente."*
- **Expected slots:** *"Créneaux scolaires attendus, hors week-ends, congés et jours fériés."* (label `Présence possible`).
- **Export parity:** *"Le PDF et le fichier Excel proviennent exactement des mêmes données Lakoli et portent la même empreinte de contrôle"* + *"Les totaux, motifs et taux sont communs au PDF et à Excel."* (label `Contrôle identique`).
- **Scope:** *"Aucune classe autorisée pour l’appel — Contactez la Direction pour vérifier vos affectations et le droit de saisir les présences."*
- Unsaved-changes guard: `window.confirm("Abandonner les modifications de présence non enregistrées ?")`.
- Slot-linked roll call: banner **« Appel lié au cours planifié »** with the escape link *"Revenir à l’appel par demi-journée"* (`creneauId` query param).
- Historical rows with no motive display `"Historique à qualifier"` / badge `"À qualifier"`.

### 11.4 Parent SMS notification flow (`preview-absents` → `notifier-absents`)
Modal **« Notifier les parents des absents »**. Verbatim message template:
> *"École : votre enfant {…} a été signalé(e) absent(e) {ce matin|cet après-midi}, le {date}. Merci de contacter l'établissement si cette absence est justifiée."*

Sub-headings: `"Aperçu du message"`, `"Sélectionnez les élèves à notifier"`, counters
`Envoyé(s)` / `Échec(s)` / `Sans contact`, badges `"Pas de numéro"`, `"{n} sans numéro"`,
totals `"{E} sélectionné(s) · {w} SMS à envoyer"`, guard
*"Enregistrez d'abord les présences, puis notifiez les parents si nécessaire."*

### 11.5 Printed attendance sheet — CONFIRMED
`Feuille de Présence` — columns `#`, `Matricule`, `Nom & Prénoms`, `Statut`, `Signature`;
three signature boxes: **`Le professeur`**, **`Le censeur / CPE`**, **`Visa direction`**.

### 11.6 Rapport retards
Panel **« Registre détaillé des retards »** — *"Durée, heure d’arrivée et motif, dans votre périmètre de cycles."*
Table columns `Élève`, `Durée`, `Arrivée`; PDF is A4 **landscape**; KPI `Élèves ← summary.elevesConcernes`.

### 11.7 Alertes absences (chunk `alertes-CZg_3Sf0.js`)
Severity is **derived from a user-set threshold**, not a stored enum (CONFIRMED):
```js
function ie(a,t){const i=a/t;
  return i>=3?{label:"Critique"} : i>=2?{label:"Élevé"} : {label:"Alerte"}}
```
Default `seuil = 5`; default window = 1st of current month → today. Header sub-title
*"Élèves dépassant le seuil défini"*, panel `« Paramètres de détection »`.
WhatsApp deep-link `https://wa.me/225…` with template:
> *"Bonjour, nous vous informons que votre enfant {prenoms nom} ({classe}) a cumulé {n} absence(s) cette période. Merci de vous rapprocher de la direction. — École"*
Button `"Alerter par WA (n)"`; empty state *"Aucun élève ne dépasse {t} absence(s) sur la période sélectionnée."*
Dashboard widget calls `GET /presences/alertes?seuil=5&limit=6`.

---

## 12. Compositions & convocations — `/planification-evaluations` (chunk `index-DEgXnv6X.js`)

Header: **« Compositions et examens »** /
*"Calendrier officiel, salles, surveillants, convocations et contrôle des chevauchements."*

### 12.1 Enums — CONFIRMED
```js
X  = {evaluationId:"", salleId:"", dateSession:"", heureDebut:"08:00", heureFin:"10:00",
      effectifPrevu:"", surveillantIds:[], forcerConflits:false, motifConflitForce:""}
is = {interrogation:"Interrogation", devoir:"Devoir", composition:"Composition",
      examen_blanc:"Examen blanc", oral:"Oral", projet:"Projet", autre:"Autre"}
```
Session status enum (from the mutations): `planifiee | terminee | annulee`.
Convocation states rendered: `"Publiée"` / `"À publier"` / `"À compléter"`, plus badges
`"Convocation publiée"` and `"Dérogation"` (`conflitForce`).
Document types: `emargement` → file `feuille-emargement-….pdf`; `pv-surveillance` → `pv-surveillance-….pdf`.

### 12.2 Publication pre-conditions — verbatim, all three block SMS/documents/publication
1. *"Complétez la salle et au moins un surveillant avant publication, SMS ou documents."*
2. *"La salle ou l'un des surveillants n'est plus actif. Remplacez cette ressource avant publication, SMS ou documents."*
3. *"Renseignez l'effectif prévu de chaque salle simultanée avant publication, SMS ou documents."*

### 12.3 Multi-room distribution rule — verbatim (the single densest rule in the domain)
> **« Répartition multi-salles : »** *"créez une séance par salle avec exactement la même date et les mêmes horaires, puis renseignez l'effectif prévu de chaque salle. **Chaque élève sera affecté une seule fois.** Toute modification retire les convocations déjà publiées du groupe afin d'imposer un nouveau contrôle."*

Related runtime messages:
- *"{n} convocation(s) publiée(s) ont été retirées pour imposer un nouveau contrôle de la répartition."*
- *"{n} salles simultanées ont été publiées ensemble."* / *"… ont été retirées ensemble."*
- *"Publication impossible : des conflits sont apparus depuis l'enregistrement."*

### 12.4 Conflict override — CONFIRMED
Server returns HTTP **409** with `{error:"conflit_planification", conflits:[…]}` →
banner *"Des conflits ont été détectés. Corrigez-les ou utilisez une dérogation motivée."*
Checkbox **« Autoriser exceptionnellement cette planification »** + required textarea
`id:"conflict-override-reason"`, placeholder *"Motif détaillé de la dérogation (10 caractères minimum)"*.

### 12.5 Room capacity & supervisor ordering
- `"Capacité de la salle : {capacite} place(s)"` ; overload text `"… est surchargée : {n} élève(s) prévu(s) pour …"` ; remedy *"réduisez l'effectif ou choisissez une autre salle."*
- **« Le premier agent sélectionné devient responsable de salle. Décochez puis recochez un agent pour modifier cet ordre. »**
- *"Aucun surveillant actif disponible. Vérifiez le personnel actif ou le périmètre de cycles."*

### 12.6 SMS convocations (`notifications/preview` → `notifications/sms`)
Modal **« Notifier les familles »** — buckets `Élèves`, `À envoyer`, `Déjà envoyés`, `Sans téléphone`;
`"Aperçu individualisé"`; `"Coût estimé : {segmentsEstimes} segment(s) SMS"`;
loading *"Calcul des destinataires et du coût…"*.
Idempotency + fan-out rule, verbatim:
> *"Cette confirmation couvre toutes les salles simultanées de la répartition. **Un seul SMS est envoyé par élève au parent principal joignable, avec sa salle affectée. Une seconde confirmation ne renvoie pas les convocations déjà transmises.**"*
Outcomes: *"{n} convocation(s) envoyée(s) pour {m} salle(s) simultanée(s)."*,
*"Toutes les convocations de cette répartition avaient déjà été envoyées."*,
*"{n} convocation(s) n'ont pas pu être envoyées. Vous pouvez relancer les échecs."*,
*"{n} envoi(s) ont été abandonnés car la publication a changé. Rechargez la répartition avant de recommencer."*

### 12.7 Lifecycle actions
- `Terminer` → `window.confirm("Confirmer que cette séance est terminée ? Elle ne pourra plus être modifiée.")` → `statut:"terminee"`.
- `Annuler` → `window.prompt("Motif de l'annulation (obligatoire)")` → `{statut:"annulee", motif}`; cancelled rows display `motifAnnulation`.
- Time-gate string `"Clôture disponible après …"` computed from `dateSession + heureFin` vs `Date.now()`.
- Print action: **« Programme des compositions et évaluations »** with `Année scolaire`, counters
  `"{n} séance(s) active(s)"`, `"{n} annulée(s) masquée(s)"`,
  warning *"{n} séance(s) restent à compléter avant publication, SMS ou documents opérationnels."*,
  empty *"Aucune séance active à imprimer."*

---

## 13. Autres pages du domaine

### 13.1 Suivi enseignants / Émargement — `/suivi-enseignants` (chunk `index-C3IRuUyb.js`)
Header **« Émargement des enseignants »** /
*"Cours prévus, présence, retard et heures réalisées, avec validation de la Direction."*

Enums — CONFIRMED:
```js
pe = {present:"Présent", retard:"Retard", absent:"Absent", cours_annule:"Cours annulé"}   // statutPresence
ve = {declare:"À valider", valide:"Validé", rejete:"Rejeté"}                              // statutValidation
```
Émargement modal **« Émarger le cours »**: state `{statutPresence:"present", heureArrivee:"08:00", heureDepart:"09:00", observation:""}`; select options *"Cours réalisé"* / *"Cours annulé"*; labels `Arrivée réelle`, `Départ réel`; submit **« Signer l’émargement »**.
Rejection: `window.prompt("Motif du rejet (obligatoire)")` — a missing motive throws `"cancelled"` and aborts.
KPIs: `Cours prévus`, `Émargés`, `À valider`, `Heures prévues`, `Heures validées` (`A=d=>${(d/60).toFixed(1)} h`).
**Core rule, verbatim:** *"Le retard et les heures réalisées sont calculés par le serveur à partir du créneau et des heures réelles. **Seuls les émargements validés alimentent le total officiel.**"*
Other states: `"Non émargé"`, `"Délai de régularisation clos"`, `"{n} min de retard"`.
Exports: `Exporter Excel` (`xlsx` → `emargements-{debut}-{fin}.xlsx`) and `Procès-verbal PDF` (`pv` → `pv-emargements-….pdf`), plus `Imprimer l’écran`.

### 13.2 Affectations enseignants — `/affectations-enseignants` (chunk `index-Bjy9iJVc.js`)
Sub-title, verbatim — this defines the whole ABAC model:
> *"**Source des droits sur les classes, matières, notes et appels par année scolaire.**"*

Filters: `Année scolaire`, cycles (`"Tous les cycles"`), classes (`"Toutes les classes"`),
teachers (`"Tous les enseignants"`), status (`"Toutes"` / `"Désactivées"`).
Form fields: teacher select (`"Choisir un compte enseignant"`), `Matière`, weekly volume
(*"Heures prévues par semaine pour cette matière et cette classe."*), and the checkbox
**« Autoriser la saisie de l'appel »** — *"Donne accès aux présences et au registre de cette classe."*

RH-link state machine (`rhLinkStatus`) — CONFIRMED messages:
- ok: *"Une fiche RH active avec la même adresse e-mail sera liée automatiquement lors de l'enregistrement."*
- missing: *"Créez une fiche RH avec la même adresse e-mail avant de poursuivre."*
- duplicate: *"Plusieurs fiches RH partagent cette adresse e-mail. Corrigez les doublons avant de poursuivre."*
- inactive: *"La fiche RH correspondante est inactive. Réactivez-la avant de poursuivre."*
- link to `href:"/rh"` **« Ouvrir le module Personnel »**; badge `"Fiche RH non liée"`.

Deactivation dialog: *"Les droits de … seront retirés immédiatement. **L'historique sera conservé.**"* /
reactivation: *"Les droits pédagogiques seront rétablis immédiatement après validation."*
Legacy-data guard: *"Affectation historique à compléter. Ouvrez-la pour renseigner son volume horaire avant toute réactivation."*
KPIs: `Enseignants concernés`, `Matières affectées`, `Volume actif cumulé`.
Error-honesty string worth quoting: *"Les affectations n'ont pas pu être chargées. **Aucun état vide n'est déduit de cette erreur.**"*

### 13.3 Années scolaires — `/annees-scolaires` (chunk `index-CGYPRsFk.js`)
Header **« Années scolaires »** / *"Gérez les années scolaires et définissez l'année active"*.
Form: `Libellé (ex : 2025-2026)`, `Date début`, (date fin).
Uniqueness rule: *"Erreur lors de la création. Vérifiez que le libellé est unique et que les dates sont valides."*
Activation confirm: *"Rendre l'année « … » active ? **L'année active actuelle sera désactivée.**"*
Tour: *"Une seule année peut être active à la fois."* / *"Les données passées restent consultables mais ne sont plus modifiables."*

### 13.4 Calendrier scolaire — `/calendrier` (chunk `index-CsOgSrQk.js`)
Event-type enum — CONFIRMED (10 values, verbatim):
```js
c = {vacances:"Vacances", examen:"Examen", evaluation:"Évaluation", reunion:"Réunion",
     sortie:"Sortie scolaire", ferie:"Jour férié", rentree:"Rentrée",
     conseils:"Conseil de classe", sport:"Sport / Tournoi", autre:"Autre"}
```
Weekday labels `["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"]`; 12 French month names.
Modal **« Nouvel événement »** / **« Modifier l'événement »**: titre (placeholder *"Ex: Vacances de Toussaint"*),
`Date de début`, `Date de fin`, type select, `description` (*"Informations complémentaires"*).
Uses `react-hook-form` (`register/handleSubmit/control/reset/setValue`) — the only pedagogy page that does.
Delete confirm `"Supprimer cet événement ?"`. Toasts: `Événement créé/modifié/supprimé`, `Erreur création`.
Tour adds a parent-visibility flag: *"Indiquez le titre, la date, l'heure et **si l'événement est visible par les parents**."*

### 13.5 Examens nationaux — `/examens-nationaux` (chunk `index-gyUdFIex.js`)
Section eyebrow is `"Scolarité"` (not "Pédagogie"). Header **« Résultats nationaux BEPC/BAC »** /
*"Registre agrégé de session normale, distinct des examens blancs internes."*
**Sovereignty disclaimer, verbatim:**
> *"Saisie et validation internes à l'établissement. **Lakoli n'est pas connecté à AGCE-DECO et ne vérifie pas automatiquement la source saisie.**"*
Fields: `Série (ex. D)`, `Référence de la source …`, column `Présents`.
Status: `"Brouillon interne"` → `"Validé en interne"` via `POST /pedagogie/examens-nationaux/{id}/valider`
(button **« Valider en interne »**); save button `"Enregistrer le brouillon"`.

### 13.6 Exports CIO & StatCIO — `/exports-cio` (chunk `index-Dim3JKYJ.js`)
Eyebrow `"Résultats administratifs"`; *"Choisissez une classe et une période, contrôlez les résultats publiés, puis téléchargez le fichier de travail."*
**3-step stepper (verbatim):** `"1 Choisir — Classe et période"` · `"2 Contrôler — Résultats publiés"` · `"3 Exporter — Collecte ou statistiques"`.
Two export profiles: `profil=collecte` → **« Collecte CIO »**, `profil=statistiques` → **« État StatCIO »**; `format=csv` (label *"au format CSV"*).
Control panel **« Contrôle avant export »** — *"Uniquement les dernières publications, **normalisées sur 20**."*
KPIs `Classés` ← `classes`, `Non classés` ← `nonClasses`, `Réussite` ← `tauxReussite`.
Warnings: *"Les élèves incomplets resteront non classés dans les statistiques."* ;
*"Aucun élève inscrit dans cette classe pour cette période : aucun fichier ne peut encore être produit."*
Version-compat: badge *"Modèle versionné — compatibilité à vérifier"* and
*"Avant transmission, vérifiez que la version indiquée dans le fichier correspond au canevas demandé par votre destinataire."*
Response header driven message: `x-lakoli-unmapped-subjects` → *"Fichier créé. {n} matière(s) restent hors du canevas historique."* else *"Fichier créé à partir des résultats publiés."*
Panel **« Historique des preuves »** ← `GET /pedagogie/evaluations/export-cio/history`.

### 13.7 Espace enseignant — `/espace-enseignant/listes`, `/espace-enseignant/classes/:id`
- `listes-CJA6e9kg.js`: **« Mes listes de classe »** / *"Uniquement les classes couvertes par vos affectations actives."*; empty *"Aucune affectation active — Contactez la Direction."*
- `classe-DmpJZyyn.js`: **« Liste pédagogique »** with an explicit data-minimisation rule:
  *"**Identité scolaire minimale, sans coordonnées familiales ni données financières.**"*
  Scope error *"Cette liste n’est pas disponible dans vos affectations."*; `"Aucun élève validé dans cette classe."`; `"Matricule non renseigné"`.
- Teacher home (`dashboard-DWiDn6JR.js`, `GET /espace-enseignant/accueil`, refetch 60 s):
  *"Votre journée pédagogique, dans l’ordre des actions à mener."* — ordered sections
  `Priorité maintenant` → `Appels à faire` → `Programme du jour` (*"Les autres cours, dans l’ordre de l’emploi du temps"*) → `Travail pédagogique` / `Outils pédagogiques`
  (*"Vos outils pédagogiques, dans une liste de travail compacte."*) → `Mes classes et matières`
  (*"Listes issues exclusivement de vos affectations actives"*).
  Work counters: `"{n} résultat(s) manquant(s)"`, `"prête à publier"`, `"{n} correction demandée"`,
  `"{n} séance à rédiger"`, `"{n} brouillon à finaliser"`.
- Direction overlay (`GET /espace-enseignant/indicateurs-direction`): **« Suivi pédagogique du jour »** /
  *"Appels, notes et planning à vérifier par la Direction."* with buckets
  `appels et emplois du temps`, `périodes et évaluations`, `conflits d’emploi du temps`
  (*"Classe, enseignant ou salle en chevauchement."*), and all-clear strings
  *"Tous les appels planifiés sont saisis."*, *"Aucune saisie incomplète détectée."*,
  *"Aucun chevauchement actif."*, *"{n} classe(s) sans évaluation"*.

---

## 14. SURPRISE #1 — Offline-first note & attendance capture (CONFIRMED)

Not a UI nicety; a full durable write-queue in `lakoli-main.js`:

```js
const s = {id:bw("op"), scope:e.scope, deviceId:C5(), method, path, body, label, uiPath,
           status:"pending", clientCreatedAt, expiresAt, attempts:0,
           lastAttemptAt:null, lastError:null, conflictPayload:null};
if((await kp(e.scope)).length >= 100)
  throw new Error("La file hors ligne contient déjà 100 opérations. Reconnectez-vous ou traitez les conflits avant de continuer.");
```
- Retry-eligibility predicate: offline **or** HTTP `401 | 408 | 429 | ≥500`; HTTP `409` is stored as `status:"conflict"` with the full server `conflictPayload`.
- Deep-link back into the originating page: `` `${uiPath}?offlineOperation=${id}` `` — the Notes page reads `I.get("offlineOperation")` on mount.
- The queued body is rendered for human comparison: `scores[]` → *"Note : {n}"* / *"Absent(e)"* / *"Non noté"*; `presences[]` → *"Statut : {statut}"* with `heureArrivee · motif`.
- UI panel **« Synchronisation pédagogique »**: `"{n} opération(s) en attente"`,
  *"{n} conflit(s) à traiter. **Les brouillons sont conservés au maximum 30 jours et effacés à la déconnexion ou au changement de compte.**"*, actions *"Ouvrir le brouillon"*,
  *"Abandonner définitivement ce brouillon conservé sur cet appareil ?"*,
  errors *"Le stockage local des brouillons n'est pas disponible dans ce navigateur."* /
  *"La file locale n'a pas pu être relue. Vérifiez les autorisations de stockage du navigateur."*
- Page-level messages: *"Connexion interrompue : le brouillon est conservé sur cet appareil et sera synchronisé automatiquement."* (notes) and *"Connexion interrompue : l'appel est conservé sur cet appareil et sera synchronisé automatiquement."* (présences).
- Conflict resolution copy: *"Les résultats ont changé sur le serveur. Le brouillon est conservé pour comparaison."* / *"Cet appel a changé sur le serveur. Le brouillon est conservé pour comparaison."* / *"Brouillon restauré. Rechargez les données du serveur, comparez puis enregistrez une nouvelle version."*
- Draft-integrity check on restore: *"Le brouillon ne correspond pas à la classe, la date et la session affichées."*
- Session guard before any save: `throw new Error("Session enseignant incomplète. Reconnectez-vous avant d'enregistrer.")`

**Scope:** only `scores` (note entry) and `presences` (roll call) carry queued payload renderers —
i.e. exactly the two things a teacher does in a classroom with no connectivity.

---

## 15. SURPRISE #2 — 62 embedded guided tours as a requirements corpus (CONFIRMED)

`lakoli-main.js` carries an array of 62 `{id,label,route,steps:[{title,description}]}` objects,
one per page, each step a long French paragraph stating actual rules. Pedagogy-relevant extracts
not already quoted above:

**`/affectations-enseignants` (teacher-assignments)** — 6 steps, verbatim highlights:
- *"Une affectation relie un enseignant, une classe et une matière pour l'année scolaire en cours. C'est le point de départ de tout : l'emploi du temps, les notes, le cahier de textes et l'espace enseignant se basent tous sur ces affectations."*
- *"…indiquez le volume horaire hebdomadaire prévu (ex. : 4 heures). Ce volume sera comparé aux créneaux saisis dans l'emploi du temps."*
- *"Lakoli affiche un avertissement si le volume planifié dépasse le volume prévu."*
- *"Sans cette autorisation, l'enseignant peut voir ses affectations mais ne peut pas enregistrer les absences."*
- *"Lakoli fait le lien automatiquement grâce à l'adresse e-mail. Ce lien active le suivi des heures réalisées."*
- *"Vous pouvez désactiver une affectation en cours d'année sans perdre l'historique — les notes et présences déjà saisies sont conservées."*

**`/notes`** — *"Lakoli calcule automatiquement les moyennes générales et les classements."* ·
*"Seuls les élèves inscrits dans cette classe apparaissent dans la liste."* ·
*"Appuyez sur Entrée ou Tab pour passer à l'élève suivant. Lakoli vérifie que la note est dans la plage autorisée (0 à la note maximale)."*

**`/bulletins`** — *"Chaque bulletin inclut les notes par matière, la moyenne générale, le classement, et l'appréciation du directeur."* · *"Lakoli vérifie que toutes les notes sont saisies avant de permettre la génération."* · *"Cliquez sur « Imprimer tout » pour générer les bulletins de toute la classe en un seul PDF."*

**`/periodes`** — *"Lakoli a déjà créé 3 trimestres pour vous."* · *"Une période clôturée ne peut plus être modifiée."*

**`/programmes`** — *"Chaque niveau (CP1, 6ème, Terminale…) peut avoir sa propre grille de matières avec des coefficients différents. Lakoli applique automatiquement la bonne grille selon la classe."* · *"**Lakoli normalise toutes les notes sur 20 pour calculer la moyenne générale correctement.**"*

**`/presences`** — *"Lakoli calcule automatiquement les taux d'absentéisme et peut alerter les parents des absences non justifiées."*

**`/annees-scolaires`** — *"Toutes les inscriptions, créances, notes et présences sont rattachées à l'année active."*

**`/cahier-textes`** — *"La direction consulte l'avancement, vise les séances et retrouve l'historique **sans écraser les versions précédentes**."*

**`/suivi-enseignants`** — *"Les retards, heures réalisées et validations restent rattachés au créneau et à leur auteur."*

**`/examens-nationaux`** — *"Cette page ne transmet rien à AGCE : elle centralise les données vérifiées par l'établissement."*

Onboarding checklist entry for périodes (separate array, `onboardingKey`):
`{id:"periodes-cours", onboardingKey:"periodesEvaluation", idx:4, title:"Configurez vos périodes", route:"/periodes", targetId:"tour-periodes-header"}`; classes entry
`{id:"classes", onboardingKey:"classesCreees", idx:1, route:"/classes", targetId:"tour-btn-nouvelle-classe"}`
with tip *"6ème A et 6ème B sont deux classes distinctes. Créez autant de sections que nécessaire."*

---

## 16. Cross-cutting observations

1. **`niveauInterface` is a first-class scoping dimension.** Nearly every pedagogy GET carries
   `niveauInterface` (values seen: `secondaire`, plus a `"Secondaire (Collège…"` label string in
   main). It is a *cycle-scoped UI mode*, separate from `cycle` on the entity. `sort-classes-BlfxF2cJ.js`
   is a shared chunk that orders class lists consistently across pages.
2. **Audit trail is pervasive and mandatory-motive.** Six distinct places require a free-text motive
   before a destructive/corrective action: period re-opening, evaluation correction, attendance
   re-entry, cahier-de-textes correction (≥10 chars), planning conflict override (≥10 chars),
   session cancellation, and émargement rejection.
3. **Publication is a two-phase, versioned concept**, distinct from saving, in three subsystems:
   evaluations (`publish` + `dernierePublicationVersion`), bulletins (`cloture` → async PDF job →
   auto-publish), convocations (`convocation` publish/retract with group semantics).
4. **Every generated document has a paper counterpart.** Print/blob endpoints found:
   attendance sheet (HTML print), late report (A4 landscape), timetable (A4 landscape),
   composition programme (HTML print), bulletins (per-pupil page breaks), monthly register
   (PDF + XLSX with a shared "empreinte de contrôle"), émargement sheet, PV de surveillance,
   émargement XLSX/PV, CIO CSV ×2 profiles.
5. **The client ships the backend's error vocabulary.** `affectation_requise`, `contexte_incoherent`,
   `periode_cloturee`, `date_periode`, `evaluations_initialisation`, `conflit_planification` —
   these are server error codes with client-side French renderings, i.e. the API returns
   machine-readable rule violations.

---

## 17. Reliability caveats

- The pre-extracted `lakoli-endpoints.txt` (339 lines) is a **lower bound**: it misses `getBlob`
  downloads and template-literal GETs. My §1 list re-derived them and is larger for this domain
  (98 vs 82 lines attributable to my roots).
- Where a template literal was truncated by a nested ternary (e.g. `` `/pedagogie/matieres${d?…` ``),
  I recorded the base path only; the query parameters after the ternary were not fully resolved.
- HTTP verbs are taken from the axios helper method actually called. Two paths appear only inside
  `getBlob(...)`; I normalised those to `GET`.
- Anything labelled INFERRED above is explicitly marked; everything else is a literal from the bundle.
