# Wireframes — Portail Professeur (`/teacher`)

> Cible: enseignants. Layout bottom-tabs mobile + sidebar desktop. Saisie rapide, ergonomie clavier sur desktop.

## Layout général

**Mobile (≤ 768px):**
```
┌───────────────────────────┐
│ ☰ Pilotage   🔍  🔔  👤  │ Topbar
├───────────────────────────┤
│                           │
│   Page content            │
│                           │
├───────────────────────────┤
│ 🏠   📚   📝   👥   ⚙️   │ Bottom tabs
│ Dash Class Eval Risk Sets │
└───────────────────────────┘
```

**Desktop (≥ 768px):** Sidebar 240px + topbar + content.

Sidebar items:
- Dashboard
- Mes classes
- Évaluations
- Présences
- Cahier de texte
- À risque
- Annonces
- Messages
- Mon emploi du temps
- Profil
- Paramètres

---

## 1. Dashboard `/teacher/dashboard`

```
┌──────────────────────────────────────────────────────────┐
│  Bonjour, Mme Dupont 👋                                   │
│  Mercredi 15 mai 2026                                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📅 Mes cours aujourd'hui                                │
│  ─────────────────────────                                │
│  08h00  2ndeB  Maths        Salle 12     [ Prendre prés.]│
│  10h00  TermS  Physique     Lab 1        [ Prendre prés.]│
│  14h00  2ndeB  Maths        Salle 12     [ Cahier text. ]│
│                                                          │
│  📝 À faire                                              │
│  ─────                                                    │
│  3 grilles à publier (DST Maths 2ndeB, ...)              │
│  2 cours sans cahier de texte                            │
│  5 absences à justifier                                  │
│                                                          │
│  🔥 Élèves à risque (3)                                 │
│  ─────                                                    │
│  • Tom Bernard (2ndeB) — Anglais ↓                       │
│  • Léa Martin (TermS) — Maths < 10                       │
│  • [Voir tout]                                           │
│                                                          │
│  📢 Annonces                                              │
│  ─────                                                    │
│  • Conseil de classe TermS le 22/05                      │
│  • Nouvelle politique évaluations                        │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Mes classes — `/teacher/classes`

```
┌──────────────────────────────────────────────────────────┐
│  Mes classes (5)                                          │
│  [Filtres: période ▼] [Recherche...]                      │
├──────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │ 2ndeB      │  │ TermS      │  │ 1ereES     │         │
│  │ Maths      │  │ Physique   │  │ Maths      │         │
│  │ 28 élèves  │  │ 22 élèves  │  │ 26 élèves  │         │
│  │ Moy 12.4   │  │ Moy 11.8   │  │ Moy 13.2   │         │
│  │ 3 à risque │  │ 1 à risque │  │ 0 à risque │         │
│  │ [Ouvrir]   │  │ [Ouvrir]   │  │ [Ouvrir]   │         │
│  └────────────┘  └────────────┘  └────────────┘         │
└──────────────────────────────────────────────────────────┘
```

Détail classe `/teacher/classes/[id]`: tabs (Élèves / Évaluations / Gradebook / Présences / Cahier de texte / Distribution / À risque / Mur / Ressources).

---

## 3. Élèves de la classe — `/teacher/classes/[id]/students`

DataTable: photo, nom prénom, moyenne actuelle, dernière note, alertes, présences mois.
Filtres: avec alerte / sans alerte / à risque.
Clic élève → drawer profile élève (lecture seule + lien admin si role permet).

---

## 4. Évaluations classe — `/teacher/classes/[id]/assessments`

Liste des évaluations passées + à venir.
```
┌──────────────────────────────────────────────────────────┐
│  Évaluations — 2ndeB / Maths                              │
│  [+ Nouvelle évaluation]                                  │
├──────────────────────────────────────────────────────────┤
│  Titre              Type    Date       Statut    Action   │
│  DST chapitre 5     DST     15/05/26   Publié    [Voir]  │
│  Interro fonctions  Interro 22/05/26   Planifié  [Saisir]│
│  Composition T2     Compo   05/06/26   Planifié  [Voir]  │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Nouvelle évaluation — `/teacher/assessments/new`

```
┌──────────────────────────────────────────────────────────┐
│  Nouvelle évaluation                                      │
│                                                           │
│  Classe         [2ndeB ▼]                                 │
│  Matière        [Maths] (auto)                            │
│  Type           [Devoir surveillé ▼]                      │
│  Titre          [_________________________]               │
│  Date           [22/05/2026]                              │
│  Heure          [10:00]                                   │
│  Durée (min)    [60]                                      │
│  Barème (max)   [20]                                      │
│  Poids          [2]    (coefficient évaluation)           │
│  Visibilité     ◉ Visible parents (par défaut)           │
│                 ○ Masquée jusqu'à publication             │
│  Description    [optionnel]                               │
│  Pièces jointes [Drop files...]                           │
│                                                           │
│  [Annuler]   [Enregistrer en brouillon]   [Publier date] │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Gradebook (saisie grille) — `/teacher/assessments/[id]/grade-entry`

```
┌────────────────────────────────────────────────────────────────┐
│  DST chapitre 5 — Maths 2ndeB — 15/05/26                       │
│  Statut: Brouillon  •  Sauvegarde auto: il y a 3s              │
│  [← Retour]  [Importer CSV]  [Aperçu publication]  [Publier]  │
├────────────────────────────────────────────────────────────────┤
│  Saisies: 24 / 28      Tab pour suivant, Enter pour ligne suiv.│
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Élève              Note   Statut    Commentaire         │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  Bernard, Tom       12.5   Présent   "Bonne progression" │ │
│  │  Dupont, Marie       8.0   Présent   ""                  │ │
│  │  Lefebvre, Marc     14.5   Présent   ""                  │ │
│  │  Martin, Léa         —     Absent    "Justificatif?"     │ │
│  │  Rousseau, Sophie   17.0   Présent   ""                  │ │
│  │  [...continued]                                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Stats brouillon : moyenne 12.8 — médiane 13 — écart 3.2      │
└────────────────────────────────────────────────────────────────┘
```

Clavier:
- ↑↓ navigation lignes
- ←→ navigation colonnes
- Enter ligne suivante même colonne
- Tab champ suivant
- Statuts: `A` absent, `E` exempt, `M` missing (raccourcis)
- Cmd/Ctrl+S sauvegarde manuelle (auto-save par défaut)

Mobile: vue carte par élève (1 élève par carte, swipe pour suivant).

---

## 7. Publier — confirmation

```
┌──────────────────────────────────────────────────────────┐
│  Publier les notes ?                                       │
│                                                           │
│  Vous allez publier 28 notes pour DST chapitre 5.         │
│                                                           │
│  Conséquences:                                            │
│  • Les parents et élèves verront immédiatement les notes  │
│  • Les snapshots et tendances seront recalculés           │
│  • Toute alerte déclenchée sera envoyée                   │
│  • Aucune suppression possible — révision uniquement      │
│                                                           │
│  Envoyer notification aux parents ?                        │
│  ☑ Email   ☑ Notification interne   ☐ SMS                 │
│                                                           │
│  [Annuler]   [Publier]                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Présences — `/teacher/classes/[id]/attendance`

Vue session du jour:
```
┌──────────────────────────────────────────────────────────┐
│  Présences — 2ndeB / Maths — 15/05 08h00                 │
│  [Marquer tous présents]                                  │
├──────────────────────────────────────────────────────────┤
│  Élève              Statut         Commentaire           │
│  Bernard, Tom       [P A R E D]   ""                    │
│  Dupont, Marie      [P A R E D]   ""                    │
│  Martin, Léa        [P A R E D]   "RDV médical"         │
│  ...                                                      │
│                                                          │
│  P=Présent  A=Absent  R=Retard  E=Excusé  D=Dispense    │
│                                                          │
│  [Annuler]  [Enregistrer]                                │
└──────────────────────────────────────────────────────────┘
```

Statuts customizables par admin.

---

## 9. Cahier de texte — `/teacher/classes/[id]/lessons`

Vue liste des cours par semaine:
```
┌──────────────────────────────────────────────────────────┐
│  Cahier de texte — Maths 2ndeB                            │
│  [Semaine 20] ◀ ▶                                         │
├──────────────────────────────────────────────────────────┤
│  Lundi 13/05                                              │
│    08h-10h  Fonctions affines (chapitre 5)                │
│             Devoirs: Ex. 12-15 p. 84                      │
│             Ressources: [PDF cours] [Lien vidéo]          │
│             [Éditer]                                      │
│                                                          │
│  Mercredi 15/05                                           │
│    14h-15h  DST chapitre 5                                │
│             [Ajouter contenu]                             │
└──────────────────────────────────────────────────────────┘
```

Éditeur cours:
- Titre, chapitre, objectifs
- Contenu (markdown WYSIWYG)
- Devoirs à faire pour prochain cours
- Ressources (upload PDF, liens vidéos)
- Visibilité parents/élèves (toggle)

---

## 10. Distribution — `/teacher/classes/[id]/distribution`

Charts:
- Histogramme notes dernière évaluation
- Box plot moyennes par période
- Évolution moyenne classe sur l'année
- Comparaison vs niveau global école

---

## 11. À risque — `/teacher/classes/[id]/at-risk`

Liste élèves de la classe avec alertes ouvertes:
- Nom, matière, règle déclenchée, sévérité, explication
- Action: contacter parent (template email pré-rempli), planifier soutien

---

## 12. Mur de classe — `/teacher/classes/[id]/wall`

Feed de posts (annonces, ressources, encouragements):
- Composer post (texte + pièce jointe)
- Visible parents + élèves de la classe
- Modération admin si activée

---

## 13. Mon emploi du temps — `/teacher/schedule`

Vue semaine personnelle (toutes mes classes/matières).
Export .ics pour intégration calendrier perso.

---

## 14. Élèves à risque global — `/teacher/students-at-risk`

Vue agrégée sur toutes mes classes.

---

## 15. Annonces — `/teacher/announcements`

Composer annonce à mes classes. Liste annonces publiées par admin.

---

## 16. Messages — `/teacher/messages` (Phase 5)

Inbox messages parents (lecture seule MVP).

---

## 17. Profil & paramètres

### `/teacher/profile`
- Photo, infos, MFA, sessions, préférences notifs.

### `/teacher/settings`
- Préférences UI (densité Grille saisie, raccourcis clavier).
- Notifications digest (instant/journalier/hebdo).
- Langue.
