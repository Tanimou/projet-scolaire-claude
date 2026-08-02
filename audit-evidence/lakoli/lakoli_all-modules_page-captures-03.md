# Evidence — Lakoli page-by-page capture log

**Method:** each page was opened in an authenticated browser session (role **Super Admin**, establishment « Mafara Ecole » inside space « EPV »), allowed to finish loading, then its rendered `<main>` text, tab list, table headers and form fields were extracted from the live DOM. Text below is quoted from the running application.

**Tenant state caveat (important for reading every capture):** this account is a **free-trial tenant, 10 % configured, 26 days remaining, 0 students, 0 payments, academic year 2026-2027**. Therefore **structure, labels, filters, statuses, KPIs and business rules are directly observed**, while **populated-state behaviour (pagination, sorting at volume, real report output, real notification delivery) could not be observed** and is marked as such in the audit report.

---

## A. Dashboard — `/app/`

Kicker « PILOTAGE QUOTIDIEN » · H1 « Tableau de bord Direction » · greeting « Bon après-midi, Salifou » · date line · active cycle « Primaire ».

- **Quick actions:** Élèves · Encaisser
- **View tabs:** Vue générale · Activité · Absences
- **Onboarding checklist « Configuration de l'école — 10 % · 1 étape complétée sur 10 »**, ordered steps: Créer les classes (done) → 1 Informations générales de l'école → 2 Définir les montants des frais scolaires → 3 Inscrivez vos élèves → 4 Configurer les périodes d'évaluation → 5 Effectuer le premier encaissement; plus non-numbered *suggestions*: Inviter un collaborateur, Envoyer le premier SMS, Découvrir les paramètres, Configurer le paiement en ligne, Découvrir le Portail Parent. Helper text: « Cliquez sur Démarrer pour être guidé directement sur la page concernée. »
- **Trial banner:** « ESSAI GRATUIT — Il vous reste 26 jours · École configurée à 10 % » + « Découvrir les tarifs »
- **Today block:** « AUJOURD'HUI — Chargement des priorités… / Les données du jour sont en cours de préparation. » then « Aucun dossier prioritaire aujourd'hui. »
- **KPI tiles:** ÉLÈVES — · ENCAISSÉ 0 F (0 % recouvré) · À PERCEVOIR 0 F
- **Chart:** « Recettes mensuelles — Année scolaire 2026-2027 » (Sep→Aoû) with « Analyser » link
- **Cards:** « AUJOURD'HUI Encaissements / Journal — 0 F — Aucun encaissement enregistré pour le moment. » + « Enregistrer un paiement »; « Suivi pédagogique — Appels, saisies de notes et conflits d'emploi du temps. » + « Ouvrir le suivi »; « Analyses complémentaires — Effectifs par cycle, frais, modes de paiement, cumul et vue groupe. » + « Afficher le détail »

**Defect observed (confirmed):** on first load the dashboard rendered an error boundary — « Quelque chose s'est mal passé / Une erreur inattendue s'est produite. Rechargez la page pour continuer. » with technical detail `Failed to fetch dynamically imported module: https://lakoli.com/app/assets/dashboard-<hash>.js`. Recovery required a manual full reload; no automatic chunk-retry. This is the classic Vite stale-chunk failure after a redeploy.

---

## B. Admissions

### `/app/inscriptions` — Inscriptions
- Tabs: **En attente · 0 | Actifs · 0 | Tous · 0**
- KPI: « En cours / Dossiers à traiter », « Inscrits validés / Inscription confirmée »
- Actions: **Importer Excel**, **Inscrire un élève**, **Actualiser les inscriptions**; filter select + « Rechercher… »
- **Business rule (quoted):** « Tant que les frais d'inscription ne sont pas encaissés et l'inscription validée, l'élève reste ici dans *En cours* et n'apparaît pas encore dans la liste Élèves. C'est ici que vous pouvez relancer les parents et faire avancer les dossiers. »

### `/app/inscriptions/nouvelle` — Enrolment wizard
Mode switch: **Nouvel élève** | **Élève existant (réinscription)**. Steps: **Informations (1) → Finance (2) → Documents (3)**.

Built-in guide text (quoted): step 1 « Renseignez le nom, prénom et sexe de l'élève. Ajoutez au moins un parent (père ou mère) avec son numéro de téléphone — ce numéro recevra les SMS et liens de paiement. Le tuteur est facultatif. Puis cliquez "Définir contact principal" pour choisir qui reçoit les notifications. Enfin, sélectionnez la classe. » · step 2 « Les frais obligatoires s'affichent automatiquement selon la classe. Ajoutez des services optionnels (cantine, transport…) si l'élève les souscrit. Appliquez une remise si nécessaire, puis enregistrez. » · step 3 « Collectez les pièces demandées (extrait de naissance, carnet de vaccination…). Uploadez-les directement ou cochez celles remises en mains propres. Après validation, vous pourrez imprimer l'attestation d'inscription. »

Fields — **IDENTITÉ DE L'ÉLÈVE**: Nom\*, Sexe\* (M/F), Prénoms\*, Date de naissance (JJ + mois + année 1994→2023), Lieu de naissance, Nationalité (default « Ivoirienne »), Matricule (« laissez vide pour génération automatique », placeholder `Ex : MENET-26-00123`, hint « Si l'État a déjà attribué un matricule à cet élève, saisissez-le ici. »), **Redoublant(e)** checkbox, **Affecté(e) État** checkbox.
**CONTACTS PARENTS\*** — PÈRE / MÈRE / TUTEUR-AUTRE (facultatif), each: Nom, Prénoms, Téléphone, Profession; « Désignez un contact principal — ce numéro recevra les SMS et liens de paiement après l'inscription. »
**CLASSE** — « Choisir la classe pour cette année… » PS·maternelle, MS, GS, CP1·primaire, CP2, CE1, CE2, CM1, CM2.
Inline validation shown while incomplete: « Renseignez le nom et prénom de l'élève. Sélectionnez une classe. » with the « Étape Finance » button disabled.

### `/app/preinscriptions` — Pré-inscriptions
Funnel tiles: 🟡 Dossiers à traiter (« Lien non encore envoyé ») · 🟠 Paiements à relancer (« Lien envoyé — en attente ») · 🔵 Dossiers à compléter (« Payé — documents à vérifier ») · 🟢 En attente validation (« Prêt pour le secrétariat »).
Status filters: Tous · Pré-inscription créée · Paiement demandé · Paiement reçu · Dossier complet.
**Business rule (quoted, emphasised in UI):** « **RÈGLE ABSOLUE** — Une inscription ne peut jamais être validée sans paiement confirmé dans Lakoli, sauf autorisation expresse de la Direction. »

### `/app/reinscriptions/suivi` — Réinscriptions (re-enrolment campaign)
Explicit 6-step guided pipeline: **1 Résultats fin d'année → 2 Initialiser → 3 Contacter (Appeler / WhatsApp) → 4 Réponses (Marquer confirmés) → 5 Encaisser (Envoyer lien de paiement) → 6 Réinscrire (Valider les réinscriptions)**.
KPIs: Total · Non contactés · Rappels prévus · Intéressés · Indécis · Confirmés · Réinscrits · Montant encaissé (FCFA).
Actions: Initialiser depuis inscrits · Importer Excel · Envoyer campagne · Exporter Excel · Actualiser · Créer la prochaine année scolaire.
Filters: Tous contacts · Toutes réponses · Tous statuts · Tout paiement · Tri par défaut · « +7 jours sans contact ».
Guard state observed: « ⚠️ Aucune année scolaire suivante n'a été créée — Les compteurs ci-dessous concernent l'année en cours utilisée en substitution. Pour utiliser le module Réinscriptions normalement, créez d'abord la prochaine année scolaire dans Paramètres → Années scolaires. »

### `/app/inscriptions/masse` — Réinscription en masse
Class-to-class bulk promotion: Classe source → Classe destination → Année scolaire destination.

### `/app/eleves/import` — Excel/CSV student import
« Télécharger le modèle CSV » · upload `.xlsx` or CSV (separators `;` `,` `|` or tab).
**Expected columns:** Nom\*, Prénoms\*, Sexe (M/F)\*, Date naissance (JJ/MM/AAAA), Lieu naissance, Classe (nom exact)\*, Nom parent, Prénoms parent, Téléphone parent, 2ᵉ téléphone parent, Lien (père/mère/tuteur), Montant déjà encaissé (optionnel, 0 par défaut).
Rules quoted: « Le nom de la classe doit correspondre exactement à une classe existante. » · « **Les créances seront générées automatiquement** — Chaque élève importé aura une créance associée (même à zéro si déjà réglé). C'est le comportement normal et recommandé. » · escape hatch « Cas rare : importer sans générer de créances (déconseillé) ».

### `/app/inscriptions/fin-annee` — Résultats de Fin d'Année
« Enregistrez ici les résultats et décisions de passage (admis, redouble) par classe. Cette étape doit être complétée avant de lancer les réinscriptions. »
Compliance notice quoted: « Aucun profil DFA officiel qualifié pour 2026-2027 — Les suggestions affichées restent une aide locale et consultative. La décision du conseil demeure obligatoire ; aucun fichier ActuMoyenne/DFA n'est annoncé compatible tant qu'un export actuel anonymisé n'a pas été validé. »

### `/app/affectations-etat` — Élèves affectés de l'État
« Registre annuel rattaché aux inscriptions validées » · « Référentiel interne déclaratif · non officiel ».
Status values: Non renseignée · Déclarée · À vérifier · Confirmée en interne · Retirée. Counters: Inscriptions / Non renseignées / À vérifier / Confirmées en interne.
Disclaimer quoted: « L'absence de déclaration signifie « non renseigné », jamais « non affecté ». Aucune donnée n'est transmise automatiquement à une administration. »

### `/app/examens-nationaux` — Résultats nationaux BEPC/BAC
Toggles **BEPC | BAC**, **Session normale | Remplacement**. Grid rows: Ivoiriens F / Ivoiriens G / Étrangers F / Étrangers G × columns Inscrits / Présents / Admis. Fields: « Référence de la source \* », date. Actions: Nouveau, Enregistrer le brouillon.
Disclaimer quoted: « Lakoli n'est pas connecté à AGCE-DECO et ne vérifie pas automatiquement la source saisie. »

---

## C. Students & families

### `/app/eleves` — Élèves
Subtitle « Primaire · Maternelle à CM2 », counter « 0 élève inscrit ». Actions: **Inscrire un élève**, **Exporter CSV**.
Note quoted: « Effectif affiché : élèves inscrits. Les préinscriptions restent consultables dans la liste sans gonfler cet effectif. »
Search « Rechercher par matricule ou nom… » · class filter (Toutes / PS…CM2).
Table columns: **Matricule | Nom & Prénoms | Sexe | Classe | Statut | Actions**. Empty state « Aucun élève trouvé » + CTA.
Related routes (bundle-confirmed, not exercised on empty data): `/eleves/:id`, `/eleves/:id/cursus` (multi-year school career), `/eleves/nouveau`.

### `/app/parents` — Parents & Tuteurs
« 0 contact(s) enregistré(s) » · **Exporter CSV** · empty state « Aucun parent trouvé ». Routes `/parents/:id`, `/parents/nouveau` exist.

### `/app/trombinoscope` — Photo directory
Class picker → photo grid. « Photos des élèves par classe ».

---

## D. Pedagogy

| Route | Capture |
|---|---|
| `/app/classes` | « Interface Primaire — 9 classe(s) » · Classes standards · **Nouvelle classe** · cards `PS MATERNELLE 0/30 élèves`, `CP1 PRIMAIRE 0/40 élèves`… → **per-class capacity** is modelled |
| `/app/matieres` | « Gérez les matières et leurs coefficients par classe » · **Nouvelle matière** · filter by class · empty « Aucune matière configurée » |
| `/app/periodes` | « Trimestres, semestres ou mois — selon le rythme de votre école » · **Créer rapidement: Trimestre 1 / 2 / 3** · Nouvelle période |
| `/app/annees-scolaires` | « 2026-2027 **Active** · 01 septembre 2026 → 30 juin 2027 » · Nouvelle année |
| `/app/affectations-enseignants` | « **Source des droits** sur les classes, matières, notes et appels par année scolaire. » Filters: Cycle / Classe / Enseignant / Statut. KPIs: Enseignants concernés, Matières affectées, Volume actif cumulé (h) |
| `/app/emploi-du-temps` | « Planification hebdomadaire **manuelle** par affectation, classe, professeur et salle. » Actions: Imprimer A4, Gérer les salles, Ajouter un créneau. Views: **Classe / Professeur**. Note: « Le calendrier scolaire reste séparé de cet emploi du temps hebdomadaire. » |
| `/app/cahier-textes` | « Séances réalisées, contenus, devoirs, observations, avancement et **visa**. » KPIs: Heures réalisées, À viser |
| `/app/notes` | « Créez une évaluation, saisissez les résultats, puis **choisissez quand les rendre visibles aux familles**. » Context selector Classe → Période → Matière, applied once for creation and entry |
| `/app/planification-evaluations` | « Compositions et examens — Calendrier officiel, salles, surveillants, convocations et **contrôle des chevauchements**. » Gate: « Ajoutez au moins une salle active et un surveillant actif pour publier les convocations » |
| `/app/bulletins` | « Consultez et imprimez les bulletins par classe et période » |
| `/app/presences` | Tabs **Saisie du jour / Registre mensuel / Statistiques / Rapport retards / Alertes absences**; **Matin / Après-midi** half-day sessions; class picker |
| `/app/suivi-enseignants` | « Émargement des enseignants — Cours prévus, présence, retard et heures réalisées, avec **validation de la Direction**. » Exports: Excel, **Procès-verbal PDF**, Imprimer. KPIs: Cours prévus, Émargés, À valider, Retards, Heures prévues, Heures validées. Note: « Le retard et les heures réalisées sont **calculés par le serveur**… Seuls les émargements validés alimentent le total officiel. » |
| `/app/exports-cio` | « Exports CIO & StatCIO » 3 steps: Choisir (classe+période) → Contrôler (résultats publiés) → Exporter (Collecte ou statistiques). « Modèle versionné · compatibilité à vérifier » |
| `/app/calendrier` | Month grid; event types **Vacances, Examen, Évaluation, Réunion, Sortie scolaire, Jour férié, Rentrée, Conseil de classe, Sport/Tournoi, Autre** |
| `/app/programmes` | **Rendered blank** (0 chars of main content) — see defects |
| `/app/orientation` | **Rendered blank** (header chrome only) — see defects |

---

## E. School life (« Vie scolaire »)

### `/app/vie-scolaire/discipline`
« Signalement factuel, instruction, décision humaine et convocation contrôlée. »
Form: Classe\*, Élève\*, Date\*, Heure, **Type\*** (indiscipline · violence · harcelement · fraude · degradation · autre), **Gravité observée\*** (mineur · important · critique), Lieu, **Faits observés\*** (10 characters minimum).
**Governance rule quoted:** « Aucun retard ou signalement ne produit automatiquement une sanction. Toute mesure reste proposée puis validée par la Direction. »

### `/app/vie-scolaire/activites`
« Registre para-scolaire conforme aux canevas primaire et secondaire. »
Club types: Cooperative, Association parents, Ase, Messagers paix, Sante hygiene environnement, Vih ist, Genre equite, Meres eleves filles, Protection enfant, Citoyennete, Sport, Photo, Theatre, Danse, Cinema, Cuisine, Chorale, Autre.
Activity domains: Socioculturelle, Sportive, Environnementale, Cooperative, Conference, Formation, Sensibilisation, Journee…
Actions: Créer un club ou une association · Enregistrer une activité · Imprimer le récapitulatif.

### `/app/vie-scolaire/suivi-sensible` — **access denied even to Super Admin**
Quoted: « **Accès sensible non habilité** — Ce registre contient des données de santé et de protection de l'enfant. Votre rôle dans Lakoli ne suffit pas : une **habilitation nominative, limitée dans le temps et par domaine** est obligatoire. Les comptes de démonstration et le portail parent n'y ont jamais accès. »
→ Confirms a **second authorisation tier above RBAC** for sensitive-category data.

---

## F. Finance

| Route | Capture |
|---|---|
| `/app/paiement-parent` | « ENCAISSEMENT MANUEL — Espèces · Chèque · Virement ». 4-step wizard **1 CHERCHER → 2 DÉTAILS → 3 PAIEMENT → 4 REÇU**. Note: « Les paiements Mobile Money et Carte sont enregistrés automatiquement par Lakoli. Utilisez cette page uniquement pour les règlements reçus physiquement au guichet. » |
| `/app/paiements` | « Journal des Paiements ». Columns **Référence / Date · Élève · Mode · Montant · Statut · Actions**. Exporter CSV |
| `/app/paiements-en-ligne` | « Réceptions Mobile Money » · status **Non configuré** · « Quand un parent paie via le lien SMS, le paiement s'enregistre automatiquement. » KPIs: À confirmer manuellement / Enregistrés automatiquement / **Paiement sans élève identifié** / Parent n'a pas encore payé. Tabs: À confirmer · Validés ✓ · En attente de paiement · Paiement sans élève · Rejetés · Tous. Actions: Actualiser, **Envoyer un lien** |
| `/app/caisse` | Cash register. Tabs **Aperçu / Entrées / Sorties / Clôture**. « Solde en caisse (espèces) … depuis le début de l'année scolaire · espèces uniquement ». Explicit formula quoted: « Solde espèces = apports manuels en espèces + encaissements en espèces − dépenses validées en espèces (depuis le début de l'année scolaire active). Les dépenses saisies dans **Cantine et Transport sont incluses automatiquement** comme sorties espèces, sans créer une seconde écriture. Les dépôts à la banque et dépenses par chèque / virement sont comptabilisés comme sorties mais ne réduisent pas le solde physique de la caisse. » Daily rollup: ENCAISSEMENTS / APPORTS MANUELS / DÉPENSES (VALIDÉES) / TRANSACTIONS |
| `/app/cloture-caisse` | « **Procès Verbal officiel de clôture journalière** » · Nouvelle clôture · list of PV |
| `/app/creances` | Receivables. KPIs **TOTAL DÛ / ENCAISSÉ / RESTE À RECOUVRER / EN RETARD** + « Taux de recouvrement global ». Filters **Toutes · En attente · Part. payé · Soldé · En retard**; « Vue élèves »; « Actions avancées » |
| `/app/categories-frais` | 4 seeded categories; catalogue offered: Inscription, Scolarité, Cantine, Transport, Activités, Manuels scolaires, Fournitures scolaires, Uniformes, Examens, Sorties scolaires, Autres. **Rule quoted:** « Lorsqu'un frais est appliqué à un élève, Lakoli crée automatiquement une **créance à recevoir** ». Per-category: montant + périodicité, Actif flag, « Service avec abonnement » switch |
| `/app/remises` | « Critères de Remise ». **Rule quoted:** « Les remises s'appliquent uniquement sur la scolarité (pas sur l'inscription). Elles sont appliquées lors de la création d'une créance pour un élève bénéficiaire. » Predefined criteria: Orphelin(e), Enfant d'enseignant, Fratrie (2ᵉ enfant+), Boursier(e), Élève méritant, Difficulté sociale, Enfant du personnel, Partenariat institutionnel |
| `/app/budget` | « Budget Prévisionnel — Suivi prévisionnel vs réel par année scolaire ». KPIs: Recettes prévisionnelles/réelles, Dépenses prévisionnelles/réelles, Solde réel, Solde prévisionnel. Actions: **Générer**, Ajouter ligne |
| `/app/reconciliation` | « Réconciliation des paiements — 0 paiement(s) en attente de réconciliation » |
| `/app/anti-fraude` | « Détection **après coup** et alertes de sécurité financière — signalement a posteriori pour vérification. » KPIs: TOTAL ALERTES / OUVERTES / CRITIQUES / TYPES DÉTECTÉS. Status filter: Ouvertes · En cours · Résolues · **Faux positifs**; Severity: Critique · Avertissement · Info |
| `/app/rapports` | Cycle toggle **🏫 Primaire / 🎓 Secondaire**. Date range + class filter + quick ranges (Aujourd'hui / Ce mois / Cette année). Tabs **Versements reçus · Impayés · Bilan financier**. Export CSV, Imprimer |
| `/app/analytics` | KPIs **CHIFFRE D'AFFAIRES (sur X attendus) · TAUX DE RECOUVREMENT · RESTE À PERCEVOIR (n élèves en retard) · RÉSULTAT NET (Recettes − Dépenses)**. Charts: évolution CA mensuel (mensuel/cumulé), Recettes vs Dépenses (par mois / cumulé), Répartition par mode de paiement, Progression du taux de recouvrement (objectif 100 %), Encaissements par catégorie de frais |
| `/app/cantine` | « Abonnements repas et dépenses ». KPIs Abonnés actifs / Facturé / Encaissé / Impayé. Tabs Abonnés · Dépenses · Résumé · **Liste accès**. Actions: **Relancer les impayés**, Abonner un élève |
| `/app/transport` | « Abonnements CAR et dépenses ». Same KPI/tab shape minus « Liste accès » |
| `/app/autres-services` | « Internat, activités parascolaires, assurance… » Empty: « Créez des catégories de frais avec le switch "Service avec abonnement" activé dans Paramètres → Frais scolaires. » |

---

## G. Communication

### `/app/messagerie` — SMS
« Communiquez avec les parents par SMS — **ID expéditeur LAKOLI** » · « Lakoli SMS · Actif · 100 SMS ».
Tabs: **Campagnes · Message individuel · Email aux parents · Historique · Listes · Modèles · Automatisations**.
Presets: « Relancer les impayés — SMS de relance à tous les parents avec solde dû », « Envoyer à une classe ».
Campaign builder: Nom de la campagne\*; **Type de message**: Relance impayé, Reçu de paiement, Absence, Convocation, Bulletin disponible, Information générale, Événement, Rentrée scolaire, Réunion parents, Message personnalisé; **Destinataires**: Créances impayées uniquement / Tous les parents…; message body with merge variables.

### `/app/whatsapp` — WhatsApp Parents
« Contactez les parents directement via WhatsApp — **aucune configuration requise** ».
**Mechanism quoted:** « Chaque bouton "WhatsApp" ouvre l'application WhatsApp (ou WhatsApp Web sur ordinateur) avec le message pré-rempli. Vous envoyez en un clic — depuis le compte WhatsApp de votre téléphone ou ordinateur. **Aucune API, aucune clé, aucun abonnement requis.** »
Modes: Message individuel · Envoi groupé · Relances impayés · Modèles réinscription. Templates: Relance impayé, Confirmation paiement, Signalement absence, Convocation, Bulletin disponible, Annonce rentrée, Message libre. Supports WhatsApp `*bold*` markup.

### `/app/credit-communication` — SMS wallet
Balance « 100 SMS restants »; counters Ce mois / Total utilisé / Offerts.
**Packs:** Pack 100 (100 SMS — 2 500 FCFA ≈ 25 F/SMS) · Starter (200 — 5 000) · Essentiel (500 — 10 000 ≈ 20 F) · **Pro (1 500 — 25 000 ≈ 17 F, RECOMMANDÉ)** · Premium (3 500 — 50 000 ≈ 14 F).
« Paiement Mobile Money sécurisé — votre solde est crédité immédiatement après confirmation. »
Ledger table: TYPE · QUANTITÉ · SOLDE APRÈS · DESCRIPTION · DATE (seeded row « Bonus bienvenue +100 SMS »).

### `/app/sms-logs` — Journal SMS
« Historique des messages transactionnels ». KPIs **TOTAL SMS · ENVOYÉS / LIVRÉS · SIMULÉS (DEV) · ÉCHECS**. Columns: DESTINATAIRE · TYPE · STATUT · MESSAGE · DATE.
→ A « **SIMULÉS (DEV)** » counter is exposed in the production UI.

---

## H. Parent portal (admin side)

### `/app/portail-parent`
Tabs **Préinscriptions | Espace Parent**; status « Portail parent activé ».
Pitch: « Offrez aux familles un espace en ligne pour soumettre les dossiers de préinscription de leurs enfants — sans avoir à se déplacer. » Value props: Formulaire en ligne (« Les parents remplissent le dossier depuis leur téléphone »), Suivi en temps réel, Conversion facile (« Un clic pour transformer un candidat en élève inscrit »). CTA **Activer le Portail de préinscription**.

### `/app/portail-parent/preinscriptions`
« Dossiers de préinscription — 0 dossiers reçus via le portail ». Filters: statut, classe, « Depuis » date.

### `/app/portail-parent/parametres` — exists (super_admin/direction only), not opened.

---

## I. HR

### `/app/rh` — Ressources Humaines
« Gestion du personnel et des paies ». KPIs **EFFECTIF ACTIF · MASSE SALARIALE BRUTE (F/mois) · DÉPARTEMENTS · CONTRATS EXPIRANTS**.
Departments: Direction, Enseignement, Administration, Comptabilité, Surveillance, Entretien, Cantine, Sécurité, Autre.
Actions: **Fiches de paie du mois**, Nouveau personnel.

### `/app/rh/pointages` — Pointage du personnel
« Enregistrez simplement les arrivées, départs, absences et missions. Les présences des élèves restent dans leur propre module. »
Tabs: **Aujourd'hui · Saisie manuelle · Anomalies et corrections · Terminaux · Rapport mensuel · Journal**. KPIs: Personnel actif, Pointés, Absence / mission, Anomalies.
Note: « Aucun terminal n'est nécessaire pour commencer… Une pointeuse pourra être ajoutée plus tard sans perdre cet historique. »

### `/app/parametres/rh` — « Barèmes CNPS/CMU/IRPP, rubriques » (Ivorian payroll contributions) — tile confirmed, page not opened.

---

## J. Administration & platform

### `/app/documents` — Documents & PDF
« Générez les documents officiels aux formats ivoiriens ». Tabs **Génération | Registre bulletins**.
**PAR ÉLÈVE:** Attestation de scolarité · Carte d'identité scolaire (« à découper et plastifier ») · **Situation financière (PDF) « officiel avec QR code »** · Fiche d'inscription · Fiche individuelle (« multi-années avec historique scolaire ») · Fiche scolaire rapide.
**PAR CLASSE:** Fiche de notation · Liste nominative de classe (« Matricules, identité, naissance et effectifs G/F/Total ») · Feuille d'appel (paysage).
**GLOBAL:** Effectifs par genre.

### `/app/utilisateurs`
« 1 compte(s) » · Actions **Affectations**, **Nouvel utilisateur**. Row shows avatar, name, email, « Dernière connexion », role badge **Super Admin**, status **Actif**. API `/api/utilisateurs/{id}/toggle-actif` confirms enable/disable.

### `/app/audit` — Journal d'audit
« Traçabilité complète — 1 action enregistrée ». Entry format: action (« Connexion »), actor, module (« Utilisateurs »), record id (« #508 »), **IP address**, timestamp.
Observation: the logged IP was a loopback-mapped address, i.e. the reverse proxy in front of the app is **not forwarding the real client IP** to the audit log.

### `/app/audit-ia` — Contrôle IA
« Contrôle qualité de l'établissement — Vérifications automatiques, expliquées règle par règle » · « finances, élèves, communication et sécurité analysés en quelques secondes » · CTA **Lancer les contrôles**. (Not executed — heavyweight tenant-wide job.)

### `/app/admin/suppressions`
« Demandes de suppression d'élève — Seule la direction peut approuver ou rejeter ces demandes. » Section « EN ATTENTE D'APPROBATION (0) ». → **deletion is a two-person approval workflow**, not a direct action.

### `/app/conformite`
« **Module bientôt disponible** — Le module Conformité est en cours de finalisation. Il sera accessible dès son ouverture officielle. » → placeholder shipped in production.

### `/app/abonnement` — Subscription
« Période d'essai — 26 jours restants ». Mandatory CGU/CGV checkbox gate (« droit de rétractation de 60 jours à compter du premier paiement »); until ticked, plan selection is blocked (« ⚠️ Cochez cette case pour pouvoir choisir une formule. »).
**Plans (per month, FCFA):** Essentiel 0–300 élèves — 29 000 · Croissance 301–500 — 47 500 · Avancé 501–750 — 69 000 · Premium 751–1 000 — 79 000. Per-student unit economics are shown for each tier.

### `/app/parametres` — Settings hub
« Ces modules ne sont pas dans le menu principal. Accédez-y ici quand nécessaire. » 18 tiles: Informations générales de l'école · Paiement en ligne (**Paystack / CinetPay**) · RH & Paie (**CNPS/CMU/IRPP**) · Abonnement Lakoli · Classes · Catégories de frais · Remises & Bourses · Périodes d'évaluation · Années scolaires · Parents · Budget prévisionnel · Paiements (liste) · Matières · Alertes absences · Anti-Fraude · Réconciliation · Journal SMS · **Export de résiliation (« Archive portable et vérifiable »)**.

### `/app/parametres/infos-generales`
Labelled fields: Nom complet de l'établissement\*, Sigle / Acronyme, Ville, Adresse complète, Téléphone principal, Adresse e-mail, Site web, **Téléverser le logo** (+ « Ou URL externe du logo »), **Signature du Directeur**, **Cachet / Tampon de l'établissement**, **Image de l'en-tête du document**, **DRENA**, **IEPP**, Nom et prénom du Directeur, **Préfixe (2–6 caractères)**, **Format de l'année** (matricule generation).
Note quoted: « Ces informations apparaissent sur tous les documents officiels imprimés » and signature/stamp images « sont insérées automatiquement en bas des documents officiels signés ».

### `/app/aide` — Help centre
Full in-product documentation tree: Démarrage rapide (Présentation, Première connexion, Tour de l'interface, **Rôles et permissions**), Gestion des élèves, Gestion des parents, Inscriptions, **Réinscriptions** (9 sub-articles), Gestion financière, Paiements et reçus, Communication, WhatsApp, Portail Parent, Administration scolaire, Rapports et exports, Procédures officielles, FAQ, Résolution des problèmes, Glossaire, **Guides par métier**, Checklists, Fonctionnalités clés.
Also « **GUIDES VISUELS — REVOIR UN TUTORIEL** » with ~20 replayable product tours (Tableau de bord, Gérer les inscriptions, Suivi des réinscriptions, Clôture de l'année scolaire, Suivre les créances, Encaisser un paiement, Paiements Mobile Money, Gérer la caisse, Rapports financiers, Analyse financière, Gérer les présences, Saisir les notes, Générer les bulletins, Calendrier scolaire, Envoyer des SMS, Envoyer via WhatsApp, Crédit SMS, Cantine, Transport, Autres services, Trombinoscope, Documents officiels…).
Footer note: « Mode d'emploi actualisé le 26 juillet 2026. Il correspond au menu en cinq espaces, aux parcours mobiles et aux libellés actuellement affichés dans Lakoli. »

### Teacher space — `/app/espace-enseignant/listes`
Opened as Super Admin → « **Accès non autorisé** — Vous n'avez pas les droits nécessaires pour accéder à cette page. Contactez votre administrateur. »
→ Confirms role guards are **exclusive, not hierarchical**: a Super Admin cannot enter the teacher workspace.

---

## K. Defects and anomalies observed on Lakoli (confirmed)

| # | Observation | Where |
|---|---|---|
| L-1 | Error boundary on first dashboard load: `Failed to fetch dynamically imported module: .../assets/dashboard-<hash>.js`; manual reload required, no auto-retry | `/app/` |
| L-2 | `/app/programmes` renders no page content at all | `/app/programmes` |
| L-3 | `/app/orientation` renders no page content at all | `/app/orientation` |
| L-4 | `/app/espaces` redirected to `/app/login` while the session remained valid (subsequent authenticated pages loaded normally) — behaviour unclear, **requires validation** | `/app/espaces` |
| L-5 | « SIMULÉS (DEV) » counter exposed in the production SMS journal | `/app/sms-logs` |
| L-6 | Audit log records a loopback-mapped IP instead of the real client IP → reverse-proxy `X-Forwarded-For` not honoured | `/app/audit` |
| L-7 | `Conformité` ships as a « Module bientôt disponible » placeholder in production | `/app/conformite` |
| L-8 | Perceived performance: pages routinely needed 8–18 s to render on a fast connection; `read_page`/accessibility snapshots repeatedly timed out waiting for document-idle, indicating sustained main-thread or network activity after paint | Whole app |

## L. Actions deliberately **not** executed (documented, not run)

Per the audit's safety constraints, the following available actions were identified but not triggered: « Lancer les contrôles » (tenant-wide AI audit), « Export de résiliation » (full tenant archive), « Envoyer campagne » / « Envoyer un lien » / any SMS or WhatsApp send, « Choisir cette formule » (subscription purchase), « Nouvelle clôture » (official cash-closing PV), student/parent/user creation, and every delete or approval control.
