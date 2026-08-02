# Lakoli — DEEP AUDIT : domaine ADMISSIONS (inscriptions / préinscriptions / réinscriptions / élèves / parents / affectés-État / suppressions / onboarding)

**Méthode** : reverse-engineering du bundle Vite minifié livré en production.
**Corpus** : 149 chunks + `lakoli-main.js` (entry bundle) + `lakoli-endpoints.txt` (extraction brute).
**Convention** : `CONFIRMÉ` = la chaîne est littéralement présente dans le bundle (citée verbatim entre guillemets).
`INFÉRÉ` = déduit de la structure du code (nom de variable, condition, flux), pas d'une chaîne UI.

> **Correctif au premier audit (superficiel)** : ce seul domaine expose **71 opérations API**, pas « ~15 pour toute la plateforme ». Le domaine Admissions comprend à lui seul un moteur de décisions de fin d'année versionné et gelable (DFA), un CRM de réinscription à 6 étapes avec campagnes SMS facturées au crédit, un registre « Affectés de l'État » à journal immuable SHA-256, un workflow de suppression d'élève à double validation, et un portail public de dépôt de dossiers de préinscription.

---

## 0. Routes front & RBAC (source : `lakoli-main.js`)

| Route SPA | Composant lazy | Rôles autorisés (CONFIRMÉ) |
|---|---|---|
| `/inscriptions` | `ez` → `index-Bs3h40d0.js` | via nav : `[...jt, ...b0]` |
| `/inscriptions/nouvelle` | `rx` → `nouvelle-SJQXCeYE.js` | — |
| `/inscriptions/masse` | `rz` → `masse-Bjiynvfj.js` | — |
| `/inscriptions/fin-annee` | `sz` → `fin-annee-DQpqHLWH.js` | `allowedRoles:["super_admin","direction"]` |
| `/preinscriptions` | `tz` → `index-CS0hQPlQ.js` | — |
| `/preinscriptions/nouvelle` | `nz` → `nouvelle-3Y8GKgoA.js` | — |
| `/reinscriptions/suivi` | `cL` → `index-vQwBYpuX.js` | `jt` |
| `/eleves` | `G6` → `index-Hh45azKV.js` | `[...jt,"comptable"]` |
| `/eleves/:id` | `Y6` → `detail-6Bu9thd6.js` | — |
| `/eleves/:id/cursus` | `Q6` → `cursus-hPCmJ3nT.js` | `allowedRoles:["super_admin","direction","scolarite"]` |
| `/eleves/import` | `K6` → `import-C7PuIymD.js` | — |
| `/eleves/nouveau` | `rx` (= même page que `/inscriptions/nouvelle`) | — |
| `/parents` | `Z6` → `index-SA2flbb5.js` | — |
| `/parents/:id` | `W6` → `detail-D38s9pPJ.js` | — |
| `/parents/nouveau` | `X6` → `nouveau-BrcwQHgV.js` | — |
| `/affectations-etat` | — → `index-BKLJh4yU.js` | `jt` (+ garde interne `super_admin`/`direction`) |
| `/admin/suppressions` | — → `suppressions-C8af2J3c.js` | `An` |
| `/portail-parent/preinscriptions` | `hL` → `preinscriptions-B3gu9n4h.js` | `allowedRoles:["super_admin","direction","scolarite"]` |
| `/portail-parent/dossier/:id` | `gL` → `dossier-Bl9jo0fs.js` | `allowedRoles:["super_admin","direction","scolarite"]` |

**Constantes de rôles (CONFIRMÉ, verbatim)** :
```
im=["super_admin","direction","comptable","caissier","scolarite","enseignant","auditeur","permanent"]
om=["super_admin","direction","comptable"]
ti=["super_admin","direction","comptable","caissier"]
jt=["super_admin","direction","scolarite"]
An=["super_admin","direction"]
b0=["permanent"]
```

**Entrées de navigation du domaine (CONFIRMÉ, verbatim)** :
```
{name:"Inscriptions",path:"/inscriptions",section:"scolarite",group:"Admissions",roles:[...jt,...b0]}
{name:"Réinscriptions",path:"/reinscriptions/suivi",section:"scolarite",group:"Admissions",roles:jt}
{name:"Élèves",path:"/eleves",section:"scolarite",group:"Dossiers élèves",
   keywords:["liste des élèves","fiche élève","dossier élève","matricule"],roles:[...jt,"comptable"]}
{name:"Affectés de l’État",path:"/affectations-etat",section:"scolarite",group:"Dossiers élèves",roles:jt}
{name:"Décisions de fin d’année",path:"/inscriptions/fin-annee",section:"scolarite",group:"Orientation et examens",roles:jt}
{name:"Mode d'emploi",path:"/aide",...}
```
**Feature-gating** : seuls deux modules portent `gatedModule` dans tout le bundle — `"orientation_dob"` et `"conformite"`. **Aucun module d'Admissions n'est gated** (CONFIRMÉ). Le catalogue est chargé via `GET /module-access/catalog` → `{catalog:[{code,...}], effectiveModules:[...]}`.

---

## 1. Inventaire complet des opérations API du domaine (71)

### 1.1 `/inscriptions` (16)

| # | Opération | Chunk | Payload / query observés |
|---|---|---|---|
| 1 | `GET /inscriptions?anneeScolaireId=&niveauInterface=&statut=&classeId=&limit=` | `index-Bs3h40d0.js`, `index-TfNa1dpy.js`, `index-BGdvfv-z.js` | `statut=validee` utilisé pour la liste des validés |
| 2 | `GET /inscriptions/{id}` | `nouvelle-SJQXCeYE.js` | mode édition (`?edit=` / query `inscription`) |
| 3 | `POST /inscriptions` | `nouvelle-SJQXCeYE.js` | `{eleveId, classeId, anneeScolaireId, remise, motifRemise, categoriesOptionnellesIds, telephoneParent, modePreinscription:true}` |
| 4 | `PATCH /inscriptions/{id}/changer-classe` | `detail-6Bu9thd6.js` | `{nouvelleClasseId, motif}` |
| 5 | `PATCH /inscriptions/{id}/fin-annee` | `fin-annee-DQpqHLWH.js` | décision unitaire |
| 6 | `GET /inscriptions/fin-annee?anneeScolaireId=&niveauInterface=&classeId=` | `fin-annee-DQpqHLWH.js` | lignes de décision |
| 7 | `GET /inscriptions/fin-annee/statut?anneeScolaireId=` | `fin-annee-DQpqHLWH.js` | état gel/ouverture + empreinte |
| 8 | `GET /inscriptions/fin-annee/statistiques?anneeScolaireId=&niveauInterface=` | `fin-annee-DQpqHLWH.js` | KPI genre/moyennes |
| 9 | `GET /inscriptions/fin-annee/dfa-profile?anneeScolaireId=` | `fin-annee-DQpqHLWH.js` | `{officialRulesReference:{label}, anneeScolaire}` |
| 10 | `POST /inscriptions/fin-annee/dfa-preview` | `fin-annee-DQpqHLWH.js` | `{anneeScolaireId, classeId, contexts:[{inscriptionId, repeating:boolean}]}` |
| 11 | `POST /inscriptions/fin-annee/decisions` | `fin-annee-DQpqHLWH.js` | `{anneeScolaireId, decisions:[{inscriptionId, statutFinAnnee, moyenneAnnuelle, noteFinAnnee, classeProposeeId, motifAjustement, expectedDecisionVersion}]}` |
| 12 | `POST /inscriptions/fin-annee/finaliser` | `fin-annee-DQpqHLWH.js` | `{anneeScolaireId}` |
| 13 | `POST /inscriptions/fin-annee/rouvrir` | `fin-annee-DQpqHLWH.js` | `{anneeScolaireId, motif}` (motif ≥ 10 car.) |
| 14 | `POST /inscriptions/suggerer-statuts` | `fin-annee-DQpqHLWH.js` | `{classeId, anneeScolaireId}` → `{updated, suggestionProfile:{warning}}` |
| 15 | `POST /inscriptions/masse-reinscription` | `masse-Bjiynvfj.js` | classe source → classe dest + année dest |
| 16 | `POST /inscriptions/regenerer-creances` | `detail-6Bu9thd6.js` | `{eleveId, anneeScolaireId}` |

### 1.2 `/preinscriptions` (9)

| # | Opération | Chunk | Payload |
|---|---|---|---|
| 17 | `GET /preinscriptions?statut=` | `index-CS0hQPlQ.js` | `refetchInterval:30000` |
| 18 | `GET /preinscriptions/stats` | `index-CS0hQPlQ.js` | compteurs par statut |
| 19 | `POST /preinscriptions` | `nouvelle-3Y8GKgoA.js` | `{nomEleve, prenomEleve, classeId, anneeScolaireId, nomParent, prenomParent, telephoneParent}` |
| 20 | `PATCH /preinscriptions/{id}/statut` | `index-CS0hQPlQ.js`, `detail-6Bu9thd6.js`, `index-Bs3h40d0.js` | `{statut}` |
| 21 | `PATCH /preinscriptions/{id}/avant-encaissement` | `nouvelle-SJQXCeYE.js` | `{eleve, pere, mere, tuteur, classeId, categoriesOptionnellesIds, remise, motifRemise, telephoneParent, contactPrincipalType}` |
| 22 | `POST /preinscriptions/{id}/envoyer-lien` | `index-Bs3h40d0.js`, `index-CS0hQPlQ.js`, `nouvelle-SJQXCeYE.js` | `{}` |
| 23 | `POST /preinscriptions/{id}/paiement-especes` | idem | `{notes, montant, modePaiement, serviceStartMonths}` |
| 24 | `POST /preinscriptions/{id}/confirmer-paiement-lien` | `index-Bs3h40d0.js`, `index-CS0hQPlQ.js` | `{}` / `{reference}` |
| 25 | `POST /preinscriptions/{id}/valider` | idem | `{exceptionDirection:boolean, exceptionNote}` |

### 1.3 `/preinscriptions-portail` — portail public (6)

| # | Opération | Chunk | Payload |
|---|---|---|---|
| 26 | `GET /preinscriptions-portail?<qs>` | `preinscriptions-B3gu9n4h.js` | filtres classe / date / recherche |
| 27 | `GET /preinscriptions-portail/stats` | `index-C_ZhDXdL.js` | |
| 28 | `GET /preinscriptions-portail/{id}` | `dossier-Bl9jo0fs.js` | dossier + documents + messages |
| 29 | `PATCH /preinscriptions-portail/{id}/statut` | `dossier-Bl9jo0fs.js` | `{statut, commentaire}` |
| 30 | `POST /preinscriptions-portail/{id}/message` | `dossier-Bl9jo0fs.js` | `{message}` → SMS au parent |
| 31 | `POST /preinscriptions-portail/{id}/convertir` | `dossier-Bl9jo0fs.js` | `{}` → crée l'élève + les créances |

### 1.4 `/reinscription-suivi` (11)

| # | Opération | Chunk | Payload |
|---|---|---|---|
| 32 | `GET /reinscription-suivi?anneeScolaireDestId=&niveauInterface=&statutContact=&statutReponse=&statutFinal=` | `index-vQwBYpuX.js` | |
| 33 | `GET /reinscription-suivi/campagnes/derniere?anneeScolaireDestId=` | `index-vQwBYpuX.js` | **absent de `lakoli-endpoints.txt`** |
| 34 | `PATCH /reinscription-suivi/{id}` | `index-vQwBYpuX.js` | maj partielle : `statutContact / statutReponse / statutFinal / statutPaiement / notes / alertes / classeSuivanteId / interetCollege / dateInfoCollege / commentaireCollege` |
| 35 | `DELETE /reinscription-suivi/{id}` | `index-vQwBYpuX.js` | retirer du suivi |
| 36 | `POST /reinscription-suivi/{id}/reincrire` | `index-vQwBYpuX.js` | `{classeDestId}` |
| 37 | `POST /reinscription-suivi/initialiser` | `index-vQwBYpuX.js` | `{anneeScolaireSourceId, anneeScolaireDestId, niveauInterface}` → `{created,total}` |
| 38 | `POST /reinscription-suivi/import` | `index-vQwBYpuX.js` | `{rows:[{nom,prenoms,classeNom,nomParent,telephoneParent}], anneeScolaireDestId}` → `{suiviCrees, elevesCrees, parentsCrees, doublons}` |
| 39 | `POST /reinscription-suivi/campagne` | `index-vQwBYpuX.js` | `{ids, anneeScolaireDestId}` (campagne WhatsApp manuelle) |
| 40 | `POST /reinscription-suivi/reincrire-confirmes` | `index-vQwBYpuX.js` | `{anneeScolaireDestId, niveauInterface}` → `{reinscrit}` |
| 41 | `POST /reinscription-suivi/sms-campaign/preview` | `index-vQwBYpuX.js` | `{ids\|filtreRapide, anneeScolaireDestId, message}` |
| 42 | `POST /reinscription-suivi/sms-campaign/send` | `index-vQwBYpuX.js` | `{…, message, cibleLabel}` — **HTTP 402 si solde insuffisant** |

### 1.5 `/eleves` (13)

| # | Opération | Chunk | Détail |
|---|---|---|---|
| 43 | `GET /eleves?limit=2000&search=&cycles=&classeId=&filtre=&statut=` | `index-Hh45azKV.js` | `filtre` ∈ `sans_classe` \| `sans_parent` |
| 44 | `GET /eleves/{id}` | `index-BGdvfv-z.js`, `index-BVP1-WeZ.js`, `nouvelle-SJQXCeYE.js`, client généré `/api/eleves/{id}` | |
| 45 | `GET /eleves/search?q=` | 6 chunks (`nouvelle-SJQXCeYE`, `index-BVP1-WeZ`, `index-BGdvfv-z`, `index-Cj0ROcZS`, `index-DxBtz_yd`, `index-ozVJACnZ`) | déclenché à ≥ 2 caractères |
| 46 | `GET /eleves/export?cycles=&classeId=` | `index-Hh45azKV.js` | **absent de `lakoli-endpoints.txt`** — export CSV élèves+parents |
| 47 | `GET /eleves/prochain-matricule` | `infos-generales-yXdBOVsG.js` | prévisualisation du prochain matricule |
| 48 | `GET /eleves/{id}/cursus` | `cursus-hPCmJ3nT.js` | parcours pluriannuel |
| 49 | `GET /eleves/{id}/audit` | `detail-6Bu9thd6.js` | journal d'audit |
| 50 | `GET /eleves/{id}/historique` | `detail-6Bu9thd6.js` | historique d'inscriptions/transferts |
| 51 | `GET /eleves/{id}/situation-financiere` | `index-BVP1-WeZ.js` + client généré | |
| 52 | `POST /eleves` | `nouvelle-SJQXCeYE.js` | `{nom,prenoms,sexe,dateNaissance,lieuNaissance,nationalite,telephoneParent,statut:"inscrit",estRedoublant,estAffecte,matriculeManuel,anneeScolaireId}` |
| 53 | `POST /eleves/eleves-parents` | `nouvelle-SJQXCeYE.js` | `{eleveId, parentId, lien, principal:0\|1}` |
| 54 | `POST /eleves/import-batch` | `import-C7PuIymD.js` | `{rows, anneeScolaireId, genererCreances, confirmationSansCreances, niveauInterface}` |
| 55 | `PATCH /eleves/{id}` | `detail-6Bu9thd6.js`, `nouvelle-SJQXCeYE.js` | fiche complète + `photoObjectPath` |

### 1.6 `/parents` (4)

| # | Opération | Chunk |
|---|---|---|
| 56 | `GET /parents?search=&limit=&niveauInterface=` | `index-SA2flbb5.js`, `index-B59sXdjb.js`, `index-DuZBT_7c.js` |
| 57 | `GET /parents/{id}` | `detail-D38s9pPJ.js` |
| 58 | `POST /parents` | `nouvelle-SJQXCeYE.js` + client orval `createParent` → `/api/parents` |
| 59 | `PATCH /parents/{id}` | `detail-6Bu9thd6.js` |

### 1.7 `/affectations-etat` (5)

| # | Opération | Chunk | Détail |
|---|---|---|---|
| 60 | `GET /affectations-etat?anneeScolaireId=&niveauInterface=&classeId=&statut=&recherche=` | `index-BKLJh4yU.js` | renvoie `{rows, summary:{inscriptions,nonRenseignees,aVerifier,confirmeesInternes}}` |
| 61 | `GET /affectations-etat/{id}/events` | `index-BKLJh4yU.js` | journal immuable, chaque event porte `snapshotSha256` |
| 62 | `POST /affectations-etat` | `index-BKLJh4yU.js` | `{inscriptionId, statut, sourceType, sourceReference, sourceDate, numeroDecision, dateEffet, observations}` |
| 63 | `PUT /affectations-etat/{id}` | `index-BKLJh4yU.js` | mêmes champs + `motif` obligatoire ≥ 10 car. |
| 64 | `POST /affectations-etat/{id}/{action}` | `index-BKLJh4yU.js` | `action` ∈ `confirmer` \| `retirer` \| `retablir`, body `{motif}` |

### 1.8 `/demandes-suppression` (4)

| # | Opération | Chunk | Détail |
|---|---|---|---|
| 65 | `GET /demandes-suppression` | `suppressions-C8af2J3c.js` | |
| 66 | `POST /demandes-suppression` | `detail-6Bu9thd6.js` | `{eleveId, motif}` |
| 67 | `PATCH /demandes-suppression/{id}/approuver` | `suppressions-C8af2J3c.js` | `{commentaire}` (facultatif) |
| 68 | `PATCH /demandes-suppression/{id}/rejeter` | `suppressions-C8af2J3c.js` | `{commentaire}` (**obligatoire**) |

### 1.9 `/onboarding` (3)

| # | Opération | Chunk |
|---|---|---|
| 69 | `GET /onboarding/status` (`refetchInterval:60000`, `refetchOnWindowFocus:true`) | `lakoli-main.js` |
| 70 | `POST /onboarding/bienvenue-vu` | `lakoli-main.js` |
| 71 | `POST /onboarding/portail-teste` | `lakoli-main.js` |

---

## 2. Énumérations de statuts (toutes CONFIRMÉES, libellés verbatim)

### 2.1 Pipeline d'inscription — vue « Inscriptions » (`index-Bs3h40d0.js`)
```js
Ne=[{key:"preinscription_creee",label:"Inscription rapide créée",prochaine:"Envoyer le lien de paiement ou encaisser les espèces"},
    {key:"paiement_demande",  label:"Paiement demandé",  prochaine:"Attendre le paiement — relancer par téléphone si nécessaire"},
    {key:"paiement_recu",     label:"Paiement reçu",     prochaine:"Vérifier le dossier et marquer complet"},
    {key:"dossier_complet",   label:"Dossier complet",   prochaine:"Contrôle et validation finale"},
    {key:"validee",           label:"Inscrit(e)",        prochaine:""}]
ve=["preinscription_creee","paiement_demande","paiement_recu","dossier_complet"]   // = « En cours »
```

### 2.2 Même pipeline — vue « Pré-inscriptions » (`index-CS0hQPlQ.js`), libellés différents
```js
k=[{key:"preinscription_creee",label:"Pré-inscription créée",prochaine:"Envoyer le lien de paiement ou encaisser les espèces"},
   {key:"paiement_demande",    label:"Paiement demandé",     prochaine:"Attendre le paiement — relancer par téléphone si nécessaire"},
   {key:"paiement_recu",       label:"Paiement reçu",        prochaine:"Compléter le dossier si nécessaire"},
   {key:"dossier_complet",     label:"Dossier complet",      prochaine:"Contrôle et validation par le secrétariat (Abidjan)"}]
```
Cartes KPI cliquables (`href` = filtre) :
`"Dossiers à traiter"` 🟡 `?statut=preinscription_creee` — desc `"Lien non encore envoyé"`
`"Paiements à relancer"` 🟠 `?statut=paiement_demande` — desc `"Lien envoyé — en attente"`
`"Dossiers à compléter"` 🔵 `?statut=paiement_recu` — desc `"Payé — documents à vérifier"`
`"En attente validation"` 🟢 `?statut=dossier_complet` — desc `"Prêt pour le secrétariat"`

### 2.3 Statut d'inscription — badge fiche élève (`detail-6Bu9thd6.js`)
```js
{confirmee:"Confirmée", validee:"Validée", en_attente:"En attente",
 preinscription_creee:"Dossier créé", paiement_demande:"Lien envoyé",
 paiement_recu:"Paiement reçu", dossier_complet:"Dossier complet", annulee:"Annulée"}
```

### 2.4 Portail public de préinscription (`dossier-Bl9jo0fs.js`, `preinscriptions-B3gu9n4h.js`)
```js
k={preinscription_creee:"Nouveau", dossier_incomplet:"Incomplet", dossier_complet:"Dossier validé",
   paiement_demande:"Paiement demandé", paiement_recu:"Paiement reçu",
   validee:"Inscrit(e)", annulee:"Refusé"}
```
**Machine à états des actions autorisées (CONFIRMÉ, verbatim)** :
```js
ae={ preinscription_creee:[{label:"Marquer incomplet",statut:"dossier_incomplet",variant:"warn"},
                           {label:"Valider le dossier",statut:"dossier_complet",variant:"success"},
                           {label:"Refuser",statut:"annulee",variant:"danger"}],
     dossier_incomplet   :[{label:"Valider le dossier",statut:"dossier_complet"},{label:"Refuser",statut:"annulee"}],
     dossier_complet     :[{label:"Marquer incomplet",statut:"dossier_incomplet"},{label:"Refuser",statut:"annulee"}],
     paiement_demande    :[{label:"Confirmer paiement reçu",statut:"paiement_recu"},{label:"Refuser",statut:"annulee"}],
     paiement_recu       :[{label:"Refuser",statut:"annulee"}],
     annulee:[], validee:[] }
// bouton « Confirmer l'inscription » visible seulement si statut ∈ ["dossier_complet","paiement_recu"]
// dossier verrouillé si statut ∈ ["validee","annulee"]
```

### 2.5 Suivi réinscription — **4 axes de statut indépendants** (`index-vQwBYpuX.js`)
```js
ue={ contact  :{non_contacte:"Non contacté", contacte:"Contacté", injoignable:"Injoignable",
                numero_incorrect:"N° incorrect", rappel:"Rappel prévu"},
     reponse  :{pas_de_reponse:"Pas de réponse", interesse:"Intéressé", indecis:"Indécis",
                confirme:"Confirmé ✓", refus:"Refus ✗"},
     final    :{non_traite:"Non traité", en_cours:"En cours", reinscrit:"Réinscrit ✓", refus:"Refus"},
     paiement :{non_paye:"Non payé", en_attente:"En attente", paye:"Payé ✓"} }
```
**Étiquettes d'alerte (tags multi-sélection, stockés en JSON dans `alertes`)** :
```js
Je=[{key:"parent_inquiet",       label:"😟 Parent inquiet"},
    {key:"rappel_demande",       label:"🔔 Rappel demandé"},
    {key:"info_contradictoires", label:"⚠️ Infos contradictoires"},
    {key:"risque_depart",        label:"🚨 Risque de départ"}]
```
**Axe « Intérêt collège » (spécifique CM2)** : `sans_reponse` = `"Sans réponse"`, `oui` = `"Intéressé (Oui)"`, `non` = `"Pas intéressé (Non)"`, `a_rappeler` = `"A rappeler"`.
Détection CM2 (CONFIRMÉ) : `_e(t){return !!t.classeActuelle?.nom?.toLowerCase().includes("cm2")}`

### 2.6 Statuts de fin d'année / DFA (`fin-annee-DQpqHLWH.js`, `cursus-hPCmJ3nT.js`)
```js
D={admis:"Admis", ajourné:"Ajourné", redoublant:"Redoublant", exclu:"Exclu",
   transféré:"Transféré", sortant:"Sortant", en_attente:"En attente"}
```
(NB : les clés `ajourné` / `transféré` portent des **accents dans la clé technique** — CONFIRMÉ.)

**Codes de blocage / non-calculabilité DFA (CONFIRMÉ, verbatim)** :
```js
Te={ entrees_mga_primaire_non_identifiees:"Compositions mensuelles et de passage non identifiées",
     cycle_non_couvert_par_dfa            :"Cycle non couvert par ce profil",
     contrat_t1_t2_t3_incomplet           :"Trois trimestres T1/T2/T3 requis",
     bulletin_officiel_publie_manquant    :"Bulletin officiel publié manquant",
     mga_secondaire_incalculable          :"MGA secondaire incalculable",
     statut_redoublant_a_confirmer        :"Historique de redoublement à confirmer" }
```

### 2.7 Affectations État (`index-BKLJh4yU.js`)
```js
w={non_renseignee:"Non renseignée", declaree:"Déclarée", a_verifier:"À vérifier",
   confirmee_interne:"Confirmée en interne", retiree:"Retirée"}
// sourceType :
declaration_etablissement = "Déclaration de l’établissement"
document_historique       = "Document historique"
rapprochement_fichier     = "Rapprochement de fichier"
// eventType du journal :
n={creation:"Création", modification:"Correction", confirmation_interne:"Confirmation interne",
   retrait:"Retrait", retablissement:"Rétablissement"}
```

### 2.8 Demandes de suppression (`suppressions-C8af2J3c.js`)
```js
N={en_attente:"En attente", approuvee:"Approuvée — élève supprimé", rejetee:"Rejetée"}
```

### 2.9 Types de documents élève (`detail-6Bu9thd6.js`)
```js
Fr=[{value:"acte_naissance",label:"Pièce d'état civil"},{value:"photo",label:"Photo d'identité"},
    {value:"bulletin",label:"Bulletin scolaire"},{value:"certificat_scolarite",label:"Certificat de scolarité"},
    {value:"carte_identite",label:"Carte d'identité"},{value:"certificat_medical",label:"Certificat médical"},
    {value:"justificatif_domicile",label:"Justificatif de domicile"},{value:"autre",label:"Autre document"}]
xs={a_controler:"À contrôler", conforme:"Conforme", a_corriger:"À corriger"}   // contrôle de conformité de pièce
// nature de la pièce d'état civil :
extrait_naissance = "Extrait / acte de naissance" | jugement_suppletif = "Jugement supplétif"
```

### 2.10 Modes de paiement (utilisé dans les modales d'encaissement d'inscription)
```js
Gs=[{key:"especes",label:"Espèces",emoji:"💵"},{key:"cheque",label:"Chèque",emoji:"📄"},
    {key:"virement",label:"Virement",emoji:"🏦"},{key:"wave",label:"Wave",emoji:"🌊"},
    {key:"orange_money",label:"Orange Money",emoji:"🟠"},{key:"mtn_money",label:"MTN MoMo",emoji:"📱"},
    {key:"djamo",label:"Djamo",emoji:"💳"},{key:"autre",label:"Autre",emoji:"💰"}]
```

### 2.11 Types de communication tracés sur la fiche élève
```js
appel="Appel téléphonique", sms="SMS", email="Email", courrier="Courrier",
rencontre="Rencontre / visite", paystack="Lien de paiement"
```

### 2.12 Catégories de ventes ponctuelles (fiche élève, onglet Ventes)
```js
uniforme="Uniforme / Tenue", voyage="Voyage scolaire", materiel="Matériel scolaire",
evenement="Événement / Spectacle", copie="Copies / Duplicata", autre="Autre"
```

### 2.13 Cycles d'abonnement de service (fiche élève, onglet Services)
```js
monthly="Mensuel", per_term="Par trimestre" (badge "Trimestriel"), annual="Annuel"
// statut abonnement : "Actif" | "Suspendu" | "Résilié"
```

---

## 3. Inventaire des formulaires (CONFIRMÉ)

### 3.1 `/inscriptions/nouvelle` — « Nouvelle inscription » (`nouvelle-SJQXCeYE.js`)

**Sélecteur de mode** (2 boutons) : `"Nouvel élève"` (`nouveau`) / `"Élève existant (réinscription)"` (`existant`).
**Onglets** : `gs=[{id:"infos",label:"Informations"},{id:"finance",label:"Finance"},{id:"documents",label:"Documents"}]`
Garde de navigation (CONFIRMÉ) : `if(s.id==="documents"&&i){f("finance");return}` où `i=!!b&&O===0` → **on ne peut pas atteindre l'onglet Documents tant que le total attendu des frais est 0 pour la classe choisie** ; l'app renvoie sur Finance.

**Section « Rechercher l'élève »** (mode existant) : placeholder `"Nom, prénom ou matricule..."`.

**Section Élève** — état initial :
```js
ss={nom:"",prenoms:"",sexe:"M",jourNaissance:"",moisNaissance:"",anneeNaissance:"",
    lieuNaissance:"",nationalite:"Ivoirienne",photoUrl:"",statut:"inscrit",
    estRedoublant:false,estAffecte:false,matriculeManuel:""}
```
- Date de naissance décomposée en 3 sélecteurs (jour / mois FR `["Janvier"…"Décembre"]` / année : `Array.from({length:30},(g,m)=>new Date().getFullYear()-m-3)` → 30 années glissantes à partir de année-3).
- `Nationalité` défaut `"Ivoirienne"`.
- Champ **Matricule** : label `"Matricule"` + `"(laissez vide pour génération automatique)"`, placeholder `"Ex : MENET-26-00123 ou laisser vide"`, aide : `"Si l'État a déjà attribué un matricule à cet élève, saisissez-le ici."`
- Cases à cocher : `"Redoublant(e)"`, `"Affecté(e) État"`.

**Section « Contacts parents *»** — 3 blocs Père / Mère / Tuteur, chacun : `Nom du père` / `Nom de la mère` / `Nom du tuteur`, `Prénoms`, `Téléphone`, `Profession`.
Chaque bloc porte un bouton bascule `"✓ Contact principal"` (état `contactPrincipalType` ∈ `pere|mere|tuteur`).

**Section Classe** : select `— Sélectionner —` groupé.
Si l'année cible n'a pas de classes : bandeau + bouton `Copier les classes depuis {année}` → `POST /classes/dupliquer {sourceAnneeId,targetAnneeId}`.

**Onglet Finance** : frais obligatoires auto-affichés ; services optionnels multi-sélection (`categoriesOptionnellesIds`) ; remise (`type:"pourcentage"` → `Math.round(base*valeur/100)`, sinon montant fixe) ; total = `max(0, brutAttendu - remise)`.
Types de frais mappés : `ts={inscription:"Inscription",reinscription:"Réinscription",scolarite:"Scolarité",transport:"Transport",cantine:"Cantine",examens:"Examens",activites:"Activités",autres:"Autres"}`

**Onglet Documents** — deux listes selon le mode :
```js
// nouvel élève (Js) :
photo_identite         "Photos d'identité (x2)"                    desc "Format identité, fond blanc"
extrait_naissance      "Fiche d'état civil ou extrait de naissance" desc "Original ou copie certifiée"
carnet_vaccination     "Photocopie carnet de vaccination"           desc "Pages des vaccins obligatoires"
dossier_origine        "Dossier complet de l'école d'origine"       desc "Bulletins, attestations, etc."
autorisation_parentale "Justificatif d'autorité parentale"          desc "Requis si parents divorcés, séparés ou tuteur légal"
fiche_inscription      "Fiche d'inscription signée"                 desc "Avec adresse mail active"
// réinscription (Ys) :
photo_identite         "Photo d'identité (x1)"                      desc "Format identité, fond blanc"
fiche_reinscription    "Fiche de réinscription signée"              desc "Avec adresse mail active"
```
Upload → `POST /documents-eleve {eleveId,nom,type,objectPath,mimeType}` ; si `photo_identite` et MIME image → `PATCH /eleves/{id} {photoObjectPath}`.

**Écran de succès** : `"Dossier créé !"`, `"Télécharger le reçu double volet"`, `" Modifier l'inscription avant encaissement"`, `" Encaisser maintenant"`, `"Voir la liste des inscriptions "`.
Le reçu passe par `POST /documents/finaliser {type:"recu",params:{paiementId}}` puis `/api/documents/{id}/download`.

**Modale « Paiement manuel »** : `"Sélectionnez le mode de règlement reçu et entrez le montant."`
Champs : `Mode de paiement *` (grille 4×2 des 8 modes), `Montant reçu (FCFA) *` (placeholder `"Ex : 15000"`), `Commentaires (facultatif)` (placeholder `"Ex : Reçu remis, règlement par chèque n°…"`).
Validations : `"Le montant doit être supérieur à 0 FCFA."`, `"Champ obligatoire."`

### 3.2 `/preinscriptions/nouvelle` (`nouvelle-3Y8GKgoA.js`) — formulaire ultra-court
Champs : `Nom *` (`"Ex : KOUASSI"`), `Prénom(s)` (`"Ex : Jean-Marc"`), `Classe souhaitée *` (optgroup par cycle), `Nom` parent (`"Ex : KOUASSI"`), `Prénom(s)` parent (`"Ex : Jean"`), `Téléphone *` (`"Ex : +225 07 00 00 00 00"`).
Validation client : `"Nom de l'élève, classe et téléphone sont obligatoires."`
Pied de page : `"Statut créé : Pré-inscription créée — Le lien de paiement peut être envoyé immédiatement."`

### 3.3 `/parents/nouveau` (`nouveau-BrcwQHgV.js`)
`Nom *` (`NOM`), `Prénoms *` (`Prénom(s)`), téléphone principal (`07 00 00 00 00`), `Téléphone secondaire` (`05 00 00 00 00`), `Email` (`email@exemple.ci`), `Profession`, `Adresse` (`Quartier, Commune, Abidjan`), `Note interne` (`"Informations utiles à l'administration..."`).

### 3.4 Fiche élève — modale « Modifier le profil » (`detail-6Bu9thd6.js`)
Avertissement : `"Toute modification est enregistrée dans le journal d'audit avec votre identité."`
Champs : `Sexe` (`Masculin`/`Féminin`), `Date de naissance`, `Lieu de naissance`, `Nationalité`, `Adresse`,
**Contacts parents** : `Nom du père` (`"Ex: COULIBALY Ibrahim"`), `Téléphone père` (`+225 07 00 00 00 00`), `Nom de la mère` (`"Ex: COULIBALY Aïssatou"`), `Téléphone mère` (`+225 05 00 00 00 00`),
**Scolarité précédente** : `École précédente`, `Classe précédente`, `Année précédente`,
**Données de santé & urgence** : `Groupe sanguin`, `Mutuelle / Assurance` (`"Ex: MUGEFCI, CNPS..."`), allergies (`"Ex: Pénicilline, arachides, latex..."`), pathologies (`"Ex: Asthme, diabète, traitement médicamenteux..."`), `Contact d'urgence` → `Nom complet` (`"Ex: Kouamé Jean"`), `Téléphone` (`"Ex: 07 00 00 00 00"`), `Relation avec l'élève` (`"Ex: Père, Mère, Tuteur, Oncle..."`).

### 3.5 Fiche élève — modale « Ajouter au dossier élève »
`Type de document` (8 valeurs §2.9) + bloc « Nature de la pièce » quand `acte_naissance` :
`"Ces informations permettent à la scolarité de contrôler la pièce sans renommer le fichier original."`
Sous-champs : `Nature de la pièce` (`Extrait / acte de naissance` | `Jugement supplétif`), numéro, `Date de délivrance`, `Lieu de délivrance`.
Règle : si `type==="acte_naissance" && natureEtatCivil==="jugement_suppletif" && !numeroPiece` → toast `"Numéro requis"` / `"Renseignez le numéro du jugement supplétif."` (CONFIRMÉ).

### 3.6 Fiche élève — modale « Demander la suppression »
`"Cette demande sera soumise à un admin de la direction pour approbation. La suppression est définitive et efface toutes les données liées à cet élève."`
Motif, placeholder : `"Ex: Erreur de saisie lors de l'inscription, doublon, mauvais élève inscrit..."`

### 3.7 Fiche élève — « Nouvelle vente ponctuelle »
`Libellé *` (`"Ex: Uniforme complet, Voyage Yamoussoukro..."`), `Montant (FCFA) *` (`15000`), `Catégorie` (§2.12), `Notes (optionnel)` (`"Remarque ou référence..."`).
Bandeau : `"Uniformes, voyages scolaires, matériel, frais exceptionnels…"`

### 3.8 Fiche élève — « Nouvel abonnement » (services)
`Service` (`Choisir un service…`), `Date de début`, `Cycle de facturation` (`Mensuel`/`Par trimestre`/`Annuel`), `Montant mensuel (FCFA)` (`Ex: 15000`) ou `Montant annuel (FCFA)` (`Ex: 150000`), `Notes` (`Remarques...`).
Suspension : modale `"Suspendre des mois"` → `"Les mois sélectionnés seront annulés (plus de dette) et marqués comme suspendus dans l'onglet Finance."` ; garde `"Cochez au moins un mois à suspendre."`

### 3.9 `/eleves/import` — import de masse (`import-C7PuIymD.js`)
Colonnes attendues (`X`) et libellés (`T`) — **CONFIRMÉ verbatim** :
```
nom                  → "Nom *"                          (obligatoire)
prenoms              → "Prénoms *"                      (obligatoire)
sexe                 → "Sexe (M/F) *"                   (obligatoire)
dateNaissance        → "Date naissance (JJ/MM/AAAA)"
lieuNaissance        → "Lieu naissance"
classeNom            → "Classe (nom exact) *"           (obligatoire)
parentNom            → "Nom parent"
parentPrenoms        → "Prénoms parent"
telephoneParent      → "Téléphone parent"
telephone2Parent     → "2eme telephone parent"
lienParente          → "Lien (père/mère/tuteur)"
montantDejaEncaisse  → "Montant déjà encaissé (optionnel, 0 par défaut)"
```
Champs obligatoires : `J=["nom","prenoms","sexe","classeNom"]`.
Le parseur accepte **des dizaines d'alias de colonnes** (ex. pour le téléphone : `telephone_parent, telephone_1, tel_1, tel1, telephone, tel, phone, mobile, mobile_1, gsm, gsm_1, num_tel, numero_tel, numero_telephone, contact`) — normalisation NFD + suppression des accents/espaces.
Séparateurs supportés : `; , | tabulation` ; formats `.csv, .txt, .xlsx, .xls` ; `"Formats supportés: .csv, .txt — Encodage UTF-8 ou UTF-8 BOM"`.
Colonnes du tableau d'aperçu : `L.` `Statut` `Nom` `Prénoms` `Sexe` `Classe` `Parent / Tél` `Déjà encaissé` `Erreur`.
Résultats par ligne : `ok` / `doublon` (`"Déjà inscrit cette année"`) / `error` (`Classe introuvable: "…"`).

### 3.10 `/inscriptions/masse` — réinscription en masse (`masse-Bjiynvfj.js`)
`Classe source (élèves à réinscrire)` (`-- Classe actuelle --`), `Classe destination` (`-- Classe suivante --`), `Année scolaire destination` (`-- Sélectionner une année --`).
Résultat : `Réinscrits`, `Déjà inscrits`.

### 3.11 Réinscription — modale de lien de paiement (`index-vQwBYpuX.js`)
`Créance à régler *` (`"Aucune créance trouvée"`, `"pré-rempli depuis la créance"`), `Montant` (`"Ex : 72000"`), `Téléphone parent` (`"+225 07 00 00 00 00"`).

---

## 4. En-têtes de tableaux (CONFIRMÉ)

| Écran | Colonnes |
|---|---|
| `/eleves` | `Matricule` · `Nom & Prénoms` · `Sexe` · `Classe` · `Statut` · `Actions` |
| `/reinscriptions/suivi` | `Élève` · `Classe actuelle` · `Classe suivante` · `Téléphone` · `Contact` · `Réponse parent` · `Paiement` · `Statut` · `Notes & Alertes` · `Actions` |
| `/inscriptions/fin-annee` | `Élève` · `Aide proposée` · `Contexte / aperçu DFA` · `Moyenne` · `Statut final` · `Classe proposée N+1` · `Note` · `Validé` · `Document` |
| `/affectations-etat` | `Élève` · `Classe` · `État` · `Source` · `Décision` · `Actions` |
| Portail préinscriptions | `Enfant` · `Classe` · `Téléphone` · `Statut` · `Déposé le` |
| Fiche élève › Créances | `Libellé` · `Échéance` · `Dû brut` · `Remise` · `Payé` · `Reste` · `Statut` · `Lien paiement` |
| Import élèves | `L.` · `Statut` · `Nom` · `Prénoms` · `Sexe` · `Classe` · `Parent / Tél` · `Déjà encaissé` · `Erreur` |
| Export CSV élèves | `Classe;Matricule;Nom;Prénoms;Sexe;Date de naissance;Statut;Parent 1 — Nom;Parent 1 — Relation;Parent 1 — Téléphone;Parent 1 — Email;Parent 2 — Nom;Parent 2 — Relation;Parent 2 — Téléphone;Parent 2 — Email;Tél. Père (fiche);Tél. Mère (fiche)` (séparateur `;`, BOM UTF-8, nom `eleves_parents_{classe}_{YYYY-MM-DD}.csv`) |

---

## 5. Onglets & filtres (CONFIRMÉ)

**Fiche élève `/eleves/:id`** — 9 onglets (le 9e conditionnel) :
```js
$e=[{id:"profil",label:"Vue d’ensemble"},{id:"sante",label:"Santé"},{id:"finance",label:"Finance"},
    {id:"pedagogie",label:"Pédagogie"},{id:"ventes",label:"Ventes"},{id:"services",label:"Services"},
    {id:"historique",label:"Historique"},{id:"documents",label:"Documents"},
    ...Rt?[{id:"fichiers",label:"Fichiers"}]:[]]
Wt=["profil","pedagogie","finance","documents","historique"]  // barre desktop
Ht=["profil","pedagogie","finance"]                            // barre mobile ; le reste sous « Plus »
```

**`/inscriptions`** — 3 onglets + 4 KPI cliquables :
onglets `En attente · {n}` / `Actifs · {n}` / `Tous · {n}` (clés `en_cours`, `valides`, `tous`).
KPI : `En cours` (« Dossiers à traiter »), `Inscrits validés` (« Inscription confirmée »), `Soldes en attente` (« Parmi les inscrits »), `Total dossiers` (« Toutes catégories »).

**`/reinscriptions/suivi`** — 6 filtres déroulants (CONFIRMÉ) :
- Contact : `Tous contacts` / `Non contacté` / `Contacté` / `Injoignable` / `N° incorrect` / `Rappel prévu`
- Réponse : `Toutes réponses` / `Pas de réponse` / `Intéressé` / `Indécis` / `Confirmé` / `Refus`
- Statut : `Tous statuts` / `Non traité` / `En cours` / `Réinscrit`
- Paiement : `Tout paiement` / `Non payé` / `En attente` / `Payé`
- Tri : `Tri par défaut` / `↓ Plus récent d'abord` / `↑ Plus ancien d'abord`
- Intérêt collège : `Tout interet college` / `Interesse (Oui)` / `Pas interesse (Non)` / `A rappeler` / `Sans reponse`
- Bascule : `"Afficher uniquement les élèves sans contact depuis plus de 7 jours"` (fenêtre `Date.now()-6048e5`)

**KPI du suivi réinscription** : `Total`, `Non contactés`, `Rappels prévus`, `Intéressés`, `Indécis`, `Confirmés`, `Réinscrits`, `Montant encaissé` + bloc CM2 : `Total CM2`, `Informés`, `A rappeler`, `Sans réponse`.

**Cibles de campagne SMS** : `Non réinscrits` (`tous_non_reinscrits`), `Élèves filtrés à l'écran` (`filtres_ecran`), `Non contactés` (`non_contactes`), `Contactés mais non réinscrits` (`contactes_non_reinscrits`), `selection`.

**`/affectations-etat`** — filtres : `Toutes les classes`, `Tous les états`, recherche `"Matricule, nom ou prénom"`.

---

## 6. Règles métier énoncées dans l'UI (CONFIRMÉ — citations verbatim)

### 6.1 Règle de validation d'inscription (la plus forte du domaine)
> **« Règle absolue »** — *« Une inscription ne peut jamais être validée sans paiement confirmé dans Lakoli, sauf autorisation expresse de la Direction. »*

Modale de validation :
> *« Validation administrative uniquement »* — *« Valider l'inscription active l'élève et génère les créances annuelles. Cette action ne constitue pas un encaissement et ne remplace pas l'enregistrement d'un paiement. »*
> Case à cocher : *« Autorisation Direction (exception sans paiement) »* + textarea `"Motif de l'autorisation..."` → `POST /preinscriptions/{id}/valider {exceptionDirection, exceptionNote}`.
> Bouton : *« Valider définitivement »*. Cas bloqué : *« Validation impossible »*.

### 6.2 Visibilité conditionnelle de l'élève
> *« Tant que les frais d'inscription ne sont pas encaissés et l'inscription validée, l'élève reste ici dans **En cours** et n'apparaît pas encore dans la liste Élèves. C'est ici que vous pouvez relancer les parents et faire avancer les dossiers. »*
> *« Effectif affiché : élèves inscrits. Les préinscriptions restent consultables dans la liste sans gonfler cet effectif. »*
> *« Vos élèves inscrits s'affichent ici dans [En cours] tant qu'un paiement n'a pas été encaissé. […] Le dossier est activé automatiquement dès que le paiement est enregistré. »*

### 6.3 Verrouillage financier après premier encaissement
> *« Dossier en attente de paiement » / « Aucun encaissement enregistré — les informations peuvent encore être modifiées. »*
> (onboarding, étape 7) *« Tant qu'aucun paiement n'a été enregistré, vous pouvez corriger librement. **Après le premier encaissement, le dossier financier est verrouillé.** »*
> Chemin d'échappement avant encaissement : bouton *« Modifier l'inscription avant encaissement »* → `PATCH /preinscriptions/{id}/avant-encaissement`.

### 6.4 Décisions de fin d'année — souveraineté du conseil de classe
> *« Les suggestions affichées restent une aide locale et consultative. La décision du conseil demeure obligatoire ; aucun fichier ActuMoyenne/DFA n'est annoncé compatible tant qu'un export actuel anonymisé n'a pas été validé. »*
> *« Décision humaine requise · jamais appliquée automatiquement »*
> *« Les cycles primaire et secondaire ne sont jamais additionnés dans cette vue. Bulletins publiés uniquement. »*
> *« Confirmez pour chaque élève s'il redouble déjà cette classe, puis lancez la prévisualisation. Le résultat ne remplit jamais la moyenne, l'aide locale ou le statut final : le conseil conserve la décision. »*
> *« Lecture seule : aucune moyenne, suggestion ou décision existante n'a été modifiée. »*
> *« … période(s) incluse(s) disposent d'un bulletin officiel publié pour tous les élèves. Aucune moyenne partielle ne sera utilisée. »*
> *« Enregistrez ici les résultats et décisions de passage (admis, redouble) par classe. Cette étape doit être complétée avant de lancer les réinscriptions. »*

**Gel / réouverture (contrôles techniques CONFIRMÉS)** :
- Bouton `« Finaliser et geler l'année »` — désactivé si des modifications non enregistrées existent (`Object.keys(w).length>0`) → toast `« Fin d'année gelée » / « Les décisions sont désormais immuables et traçables. »`
- Après gel : bandeau `« Année finalisée et gelée — empreinte {…} »` + boutons `Majors Excel` / `Rouvrir`.
- Réouverture : `window.prompt("Motif obligatoire de réouverture (10 caractères minimum) :")`, refus si `< 10` caractères → toast `« Fin d'année rouverte » / « La correction sera conservée dans le journal d'audit. »`
- Correction d'une décision **déjà validée** : `window.prompt("Motif de correction des décisions déjà validées (10 caractères minimum) :")`, refus si `< 10`.
- **Verrouillage optimiste** : chaque décision envoie `expectedDecisionVersion:Number(p?.decision_version??0)` ; l'erreur serveur `error==="decision_concurrente"` déclenche le toast `« Décision modifiée entre-temps »` et un refetch.
- Pré-condition `dfa-preview` : `« Confirmez le statut redoublant pour {n} élève(s). »` (jeté côté client avant l'appel).
- Documents post-gel : `POST /documents/finaliser {type:"liste_majors"}` → `« Le classeur reprend exactement le snapshot annuel finalisé. »` ; PDF → `« Le PDF a été généré depuis le snapshot finalisé. »`

### 6.5 Réinscription — parcours obligatoire en 6 étapes
> *« Cette page concerne uniquement vos élèves déjà présents cette année, pour préparer leur passage à l'année suivante. Suivez les 6 étapes dans l'ordre : Résultats → Initialiser → Contacter → Réponses → Encaisser → Réinscrire. »*
> Bandeau du parcours : `« Parcours réinscription »` / `« Suivez les étapes dans l'ordre »`

Définition littérale des étapes (CONFIRMÉ) :
```js
1 "Résultats fin d'année" desc "Saisir les résultats"      href "/app/inscriptions/fin-annee"  done: total>0
2 "Initialiser"           desc "Préparer la liste"          action initialiser                  done: total>0
3 "Contacter"             desc "Appeler / WhatsApp"         action campagne                     done: nonContactes===0 && total>0
4 "Réponses"              desc "Marquer confirmés"          action filtreConfirme               done: confirmes>0 && nonContactes===0
5 "Encaisser"             desc "Envoyer lien de paiement"   action filtrePaiementPaye           done: payes>0
6 "Réinscrire"            desc "Valider les réinscriptions" action filtreConfirme               done: reinscrits>0
```

Autres règles de la page :
> *« ⚠️ À utiliser uniquement après validation des parents et réception du paiement. »* (bouton « Finaliser les réinscriptions confirmées »)
> *« 📋 La réinscription génère automatiquement les créances de l'année suivante. Vous pourrez ensuite envoyer le lien de paiement au parent. »*
> *« ℹ️ La classe affichée dans la fiche élève ne changera qu'à l'activation de la nouvelle année scolaire — c'est normal. »*
> *« Classe de destination »* / *« Veuillez sélectionner la classe de l'élève l'année prochaine. »* / *« Requis avant réinscription »*
> Garde-fou paiement : *« Paiement de réinscription non encaissé … Il est recommandé d'encaisser le paiement avant de finaliser. »* + case obligatoire *« Je confirme vouloir réinscrire sans paiement encaissé »*
> *« Créances impayées — année en cours »* / *« Pensez à régler ces échéances avant ou après la réinscription. »*
> Pré-requis structurel : *« Aucune année scolaire suivante n'a été créée »* … *« Pour utiliser le module Réinscriptions normalement, créez d'abord la prochaine année scolaire dans Paramètres → Années scolaires »*, sinon *« Pour préparer les réinscriptions de {année}, créez d'abord la prochaine année scolaire depuis les paramètres. Le suivi des réinscriptions deviendra alors disponible. »*
> Retrait du suivi (confirm natif) : *« Retirer {prénom} {nom} du suivi réinscription ?\n\nCela ne supprime pas l'élève, uniquement son entrée dans ce suivi. »*
> Regroupement SMS : *« Les SMS sont regroupés par parent, sauf si le message contient une variable propre à l'élève ([Nom]). »*
> *« Solde Communication insuffisant pour envoyer cette campagne. »* / *« Mode démo : l'envoi sera simulé, aucun crédit ne sera débité. »*
> *« ✅ Le paiement sera automatiquement lié à la créance sélectionnée lors de la validation caissière. »*
> Auto-sélection de l'année cible (CONFIRMÉ) : `xe = G.find(s=>!s.active)` → **par défaut, la première année scolaire NON active** (= l'année suivante), pas l'année active.

### 6.6 Import d'élèves — génération de créances
> *« Importer sans générer de créances ? »* — *« Vous êtes sur le point d'importer des élèves sans générer de créances. Cela signifie qu'aucun suivi de paiement, aucune relance automatique, et aucune donnée financière ne seront disponibles pour ces élèves. Cette option est déconseillée — voulez-vous vraiment continuer ? »* → bouton `« Oui, importer sans créances »`.
> *« Les créances seront générées automatiquement »* … *« C'est le comportement normal et recommandé. »*
> *« Cas rare : importer sans générer de créances (déconseillé) »* / *« Revenir au comportement normal (générer les créances) »*
> *« * Champs obligatoires en rouge. Le nom de la classe doit correspondre exactement à une classe existante. »*
> Plafond documenté (onboarding) : *« Vous pouvez importer jusqu'à 2 000 élèves d'un coup. »*

### 6.7 Réinscription en masse
> *« Réinscrire tous les élèves d'une classe vers la classe suivante »*
> *« Leurs créances de scolarité seront générées automatiquement. Cette action est irréversible. »*
> Exclusions automatiques : *« {n} élève(s) ignoré(s) — exclus, redoublants ou sortants »*

### 6.8 Suppression d'élève — double validation
> *« Demandes de suppression d'élève »* / *« Seule la direction peut approuver ou rejeter ces demandes. »*
> *« L'approbation supprimera définitivement l'élève et toutes ses données (inscriptions, créances, paiements, documents). Action irréversible. »*
> *« Commentaire (facultatif pour approbation, obligatoire pour rejet) »* — garde client : toast `« Commentaire requis » / « Saisissez un motif de rejet. »`
> *« Accès réservé à la direction et aux super-administrateurs. »* (garde `user.role==="super_admin"||user.role==="direction"`)
> Côté demandeur : *« Un admin de la direction doit l'approuver avant la suppression. »*

### 6.9 Affectés de l'État — registre déclaratif non officiel
> *« Cette déclaration est interne à l'établissement. « Confirmée en interne » ne signifie pas validée par l'AGFNE, la DEEP, l'IEPP ou la DRENA. »*
> *« Référentiel interne déclaratif · non officiel »*
> *« L'absence de déclaration signifie « non renseigné », jamais « non affecté ». Aucune donnée n'est transmise automatiquement à une administration. »*
> *« Registre annuel rattaché aux inscriptions validées · {année} »*
> *« Événements immuables et empreintes de preuve »* — chaque événement affiche `« SHA-256 · {snapshotSha256} »`
> *« La version et sa preuve ont été ajoutées au journal. »* / *« L'action est versionnée et conservée dans le journal. »*
> Retrait : *« La ligne restera conservée dans le registre et son historique. »*
> Rétablissement : *« La ligne repassera à l'état « Déclarée » et devra être confirmée de nouveau. »*
> Validation formulaire (CONFIRMÉ) : `g = sourceReference.trim().length>=3 && (!edition || motif.trim().length>=10)` → **motif ≥ 10 caractères obligatoire en modification**, `maxLength:500`.
> Placeholder source : `"Ex. liste interne du 15/09/2026"` ; `"Numéro de décision, si connu"`.

### 6.10 Portail public de préinscription
> *« Offrez aux familles un espace en ligne pour soumettre les dossiers de préinscription de leurs enfants — sans avoir à se déplacer. Vous gérez tout depuis cet espace. »*
> Arguments : `« Formulaire en ligne »` / *« Les parents remplissent le dossier depuis leur téléphone »* ; `« Suivi en temps réel »` / *« Recevez et traitez les candidatures à votre rythme »* ; `« Conversion facile »` / *« Un clic pour transformer un candidat en élève inscrit »*
> Bouton d'activation : *« Activer le Portail de préinscription »*
> *« Lien de dépôt de dossier »* — *« Partagez ce lien aux familles pour qu'elles puissent soumettre un dossier de préinscription »*
> Conversion : *« Assurez-vous que les catégories de frais sont configurées pour cette classe avant de continuer. »* → succès : *« 🎉 Inscription confirmée ! »* / *« L'élève est maintenant inscrit et les créances ont été générées. »* ; erreur : *« Vérifiez que les catégories de frais sont configurées. »*
> Messagerie parent : *« Écrire un message au parent… »* → *« Un SMS a été envoyé au parent. »*
> Distinction explicite avec le portail parent : *« Cet espace est réservé aux parents dont l'enfant est [déjà inscrit] dans l'école. Le parent entre son numéro de téléphone, reçoit un code SMS, et accède à ses bulletins, ses frais scolaires et ses paiements en ligne. »*

### 6.11 Fiche élève — divers
> *« Documents au format officiel du Ministère de l'Éducation Nationale de Côte d'Ivoire »* — 4 PDF : `Attestation de fréquentation` (*« PDF officiel avec QR code — certifie la présence régulière »*), `Carte d'identité scolaire` (*« PDF officiel — planche 4 cartes à découper et plastifier »*), `Fiche d'inscription` (*« PDF officiel — parents, frais, situation d'inscription »*), `Fiche individuelle` (*« PDF officiel — identité complète, parents, historique scolaire »*), + `Situation financière` (*« PDF officiel avec QR code — créances & versements »*).
> Régénération de créances (confirm natif) : *« Cela va annuler les créances scolarité impayées et les regénérer selon la configuration actuelle des frais.\n\nÀ utiliser uniquement en cas d'erreur dans les créances. Continuer ? »*
> *« Aucune échéance générée — les échéances apparaîtront dès la validation de l'inscription. »*
> *« Documents physiques reçus ? »* — *« Une fois l'acte de naissance et les autres pièces déposées, marquez le dossier complet pour passer à la validation. »* → `PATCH /preinscriptions/{id}/statut {statut:"dossier_complet"}`
> *« Aucun bulletin archivé — clôturez une période depuis Paramètres › Périodes »*
> *« Pour personnaliser les en-têtes (logo, IEPP, DRENA, directeur), configurez ces informations dans les Paramètres de l'établissement »*
> Accès portail parent par le staff : `POST /portail/staff-access {eleveId}` → ouverture `?staff_token=…` ; échec : *« Aucun parent lié à cet élève. »*

### 6.12 Matricules (`infos-generales-yXdBOVsG.js`)
Champs de configuration : `matriculePrefix` (défaut `"EG"`), `matriculeAnneeFormat` (défaut `"court"`), prévisualisation via `GET /eleves/prochain-matricule`.
Tour guidé : *« Définissez le préfixe et le format de l'année pour les matricules élèves. Les matricules sont générés automatiquement à l'inscription selon ce format. »*

---

## 7. Modèles de messages (CONFIRMÉ, verbatim — `lakoli-main.js`)

Registre `Mo` de modèles WhatsApp de réinscription :

| id | nom | description | variables |
|---|---|---|---|
| `reinscription_relance` | `Réinscription à confirmer` | `Premier contact pour demander confirmation de réinscription` | `nomEleve, classe, ecole` |
| `reinscription_lien_paiement` | `Lien de paiement` | `Envoi du lien de paiement après confirmation` | `nomEleve, classe, montant, lienPaiement, ecole` |
| `reinscription_paiement_recu` | `Paiement recu` | `Confirmation de reception du paiement` | `nomEleve, montant, ecole` |
| `reinscription_relance_generale` | `Relance generale` | `Rappel général en cours de campagne de réinscription` | `nomEleve, ecole` |

Modèle 1 (texte intégral, CONFIRMÉ) :
> *« Bonjour Monsieur/Madame,\n\nL'ecole {ecole} prepare la prochaine rentree scolaire.\n\nVotre enfant {nomEleve}, actuellement en classe de {classe}, peut etre reinscrit pour l'annee scolaire suivante.\n\nMerci de repondre OUI si vous souhaitez poursuivre sa scolarite a {ecole}.\n\nAdministration {ecole} »*

Modèle 5 — « info collège » (tenant-spécifique, CONFIRMÉ) :
> *« Bonjour Monsieur/Madame,\n\nVotre enfant {nomEleve} termine actuellement son cycle primaire a GSSV.\n\nNous avons le plaisir de vous informer que le College Source Vision ouvrira ses portes a la prochaine rentree scolaire.\n\nAfin d'assurer la continuite du parcours scolaire de nos eleves, les familles de GSSV beneficieront d'une priorite d'inscription pour l'entree en classe de 6eme. […] »*
Les boutons associés portent les titres `« WhatsApp — Modèle 1 : présentation réinscription »`, `« WhatsApp — Modèle 3 : confirmation paiement reçu »` (visible seulement si `statutPaiement==="paye"`), `« WhatsApp — Modèle 4 : relance générale »`, `« Envoyer info collège par WhatsApp (Modèle 5) »`, `« WhatsApp — n° secondaire : {tel} »`.

Modèle SMS de campagne réinscription (préchargé, éditable) :
```
Bonjour 👋
Votre enfant *[Nom]* en classe de *[Classe]* doit être réinscrit pour l'année prochaine.

✅ Répondez *OUI* pour confirmer votre souhait de réinscription.
📞 Ou appelez-nous directement.
```
Variables disponibles : `« Variables : [Nom], [Classe] »`.
Un second gabarit court existe : `« Bonjour {nom_parent}, réinscrivez {nom_eleve} ({classe_actuelle}→{classe_suivante}) pour {annee_scolaire} en ligne : {lien_reinscription} - {nom_ecole} »`.
Relance préinscription (texte suggéré) : *« Bonjour Madame/Monsieur, je voulais vérifier que vous avez bien reçu le lien de paiement et savoir si vous rencontrez une difficulté. »*
Construction WhatsApp : `https://wa.me/{tel}?text={encodeURIComponent(message)}` avec normalisation Unicode (guillemets typographiques, NBSP, tirets longs, ellipses) avant envoi.

---

## 8. Onboarding — les 10 étapes (CONFIRMÉ, `lakoli-main.js`)

| idx | id | onboardingKey | Titre | Route |
|---|---|---|---|---|
| 0 | `parametres-ecole` | `infosGenerales` | Informations générales de l'école | `/parametres/infos-generales` |
| 1 | `classes` | `classesCreees` | Créez vos classes | `/classes` |
| 2 | `categories-frais` | `categoriesFrais` | Renseignez vos frais scolaires | `/categories-frais` |
| 3 | `import-eleves` | `elevesImportes` | **Inscrivez vos élèves** | `/inscriptions/nouvelle` |
| 4 | `periodes-cours` | `periodesEvaluation` | Configurez vos périodes | `/periodes` |
| 5 | `collaborateur` | `collaborateurInvite` | Invitez un collaborateur | `/utilisateurs` |
| 6 | `encaissement` | `premierEncaissement` | **Effectuez votre premier encaissement** | `/inscriptions` |
| 7 | `premier-sms` | `premierSms` | Envoyez votre premier SMS | `/messagerie` |
| 8 | `paiement-en-ligne` | `paiementEnLigne` | Activez les paiements en ligne | `/parametres/paiement` |
| 9 | `portail-parent` | `portailParentTeste` | Découvrir le Portail Parent | `/portail-parent` |

Étape 3 (verbatim) : *« Importez vos élèves depuis un fichier CSV, ou ajoutez-les via le processus d'inscription. L'import est accessible depuis la page Inscriptions. »* — astuce : *« Le modèle CSV est téléchargeable sur la page d'import. Vous pouvez importer jusqu'à 2 000 élèves d'un coup. »*
Étape 6 (verbatim) : *« Après la création du dossier, un bouton « Modifier l'inscription avant encaissement » vous permet de corriger la classe, les informations de l'élève ou les frais sélectionnés — sans créer un nouvel élève. Une fois la modification enregistrée, encaissez directement depuis cet écran. Espèces, mobile money, chèque — tout se fait ici. »*
Fin de parcours : *« Configuration principale terminée 🎉 » / « Votre école est entièrement configurée. »*
Le composant `onboarding-next-step-CVPmH6Xs.js` est monté dans `/inscriptions` avec `currentKey:"premierEncaissement"` et `successMessage:"Paiement enregistré avec succès"` → l'app pousse l'étape suivante après le premier encaissement.

---

## 9. Tours guidés du domaine (CONFIRMÉ — contenu métier réel)

**`/inscriptions`** (5 étapes) — *« Chaque inscription passe par 5 étapes : créée → paiement demandé → paiement reçu → dossier complet → validée. Cette page vous montre où en est chaque élève dans ce parcours. »* ; *« Pour inscrire plusieurs élèves d'un coup, utilisez l'import CSV/Excel. […] Idéal en début d'année pour migrer depuis un ancien système. »*
Ancres : `ptour-inscrip-tabs`, `ptour-inscrip-btn-new`, `ptour-inscrip-btn-import`, `ptour-inscrip-table`.

**`/eleves`** (3 étapes) — ancres `ptour-eleves-liste`.

**`/reinscriptions/suivi`** (4 étapes) — *« L'objectif est d'arriver à 0 « en attente » avant la rentrée. »* ; *« Lakoli personnalise automatiquement chaque message avec le nom de l'élève et le lien vers l'espace parent. »*
Ancres : `ptour-reinsc-kpis`, `ptour-reinsc-sms-btn`, `ptour-reinsc-table`.

**`/inscriptions/fin-annee`** (3 étapes) — *« Avant de lancer la clôture, vérifiez qu'il ne reste pas de créances impayées et que toutes les notes sont saisies. Lakoli vous signale les points bloquants. »* ; *« Indiquez pour chaque classe la classe de destination l'année suivante. Les élèves seront transférés automatiquement. Vous pouvez exclure manuellement les élèves redoublants. »*
Ancres : `ptour-finannee-checklist`, `ptour-finannee-promotion`.

**`/affectations-etat`** (2 étapes) — *« Suivez séparément les élèves affectés par l'État, leurs prises en charge et les pièces de contrôle. »* ; *« Utilisez les filtres et les statuts pour identifier les dossiers incomplets avant toute confirmation. »*
Ancre : `ptour-state-assignments-main`.

**`/parents`** (3 étapes) — *« Un parent peut être lié à plusieurs élèves (fratrie). Chaque lien précise la relation : père, mère ou tuteur — cela détermine qui reçoit les SMS et les notifications. »*

Autres `data-tour-id` du domaine : `ptour-deletions-main` (`/admin/suppressions`).

---

## 10. Détails d'implémentation notables (INFÉRÉ du code, non affiché à l'écran)

1. **Deux vocabulaires pour un même pipeline.** `preinscription_creee` s'affiche `"Inscription rapide créée"` dans `/inscriptions` mais `"Pré-inscription créée"` dans `/preinscriptions` et `"Nouveau"` dans le portail public. Trois surfaces, un seul enum backend.
2. **`/inscriptions` filtre `annulee` côté client** : `.then(t=>t.data.filter(s=>s.statut!=="annulee"))` — les dossiers annulés n'apparaissent dans aucun onglet, même « Tous ».
3. **Rafraîchissement automatique** : `/inscriptions` et `/preinscriptions` ont `refetchInterval:30000` ; `onboarding/status` a `refetchInterval:60000` + `refetchOnWindowFocus`.
4. **`niveauInterface`** (`primaire` / `secondaire`) est un axe de partitionnement transverse envoyé à quasiment tous les endpoints du domaine ; `cycles` (liste CSV) l'accompagne sur `/eleves`.
5. **Création d'élève = 4 appels chaînés** dans `POST` du formulaire d'inscription : `POST /eleves` → (pour père/mère/tuteur non vides) `POST /parents` puis `POST /eleves/eleves-parents {eleveId,parentId,lien,principal}` → `POST /inscriptions {…, modePreinscription:true}` → uploads `POST /documents-eleve` en parallèle (`Promise.all`).
6. **Le lien parent-élève est déduit par chaîne** en mode édition : `["père","pere","father"]`, `["mère","mere","mother"]`, `["tuteur","guardian"]` — tolérance aux variantes d'accent/langue.
7. **Contact principal auto-déduit** : si `telephoneParent` correspond au téléphone du père → `pere`, sinon mère, sinon tuteur ; à défaut, premier parent renseigné.
8. **Campagne SMS facturée** : `sms-campaign/send` renvoie **HTTP 402** quand le solde est insuffisant → toast `« Solde insuffisant »` avec le message serveur ; l'aperçu expose `Crédits requis`, `Solde wallet`, `Ignorés (n° invalide)` et un bouton `Recharger`.
9. **Export XLSX du suivi réinscription** côté client (SheetJS, chunk `xlsx-BZe_PqlR.js`) avec colonnes `Nom`, `Prénoms`, `Matricule`, …
10. **`/reinscription-suivi` importe aussi depuis Excel** avec détection de colonnes par libellés FR approximatifs (`"nom élève"`, `"téléphone parent"`, `"classe actuelle"`…).
11. **`estAffecte` sur l'élève ≠ registre `affectations-etat`** : la case du formulaire d'inscription est un booléen de fiche ; le registre `/affectations-etat` est un objet versionné distinct rattaché à l'`inscriptionId`.
12. **Génération de reçu / documents officiels** passe systématiquement par `POST /documents/finaliser {type, params}` puis `GET /api/documents/{id}/download` (PDF) ou `/export.xlsx`.

---

## 11. Ce qu'un audit UI superficiel ne peut pas voir

1. `/inscriptions/fin-annee` n'est pas un « écran de promotion » : c'est un **moteur de décision DFA avec profil de règles officielles versionné** (`officialRulesReference`), prévisualisation en lecture seule, 6 codes de non-calculabilité, verrouillage optimiste par `decision_version`, gel avec empreinte, réouverture à motif obligatoire ≥ 10 caractères, et journal d'audit.
2. `/reinscriptions/suivi` est un **CRM complet** (6 étapes prescrites, 4 axes de statut orthogonaux, 4 tags d'alerte, filtre « sans contact > 7 jours », campagnes SMS facturées avec preview de coût, 5 modèles WhatsApp, import Excel, export XLSX, bloc « intérêt collège » spécifique CM2).
3. `/affectations-etat` est un **registre à journal immuable** : chaque événement porte une empreinte `SHA-256` du snapshot, 5 types d'événements, motif obligatoire, et une clause de non-officialité explicite vis-à-vis d'AGFNE / DEEP / IEPP / DRENA.
4. `/admin/suppressions` implémente une **séparation des pouvoirs** : le demandeur (scolarité) crée, seule la direction approuve, le rejet exige un commentaire, l'approbation supprime en cascade (inscriptions, créances, paiements, documents).
5. Le **portail public de préinscription** est un produit dans le produit : lien partageable, dépôt de pièces par le parent, messagerie SMS bidirectionnelle par dossier, machine à états à 7 statuts, conversion en 1 clic générant les créances.
6. Le bouton **« Modifier l'inscription avant encaissement »** (`PATCH /preinscriptions/{id}/avant-encaissement`) est une correction complète du dossier (élève + 3 parents + classe + services + remise) qui n'existe que dans la fenêtre pré-paiement.
7. L'**import CSV/Excel** accepte 12 colonnes avec ~60 alias de noms, 4 séparateurs, `.xlsx`/`.xls`/`.csv`/`.txt`, un champ `montantDejaEncaisse` (reprise de solde depuis l'ancien système) et un mode explicite « sans créances » derrière une double confirmation.
8. La **règle absolue** « pas de validation sans paiement » a une **porte de sortie tracée** : `exceptionDirection` + `exceptionNote`.
9. Le domaine génère **5 PDF officiels** au format du Ministère de l'Éducation Nationale de Côte d'Ivoire, dont 2 avec QR code, et une planche de 4 cartes scolaires à découper.
10. Le **verrouillage financier post-encaissement** est un invariant produit énoncé dans l'onboarding, pas seulement une contrainte technique.

---

## 12. Fichiers sources exploités

```
chunks/nouvelle-SJQXCeYE.js       57 458 o   /inscriptions/nouvelle · /eleves/nouveau
chunks/detail-6Bu9thd6.js        137 912 o   /eleves/:id (fiche élève, 9 onglets)
chunks/index-vQwBYpuX.js          68 488 o   /reinscriptions/suivi
chunks/fin-annee-DQpqHLWH.js      30 338 o   /inscriptions/fin-annee
chunks/index-Bs3h40d0.js          34 624 o   /inscriptions
chunks/index-CS0hQPlQ.js          17 796 o   /preinscriptions
chunks/index-Hh45azKV.js                     /eleves (liste + export CSV)
chunks/index-BKLJh4yU.js          18 561 o   /affectations-etat
chunks/import-C7PuIymD.js         17 227 o   /eleves/import
chunks/dossier-Bl9jo0fs.js        16 939 o   /portail-parent/dossier/:id
chunks/index-C_ZhDXdL.js          13 580 o   /portail-parent (stats + liens)
chunks/masse-Bjiynvfj.js           9 231 o   /inscriptions/masse
chunks/preinscriptions-B3gu9n4h.js 9 290 o   /portail-parent/preinscriptions
chunks/cursus-hPCmJ3nT.js          8 237 o   /eleves/:id/cursus
chunks/suppressions-C8af2J3c.js    6 080 o   /admin/suppressions
chunks/detail-D38s9pPJ.js          5 799 o   /parents/:id
chunks/nouvelle-3Y8GKgoA.js        5 409 o   /preinscriptions/nouvelle
chunks/index-SA2flbb5.js                     /parents
chunks/nouveau-BrcwQHgV.js                   /parents/nouveau
chunks/infos-generales-yXdBOVsG.js 25 833 o  config matricules
chunks/onboarding-next-step-CVPmH6Xs.js 1 461 o
lakoli-main.js                               routes, RBAC, tours, onboarding, modèles WhatsApp, client orval
```
