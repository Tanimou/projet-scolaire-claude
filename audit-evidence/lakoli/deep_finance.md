# Lakoli — Deep audit: FINANCE domain (reverse-engineered from shipped JS)

**Method.** All findings below were extracted from the shipped Vite bundle:
`scratchpad/lakoli-main.js` (716 KB entry) + `scratchpad/chunks/*.js` (149 minified chunks, 3.3 MB).
Extraction used `node`/`grep` one-liners against the minified single-line sources (no full-file reads).
A regex sweep of `.get( / .post( / .put( / .patch( / .delete(` call sites over the whole corpus yielded
**513 distinct client→API operations** across the app (vs. the 338 lines in the pre-existing
`lakoli-endpoints.txt`, which is lossy — it drops most template-literal/query-string GETs).

**CONFIRMED** = the exact string / call site exists in the bundle. **INFERRED** = deduced from surrounding code.
French UI copy is quoted **verbatim**.

**Correction to the earlier shallow audit:** the claim of "~15 API endpoints" is off by more than an order of
magnitude. The finance domain **alone** accounts for **~105 distinct operations** (enumerated in §1).

---

## 1. API surface — FINANCE domain

All CONFIRMED (call sites present in bundle). Chunk file in brackets.
`${...}` in a path = template-literal path parameter in the source.

### 1.1 Caisse (cash drawer / expenses) — `index-B9Qj624b.js`
| Op | Notes |
|---|---|
| `GET /caisse` | list of *sorties* (dépenses). queryKey `caisse-sorties`, `refetchInterval: 30 s` |
| `GET /caisse/apercu?dateDebut=${i}&dateFin=${m}` | period overview; `refetchInterval: 60 s` |
| `POST /caisse` | create dépense. Body: `{categorie, description, montant, dateDepense, modePaiement, beneficiaire, reference}` |
| `PATCH /caisse/${t}/${s}` | `s` ∈ `valider` \| `rejeter`. Body `{noteValidation}` |
| `DELETE /caisse/${t}` | delete dépense |
| `POST /caisse/apports` | cash injection. Body: `{libelle, montant, modePaiement, dateApport, notes}` |
| `DELETE /caisse/apports/${t}` | |
| `GET /paystack/stats` | also queried from the caisse page (queryKey `paystack-stats-caisse`) |

### 1.2 Clôture de caisse (daily official closing / PV) — `index-Cn8YezvA.js`
| Op | Notes |
|---|---|
| `GET /cloture-caisse` | list of PVs |
| `GET /cloture-caisse/check?date=${l}` | returns `{exists, cloture:{pvNumero, statut}}` — blocks double-close |
| `GET /cloture-caisse/session-data?date=${l}` | returns `totalEncaisse, totalEncaisseCash, totalEncaisseDigital, totalDepenses, totalDepensesCash, totalDepensesNonCash, nbTransactions, nbEleves, parMode[], parCategorie[]` |
| `POST /cloture-caisse` | Body: `{date, fondOuverture, soldeReel, observationsCarissier, observationsDirection, anneeScolaireId}` *(note the misspelling `observationsCarissier` — it is verbatim in the bundle, both in the POST body and the printed PV template)* |
| `DELETE /cloture-caisse/${t}` | cancels the PV (marks "Annulé") |

### 1.3 Créances (receivables) — `index-TfNa1dpy.js`, `index-C_B_QAOx.js`, `detail-6Bu9thd6.js`
| Op | Notes |
|---|---|
| `GET /creances?${s}` | URLSearchParams: `anneeScolaireId`, `statut`, `enRetard=true`, `niveauInterface` |
| `GET /creances?eleveId=${...}&anneeScolaireId=${...}` | per-student variant (5 distinct call sites) |
| `GET /creances/annulation-masse-apercu?anneeScolaireId=${r?.id}&niveauInterface=${encodeURIComponent(m)}` | dry-run preview: `{count, elevesCount, totalReste, totalPaye}` |
| `POST /creances/annuler-masse` | Body: `{anneeScolaireId, niveauInterface, expectedCount, confirmationCount, motif}` |
| `POST /inscriptions/regenerer-creances` | Body `{eleveId, anneeScolaireId}` — regenerates scolarité créances |

### 1.4 Catégories de frais (fee catalogue) — `index-DE6ERqXg.js`
| Op | Notes |
|---|---|
| `GET /categories-frais?anneeScolaireId=${a?.id}` | |
| `GET /categories-frais?anneeScolaireId=${r?.id}&estService=true` | subscription-type services only |
| `POST /categories-frais` | |
| `PUT /categories-frais/${d.id}` | |
| `DELETE /categories-frais/${d.id}` | |

### 1.5 Critères de remise (discount criteria) — `index-Bb1qhKZd.js`
`GET /criteres-remise` · `POST /criteres-remise` · `PATCH /criteres-remise/${s}` · `DELETE /criteres-remise/${s}`

### 1.6 Budget prévisionnel — `index-CXfnRc2p.js`
| Op | Notes |
|---|---|
| `GET /budget-previsionnel/comparaison?anneeScolaireId=${n}&niveauInterface=${j}` | returns `lignes[], totalPrevRecettes, totalPrevDepenses, recettesReelles, depensesReelles, soldePrevisionnel, soldeReel` |
| `POST /budget-previsionnel` | Body `{categorie, libelle, montantPrevisionnel, anneeScolaireId}` |
| `POST /budget-previsionnel/generer-depuis-inscriptions` | Body `{anneeScolaireId}` → `{created, skipped}` |
| `DELETE /budget-previsionnel/${s}` | |

### 1.7 Anti-fraude — `index-DBoTAX2W.js`, `dashboard-DWiDn6JR.js`
| Op | Notes |
|---|---|
| `GET /anti-fraude?statut=${a}&severite=${o}` | `refetchInterval: 15 s` |
| `GET /anti-fraude/stats` | `refetchInterval: 30 s` |
| `PATCH /anti-fraude/${t}` | Body `{statut, noteResolution}` |
| `POST /anti-fraude/bulk-resolve` | Body `{alertIds[], statut, note}` |
| `GET /dashboard/alertes-fraude-recentes` | banner on dashboard, `refetchInterval: 30 s` |

### 1.8 Paiements — `index-DHRc_dZq.js`, `index-BVP1-WeZ.js`, `session-BXAiHD0I.js`
| Op | Notes |
|---|---|
| `GET /paiements?${t}` | params `limit=50`, `niveauInterface`, `filtre` |
| `GET /paiements?eleveId=${l}&anneeScolaireId=${S?.id}&limit=200` | |
| `GET /paiements/session?date=${i}` | cashier session recap |
| `POST /paiements` | Body `{creanceId, eleveId, anneeScolaireId, montant, modePaiement, referenceExterne}` |
| `POST /paiements/${r.id}/rembourser` | Body `{motifRemboursement, montantRembourse}` |

### 1.9 Relances (dunning / follow-up log) — `detail-6Bu9thd6.js`, `index-TfNa1dpy.js`
| Op | Notes |
|---|---|
| `GET /relances?eleveId=${l}&limit=100` | |
| `POST /relances` | Body `{eleveId, type, montant, destinataire, paystackUrl, notes}` |
| `POST /sms-logs/relance` | Body `{classeId}` — bulk SMS dunning from the reports page |
| `POST /subscriptions/sms-relance` | Body `{serviceType, anneeScolaireId}` |

### 1.10 Ventes additionnelles (one-off sales) — `detail-6Bu9thd6.js`, `index-BVP1-WeZ.js`
| Op | Notes |
|---|---|
| `GET /ventes-additionnelles?eleveId=${l}&anneeScolaireId=${S?.id}` | |
| `POST /ventes-additionnelles` | |
| `PATCH /ventes-additionnelles/${n.item.id}/paiement` | Body `{montantPaye}` (cumulative) |
| `POST /ventes-additionnelles/${t.id}/attach-creance` | returns `{creanceId}` — lazily materialises a créance so a payment link can be issued |
| `DELETE /ventes-additionnelles/${t.id}` | |

### 1.11 Cantine — `index-DxBtz_yd.js`, `index-BVP1-WeZ.js`
`GET /cantine/abonnements?eleveId&anneeScolaireId` · `PATCH /cantine/abonnements/${id}/paiement` ·
`GET /cantine/depenses?anneeScolaireId` · `POST /cantine/depenses` · `DELETE /cantine/depenses/${t.id}`

### 1.12 Transport — `index-Cj0ROcZS.js`, `index-BVP1-WeZ.js`
`GET /transport/abonnements?eleveId&anneeScolaireId` · `PATCH /transport/abonnements/${id}/paiement` ·
`GET /transport/depenses?anneeScolaireId` · `POST /transport/depenses` · `DELETE /transport/depenses/${t.id}`

### 1.13 Subscriptions (generic service-subscription engine behind Cantine / Transport / Autres services)
`index-DxBtz_yd.js`, `index-Cj0ROcZS.js`, `index-ozVJACnZ.js`, `detail-6Bu9thd6.js`
| Op | Notes |
|---|---|
| `GET /subscriptions?eleveId&anneeScolaireId` | |
| `GET /subscriptions/global?serviceType=${d}&anneeScolaireId=${r?.id}` | `serviceType` ∈ `cantine`, `transport`, + any `categories-frais.type` flagged `estService` |
| `GET /subscriptions/access-list?serviceType=cantine&anneeScolaireId=${o?.id}` | canteen access roster |
| `POST /subscriptions` | Body `{eleveId, anneeScolaireId, serviceType, startDate, plannedEndDate, monthlyPrice, annualPrice, billingCycle:"monthly", notes}` |
| `PATCH /subscriptions/${t}` | Body `{accessStatus}` — `allowed` \| `blocked` |
| `POST /subscriptions/${t}/cancel` | Body `{cancellationReason}` |
| `POST /subscriptions/${a}/suspend-mois` | Body `{creanceIds[]}` — suspend selected months |
| `POST /subscriptions/${a}/resume` | |

### 1.14 Online payments / aggregators — `index-BYXLUh--.js`, `lakoli-main.js`, `paiement-DWvhp1Tm.js`
The provider prefix is **dynamic**. In `index-BYXLUh--.js`:
`E = n?.provider==="cinetpay" ? "cinetpay" : n?.provider==="paydunya" ? "paydunya" : n?.provider==="hub2" ? "hub2" : "paystack"`

| Op | Notes |
|---|---|
| `GET /paystack/stats` | `{provider, a_valider, total_a_valider, valides, total_valide, non_attribues, en_attente}` |
| `GET /paystack/requests?status=${l}` | `refetchInterval: 30 s` |
| `POST /paystack/requests/${t}/validate` | → `{paiementId, requestId}`, then auto-prints receipt |
| `POST /paystack/requests/${t}/reject` | Body `{reason}` |
| `POST /${E}/init` | Body `{eleveId, creanceId, amount, guardianEmail, guardianPhone, feeCategory, anneeScolaireId, notes}` → `{authorizationUrl}` |
| `GET /${E}/verify/${t}` | force status refresh with the operator |
| `POST /${E}/sync-pending` | → `{updated}` |
| `GET /paystack/portail/${matricule}` | **public** parent portal lookup → `{eleve, creances[]}` |
| `POST /paystack/portail/init` | **public** — Body `{matricule, guardianEmail, guardianPhone, creanceIds[], totalAmount}` |
| `GET /api/payment-providers/recu/${paiementId}` | raw `fetch()` returning **HTML** receipt, written into a popup and printed |

### 1.15 Payment config (aggregator credentials wizard) — `paiement-DWvhp1Tm.js`
`GET /payment-config` · `POST /payment-config/valider` · `PUT /payment-config` · `DELETE /payment-config`

### 1.16 Réconciliation — `index-C_B_QAOx.js` + generated hooks in `lakoli-main.js`
| Op | Notes |
|---|---|
| `GET /api/reconciliation/file-attente` | queue of unmatched payments (Orval-generated hook, `queryKey ["/api/reconciliation/file-attente"]`) |
| `POST /api/reconciliation/${id}/reconcilier` | Body `{eleveId, creanceId?, motif}` (mutationKey `["reconcilierPaiement"]`) |

### 1.17 Financial reports / analytics — `index-Dy2QZJ7u.js`, `index-tgktBz20.js`, `dashboard-DWiDn6JR.js`
| Op | Notes |
|---|---|
| `GET /rapports/paiements?dateDebut=${y}&dateFin=${f}&niveauInterface=${o}&classeId=${i}` | |
| `GET /rapports/impayes?classeId&incluireSortants=true&niveauInterface` | note the typo `incluireSortants` — verbatim |
| `GET /dashboard/bilan?cycles=${...}` | |
| `GET /dashboard/finance-avancee?${r}` | |
| `GET /dashboard/recettes-mensuelles?${r}` | |
| `GET /dashboard/repartition-modes?${r}` | |
| `GET /dashboard/cumul-par-categorie?${r}` | |
| `GET /dashboard/repartition-paiements?${F}` | |
| `GET /dashboard/derniers-versements?limit=20&${F}` | |
| `GET /dashboard/stats?${F}` | |
| `GET /dashboard/todo?${F}` | `{creancesEnRetard, paiementsEnLigneAValider, preinscriptionsEnAttente, parentsAContacter, aRelancer}` |

### 1.18 Enrollment-linked money ops — `index-Bs3h40d0.js`, `index-CS0hQPlQ.js`, `nouvelle-SJQXCeYE.js`, `index-BVP1-WeZ.js`
| Op | Notes |
|---|---|
| `GET /eleves/${r.id}/situation-financiere` | `{totalGlobalImpaye, ...}` |
| `POST /preinscriptions/${t}/paiement-especes` | Body `{notes, montant, modePaiement}` |
| `POST /preinscriptions/${t}/confirmer-paiement-lien` | Body `{notes}` (transaction reference) |
| `POST /preinscriptions/${t}/envoyer-lien` | |
| `PATCH /preinscriptions/${p}/avant-encaissement` | edit enrolment **before** any cash is taken |
| `POST /preinscriptions/${t}/valider` | Body `{exceptionDirection, exceptionNote}` |

### 1.19 SMS wallet (prepaid comms credit, bought with Mobile Money) — `index-C62rUqbA.js`
`GET /sms-wallet` · `GET /sms-wallet/packages` · `POST /sms-wallet/recharge` ·
`GET /sms-wallet/recharge/verify?reference=${encodeURIComponent(t)}`

### 1.20 SaaS billing (Lakoli's own subscription) — `index-D0ZnJiDL.js`
`GET /billing/status` · `GET /billing/plans` · `GET /billing/factures` · `POST /billing/subscribe`

---

## 2. Status / enum value sets (all CONFIRMED, verbatim)

### 2.1 Créance status — `index-TfNa1dpy.js`
```js
{en_attente:{label:"En attente"}, partiellement_paye:{label:"Part. payé"},
 solde:{label:"Soldé"}, annulee:{label:"Annulée"}}
```
Filter buttons expose only `["en_attente","partiellement_paye","solde"]` plus `Toutes` and a destructive `En retard` toggle.
On the student detail page (`detail-6Bu9thd6.js`) the same enum is rendered as `En attente / Partiel / Soldé`.
Service subscription views (`index-Cj0ROcZS.js`, `index-DxBtz_yd.js`) use `{solde:"Soldé", partiellement_paye:"Partiel", en_attente:"À payer"}`.

### 2.2 Paiement status — `index-DHRc_dZq.js`
```js
{paye:"Payé", valide:"Validé", annule:"Annulé", rembourse:"Remboursé",
 en_attente:"En attente", partiellement_paye:"Partiel"}
```

### 2.3 Dépense (caisse) status — `index-B9Qj624b.js`
```js
{brouillon:{label:"Brouillon"}, validee:{label:"Validée"}, rejetee:{label:"Rejetée"}}
```

### 2.4 Modes de paiement
Canonical DB values (`index-B9Qj624b.js`):
```js
{cash:"Espèces", wave:"Wave", orange_money:"Orange Money", mtn_money:"MTN MoMo",
 virement:"Virement", cheque:"Chèque", djamo:"Djamo", carte:"Carte",
 autre:"Autre", especes:"Espèces"}
```
The cashier UI (`index-BVP1-WeZ.js`) presents **8 tiles** that collapse onto 6 DB values:
| UI value | UI label | `dbValue` |
|---|---|---|
| `cash` | Espèces | `cash` |
| `wave` | Wave App | `wave` |
| `wave_depot` | Wave agence | `wave` |
| `orange_money` | OM USSD | `orange_money` |
| `om_depot` | OM agence | `orange_money` |
| `mtn_money` | MTN USSD | `mtn_money` |
| `djamo` | Djamo | `djamo` |
| `cheque` | Chèque | `cheque` |

The CSV export map in `index-DHRc_dZq.js` additionally carries `wave_depot:"Wave agence"` and `om_depot:"OM agence"` as **stored** values, so the DB does see the agency variants somewhere. Clôture PV map adds `carte:"Carte bancaire"`.

### 2.5 Paystack / online-payment request status — `index-BYXLUh--.js` (8 values)
```js
initiated:      "Lien créé — pas encore ouvert"
pending:        "Lien ouvert — parent n'a pas encore payé"
payment_received:"Paiement reçu — En attente de confirmation"
verified:       "Paiement vérifié — En attente de confirmation"
validated:      "Enregistré en caisse ✓"
rejected:       "Rejeté"
unattributed:   "Paiement reçu — élève non identifié"
expired:        "Lien expiré"
```
Filter tabs: `[["payment_received","À confirmer"],["validated","Validés ✓"],["pending","En attente de paiement"],["unattributed","Paiement sans élève"],["rejected","Rejetés"],["all","Tous"]]`

### 2.6 Anti-fraude alert **type** (9) — `index-DBoTAX2W.js`
```js
cash_excessif:"Cash excessif", annulation_suspecte:"Annulation suspecte",
montant_modifie:"Montant modifié", double_paiement:"Double paiement",
paiement_hors_horaire:"Hors horaires", accumulation_annulations:"Accumulation d'annulations",
ecart_montant:"Écart de montant", acces_non_autorise:"Accès non autorisé", autre:"Autre"
```
**Severity** (3): `critique:"Critique"`, `avertissement:"Avertissement"`, `info:"Info"`
**Statut** (4): `ouverte:"Ouverte"`, `en_cours:"En cours"`, `resolue:"Résolue"`, `faux_positif:"Faux positif"`

### 2.7 Catégorie de frais — `type` (18 values) — `index-DE6ERqXg.js`
```js
inscription:"Inscription", reinscription:"Réinscription", scolarite:"Scolarité",
transport:"Transport", cantine:"Cantine", tenue:"Tenue / Uniforme",
examens:"Examens officiels", activites:"Activités parascolaires",
fournitures:"Fournitures scolaires", assurance:"Assurance", cotisation:"Cotisation",
internat:"Internat", numerique:"Numérique / Informatique",
sorties_scolaires:"Sorties scolaires", bibliotheque:"Bibliothèque",
laboratoire:"Laboratoire", photocopies:"Photocopies", autres:"Autres"
```

### 2.8 `frequenceFacturation` (5) — `index-DE6ERqXg.js`
```js
{unique:"Unique", mensuel:"Mensuel", trimestriel:"Trimestriel",
 semestriel:"Semestriel", annuel:"Annuel"}
```
Select option labels: `Paiement unique`, `Mensuel (par mois)`, `Trimestriel`, `Semestriel`, `Annuel`.

### 2.9 Fee scope (`scopeType`) — `index-DE6ERqXg.js`
`all` → "Toutes les classes" / "Tous les élèves" · `cycles` → "Par cycles" / "Maternelle, Collège…" · `classes` → "Classes précises" / "Sélection manuelle"
Serialised as: `cycles` → `{classeId:null, cycles, classeIds:null}`; `classes` → `{classeId:null, cycles:null, classeIds:[Number]}`; `all` → all three `null`.

### 2.10 Critère de remise — `type`
`pourcentage` → "Pourcentage (%)" · `montant_fixe` → "Montant fixe (FCFA)". Default `{type:"pourcentage", valeur:10}`.

### 2.11 Vente additionnelle — `categorie` (6) — `detail-6Bu9thd6.js`
`uniforme:"Uniforme / Tenue"`, `voyage:"Voyage scolaire"`, `materiel:"Matériel scolaire"`, `evenement:"Événement / Spectacle"`, `copie:"Copies / Duplicata"`, `autre:"Autre"`

### 2.12 Relance — `type` (6) — `detail-6Bu9thd6.js`
`appel:"Appel téléphonique"`, `sms:"SMS"`, `email:"Email"`, `courrier:"Courrier"`, `rencontre:"Rencontre / visite"`, `paystack:"Lien de paiement"`

### 2.13 Dépense **catégories**
- **Caisse** (12, free-text `<datalist>`): `["Salaires et primes","Fournitures scolaires","Maintenance / Réparations","Électricité / Eau","Transport","Communication","Loyer / Charges","Alimentation / Restauration","Matériel informatique","Frais bancaires","Dépôt à la banque","Divers"]`
- **Apport** nature (6): `["Fonds de caisse initial","Apport de la direction","Dépôt bancaire","Recette exceptionnelle","Remboursement reçu","Autres entrées"]`
- **Cantine** (5): `{alimentation:"Alimentation", personnel:"Personnel", equipement:"Équipement", entretien:"Entretien", autre:"Autre"}`
- **Transport** (5): `{carburant:"Carburant", entretien:"Entretien véhicule", chauffeur:"Chauffeur / Personnel", assurance:"Assurance", autre:"Autre"}`

### 2.14 Budget line `categorie`
`recettes` → "Recettes" · `depenses` → "Dépenses"

### 2.15 Subscription `accessStatus`
`allowed` \| `blocked` — toast labels "Accès autorisé" / "Accès bloqué".

### 2.16 SMS wallet movement types — `index-C62rUqbA.js`
`Bonus bienvenue`, `Recharge`, `SMS envoyé`, `Ajustement`, `Remboursement`, `Correction`

### 2.17 Payment aggregators (4) — `paiement-DWvhp1Tm.js`
```js
[{id:"paystack",  nom:"Paystack",  badge:"Recommandé", guideUrl:"https://dashboard.paystack.com/#/settings/developers"},
 {id:"cinetpay",  nom:"CinetPay",  guideUrl:"https://app.cinetpay.com/"},
 {id:"paydunya",  nom:"PayDunya",  guideUrl:"https://app.paydunya.com/"},
 {id:"hub2",      nom:"Hub2",      badge:"Bêta", guideUrl:"https://dashboard.hub2.io/"}]
```

### 2.18 Audit-journal action codes touching money — `index-D08hVBlK.js`
```
CREATE_PAIEMENT "Paiement créé"      ANNULER_PAIEMENT "Paiement annulé"
VALIDER_PAIEMENT "Paiement validé"   RECONCILIER_PAIEMENT "Réconciliation"
CREATE_CREANCE "Créance créée"       UPDATE_CREANCE "Créance modifiée"
ANNULER_CREANCE "Créance annulée"    ANNULATION_MASSE_CREANCES "Annulation masse"
ANNULATION_MASSE_CREANCES_VALIDATED "Annulation validée"
CREATE_DEPENSE "Dépense créée"       VALIDER_DEPENSE "Dépense validée"
REJETER_DEPENSE "Dépense rejetée"    CLOTURE_CAISSE "Clôture caisse"
CREATE_CATEGORIE_FRAIS / UPDATE_CATEGORIE_FRAIS
CREATE_VENTE_ADDITIONNELLE "Vente additionnelle"  PAYER_VENTE_ADDITIONNELLE "Vente payée"
CREATE_CANTINE_ABONNEMENT / PAY_CANTINE_ABONNEMENT / DELETE_CANTINE_ABONNEMENT
```
Diff-view field labels: `montantDu:"Montant dû"`, `montantPaye:"Montant payé"`, `remise:"Remise"`, `dateEcheance:"Échéance"`, `motifModification:"Motif"`, `amount:"Montant"`, `reference:"Référence"`, `raison:"Raison"`.

---

## 3. Form field inventories (modals / "Nouveau…" forms the shallow audit never opened)

### 3.1 Caisse → "Enregistrer un apport de fonds" (modal)
Subtitle: *"Fonds initial, dépôt, recette exceptionnelle..."*
| Field | Required | Widget | Placeholder / options |
|---|---|---|---|
| `Nature de l'apport *` | ✔ (`required:!0`) | input + `<datalist>` | `Ex : Fonds de caisse initial` (6 suggestions, §2.13) |
| `Montant (FCFA) *` | ✔ | number | |
| `Mode` | | select | 6 options from `pe[]` (§2.4) |
| `Date` | | date | defaults to today |
| `Notes` | | input | `Observation...` |

### 3.2 Caisse → "Enregistrer une dépense" (modal)
Header note: **"La dépense sera créée en brouillon et devra être validée."**
| Field | Required | Widget | Placeholder |
|---|---|---|---|
| `Catégorie *` | ✔ | select, first option `— Choisir —` | 12 categories |
| `Montant (FCFA) *` | ✔ | number | |
| `Description` | | input | `Objet de la dépense` |
| `Bénéficiaire` | | input | `Nom du fournisseur` |
| `Mode` / `Date` | | select / date | |
| `Référence / N° reçu` | | input | `REF-2025-001` |
| `Note (optionnelle)` | | textarea | |

### 3.3 Clôture de caisse form
| Field | Help text |
|---|---|
| `Fond de caisse à l'ouverture (FCFA)` | *"Espèces présentes en caisse avant l'ouverture"* |
| `Solde réel en caisse (FCFA)` | *"Espèces comptées physiquement à la fermeture"* |
| `Observations du caissier` | placeholder `Néant` |
| `Observations de la direction` | placeholder `Néant` |
Live recap rows: `Fond d'ouverture`, `Encaissements espèces du jour`, `Dépenses du jour`, `Solde théorique (espèces)`, `Solde réel déclaré`. KPI tiles: `Encaissements espèces`, `Encaissements numériques`, `Élèves servis`, `Dépenses espèces`. Submit: **"Clôturer et imprimer le PV"**.

### 3.4 Catégorie de frais — full form (`index-DE6ERqXg.js`)
Defaults: `{type:"scolarite", obligatoire:true, recurrent:false, estService:false, actif:true, frequenceFacturation:"unique", nombreEcheances:1, nom:"", montant:0, scopeType:"all", scopeCycles:[], scopeClasseIds:[]}`
| Field | Label / help |
|---|---|
| `Type *` | 18 options |
| montant | `Montant total (FCFA) *` / `Prix mensuel (FCFA) *` / `Prix par trimestre (FCFA) *` (label switches on frequency); placeholder `75000` |
| `Intitulé *` | placeholder `Ex: Scolarité annuelle 2024-2025`; help *"Nom tel qu'il apparaîtra sur les reçus et les relances envoyés aux parents."* |
| `Service avec abonnement` (switch) | *"Les parents s'inscrivent individuellement et peuvent se désabonner en cours d'année. Les créances sont générées automatiquement selon le cycle choisi."* / *"Ex : cantine, transport, internat, activités parascolaires…"* |
| `Cycle de facturation` | `Mensuel` → *"Une créance par mois, du mois de début jusqu'à la fin d'année."*; `Trimestriel` → *"Une créance tous les 3 mois. Montant = prix par trimestre."* |
| `Durée (nombre de mois)` | *"Ex : 9 = 3 trimestres (sept → mai)"*, *"Ex : 9 = sept → mai, 10 = sept → juin"* |
| `Facturation / Échéances` → `Nombre de mensualités` | month picker Sept→Juin (`Septembre…Juin`, values 9,10,11,12,1..6); *"Sélectionnez les 3 mois de versement"* / *"Sélectionnez les 2 mois de versement"* / *"Sélectionnez les mois concernés"*; *"Astuce : ajustez un mois pour que le total corresponde exactement au montant total."*; error suffix `(écart ${d>0?"+":""}${d} FCFA vs montant total)` |
| `Obligatoire` | `Oui`/`Non`; *"Frais généré automatiquement pour tous les élèves de la classe à l'inscription. Ne peut pas être ignoré."* |
| `Se renouvelle chaque année ?` | `Oui — revient chaque année scolaire` / `Non — frais ponctuel, une seule fois` |
| `Statut` | `Actif` / `Inactif (masqué à l'inscription)` |
| `À qui s'applique ce frais ?` | *"Définissez le périmètre des élèves concernés. Modifier ce choix n'affecte pas les créances déjà générées."* → `Toutes les classes` / `Par cycles` / `Classes précises`; empty states *"Créez d'abord des classes pour voir les cycles disponibles."*, *"Aucune classe créée."* |
| `Description` | placeholder `Description optionnelle` |

### 3.5 Critère de remise form
`Nom du critère *` (`Ex: Orphelin(e)`), `Code unique *` (`Ex: orphelin`), `Description`, `Type de remise` (pourcentage / montant_fixe), `Valeur *` (placeholder `10`).
Above the form: **"CRITÈRES PRÉDÉFINIS — cliquez pour pré-remplir le formulaire"** — 8 seeded criteria:
```js
orphelin           "Orphelin(e)"                  "Élève ayant perdu un ou deux parents"
enfant_enseignant  "Enfant d'enseignant"          "Enfant de membre du personnel enseignant"
fratrie            "Fratrie (2e enfant+)"         "Réduction accordée aux fratries déjà inscrites"
boursier           "Boursier(e)"                  "Bénéficiaire d'une bourse scolaire"
eleve_meritant     "Élève méritant"               "Réduction accordée aux meilleurs élèves"
difficulte_sociale "Difficulté sociale"           "Famille en situation de précarité"
personnel_admin    "Enfant du personnel"          "Enfant de membre du personnel non-enseignant"
partenariat        "Partenariat institutionnel"   "Entreprise partenaire ou accord institutionnel"
```

### 3.6 Remboursement modal (`index-DHRc_dZq.js`)
Shows `Référence`, `Montant encaissé`, `Élève`, and — when `paiement.tropPercu > 0` — **"Trop-perçu détecté : {montant}"**.
`Montant à rembourser (FCFA) *` (`type=number, min:1, max:montantEncaissé`), footer hints `Max : …`, `Remboursement partiel`, `Remboursement total`, and a shortcut **"Rembourser uniquement le trop-perçu ({montant})"**.
`Motif *` textarea, placeholder `Ex: Trop-perçu, erreur de saisie, désistement...`. Submit disabled unless motif non-empty and amount > 0. Button label flips to `Remb. partiel`.

### 3.7 "Envoyer un lien de paiement au parent" (`index-BYXLUh--.js`)
`Élève` (select, `— Sélectionner —`), `Créance (facultatif)` (select, `— Paiement libre —`; selecting one auto-fills amount as `montantDu - montantPaye - remise` and the fee label), `Montant (FCFA)` (`Ex: 75000`), `Téléphone du parent *` (`07 00 00 00 00`, help *"Le SMS de paiement sera envoyé à ce numéro."*), `Email du parent (facultatif)` (`parent@exemple.ci`, help *"Si vide, un email de référence sera généré automatiquement."*), `Catégorie de frais (label)` (`Ex: Scolarité T1`), `Notes internes`.

### 3.8 Lien de paiement modal on the Créances page (`index-TfNa1dpy.js`)
`Reste à payer :`, `Montant (FCFA) *`, email `(facultatif)` `parent@example.com`, `Téléphone WhatsApp` `+225 07 00 00 00 00`, plus a **"📲 Les deux parents"** toggle and `title:"Aucun numéro parent enregistré"` when no phone exists. Actions: `Générer le lien de paiement`, `Copier le lien de paiement`, `Ouvrir le lien de paiement`, `Envoyer par WhatsApp`.

### 3.9 Nouvel abonnement cantine / transport
Both: *"Des créances mensuelles seront automatiquement générées de la date de début à la fin de l'année scolaire."*
Cantine: `Élève *` (`Rechercher par nom ou matricule...`), `Montant mensuel (FCFA) *` (`Ex: 10000 (par mois)`), `Date début *`, `Date fin (optionnel)`, `Notes`.
Transport: same + `Zone / Quartier` (`Zone 1, Cocody, Yopougon...`) and `Ex: 20000 (par mois)`, `Notes supplémentaires`.

### 3.10 Nouvelle dépense cantine / transport
`Libellé *` (`Ex: Achat vivres semaine du 10/03, Salaire cuisinier...` / `Ex: Carburant semaine du 10/03, Vidange car...`), `Montant (FCFA) *` (`25000` / `35000`), `Catégorie`, `Date`, `Notes`.

### 3.11 Vente additionnelle ("Nouvelle vente ponctuelle")
Section intro: *"Uniformes, voyages scolaires, matériel, frais exceptionnels…"*
`Libellé *` (`Ex: Uniforme complet, Voyage Yamoussoukro...`), `Montant (FCFA) *` (`15000`), `Catégorie` (6 options), `Notes (optionnel)` (`Remarque ou référence...`).

### 3.12 Budget — "Nouvelle ligne budgétaire"
`Catégorie` (Recettes / Dépenses), `Libellé` (`Ex: Frais de scolarité`), `Montant prévisionnel (FCFA)`.

### 3.13 Payment-config wizard (4 steps) — provider-specific credential fields
- **Paystack**: `(commence par pk_…)` placeholder `pk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, `(commence par sk_…)`
- **CinetPay**: `(Site ID — 9 chiffres)` placeholder `Ex: 105898745`, `(Clé API)` `Votre code d'accès CinetPay`
- **PayDunya**: `(Master Key)`, `(Private Key)`, `(Public Key)`, `(Token)` + explicit `Mode de fonctionnement` radio: `Test (paiements fictifs)` / `Production (paiements réels)`
- **Hub2**: `(Client ID)`, `(Client Secret)`

### 3.14 Relance / communication log entry (student detail)
`Type` (6 options), `Destinataire (optionnel)` (`Nom ou numéro`), `Notes`.

### 3.15 Réconciliation modal
`Montant`, `Associer à l'élève` (`Rechercher par matricule ou nom...`), `Créance à solder` (loading text `Chargement des créances...`), `Motif de réconciliation` (`Motif (optionnel)`).

---

## 4. Tabs, filters, table headers

### 4.1 `/caisse` tabs — `[Aperçu, Entrées, Sorties, Clôture]`
KPI tiles: `Encaissements`, `Apports manuels`, `Dépenses (validées)`, `Transactions`; hero card `Solde en caisse (espèces)` with sub *"Depuis le début de l'année scolaire · espèces uniquement"*, plus `Entrées espèces` / `Sorties espèces`.
Sorties filter chips: `Toutes`, `Aujourd'hui (validées)`, `Ce mois (validées)`, `Cette année (validées)`, `En attente validation`.
Export dropdown (` Exporter `): `Livre de caisse complet`, `Entrées uniquement`, `Sorties uniquement` → files `livre-caisse-…csv`, `caisse-entrees-…csv`, `caisse-sorties-…csv` (`;`-delimited).
CSV headers:
- entrées → `["Type","Date","Heure","Élève / Libellé","Mode de paiement","Montant (F CFA)"]`
- sorties → `["Date","Catégorie","Description","Bénéficiaire","Mode de paiement","Montant (F CFA)","Statut"]`
- complet → `["Date","Catégorie","Description","Bénéficiaire","Mode de paiement","Entrée (F CFA)","Sortie (F CFA)","Statut"]` *(inferred header order from the row-builder)*

### 4.2 `/creances`
KPIs: `Total dû`, `Encaissé`, `Reste à recouvrer`, `En retard` + a `Taux de recouvrement global` progress bar (green ≥ 70 %, amber ≥ 40 %, else red).
Filters: `Toutes` · `En attente` · `Part. payé` · `Soldé` · `En retard` (destructive) · `Vue élèves` · search `Rechercher...` (`Rechercher une créance par élève`).
Deep-link filters via `?filtre=` : `{sans_echeance:"Créances sans date d'échéance", negatives:"Créances à solde anormal (trop-perçu)"}`, rendered as *"Filtre actif : …"* with a *" Voir toutes les créances"* escape.
Per-student columns: `Dû`, `Remise`, `Payé`, `Reste`.
Overflow menu (direction/super_admin only, `title:"Actions avancées — réservé à la direction"`) → **"Annuler toutes les créances"**.

### 4.3 `/paiements` — "Journal des Paiements" / "Historique des encaissements"
Table headers: `Référence / Date`, `Élève`, `Mode`, `Montant`, `Statut`, `Actions`.
Row action `title:"Rembourser ce paiement"` (visible only to `["direction","super_admin"]`).
Deep-link filter: `{remises_elevees:"Paiements avec remise supérieure à 50%"}`.
Buttons: `Exporter CSV` (→ `paiements_YYYY-MM-DD.csv`), `Enregistrer Paiement` (→ `/paiement-parent`).

### 4.4 `/paiement-parent` — 4-step wizard
Steps: `Chercher` → `Détails` → `Paiement` → `Reçu`.
Section headings inside step 2: `Scolarité` (badged `{année} · En cours` or `· Réinscription`), ` Ventes & Fournitures`, cantine + transport rows, `Déjà réglées` (`✅ Réglée`).
Bulk controls `COCHER TOUT` / `DÉCOCHER TOUT`, counter `{n} ITEM(S)`.
Step 3: `Détails du paiement`, `Montant :`, `TOTAL ENCAISSÉ`, `Mode de règlement` (8 tiles), `Référence (Optionnel)` (`Ex: N° Chèque, Réf Transaction...`), submit `Valider l'encaissement`.
Step 4: `Paiement enregistré !` / *"L'opération a été validée avec succès."*, `Total Encaissé`, `Solde Restant`, buttons ` Imprimer le reçu` and `Nouveau paiement`.

### 4.5 `/paiements-en-ligne` — "Réceptions Mobile Money"
KPIs: `À confirmer manuellement`, `Enregistrés automatiquement`, `Paiement sans élève identifié`, `Parent n'a pas encore payé`.
Actions: `Actualiser` (`title:"Interroge l'opérateur de paiement pour récupérer les derniers paiements reçus"`), `Envoyer un lien`, per-row `Vérifier` / `Valider` / `Confirmer rejet` (`Motif de rejet...`), `Copier`, `Ouvrir`, `💬 WhatsApp`.

### 4.6 `/rapports` — "Rapports Financiers"
Tabs: `Versements reçus` · `Impayés` · `Bilan financier`. Range presets `Aujourd'hui`, `Ce mois`, `Cette année`, plus `Du`/`au` and `Toutes les classes`.
Impayés extras: checkbox **"Inclure les élèves sortants avec dettes"** (`incluireSortants`), `SORTI` badge, amount buckets `< 20k`, `20k–50k`, `50k–100k`, `100k–200k`, `> 200k`, panels `Impayés par classe`, `Distribution des montants dus`, `Élèves avec impayés`.
Bilan: `Total recettes`, `Total dépenses`, `Résultat net`, `CA cumulatif de l'année`, `Recettes vs Dépenses par mois`, `Modes de paiement`, `Détail par mois`.
CSV exports — versements columns: `Référence, Matricule, Nom élève, Prénoms élève, Classe, Catégorie de frais, Mode de paiement, Montant (FCFA), Date, Statut, Parent, Tel. parent`; impayés columns: `Matricule, Nom, Prénoms, Classe, Téléphone, Total dû (FCFA), Remise (FCFA), Payé (FCFA), Reste à payer (FCFA)`; bilan columns: `Mois, Recettes (FCFA), Dépenses (FCFA), Solde (FCFA)`.

### 4.7 `/analytics` — "Analyse Financière"
KPIs: `Chiffre d'affaires` (sub `sur {x} F attendus`), `Taux de recouvrement` (sub `{x} reste à percevoir`), `Reste à percevoir` (sub `{n} élève(s) en retard`), `Résultat net` (sub `Recettes − Dépenses`).
Charts: `Évolution du chiffre d'affaires mensuel` (toggle `Par mois` / `Cumulé`), `Recettes vs Dépenses`, `Répartition par mode de paiement`, `Progression du taux de recouvrement`, `Encaissements par catégorie de frais`.

### 4.8 `/cantine` tabs — `Abonnés`, `Dépenses`, `Résumé`, `Liste accès`
KPIs `Abonnés actifs`, `Facturé`, `Encaissé`, `Impayé`. Résumé: `Solde net cantine` = *"Recettes encaissées − Dépenses"*, plus ` Dépenses par catégorie` and `Suivi mensuel` (`Mois`, `Abonnés`, `Dépenses`, `Solde`, `Total`).
`Liste accès` tab has `Copier liste` and per-student toggles `title:"Autorisés à la cantine"` / `title:"Accès bloqué"`.

### 4.9 `/transport` tabs — `Abonnés`, `Dépenses`, `Résumé` (no access list); `Suivi mensuel CAR`, `Solde net transport`.

### 4.10 `/autres-services` — "Autres services" / *"Internat, activités parascolaires, assurance…"*
Empty state: **"Aucun service configuré"** → *"Créez des catégories de frais avec le switch "Service avec abonnement""* → link `Paramètres → Frais scolaires`.

### 4.11 `/anti-fraude` — "Module Anti-Fraude"
KPIs `Total alertes`, `Ouvertes`, `Critiques`, `Types détectés`. Two selects: `Tous les statuts` (4 values) and `Toutes sévérités` (3 values). Row action `Traiter` → modal `Traiter l'alerte` with `Note de résolution (optionnel)...` and buttons `Faux positif` / `Résoudre`.

### 4.12 `/reconciliation` — "Réconciliation des paiements"
Header sub `{n} paiement(s) en attente de réconciliation`. Empty: `Aucun paiement à réconcilier` / `Tous les paiements ont été rapprochés`. Section `À réconcilier`.

### 4.13 `/credit-communication` — "Crédit Communication"
KPIs `Crédit SMS disponible`, `SMS restants`, `Ce mois`, `Total utilisé`, `Offerts`. Panels `Packs de recharge` (badges `Recommandé`, `Disponible prochainement`), `Derniers mouvements` (`Type`, `Quantité`, `Solde après`, `Description`, `Date`).

### 4.14 `/abonnement` — "Abonnement Lakoli"
`Formule actuelle`, `Historique de facturation` (`Référence`, `Formule`, `Montant`, `Date`, `Statut`), `Garantie de remboursement` (`Premier paiement`, `Date limite de rétractation`), `Demande de remboursement`.

### 4.15 `/conditions-et-tarifs` — aggregator tariff table
Columns: `Agrégateur`, `Frais indicatifs`, `Délai de versement`, `Mode test`, `Documentation`.

---

## 5. Business rules stated in French UI copy (verbatim — this is the gold)

### 5.1 How the cash balance is computed (`/caisse`, blue callout "Comment est calculé le solde ?")
> **Solde espèces** = apports manuels en espèces + encaissements en espèces − dépenses validées en espèces (depuis le début de l'année scolaire active).
> Les dépenses saisies dans **Cantine** et **Transport** sont incluses automatiquement comme sorties espèces, sans créer une seconde écriture.
> Les dépôts à la banque et dépenses par chèque / virement sont comptabilisés comme sorties mais **ne réduisent pas** le solde physique de la caisse.

### 5.2 Expense approval circuit (`/caisse`, "Circuit de validation")
> Les dépenses créées sont en **brouillon**. Seuls la Direction et la Comptabilité peuvent les **valider** pour qu'elles impactent la caisse et les rapports.

RBAC in code: `Xe=["direction","comptable","super_admin"]` (can create) and `Ye=["direction","comptable","super_admin"]` (can validate) — `index-B9Qj624b.js`.

### 5.3 Payment-mode impact on the drawer (`/caisse`, "Mode de paiement")
> Les dépenses en **espèces** réduisent directement le solde de la caisse physique.
> Les **dépôts à la banque** et dépenses par **chèque / virement** sont comptabilisés mais marqués *hors caisse* — ils ne modifient pas le solde espèces.

### 5.4 One closing per day (`/cloture-caisse`)
> **Clôture déjà effectuée** — Le PV **{pvNumero}** existe déjà pour le {date}. Choisissez une autre date ou annulez le PV existant.

Guard: `$?.exists && $.cloture?.statut !== "annule"` blocks the form entirely.

> {montant} de dépenses par chèque, virement ou autre mode hors espèces sont comptabilisées dans le rapport, mais pas dans le tiroir-caisse.

> Aucun paiement enregistré pour cette date. *(shown when `nbTransactions === 0`)*

Cancel confirm:
> Annuler le PV {pvNumero} du {date} ?
> Cette action est irréversible. Le PV sera marqué "Annulé".

Cancel is restricted to `me=["direction","super_admin"]`; creating a closing to `be=["super_admin","direction","comptable","caissier"]`.

### 5.5 Theoretical vs. real balance (PV formula, computed client-side)
`soldeTheorique V = fondOuverture + totalEncaisseCash − totalDepensesCash`; `ecart g = soldeReel − V`.
PV §3 "Réconciliation de caisse" prints the écart as `✓ AUCUN ÉCART` / `⚠ EXCÉDENT` / `⚠ MANQUANT`.

### 5.6 Mass cancellation of receivables (`/creances`, direction-only)
> ⚠️ **Action irréversible** — Cette action va annuler **{n} créance(s)** non soldées de l'année **{libellé}**.
> Les créances annulées n'apparaîtront plus dans les indicateurs de retard. Les créances déjà soldées et les autres cycles ne sont pas affectés.
> Motif détaillé * … *"10 caractères minimum. Le motif restera dans le journal d'audit."* (placeholder `Ex. Frais gérés hors Lakoli avant la reprise des données`)
> Pour confirmer, saisissez exactement : `ANNULER {n}`

Preview grid: `Périmètre isolé` (= the `niveauInterface` cycle), `Élèves concernés`, `Reste à recouvrer`, `Déjà encaissé`.
Payload sends both `expectedCount` and `confirmationCount` → server-side optimistic-concurrency check. **INFERRED**: the server re-validates the count so the destructive op aborts if the set changed since the preview.

### 5.7 Manual cash desk is for physical money only (`/paiement-parent`)
> **Mobile Money et Carte** sont enregistrés automatiquement par Lakoli. Utilisez cette page **uniquement** pour les règlements reçus physiquement au guichet (espèces, chèque, virement).

> ⚠ Aucune année scolaire active. Veuillez en configurer une avant d'enregistrer des paiements.

### 5.8 Multi-item settlement is executed as N sequential `POST /paiements` (CONFIRMED in code)
For each selected line: `creance` → `POST /paiements`; `vente` **with** `creanceId` → `POST /paiements`; `vente` **without** → `PATCH /ventes-additionnelles/{id}/paiement {montantPaye: previous + delta}`; `cantine` / `transport` → `PATCH /{service}/abonnements/{id}/paiement`.
Cross-check, `aide` article *paiements-encaisser*:
> Si le parent paie plusieurs créances en même temps, effectuez autant de transactions que de créances pour un suivi précis.

### 5.9 Refunds
Amount clamped `Math.min(Math.max(0, Number(l)||0), montantEncaissé)`; partial = `0 < d < i`. `motifRemboursement` is mandatory (submit disabled on empty). Overpayment (`tropPercu`) is surfaced with a one-click "refund only the overpayment" shortcut.

### 5.10 Discounts apply to scolarité only (`/remises`)
> **Remarque :** Les remises s'appliquent uniquement sur la **scolarité** (pas sur l'inscription). Elles sont appliquées lors de la création d'une créance pour un élève bénéficiaire.

Aide article *finance-remises* adds:
> Motif obligatoire — Saisissez le motif de la remise. Il sera visible dans les rapports.
> ⚠ Les remises sont accordées uniquement par la direction. Le scolarité peut les appliquer sur instruction écrite.

### 5.11 Fee catalogue semantics (`/categories-frais`)
> Les catégories de frais représentent les montants facturés aux parents d'élèves : inscription, scolarité, cantine, transport, activités, manuels scolaires ou autres frais.
> Lorsqu'un frais est appliqué à un élève, Lakoli crée automatiquement une **créance à recevoir** pour l'établissement.
> **Pour démarrer :** … **« Renseigner »** sur les catégories existantes pour définir les montants et la périodicité. … **« Nouvelle catégorie »** uniquement pour des frais supplémentaires propres à votre école.
> Lakoli a déjà créé les catégories les plus courantes.

Scope change safety:
> Définissez le périmètre des élèves concernés. **Modifier ce choix n'affecte pas les créances déjà générées.**

Delete guard:
> ⚠ Cette action est irréversible. **Seules les catégories sans créances associées peuvent être supprimées.**
> *Suppression impossible* → **Désactiver à la place** : *"…désactiver cette catégorie : elle sera masquée à l'inscription mais les créances existantes seront conservées."*

Recurrence explanation:
> **Oui** : ce frais revient chaque année scolaire (ex : scolarité, inscription, transport, cantine).
> **Non** : frais ponctuel, une seule fois (ex : tenue uniforme à l'entrée, sortie scolaire exceptionnelle).

Instalment-sum check: *"Astuce : ajustez un mois pour que le total corresponde exactement au montant total."* + inline error `(écart +N FCFA vs montant total)`.

### 5.12 Enrolment is blocked when fee amounts are 0 (`/inscriptions/nouvelle`)
> **Montants des frais manquants — inscription bloquée**
> Les catégories de frais ont déjà été pré-créées pour vous (inscription, scolarité, fournitures…), mais leurs **montants sont encore à 0 FCFA**.
> Dans **Paramètres → Catégories de frais**, ouvrez chaque ligne et saisissez le montant correspondant (ex : 25 000 FCFA pour l'inscription, 75 000 FCFA pour la scolarité…). Cela prend moins de 2 minutes.

Also: `Aucun frais obligatoire configuré pour cette classe.` and a `Récapitulatif financier annuel` panel (`Frais obligatoires`, `Services optionnels sélectionnés`, `CA attendu brut`, `Remise`, `Total net à payer`).

### 5.13 Post-payment immutability of an enrolment
> Cette inscription comporte déjà un paiement. Les corrections ayant un impact financier doivent être effectuées par une procédure de régularisation.

and, before any cash:
> **Modifier l'inscription avant encaissement** (route `PATCH /preinscriptions/{id}/avant-encaissement`)
> Aucun encaissement enregistré — les informations peuvent encore être modifiées.

### 5.14 Validation ≠ encashment (`/preinscriptions`)
> **Valider l'inscription** active l'élève et génère les créances annuelles. **Cette action ne constitue pas un encaissement et ne remplace pas l'enregistrement d'un paiement.**

> Utilisez ce formulaire si aucun lien n'a été envoyé au parent, ou si le parent a payé directement à l'école. **Les paiements via lien sont enregistrés automatiquement.**

> **Confirmer paiement en ligne reçu** — À utiliser uniquement si le paiement a bien été effectué mais n'a pas été détecté automatiquement. Saisissez la référence de transaction fournie par le provider.

> Tant que les frais d'inscription ne sont pas encaissés et l'inscription validée, l'élève reste ici dans **{onglet}**. … Le dossier est activé automatiquement dès que le paiement est enregistré.

> **Paiement en ligne non configuré** — Pour envoyer un lien de paiement, vous devez d'abord connecter un moyen de paiement (Paystack, CinetPay, etc.) dans les paramètres de votre école.

> Un SMS sera envoyé immédiatement au parent. Le dossier passera en statut 'Paiement demandé'.

### 5.15 Créance regeneration (student detail → "Options avancées")
> Cela va annuler les créances scolarité impayées et les regénérer selon la configuration actuelle des frais.
>
> À utiliser uniquement en cas d'erreur dans les créances. Continuer ?

Menu caption: *"À utiliser en cas d'erreur — annule et recrée les créances impayées"*.

### 5.16 Service subscriptions
> Résilier cet abonnement ? **Les créances impayées restantes seront annulées.**
> Des créances mensuelles seront automatiquement générées de la date de début à la fin de l'année scolaire.
> Aucune créance mensuelle générée (abonnement créé avant la mise à jour) *(legacy-data warning)*
> **Suspendre des mois** — Les mois sélectionnés seront annulés (plus de dette) et marqués comme suspendus dans l'onglet Finance. / Cochez au moins un mois à suspendre.

### 5.17 Reconciliation semantics
> Sélectionnez la créance à solder — *"Sans cela, le paiement sera rattaché à l'élève mais aucune dette ne sera marquée comme payée."*
> Aucune créance impayée trouvée pour cet élève. Le paiement sera rattaché à l'élève mais aucune dette ne sera marquée comme réglée.
> Sélectionnez une créance pour que le solde soit mis à jour, sinon le paiement ne sera pas déduit d'une dette.

Auto-selection rule (CONFIRMED in code): if exactly one unpaid créance exists (`resteAPayer > 0`), it is pre-selected; the modal hard-blocks submission when `f.length > 0 && !l`.

Tour copy:
> La réconciliation compare les paiements Lakoli avec les relevés de votre agrégateur de paiement. Elle identifie les écarts à corriger **avant la clôture de caisse**.

### 5.18 Online payment — validation policy (`/paiements-en-ligne`)
> **Montant reçu — en attente de validation.** Si le montant reçu correspond exactement au montant facturé, cliquez **Valider — Enregistrer en caisse**. Si l'opérateur a reçu un montant différent, enregistrez le reliquat via une saisie manuelle.

> Vérification en cours auprès de l'opérateur. … pour forcer la mise à jour. **Si le statut ne change pas, vous pouvez encaisser manuellement sans risque de doublon.**

Aide article adds:
> La page « Réceptions Mobile Money » affiche aussi une alerte en haut si un paiement attend votre confirmation **depuis plus de 5 minutes**.

### 5.19 Custody-of-funds / regulatory disclaimer (`/parametres/paiement` + `/conditions-et-tarifs`)
> Pour encaisser en ligne (Orange Money, Wave, carte bancaire…), il faut passer par un **service de paiement agréé** — appelé agrégateur. … Ils sont autorisés et contrôlés par la **BCEAO** (Banque Centrale des États de l'Afrique de l'Ouest).
> L'agrégateur encaisse le paiement et vire les fonds **directement sur votre compte bancaire/marchand**. **Lakoli ne voit jamais cet argent, ne le détient jamais — il n'est que la passerelle de notification.**
> Lakoli reçoit automatiquement la confirmation du paiement et met à jour le dossier de l'élève — **sans aucune intervention de votre part**.
> Ces codes ne donnent aucun accès à votre argent — Lakoli s'en sert uniquement pour confirmer que le paiement a bien eu lieu.
> Les paiements des parents sont **vérifiés automatiquement** dès la redirection après paiement, **et au plus tard dans les 2 minutes via notre vérificateur automatique** — aucune configuration supplémentaire n'est requise de votre côté.
> Le respect des obligations réglementaires (KYC, conformité fiscale, licence de paiement) relève du contrat entre votre école et l'agrégateur choisi. **Lakoli n'est ni un établissement de paiement, ni un intermédiaire financier** — l'application se limite à générer les liens de paiement et à enregistrer les confirmations transmises par l'agrégateur.

Mode detection:
> Le mode (test/production) est déterminé automatiquement selon le préfixe de votre code secret (sk_test_ = test, sk_live_ = production).
> ⚠ CinetPay ne propose pas de mode test — dès l'activation, les paiements sont réels.
> ⚠ Les codes de test et de production sont différents [PayDunya] — assurez-vous d'être dans le bon mode avant de copier.
> Hub2 est en bêta chez Lakoli. Nous recommandons Paystack en usage principal tant que Hub2 n'a pas fait ses preuves avec un volume de production plus important.
> Ce test ne fait qu'enregistrer la connexion — le paiement en ligne ne sera activé qu'après avoir cliqué sur « Confirmer et activer » à l'étape suivante.

Aggregator tariff rows (verbatim):
| Agrégateur | Frais indicatifs | Délai de versement | Mode test |
|---|---|---|---|
| Paystack (`Recommandé`) | ≈ 1,5% par transaction (voir grille Paystack à jour) | 24 à 48h ouvrées sur votre compte bancaire ou mobile money | Oui — clés de test disponibles avant activation |
| CinetPay (`Disponible`) | Variable selon opérateur mobile money (voir grille CinetPay) | Selon configuration de votre compte marchand CinetPay | Non — CinetPay ne propose pas de mode test, tout paiement est réel |
| PayDunya | Variable selon moyen de paiement (voir grille PayDunya) | Selon configuration de votre compte marchand PayDunya | Oui — mode test/production déclaré manuellement lors de la configuration |
| Hub2 | Variable selon opérateur (voir grille Hub2) | Selon configuration de votre compte marchand Hub2 | — |

### 5.20 SMS wallet metering
> Les SMS non envoyés en cas de solde insuffisant ne sont pas débités. **Chaque SMS de plus de 160 caractères (ou 70 pour les messages accentués) compte comme plusieurs segments.**
> Solde épuisé — les SMS sont actuellement bloqués. Rechargez votre compte. / Solde critique — rechargez bientôt pour ne pas interrompre les notifications. / Solde bas — nous vous recommandons de recharger avant d'atteindre 0.
> Paiement Mobile Money sécurisé — votre solde est crédité immédiatement après confirmation.
> Ce paiement a déjà été crédité sur votre compte. *(idempotency guard on `recharge/verify`)*
> Paiement reçu mais crédit non appliqué : {err}. Il sera appliqué automatiquement dans quelques minutes.

### 5.21 SaaS billing / refund policy
> Vous êtes dans le délai de rétractation de **60 jours**. … envoyez votre demande à **remboursement@lakoli.com**
> Le délai légal de rétractation de 60 jours est dépassé.
> J'accepte les **Conditions Générales d'Utilisation et de Vente** de Lakoli, y compris la politique de remboursement (droit de rétractation de 60 jours à compter du premier paiement).
> ⚠️ Cochez cette case pour pouvoir choisir une formule.
> Votre établissement compte {n}, au-delà du seuil de votre formule actuelle. Passez à la formule {x} pour rester dans les limites de votre plan.
> Expire dans {v} jour(s) — **aucun prélèvement automatique**, pensez à repayer avant cette date pour éviter la suspension.
> **Accès suspendu** — Votre essai ou votre abonnement est arrivé à échéance. Choisissez une formule ci-dessous pour réactiver l'accès à Lakoli.

Pricing is per-student, tiered: `À {seuil_eleves_max} élèves : {x} F CFA par élève/mois`, `Pour vos {n} élèves : tarif personnalisé sur devis`, `{min}–{max} élèves`.

### 5.22 In-app help — daily/weekly accountant control checklist (`index-BT4yo3uy.js`, article `guide-comptable`)
**Contrôle quotidien**
- Vérifier les encaissements de la veille — *Rapports → Paiements → Hier*
- Contrôler la clôture de caisse — *Caisse & Dépenses → Clôtures → Vérifier l'écart = 0*
- Vérifier les paiements en ligne — *Menu Réceptions Mobile Money → statuts*
- Contrôler les nouvelles créances créées — *Créances → filtrées par date de création*

**Contrôle hebdomadaire**
- Rapport des encaissements de la semaine
- Rapport des impayés (créances en retard)
- Vérification des remises accordées
- Réconciliation paiements en ligne vs Mobile Money reçus

**En cas d'anomalie**
- Écart de caisse : consulter le journal d'audit, identifier le paiement en cause
- Créance manquante : vérifier si l'inscription a bien été enregistrée
- Double paiement : signaler à la direction pour annulation

### 5.23 Help-article créance status table (`finance-creances`)
| Statut | Signification |
|---|---|
| En cours | Solde restant dû, en cours de paiement |
| Soldée | Entièrement payée |
| Annulée | Annulée par la direction (remboursement ou erreur) |
| En retard | Échéance dépassée sans paiement |

> ⚠ N'annulez une créance que sur instruction explicite de la direction. Toute annulation est tracée.

### 5.24 Help-article receipt rule (`paiements-encaisser`)
> ⚠ **Toujours imprimer et remettre le reçu au parent IMMÉDIATEMENT. Un paiement sans reçu peut créer des litiges.**

### 5.25 Help-article closing rule (`paiements-cloture`)
> ⚠ **La clôture est irréversible. Vérifiez soigneusement avant de confirmer.**
*(Note the contradiction with §5.4: the UI does ship a `DELETE /cloture-caisse/{id}` "Annuler ce PV" action restricted to direction/super_admin. The help text is stricter than the code.)*

---

## 6. Printed / generated documents

### 6.1 PV de Clôture de Caisse (full HTML template, `index-Cn8YezvA.js`)
Opened in a popup and auto-printed after 600 ms. Structure:
- Header: establishment logo (`/api/storage/objects/…`), `nom`, `adresse`, `Tél:`
- Title box: **Procès Verbal de Clôture de Caisse** + capitalised long-form date
- Meta boxes: `Numéro PV`, `Date de clôture`, `Caissier responsable`, `Transactions` (`{n} paiement(s) / {m} élève(s)`)
- **§1. Répartition des encaissements par mode de paiement** — columns `Mode de paiement | Nb transactions | Montant | %`, total row `TOTAL ENCAISSÉ … 100%`
- **§2. Dépenses de la journée** — `Catégorie | Nb | Montant`, `TOTAL DÉPENSES`; else *"Aucune dépense enregistrée ce jour."*
- **§3. Réconciliation de caisse** — `Fond de caisse à l'ouverture` (+), `Encaissements en espèces du jour` (+), `Dépenses payées en espèces du jour` (−), `Solde théorique (calculé)`, `Solde réel déclaré par le caissier`, `Écart ✓ AUCUN ÉCART / ⚠ EXCÉDENT / ⚠ MANQUANT`
- **§4. Observations** — caissier + direction, defaulting to `Néant`
- **§5. Signatures et cachet** — `Le/La Caissier(ère)`, `Signature & Cachet`, plus optional `cachetObjectPath` stamp image
- Footer: `Document généré le … à … — {école} — {pvNumero}`

### 6.2 Reçu de paiement (`print-utils-DQ07mrV6.js`)
Official Ivorian header block: `Ministère de l'Education Nationale / et de l'Alphabétisation`, `DRENA:`, `IEPP:`, establishment name + contacts; right column `République de Côte d'Ivoire / Union - Discipline - Travail / Année scolaire:`; Armoiries image.
Title `Reçu de Paiement {référence}`. Blocks: `Informations sur l'élève` (`Matricule`, `Nom et Prénoms`, `Né(e) le … à …`, `Sexe … Classe`, `Montant total à payer`, `Contact parent`); payments table `N° | Date | Libellé | Montant`; footers `TOTAL VERSEMENTS`, `RESTE À PAYER (SOLDE)` (red if > 0, green if ≤ 0); side box `Cachet et signature du comptable` + `{ville}, le {date}` (ville defaults to `Abidjan`).
Printed with `@page{margin:18mm 16mm}`, Times New Roman, and a CSP meta `default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data:`.

### 6.3 Session caissier recap (`session-BXAiHD0I.js`)
`Session Caissier` / *"Récapitulatif des encaissements de la journée"*; printed table `# | Réf. | Élève | Mode | Heure | Montant`, filtered to `statut === "paye"`; panels `Par mode de paiement`, `Par caissier`, `Total session`.

### 6.4 Provider receipt
`GET /api/payment-providers/recu/{paiementId}` returns ready-made HTML that is written into a popup and printed after 800 ms — used automatically right after `POST /paystack/requests/{id}/validate`.

---

## 7. RBAC & feature gating

### 7.1 Roles (8) — `lakoli-main.js`
`["super_admin","direction","comptable","caissier","scolarite","enseignant","auditeur","permanent"]`
Aliases used across nav/routes: `om = [super_admin, direction, comptable]`, `ti = [super_admin, direction, comptable, caissier]`, `An = [super_admin, direction]`, `jt = [super_admin, direction, scolarite]`.

### 7.2 Route guards for finance routes (from `<Route allowedRoles=[…]>`)
| Route | allowedRoles |
|---|---|
| `/paiement-parent` | super_admin, direction, comptable, caissier |
| `/paiements` | + auditeur |
| `/paiements/session` | + auditeur |
| `/paiements-en-ligne` | super_admin, direction, comptable, caissier |
| `/creances` | super_admin, direction, comptable, caissier |
| `/categories-frais` | super_admin, direction, comptable |
| `/remises` | super_admin, direction |
| `/caisse` | super_admin, direction, comptable, auditeur |
| `/cloture-caisse` | super_admin, direction, comptable, caissier, auditeur |
| `/budget` | super_admin, direction, comptable, auditeur |
| `/rapports` | super_admin, direction, comptable, auditeur |
| `/analytics` | super_admin, direction, comptable, auditeur |
| `/reconciliation` | super_admin, direction, comptable |
| `/documents` | super_admin, direction, scolarite, comptable |

In-page RBAC beyond the route guard:
- Refund button: `["direction","super_admin"]` only
- "Actions avancées → Annuler toutes les créances": `super_admin`/`direction`
- Anti-fraude bulk-resolve: `direction`/`super_admin`
- Budget mutations: `["super_admin","direction"]`
- Critères de remise mutations: `["direction","super_admin"]`
- Dépense create/validate: `["direction","comptable","super_admin"]`
- Clôture create: `["super_admin","direction","comptable","caissier"]`; PV cancel: `["direction","super_admin"]`

### 7.3 Module gating — `GET /module-access/catalog`
Layout computes `he = new Set(catalog.effectiveModules)` and `_e = new Set(catalog.map(c=>c.code).filter(c=>!he.has(c)))` → i.e. **entitled vs. locked** module codes. Nav entries resolve their code via `lm(e) = e.gatedModule ?? t3[e.path]`.
Finance module codes (`t3` map):
```
/paiement-parent   → payment_entry
/paiements-en-ligne→ online_payments
/caisse            → cash
/creances          → receivables
/rapports          → financial_reports
/analytics         → financial_analytics
/cantine           → cafeteria
/transport         → transport
/autres-services   → other_services
/credit-communication → communication_credit
/abonnement        → subscription
/audit             → audit_log
```
Only two nav entries carry an explicit `gatedModule` override (`orientation_dob`, `conformite`) — everything else is gated by path→code mapping. **CONFIRMED** that gating is server-driven per tenant, not a hard-coded plan table in the bundle.

### 7.4 Sidebar structure — section `finance-services` = "Finance & services" / *"Encaissements et prestations"*
Groups & items:
- **Paiements**: `Nouveau paiement` (/paiement-parent, keywords `encaisser, encaissement manuel, paiement parent`), `Paiements en ligne` (keyword `réceptions Mobile Money`), `Caisse`
- **Suivi financier**: `Créances`
- **Services aux élèves**: `Cantine`, `Transport`, `Autres services` (roles `ti + scolarite`)
- (in section `piloter` → group **Analyse**): `Rapports financiers`, `Analyse financière`

**Not in the sidebar at all** — reachable only from `/parametres` → *"Accès rapide — Configuration"* (*"Ces modules ne sont pas dans le menu principal. Accédez-y ici quand nécessaire."*):
`Paiement en ligne` (/parametres/paiement, *"Paystack / CinetPay de l'école"*), `Catégories de frais` (*"Frais scolarité, transport…"*), `Remises & Bourses` (*"Réductions accordées"*), `Budget prévisionnel` (*"Objectifs financiers"*), `Paiements (liste)` (*"Historique des versements"*), `Anti-Fraude` (*"Détection d'anomalies"*), `Réconciliation` (*"Contrôle comptable"*), `RH & Paie` (*"Barèmes CNPS/CMU/IRPP, rubriques"*), `Abonnement Lakoli`, `Journal SMS`, `Export de résiliation`.
Plus **`/cloture-caisse`**, which has no sidebar entry at all and is reached only from the Caisse page card *"Clôture de caisse — Arrêté journalier officiel avec PV imprimable"* (`data-tour-id="ptour-caisse-cloture"`).

### 7.5 Role quick-action bars (`x0`)
`comptable` → `[Accueil, Encaisser, Créances, Rapports]`; `caissier` → `[Accueil, Encaisser, Créances]`; `direction`/`super_admin` → `[Accueil, Élèves, Encaisser, Créances]`.

---

## 8. Cross-cutting: `niveauInterface` (cycle isolation) — a hard finance boundary

`lakoli-main.js`:
```js
fu = ["maternelle","primaire"];  Tp = ["college","lycee","superieur"];
z5 = {primaire: fu, secondaire: Tp};
L5 = {primaire:{label:"Primaire", badge:"Primaire (Maternelle + CM2)"},
      secondaire:{label:"Secondaire", badge:"Secondaire (Collège + Lycée)"}}
```
`niveauInterface` is passed as a query param on **/creances, /paiements, /rapports/paiements, /rapports/impayes, /budget-previsionnel/comparaison, /creances/annuler-masse, /creances/annulation-masse-apercu, /inscriptions**, and shown to the operator as **"Périmètre isolé"** in the mass-cancellation dialog. A user with `canSwitch` toggles between the two interfaces; the dashboard passes `cycles=` instead.
This is the mechanism the copy refers to with *"les autres cycles ne sont pas affectés"*.

---

## 9. Notable messaging templates (money-related, verbatim)

- WhatsApp payment link (créances page):
  > Bonjour, voici le lien de paiement sécurisé pour {nom} {prenoms} :
  > {generatedUrl}
  > Montant : {montant}
- WhatsApp dunning (rich, `*bold*`):
  > Bonjour {parent}, parent de *{élève}*.
  > Nous vous rappelons qu'un solde de *{montant}* est dû pour l'année scolaire en cours.
  > Merci de régulariser votre situation au secrétariat ou via notre portail en ligne.
  > Cordialement, la Direction.
- SMS dunning (accent-free, for GSM-7 segment economy):
  > Bonjour {parent}, parent de {élève}. Un solde de {montant} est du pour l'annee scolaire. Merci de regulariser au secretariat. Cordialement, la Direction.
- SMS payment link (`index-BYXLUh--.js`):
  > {école} - Bonjour cher parent{, de X}, Frais {catégorie} : {montant} FCFA. Veuillez regulariser avant le {date} : {authorizationUrl}
- Cantine/transport bulk dunning result toast: `{n} SMS envoyé(s) aux parents avec impayés cantine` / `…transport` / `…pour ce service`
- SMS log types: `{lien_paiement:"Lien paiement", relance_impayes:"Relance impayés", inscription:"Inscription"}`; statuses `envoye:"Envoyé"`, `echec:"Échec"`, `en_attente:"En attente"`.
- Support escalation from the payment-config wizard (WhatsApp deep link to `+225 01 01 54 51 62`):
  > Bonjour, j'ai besoin d'aide pour configurer le paiement en ligne ({provider}) sur Lakoli. Je suis bloqué(e) à l'étape {n}/4 de l'assistant.

---

## 10. Public / unauthenticated finance surface

`/paiements-en-ligne/portail` (SEO title *"Portail de paiement en ligne — Frais scolaires | Lakoli"*, description *"Payez les frais scolaires de votre enfant en ligne en toute sécurité. Entrez le matricule de votre enfant pour consulter et régler les frais en attente."*):
1. `GET /paystack/portail/{matricule}` (input `Ex: EPA-2024-001`, uppercased on type; error *"Élève introuvable. Vérifiez le matricule."*)
2. all returned `creances` are pre-checked; parent unchecks what they don't want to pay
3. `POST /paystack/portail/init {matricule, guardianEmail, guardianPhone, creanceIds, totalAmount}` → redirect to `authorizationUrl`

A separate `/payer` route renders a Wave-branded flow with a not-yet-live fallback:
> **Paiement manuel requis** — Le paiement en ligne Wave sera bientôt disponible. En attendant, veuillez vous rendre à l'école ou contacter le service de scolarité.
> Référence à communiquer : `{matricule}`
> Vous serez redirigé vers l'application Wave CI pour finaliser le paiement.

---

## 11. Things a shallow UI pass would MISS (summary of surprises)

1. **Four payment aggregators, not one.** Paystack / CinetPay / PayDunya / Hub2, with a dynamic path prefix (`POST /{provider}/init`, `GET /{provider}/verify/{ref}`, `POST /{provider}/sync-pending`). The "paystack" namespace is a legacy name, not the actual capability boundary.
2. **A daily-closing PV generator with a full printed legal document** (`/cloture-caisse`), including theoretical-vs-real reconciliation, écart classification (`AUCUN ÉCART / EXCÉDENT / MANQUANT`), signature + stamp blocks, and PV cancellation. There is no sidebar link to it.
3. **Cash-drawer double-entry semantics distinguishing "hors caisse"** — cheque/virement/bank-deposit expenses count in reports but do not reduce the physical drawer; canteen/transport expenses are auto-imported without double-posting.
4. **A brouillon → validée/rejetée approval workflow for expenses**, with role restriction and a `noteValidation`.
5. **A guarded mass-cancellation of receivables** with server-side count arbitration (`expectedCount` + `confirmationCount`), a typed confirmation token `ANNULER {n}`, a 10-character mandatory motive, an audit-trail promise, and cycle isolation (`Périmètre isolé`).
6. **A refund engine with overpayment (`tropPercu`) detection** and a one-click "refund only the overpayment" path.
7. **An anti-fraud module with 9 typed anomaly detectors** (`cash_excessif`, `annulation_suspecte`, `montant_modifie`, `double_paiement`, `paiement_hors_horaire`, `accumulation_annulations`, `ecart_montant`, `acces_non_autorise`, `autre`), 3 severities, 4 workflow states, 15 s/30 s polling, dashboard banner and bulk "faux positif" classification.
8. **A generic subscription engine** (`/subscriptions`) that powers Cantine, Transport **and** any fee category flagged `estService` — with month-level suspension (`suspend-mois`), resume, cancellation-cascades-to-unpaid-créances, and **canteen access blocking** (`accessStatus: allowed|blocked`) as a debt-collection lever.
9. **Instalment scheduling per fee category**: monthly / quarterly / half-yearly with an explicit Sept→June month picker and a sum-must-equal-total validator surfacing `(écart +N FCFA vs montant total)`.
10. **A pre-seeded 8-item discount criteria catalogue** (orphan, teacher's child, sibling, scholarship, merit, social hardship, staff child, institutional partnership) with percentage or fixed-amount types, applying to scolarité only.
11. **A budget module that can bootstrap itself from enrolments** (`POST /budget-previsionnel/generer-depuis-inscriptions` → `{created, skipped}`) and then chart prévisionnel vs réel.
12. **A reconciliation queue** (`/api/reconciliation/file-attente` + `/{id}/reconcilier`) that is a *different* mechanism from the Paystack request validation queue — two distinct rapprochement paths coexist.
13. **A public, unauthenticated parent payment portal keyed on matricule**, with multi-créance selection and its own `paystack/portail/init` endpoint.
14. **Official Ivorian document chrome baked into receipts** (Ministère de l'Éducation Nationale, DRENA, IEPP, *Union - Discipline - Travail*, Armoiries) — a compliance feature, not decoration.
15. **`niveauInterface` (primaire | secondaire) is a first-class financial partition** threaded through nearly every finance query and explicitly surfaced during destructive operations.
16. **A prepaid SMS wallet with real money mechanics** (packages, Mobile Money recharge, `recharge/verify` idempotency, segment counting at 160/70 chars, hard block at zero balance) — communication is metered and monetised.
17. **Lakoli's own SaaS billing is per-student-tiered with a 60-day statutory withdrawal right**, a CGU/CGV acceptance gate, no auto-debit, and hard access suspension on expiry.
18. **Deep-linkable data-quality filters** on finance pages driven by the server-side "Contrôle IA" audit: `/paiements?filtre=remises_elevees` ("Paiements avec remise supérieure à 50%"), `/creances?filtre=sans_echeance`, `/creances?filtre=negatives` ("Créances à solde anormal (trop-perçu)").
19. **An in-app help corpus that encodes the accounting SOP** (daily/weekly accountant checklist, anomaly playbook, créance status glossary) — effectively written business rules shipped inside the bundle.
20. **`GET /api/payment-providers/recu/{paiementId}` returns server-rendered HTML**, not JSON — a server-side receipt renderer distinct from the client-side `print-utils` one.
21. Two enrolment-side money endpoints that gate mutability: `PATCH /preinscriptions/{id}/avant-encaissement` (edit only while no cash has been taken) and `POST /inscriptions/regenerer-creances` (destructive rebuild of unpaid scolarité créances).
22. **Contradiction worth flagging to product**: the help article says *"La clôture est irréversible"*, while the UI ships a direction-only `DELETE /cloture-caisse/{id}` ("Annuler ce PV", *"Cette action est irréversible. Le PV sera marqué 'Annulé'"*). Documentation and implementation disagree.

---

## 12. Caveats / limits of this extraction

- The regex sweep captures only call sites whose first argument literal begins with `/`. Calls built through a helper variable (e.g. Orval-generated hooks in `lakoli-main.js`) were recovered manually — `/api/reconciliation/*` was found that way, so **a small number of generated-hook endpoints may still be unlisted**.
- Query parameters are enumerated as they appear at the call site; the server may accept more.
- Request/response *schemas* are inferred from client destructuring, not from an OpenAPI document (`scratchpad/openapi.json` exists in the working set but was not cross-checked here).
- Nothing about server-side validation, DB constraints, or webhook handling is observable from the client bundle. Statements about server behaviour above are marked INFERRED where relevant.
