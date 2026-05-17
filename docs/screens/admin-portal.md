# Wireframes — Portail Administrateur (`/admin`)

> Cible: gestionnaires d'établissement. Layout sidebar fixe + topbar (desktop prioritaire, responsive mobile).

## Layout général

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰ [Logo École]  Lycée Voltaire   🔍 Recherche...    🔔  ❓  👤 Admin ▼  │ ← Topbar
├──────────┬───────────────────────────────────────────────────────────────┤
│ 📊 Dash  │                                                                │
│          │                                                                │
│ ÉCOLE    │   Page content                                                 │
│ • Settings│                                                               │
│ • Brand  │                                                                │
│ • Grade S│                                                                │
│ • Calend │                                                                │
│          │                                                                │
│ HIERARCH │                                                                │
│ • Cycles │                                                                │
│ • Levels │                                                                │
│ • Classes│                                                                │
│ • Subject│                                                                │
│          │                                                                │
│ PEOPLE   │                                                                │
│ • Teach  │                                                                │
│ • Stud   │                                                                │
│ • Parent │                                                                │
│ • Users  │                                                                │
│          │                                                                │
│ ACADEMIC │                                                                │
│ • Enrol  │                                                                │
│ • Assign │                                                                │
│ • Schedule│                                                               │
│ • Assess │                                                                │
│ • Attend │                                                                │
│          │                                                                │
│ COMMUNIC │                                                                │
│ • Annonc │                                                                │
│ • Messag │                                                                │
│          │                                                                │
│ CUSTOM   │                                                                │
│ • Roles  │                                                                │
│ • Fields │                                                                │
│ • Forms  │                                                                │
│ • Rules  │                                                                │
│ • Templ. │                                                                │
│          │                                                                │
│ OPS      │                                                                │
│ • Audit  │                                                                │
│ • Import │                                                                │
│ • Export │                                                                │
│ • Integ. │                                                                │
│ • Setts  │                                                                │
└──────────┴───────────────────────────────────────────────────────────────┘
```

---

## 1. Dashboard `/admin/dashboard`

Widgets customisables (drag-drop layout via `react-grid-layout`). Catalogue de widgets:

| Widget | Description | Source |
|---|---|---|
| KPI cards | Nb élèves / profs / classes / alertes ouvertes / taux présence | `/admin/stats/overview` |
| Inscriptions à valider | Liste pending guardianship + enrollment | `/enrollment-requests?status=pending` |
| Élèves à risque | Top 10 élèves avec alertes ouvertes | `/students/at-risk` |
| Activité récente | Feed audit récent (publications, valida) | `/audit?limit=20` |
| Calendrier événements | Mini calendrier prochains events école | `/school-calendar/upcoming` |
| Tendance globale | Chart moyenne globale école par mois | `/analytics/school-trend` |
| Distribution classes | Bar chart moyenne par classe | `/analytics/class-distribution` |
| Annonces récentes | Top 5 annonces publiées | `/announcements?limit=5` |

```
┌────────────────────────────────────────────────────────────┐
│  Vue d'ensemble — Lycée Voltaire    [ + Ajouter widget ]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ 542     │ │ 28      │ │ 18      │ │ 12      │          │
│  │ Élèves  │ │ Profs   │ │ Classes │ │ Alertes │          │
│  │ +12 mo  │ │ +1 mo   │ │ stable  │ │ ouvertes│          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                            │
│  ┌────────────────────────┐ ┌─────────────────────────┐    │
│  │ Inscriptions à valider │ │ Élèves à risque         │    │
│  │ 7 demandes en attente  │ │ • Léa M. — Maths 6.5    │    │
│  │ [Voir tout]            │ │ • Tom B. — Anglais ↓    │    │
│  │                        │ │ [Voir tout]             │    │
│  └────────────────────────┘ └─────────────────────────┘    │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Activité récente                                    │   │
│  │ 10:32  Mme Dupont a publié 28 notes — Maths 2nde B  │   │
│  │ 10:18  M. Bernard a validé inscription Léa Martin   │   │
│  │ 09:55  Alerte LOW_SUBJECT_AVG sur Tom B (Anglais)   │   │
│  │ [...]                                                │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## 2. École / Settings — `/admin/school/settings`

Onglets: Général, Calendrier, Notation, Notifications, Politiques.

**Général:**
- Nom établissement
- Logo (upload + crop)
- Favicon
- Adresse, téléphone, email contact
- Pays, fuseau horaire, langue par défaut
- Site web officiel

**Calendrier (lien vers `/admin/school/calendar`):** voir §4.

**Notation:**
- Échelle par défaut: choix `/20`, `/100`, `/10`, `A-F`, ou custom
- Permet notes négatives ? Oui/Non
- Permet notes au-dessus du max ? Oui/Non
- Arrondi: aucun / 0.5 / 0.25
- Affichage parents: brut + moyenne pondérée

**Notifications:**
- Email "From" personnalisé (validation DKIM)
- Délai digest (instant / journalier / hebdo)
- Types notifs activables (publication note, alerte, annonce, inscription)

**Politiques:**
- Auto-approve guardianship (selon domaine email parent) ?
- Validation publication notes (admin doit valider ?)
- Délai max correction note publiée
- Politique de présences (types: présent/absent/retard/excusé/dispense)
- Rétention audit log (années)

---

## 3. École / Branding — `/admin/school/branding`

```
┌──────────────────────────────────────────────────────────┐
│  Branding & White-label                                   │
├──────────────────────────────────────────────────────────┤
│  Logo principal                                           │
│  [Drop zone ou click pour uploader]                       │
│  Format: SVG préférable, PNG max 1MB, ratio libre.        │
│  Aperçu: [Logo]                                           │
│                                                           │
│  Favicon                                                  │
│  [Upload — 32×32 ou SVG]                                  │
│                                                           │
│  Couleur primaire                                         │
│  [Color picker] OKLCH preview: brand-50..900 généré       │
│  ████ ████ ████ ████ ████ ████ ████                      │
│                                                           │
│  Couleur accent (optionnel)                               │
│  [Color picker]                                           │
│                                                           │
│  Police (Google Fonts)                                    │
│  [Combobox: Inter (défaut), Roboto, Lato, ...]            │
│                                                           │
│  ────────                                                  │
│  Aperçu en direct                                          │
│  [Mock dashboard avec branding appliqué]                  │
│                                                           │
│  [Annuler]   [Enregistrer & appliquer]                    │
└──────────────────────────────────────────────────────────┘
```

---

## 4. École / Calendrier — `/admin/school/calendar`

Vue calendrier annuel avec events configurables:
- Vacances (par académie ou custom)
- Jours fériés
- Réunions parents-profs
- Sorties scolaires
- Conseils de classe
- Events custom

Drag-drop pour créer un event; double-clic pour éditer. Couleurs configurables. Visibilité par audience (tout / classe / niveau).

---

## 5. École / Grading Scale — `/admin/school/grading-scale`

Liste des échelles + bouton "Créer une échelle":
```
┌─────────────────────────────────────────────────┐
│  Échelles de notation                             │
│  [+ Créer une échelle]                            │
├─────────────────────────────────────────────────┤
│  ✓ /20 (défaut)         5e à Terminale  [Éditer]│
│    /100                  Concours       [Éditer]│
│    A-F                   International  [Éditer]│
└─────────────────────────────────────────────────┘
```

Éditeur d'échelle:
- Nom, code
- Max score
- Mapping (ex. F=0-25, E=26-40, ..., A=85-100)
- Couleurs par tranche

---

## 6. Hiérarchie

### `/admin/cycles`
Liste cycles (Primaire, Collège, Lycée, etc.). CRUD simple.

### `/admin/grade-levels`
Liste niveaux (6ème, 5ème, ..., Terminale). Lien vers cycle.

### `/admin/classes`
Liste classes avec capacité, inscriptions actives, prof principal.
Filtres: année, niveau, statut. Actions: créer, dupliquer, archiver.

Détail classe:
- Élèves inscrits (liste + ajouter/retirer)
- Affectations profs-matières
- Emploi du temps
- Capacité + dérogations

### `/admin/subjects`
Liste matières + coefficients par niveau. CRUD.

---

## 7. People

### `/admin/teachers`
DataTable: photo, nom, email, matricule, spécialités, classes affectées, statut.
Actions: créer, inviter par email, importer CSV, désactiver, exporter.

Détail prof: profil + affectations + emploi du temps + custom fields.

### `/admin/students`
DataTable: photo, nom, classe actuelle, parents rattachés, statut.
Filtres: classe, niveau, présence d'alertes ouvertes.
Actions: créer manuellement, importer CSV, exporter, voir bulletin.

### `/admin/parents`
DataTable: nom, email, enfants rattachés, statut vérif email/téléphone.

### `/admin/users`
Tous les utilisateurs (admin + prof + parent + custom roles). Recherche, filtres.
Actions: assigner rôle, reset MFA, suspendre, voir sessions actives.

---

## 8. Inscriptions

### `/admin/enrollment-requests`
File d'attente des demandes (guardianship + enrollment).
```
┌─────────────────────────────────────────────────────────────┐
│  Demandes en attente — 7                                     │
├─────────────────────────────────────────────────────────────┤
│  Type  Demandeur          Concerne            Date    Action│
│  GUARD M. Martin (parent) Léa Martin (élève)  Auj.   [Voir]│
│  GUARD Mme Dupont         Tom Dupont          Auj.   [Voir]│
│  ENROL Mme Bernard        Marc → Class 2ndeB  Hier   [Voir]│
│  [...]                                                       │
└─────────────────────────────────────────────────────────────┘
```

Détail (Sheet à droite):
- Infos demandeur + concerné
- Documents joints
- Commentaire demandeur
- [Approuver] / [Rejeter avec commentaire] / [Demander info]
- Historique des décisions précédentes

### `/admin/enrollments`
Vue inscriptions actives + transferts + radiations. Filtres puissants.

---

## 9. Affectations & emploi du temps

### `/admin/teaching-assignments`
Liste affectations prof-classe-matière-période.
Vue alternative: matrice classes × matières avec profs assignés (lecture rapide).

### `/admin/schedule`
Emploi du temps drag-drop:
```
┌────────────────────────────────────────────────────────┐
│  Emploi du temps — 2ndeB                                │
│  [Semaine type] [Semaine 12] [Semaine 13]               │
├──────┬───────┬───────┬───────┬───────┬───────┬─────────┤
│      │ Lun   │ Mar   │ Mer   │ Jeu   │ Ven   │ Sam     │
├──────┼───────┼───────┼───────┼───────┼───────┼─────────┤
│ 8h   │Maths  │Anglais│       │Phys   │Maths  │         │
│      │Mme D. │M. B.  │       │M. C.  │Mme D. │         │
│      │Salle12│Salle03│       │Lab1   │Salle12│         │
├──────┼───────┼───────┼───────┼───────┼───────┼─────────┤
│ 9h   │Maths  │Hist   │       │Phys   │Anglais│         │
│      │Mme D. │M. E.  │       │M. C.  │M. B.  │         │
│      │       │Salle05│       │       │Salle03│         │
├──────┼───────┼───────┼───────┼───────┼───────┼─────────┤
│ 10h  │ ...   │ ...   │ ...   │ ...   │ ...   │ ...     │
└──────┴───────┴───────┴───────┴───────┴───────┴─────────┘
```

Conflict detection (prof double-affecté ou salle occupée): badge rouge sur la case.
Export PDF + .ics.

---

## 10. Évaluations admin — `/admin/assessments`

Vue globale: toutes les évaluations planifiées de toutes les classes.
Filtres puissants (classe, matière, prof, période, type, statut publication).
Actions admin: forcer publication, déléguer, supprimer si non-publiée.

---

## 11. Présences admin — `/admin/attendance`

Vue agrégée:
- Taux présence par classe / par élève / par mois
- Liste élèves avec absentéisme élevé
- Justification absences (workflow)
- Export Excel mensuel

---

## 12. Discipline — `/admin/disciplinary`

Liste des incidents disciplinaires. Workflows: ouvert → en cours → sanctionné → clos.
Statistiques par classe/élève/type.

---

## 13. Annonces — `/admin/announcements`

Liste annonces (brouillons, programmées, publiées, archivées).
Composer:
- Titre, contenu (markdown + WYSIWYG simple)
- Audience: tout / classe / niveau / utilisateurs / rôles
- Date de publication (immédiate ou programmée)
- Notification email + push + interne
- Pièces jointes

---

## 14. Customization

### `/admin/roles`
Liste des rôles (système + custom). Bouton "Créer un rôle".
Éditeur de rôle:
```
┌──────────────────────────────────────────────────────────┐
│  Rôle: Comptable                                          │
│  Description: Gestion des inscriptions et paiements       │
│                                                           │
│  Permissions                                              │
│  ▼ Élèves                                                 │
│    ☑ Lire    ☐ Créer    ☐ Modifier    ☐ Supprimer        │
│  ▼ Inscriptions                                           │
│    ☑ Lire    ☑ Créer    ☑ Modifier    ☐ Supprimer        │
│    ☑ Valider                                              │
│  ▼ Notes                                                  │
│    ☑ Lire    ☐ Créer    ☐ Modifier    ☐ Supprimer        │
│  ▼ Présences  ▼ Annonces  ▼ Audit  ▼ Paiements           │
│  [...]                                                    │
│                                                           │
│  [Annuler]  [Enregistrer]                                 │
└──────────────────────────────────────────────────────────┘
```

### `/admin/custom-fields`
Liste des custom fields par scope (Student, Teacher, Parent, Class, Assessment).
Éditeur:
- Clé technique (snake_case)
- Label affiché
- Type (text/number/date/select/multi/boolean/file)
- Required ?
- Options si select
- Validation (regex, min/max)
- Visibilité (admin / prof / parent / public)
- Ordre

Aperçu live du formulaire avec ce champ.

### `/admin/custom-forms`
Builder de formulaires custom (autorisation sortie, dossier santé, etc.).
Drag-drop fields. Soumissions listées.

### `/admin/alert-rules`
Liste règles (5 MVP + custom).
Rule builder:
```
QUAND
  [moyenne_matière] est [<] [10]
ET
  [tendance] est [↓ baisse]
ALORS
  Déclencher alerte [LOW_SUBJECT_AVG_CUSTOM]
  Sévérité [Moyenne]
  Message: "Votre enfant est sous le seuil..."
  Recommandation: "Planifier un rdv..."
```

### `/admin/notification-templates`
Liste templates (email, push) avec preview + variables.
Éditeur Markdown + variables `{{firstName}}`.

### `/admin/report-templates`
Templates bulletins customisables (entête, structure, footer).

---

## 15. Bulk Imports — `/admin/imports`

```
┌──────────────────────────────────────────────────────────┐
│  Imports en lot                                           │
│  [+ Nouvel import]                                        │
├──────────────────────────────────────────────────────────┤
│  Type           Date        Statut    Lignes   Action     │
│  Élèves         10/05/26    ✓ Done    245     [Voir]    │
│  Notes Maths    09/05/26    ✓ Done    28      [Voir]    │
│  Profs          08/05/26    ✗ Erreur  5       [Voir]    │
└──────────────────────────────────────────────────────────┘
```

Wizard nouveau import:
1. Choisir type (Élèves, Profs, Classes, Notes, Présences)
2. Télécharger template CSV
3. Upload votre CSV
4. **Preview** (10 lignes parsées + erreurs détectées par ligne)
5. Choisir mode (all-or-nothing / skip-invalid)
6. Confirmer et appliquer
7. Suivi progression + rollback possible 24h

---

## 16. Audit — `/admin/audit`

DataTable des actions sensibles. Filtres: acteur, type ressource, action, date, IP.
Détail: before/after diff JSON.
Export CSV.
Intégrité: hash chain check (badge ✓ ou ⚠️).

---

## 17. Profil & paramètres

### `/admin/profile`
- Photo, infos personnelles
- Email, téléphone
- Mot de passe (changer)
- MFA (statut + reset)
- Sessions actives + revoke
- Préférences notifs

### `/admin/settings`
- Préférences UI (densité, thème, langue)
- Raccourcis clavier
- API keys (Phase 5)
