# Pilotage scolaire — Plan d'implémentation complet du portail admin

> **Statut** : à valider avant tout code.
> **Référence** : 3 images cibles (Élèves / Classes / Enseignants) + spec produit complète (18 pages admin).
> **Objectif** : transformer le portail admin actuel en plateforme SaaS scolaire production-ready, visuellement cohérente avec les maquettes cibles, data-driven, sécurisée, accessible.

---

## 1. Audit du codebase existant

### 1.1 Pages admin déjà présentes (32 fichiers `page.tsx`)

| Route | État actuel | Niveau de conformité cible |
|---|---|---|
| `/admin/dashboard` | ✅ Réécrit dans le sprint précédent (691 l.) | Bon, polish mineur restant |
| `/admin/students` | ⚠ Existe (234 l.) avec table basique sans avatars, sans KPI, sans donut, sans stars | **À reconstruire** (image 1) |
| `/admin/students/[id]` | ✅ Existant avec onglets (159 l.) | OK, polish |
| `/admin/students/new` | ✅ Existant | OK |
| `/admin/classes` | ⚠ Existe (76 l.) avec composant `ClassesManager` séparé | **À reconstruire** (image 2) |
| `/admin/classes/[id]` | ✅ Existant détaillé (295 l.) | OK, polish |
| `/admin/teachers` | ⚠ Existe (150 l.) en grille de cards 2-3 cols | **À reconstruire** (image 3) |
| `/admin/guardians` | ⚠ Liste basique (151 l.) | À redesigner |
| `/admin/enrollment-requests` | ✅ Stub propre du sprint précédent | OK, à compléter |
| `/admin/alerts` | ✅ 4 règles + onglet stub (159 l.) | OK, à compléter |
| `/admin/exports` | ✅ Stub du sprint précédent | OK, à connecter au worker plus tard |
| `/admin/audit` | ❌ N'existe pas | **À créer** |
| `/admin/announcements` + `/new` | ✅ Existant | OK, polish |
| `/admin/calendar` | ✅ Existant | OK, polish |
| `/admin/cycles` | ✅ Existant | À polish + renommer "Cycles & niveaux" |
| `/admin/subjects` | ✅ Existant | À redesigner avec KPI + table |
| `/admin/teaching-assignments` | ✅ Existant (matrix) | À redesigner / rebrand `/admin/assignments` |
| `/admin/academic-years` | ✅ Existant | À redesigner avec KPI + table |
| `/admin/imports` + `/new` + `/[id]` | ✅ Wizard complet (172+255 l.) | OK, polish |
| `/admin/users` | ✅ Existant | À redesigner avec KPI |
| `/admin/users/invite` | ✅ Existant | OK |
| `/admin/roles` + `/new` + `/[id]` | ✅ Existant | À redesigner |
| `/admin/school/branding` | ✅ Existant | À fusionner dans `/admin/establishment` |
| `/admin/school/structure` | ✅ Existant détaillé (330 l.) | OK |
| `/admin/schools` | ✅ Existant (multi-school) | OK |
| **`/admin/establishment`** | ❌ N'existe pas (existe partiellement en `/admin/school/branding`) | **À créer** |
| **`/admin/assessments`** | ❌ N'existe pas | **À créer** |
| **`/admin/attendance`** | ❌ N'existe pas | **À créer** |
| **`/admin/communications`** | ❌ N'existe pas (existe partiellement en `/admin/announcements`) | **À créer ou alias** |
| **`/admin/settings`** | ❌ N'existe pas (séparer de `/admin/school/branding`) | **À créer** |
| **`/admin/levels`** | ❌ N'existe pas (existe en `/admin/cycles`) | À renommer / alias |

### 1.2 Backend (28 controllers)

Modules NestJS existants :
- ✅ `analytics` (dashboard admin/teacher/parent)
- ✅ `announcements`, `attendance`, `calendar`
- ✅ `enrollments`, `grades` (+ assessments controller)
- ✅ `guardians`, `imports`, `lessons`
- ✅ `notifications`, `health`
- ✅ `identity` (me, register, invite, users, roles)
- ✅ `school-structure` (academic-years, branding, classes, cycles, subjects, setup, structure)
- ✅ `schools` (multi-school)
- ✅ `students`, `teaching` (teachers + teaching-assignments)

Endpoints **manquants** pour matcher le spec :
- ❌ `GET /api/v1/admin/audit` — endpoint dédié `audit_log` avec filtres date/user/action/resource
- ⚠ `GET /api/v1/students` — manque les champs `academicPerformance` (calcul stars), `legalGuardianName/email`
- ⚠ `GET /api/v1/classes` — manque `currentEnrollment`, `mainTeacher` joint, `capacityRate`
- ⚠ `GET /api/v1/teachers` — manque agrégat stats (totalTeachers, activeTeachers, subjectsCovered, ratioTeacherStudent)
- ⚠ `GET /api/v1/admin/students/aggregate` — stats KPI globaux élèves (total / nouveaux / actifs / répartition par niveau)
- ⚠ `GET /api/v1/admin/classes/aggregate` — stats KPI classes (total / avg-capacity / full / active)
- ⚠ `GET /api/v1/admin/teachers/aggregate` — stats KPI profs (total / active / subjects / ratio)
- ❌ `GET /api/v1/admin/assessments` — vue admin des évaluations (existant pour teacher)
- ❌ `GET /api/v1/admin/attendance/overview` — vue admin de l'assiduité

### 1.3 Composants `@pilotage/ui` (42 fichiers)

Déjà disponibles :
- ✅ Layout : `AppShell`, `Sidebar`, `SidebarItem`, `Topbar`
- ✅ Atomes : `Avatar`, `AvatarGroup`, `StatusBadge`, `DateCard`, `Tabs`, `SectionHeader`
- ✅ Charts : `Sparkline`, `ProgressBar`, `DonutChart`, `LineChart`, `BarChart`, `GroupedBarChart`
- ✅ KPI : `KpiCard`, `SubjectKpiCard`, `Stats2x2Grid`
- ✅ Cartes : `AlertCard`, `RecommendationCard`, `CommentsFeed`, `SubjectPerfCard`, `ChildProfileHero`
- ✅ Spécialités : `Timeline`, `ActivityTimeline`, `EmptyState`, `LoadingState`, `ErrorState`, `MiniCalendar`, `QuickActionsList`
- ✅ Gradebook : `GradePill`, `EditableGradeTable`, `DataTable`
- ✅ Topbar : `YearSelector`, `NotificationBell`, `UserMenu`
- ✅ Sidebar : `TipOfTheDayCard`, `HelpSidebarCard`

Composants **manquants** (à créer pour matcher le spec) :
- ❌ `PageHeader` — combine titre + sous-titre + breadcrumb + actions
- ❌ `Breadcrumb` — fil d'Ariane (`Tableau de bord > Classes`)
- ❌ `FilterBar` — composition search + selects + bouton primaire
- ❌ `SearchInput` — input avec icône loupe + clear
- ❌ `SelectFilter` — dropdown customisé (vs natif)
- ❌ `IconButton` — bouton carré avec icône seule (vue / edit / delete)
- ❌ `RowActions` — barre d'actions de ligne `[👁 ⋯]`
- ❌ `AvatarNameCell` — avatar + nom + email (utilisé partout dans les tables)
- ❌ `StarRating` — étoiles 0-5 pour "Performance académique"
- ❌ `ConfirmDialog` — modal de confirmation destructive
- ❌ `FormDrawer` — drawer latéral pour formulaires d'ajout/edit (vs page séparée)
- ❌ `DetailDrawer` — drawer latéral pour vue détail rapide
- ❌ `SubjectChip` — pill colorée par matière (utilisée dans table Enseignants)

---

## 2. Cibles visuelles — analyse des 3 images

### 2.1 Image 1 — Élèves

**Layout** : sidebar bleu marine très foncé + topbar + main avec :
- `PageHeader` "Élèves" + sous-titre "Gérez les informations et les inscriptions des élèves"
- Topbar : `📅 Année scolaire 2024-2025 ▾` + bell badge `5` + bouton logout/user
- **4 KPI cards horizontales** :
  - Total des élèves `1 248` · +5.2% par rapport à l'année dernière · sparkline bleue
  - Nouveaux inscrits `156` · Ce mois-ci · sparkline verte
  - Élèves actifs `1 078` · 86.4% du total · sparkline violette
  - Répartition par niveau · **donut multi-segments** avec légende latérale (6ème 312, 5ème 298, 4ème 256, 3ème 240, 2nde 142)
- **FilterBar** : `🔍 Rechercher un élève (nom, ID...)` + 3 selects (Classe / Niveau / Statut) + **bouton primaire `+ Ajouter un élève`**
- **DataTable** colonnes : Élève (avatar+nom+email) · ID Élève · Date de naissance · Classe (badge coloré) · Niveau · Responsable légal (nom+email) · Statut d'inscription (badge) · Performance académique (stars+label) · Actions (`👁 ⋯`)
- 7 lignes de démo (Martin Dupont 6ème A · Emma Bernard 5ème B · etc.)
- Pagination en bas : `Affichage de 1 à 10 sur 1 248 élèves` + numéros pages + chevrons

### 2.2 Image 2 — Classes

**Layout identique** avec :
- Topbar : burger gauche + breadcrumb optionnel + bell `3` + avatar Admin User
- `PageHeader` "Classes Management" → **à traduire** "Gestion des classes"
- Breadcrumb : `Tableau de bord > Classes`
- **4 KPI cards** :
  - Total Classes `24` · sparkline bleue
  - Average Capacity `78%` · sparkline verte
  - Full Classes `5` · sparkline orange
  - Active Classes `23` · sparkline violette
- 2 filtres dropdown : `Filter by Grade Level (All Grades)` + `Filter by Academic Year (2024-2025)` + bouton bleu `+ Add New Class`
- **DataTable** colonnes : Class Name (link bleu) · Grade Level · Academic Year · Max Students · Current Enrollment · **Capacity (progress bar horizontal vert/rouge avec % à droite)** · Teacher Assigned (avatar+nom) · Status (`Active` vert / `Full` rouge) · Actions (`👁 ✏️`)
- 8 lignes de démo
- Pagination : `Showing 1 to 8 of 24 classes` + chevrons + numéros

### 2.3 Image 3 — Enseignants

**Layout identique** avec :
- `PageHeader` "Enseignants" + sous-titre "Gérez les informations et affectations des enseignants"
- Bouton primaire en haut à droite : `+ Ajouter un enseignant`
- **4 KPI cards avec mini-sparklines** :
  - Total Enseignants `48` · Tous les enseignants · sparkline bleue
  - Enseignants Actifs `42` · 87.5% du total · sparkline verte
  - Matières Couvertes `16` · Dans tout l'établissement · sparkline violette
  - Ratio Enseignant/Élève `1 / 18` · En moyenne · sparkline orange
- **FilterBar** : search "Rechercher un enseignant..." + `▼ Filtrer par matière` + `▼ Statut : Tous`
- **DataTable** colonnes : Enseignant (avatar+nom+sous-titre rôle) · N° Employé · **Spécialité(s) (pills colorées par matière, 1-2 max)** · Classes Assignées · Email · Téléphone · Statut (`● Actif` vert / `● Inactif` rouge) · Actions (`✏️ 👁 🗑️` — 3 IconButtons colorés bleu/cyan/rouge)
- 5 lignes de démo
- Sidebar footer : `📅 Année scolaire 2024-2025 ▼`
- Pagination

### 2.4 Patterns transversaux extraits

| Pattern | Spec |
|---|---|
| Sidebar | Dark navy (≈ `oklch(0.17 0.05 260)`) **groupé par section** : Main / Gestion scolaire / Personnes / Pédagogie / Communication / Documents & suivi / Configuration |
| Active sidebar item | Bg `oklch(0.40 0.16 260)` bleu vif + texte blanc + icône blanche |
| Topbar | Hauteur 64 px + burger mobile + breadcrumb opt + YearSelector + Bell badge + UserMenu |
| KPI card | Icon rond coloré tonal (48-56 px) + label uppercase 11 px + big number 28-32 px mono + sparkline 40 px hauteur full-width + delta ligne |
| FilterBar | Card blanc rounded-xl ring-slate-200 + 1 search à gauche + N selects horizontaux + bouton primaire à droite |
| Table header | Bg slate-50 + texte uppercase 11 px bold + tracking-wider |
| Table rows | Hauteur 56-64 px, hover bg-slate-50, divide-y entre rows |
| AvatarNameCell | Avatar 36 px + (nom bold 14 px / email 11 px slate-500) |
| StatusBadge | Pill arrondi avec **dot couleur** + label · 12 toners (success, warning, danger, info, neutral, sky, etc.) |
| ProgressBar (capacity) | Hauteur 6 px, tonal vert <90%, rouge =100% |
| Star rating | 5 étoiles 14 px, jaune `fill-amber-400` actives, gris `text-slate-200` inactives + label texte sous |
| Pagination | Compact : `Affichage X à Y sur N` à gauche + numéros + chevrons à droite |
| Action row | `IconButton` 32×32 bg-tonal-50 (👁 = bleu/✏️ = cyan/🗑 = rouge) |

---

## 3. Restructuration de la sidebar (groupée)

Sidebar actuelle (plat) → cible (groupée en sections cliquables ou non, avec divider) :

```
PILOTAGE SCOLAIRE
Lycée Voltaire

[MAIN]
  • Tableau de bord

[GESTION SCOLAIRE]
  • Établissement
  • Années académiques
  • Cycles & niveaux
  • Classes
  • Matières

[PERSONNES]
  • Élèves
  • Enseignants
  • Parents / Tuteurs
  • Utilisateurs

[PÉDAGOGIE]
  • Notes & Évaluations
  • Présences
  • Inscriptions
  • Affectations

[COMMUNICATION]
  • Annonces
  • Notifications

[DOCUMENTS & SUIVI]
  • Imports
  • Exports
  • Rapports
  • Audit

[CONFIGURATION]
  • Rôles
  • Paramètres
```

Footer sidebar : carte aide ou tip + avatar + nom + rôle + chevron dropdown.

---

## 4. Plan d'exécution par phases

### Phase 0 — Validation (toi)

Tu valides ce plan. Je n'écris aucune ligne tant que tu n'as pas dit OK. ⏳

---

### Phase 1 — Design system : composants manquants (≈ 1-1.5 j)

**Composants `@pilotage/ui` à créer** :
1. `PageHeader` — `{ title, subtitle?, breadcrumb?, actions? }` → utilisé partout
2. `Breadcrumb` — `{ items: { label, href? }[] }`
3. `FilterBar` — composition slot (search + filters + primary action)
4. `SearchInput` — input avec loupe + bouton clear
5. `SelectFilter` — dropdown stylé (label + chevron + options)
6. `IconButton` — bouton carré 32×32 avec icône + variants (view / edit / delete)
7. `RowActions` — composition de 2-3 IconButtons
8. `AvatarNameCell` — pattern récurrent dans toutes les tables
9. `StarRating` — composant étoiles (readonly + value 0-5)
10. `SubjectChip` — pill colorée par matière (utilise `subjectColor()` existant)
11. `CapacityBar` — progress bar avec % à droite + tonal vert/orange/rouge
12. `ConfirmDialog` — modal simple OK/Cancel + danger variant
13. `FormDrawer` — drawer latéral droit + slot header + slot footer (Save/Cancel)
14. `DetailDrawer` — drawer latéral droit en lecture seule + tabs internes
15. `Pagination` — composant compact + props (page, total, pageSize, onPageChange)

**Refactor sidebar groupé** :
- `Sidebar` accepte désormais une `groups: SidebarGroup[]` au lieu de `items: SidebarItem[]`
- Chaque groupe a `{ label, items[] }` ; label optionnel rendu en uppercase 10 px slate-400
- Backward-compat : si `items` direct, fallback en un seul groupe sans label

**Tokens design** :
- Sidebar bg renforcé (déjà fait : `oklch(0.17 0.05 260)`)
- Subject palette stable (déjà fait via `subject-color.ts`)
- Confirm restart Tailwind v4 `@source` directive (déjà ajoutée)

**Acceptance Phase 1** :
- ✅ 15 nouveaux composants livrés avec types + tests visuels manuels sur la page `/dev/components`
- ✅ Sidebar refactorée (backward-compatible)
- ✅ `pnpm typecheck` propre

---

### Phase 2 — 3 pages image-prescribed (≈ 2-3 j)

#### 2A. `/admin/students` (image 1)
- **Backend** : extension `students.controller.ts` :
  - `GET /api/v1/students/aggregate` → `{ totalStudents, newThisMonth, activeStudents, repartitionByLevel: [{level, count, color}] }`
  - `GET /api/v1/students?withPerf=true` → champ `academicPerformance: { rating: 0-5, label: 'Excellent'|'Très bien'|... }` calculé depuis `Grade.statsForStudent`
  - Pagination + filtres `q`, `classSectionId`, `gradeLevelId`, `status`
- **Frontend** : `apps/web/src/app/admin/students/page.tsx` réécrite :
  - `PageHeader` "Élèves" + sous-titre
  - 4 KPI cards (3 chiffres + 1 donut "Répartition par niveau")
  - `FilterBar` (search + 3 SelectFilter + bouton primaire ouvre un FormDrawer "Ajouter un élève")
  - `DataTable` 9 colonnes avec `AvatarNameCell`, badge classe coloré, `StatusBadge`, `StarRating`, `RowActions`
  - Pagination
- **Demo data** : seed-demo déjà a 2 458 élèves ; on ajoute des `academicPerformance` calculés en temps réel

#### 2B. `/admin/classes` (image 2)
- **Backend** : extension `classes.controller.ts` :
  - `GET /api/v1/classes/aggregate` → `{ totalClasses, avgCapacity, fullClasses, activeClasses }`
  - `GET /api/v1/classes?withTeacher=true` → joint le main teacher (Professeur principal) si défini
- **Frontend** : `apps/web/src/app/admin/classes/page.tsx` réécrite (remplace `ClassesManager`) :
  - `PageHeader` "Classes" + breadcrumb "Tableau de bord > Classes"
  - 4 KPI cards
  - `FilterBar` (2 SelectFilter "Niveau" + "Année" + bouton primaire "Ajouter une classe" → FormDrawer)
  - `DataTable` colonnes : Nom · Niveau · Année · Max · Actuel · `CapacityBar` (% + couleur) · Enseignant référent (`AvatarNameCell`) · `StatusBadge` · `RowActions`
  - Pagination
- **Routes existantes** : `/admin/classes/[id]` reste (vue détail élèves + matières)

#### 2C. `/admin/teachers` (image 3)
- **Backend** : extension `teachers.controller.ts` :
  - `GET /api/v1/teachers/aggregate` → `{ totalTeachers, activeTeachers, subjectsCovered, ratioTeacherStudent }`
  - `GET /api/v1/teachers?withSubjects=true` → array `subjects[]` (depuis teaching_assignments groupé)
  - Email + phone exposés (déjà dans `UserProfile`)
- **Frontend** : `apps/web/src/app/admin/teachers/page.tsx` réécrite (remplace la grille de cards) :
  - `PageHeader` "Enseignants" + sous-titre + bouton "Ajouter un enseignant" (top right)
  - 4 KPI cards avec mini-sparklines
  - `FilterBar` (search + SelectFilter "Matière" + SelectFilter "Statut")
  - `DataTable` colonnes : Enseignant (`AvatarNameCell` + sous-titre rôle) · N° Employé · Spécialités (`SubjectChip[]`) · Classes assignées · Email · Téléphone · `StatusBadge` · `RowActions` (3 IconButtons)
  - Pagination

**Acceptance Phase 2** :
- ✅ 3 pages pixel-correct vs images
- ✅ Backend endpoints répondent avec données seedées
- ✅ Filtres + recherche + pagination fonctionnels
- ✅ Actions (View / Edit / Add) ouvrent les bons drawers/pages

---

### Phase 3 — Restructuration sidebar + redesign pages structure (≈ 1-2 j)

**Sidebar groupée** (refactor de `sidebar-items.ts`) :
- Migration vers la structure `groups[]`
- 18 items répartis dans 7 sections

**Pages à rebuild/polish** :
- `/admin/dashboard` — polish léger (déjà bien)
- **`/admin/establishment`** — fusion `/admin/school/branding` + nouvelles sections (général / logo / adresse / barème / config)
- **`/admin/academic-years`** — KPI cards + table + drawer ajout
- **`/admin/levels`** — alias vers `/admin/cycles` enrichi (cycles cards + grade levels table)
- **`/admin/subjects`** — KPI cards (matières actives, coef configurés, niveaux couverts, matières sans prof) + table + matrice coefficients

**Acceptance Phase 3** :
- ✅ Sidebar regroupée en sections
- ✅ 5 pages "Gestion scolaire" redesignées

---

### Phase 4 — Personnes / Inscriptions / Affectations (≈ 2 j)

- **`/admin/guardians`** redesign : KPI cards (parents actifs / liens approuvés / en attente / à vérifier) + table avec elements liés + drawer détail
- **`/admin/enrollments`** (extension de `/admin/enrollment-requests` actuel) : KPI cards (4 statuts) + Tabs (Toutes/En attente/À vérifier/Approuvées/Rejetées) + table + actions Approve/Reject
- **`/admin/assignments`** (alias `/admin/teaching-assignments` rebrand) : KPI cards (affectations actives / profs affectés / classes couvertes / matières sans prof) + table

**Acceptance Phase 4** : 4 pages personnes/inscriptions/affectations livrées.

---

### Phase 5 — Pédagogie (Évaluations, Présences, Alertes) (≈ 2-3 j)

- **`/admin/assessments`** NEW : vue admin de toutes les évaluations
  - Backend : `GET /api/v1/admin/assessments?status=&classSectionId=&subjectId=` agrégé
  - KPI cards (planifiées / publiées / brouillons / corrections récentes)
  - DataTable : titre · type · matière · classe · prof · date · barème · statut publication
- **`/admin/attendance`** NEW : vue admin de l'assiduité
  - Backend : `GET /api/v1/admin/attendance/overview?date=` agrégé
  - KPI cards (présences/absences/retards/non justifiées)
  - DataTable : élève · classe · date · statut · justification · signalé par
- **`/admin/alerts`** polish : Tabs (Règles d'alerte / Alertes actives / Historique) avec data réelle quand R6 sera prêt

**Acceptance Phase 5** : 3 pages pédagogie livrées.

---

### Phase 6 — Communication / Imports / Exports (≈ 1-2 j)

- **`/admin/communications`** = alias/refonte `/admin/announcements` :
  - KPI cards (envoyés / brouillons / destinataires / taux lecture)
  - Form drawer création + table envois
- **`/admin/imports`** polish (wizard déjà bien) : ajouter KPI cards
- **`/admin/exports`** : connecter au worker BullMQ quand R7 sera prêt — pour l'instant la table existante reste

**Acceptance Phase 6** : 3 pages communication/imports/exports polish.

---

### Phase 7 — Admin meta (Audit, Users, Roles, Settings) (≈ 1-2 j)

- **`/admin/audit`** NEW : page dédiée
  - Backend : `GET /api/v1/admin/audit?from=&to=&actorId=&action=&resourceType=&page=` paginé
  - KPI cards (actions aujourd'hui / critiques / exports sensibles / connexions admin)
  - FilterBar (date range + user select + action select + resource select)
  - DataTable colonnes : Date · Utilisateur · Action · Ressource · Ancienne valeur · Nouvelle valeur · IP · Détails
- **`/admin/users`** : KPI cards (actifs / invitations / désactivés / MFA) + table + actions (invite / edit role / deactivate / reset password)
- **`/admin/roles`** polish : cards par rôle + matrice permissions (présentation propre, pas un dump technique)
- **`/admin/settings`** NEW : page avec onglets (Général / Identité visuelle / Notation / Notifications / Sécurité / Données / Exports)

**Acceptance Phase 7** : 4 pages admin meta livrées.

---

### Phase 8 — QA + Responsive + A11y (≈ 1 j)

- Pass responsive sur les 18 pages : mobile (drawer sidebar) + tablette + desktop
- Pass a11y : focus ring + `aria-*` + contrastes (axe-core)
- Empty / Loading / Error states sur toutes les pages
- Tests Playwright smoke : login → naviguer dans toutes les sections principales
- Final `pnpm typecheck` + `pnpm test:e2e:smoke` + `pnpm test:e2e:a11y`

---

## 5. Backend — endpoints à créer / étendre

### Nouveaux endpoints
```
GET  /api/v1/students/aggregate                  → KPI page Élèves
GET  /api/v1/classes/aggregate                   → KPI page Classes
GET  /api/v1/teachers/aggregate                  → KPI page Enseignants
GET  /api/v1/guardians/aggregate                 → KPI page Parents
GET  /api/v1/admin/audit                         → Liste filtrable de l'audit
GET  /api/v1/admin/assessments                   → Vue admin
GET  /api/v1/admin/attendance/overview           → Vue admin assiduité
```

### Endpoints à étendre
```
GET /api/v1/students?withPerf=true               → +academicPerformance
GET /api/v1/classes?withTeacher=true             → +mainTeacher join
GET /api/v1/teachers?withSubjects=true           → +subjects[] (from teaching_assignments)
```

### Sécurité
- Tous les endpoints `/api/v1/admin/*` nouveaux : `@RequiresPermission('audit.read')` ou équivalent
- ABAC : super_admin + school_admin pour admin endpoints
- Tenant scope strict via `SchoolContextService`

---

## 6. Base de données — état + extensions

### Modèles déjà alignés avec le spec
- ✅ tenant, school, school_settings (via Branding pour le moment)
- ✅ academic_year, term, cycle, grade_level, class_section
- ✅ subject, subject_coefficient
- ✅ user_profile, teacher (TeacherProfile), guardian, student
- ✅ guardianship, enrollment
- ✅ teaching_assignment
- ✅ assessment, grade, grade_revision (= score_revision)
- ✅ audit_log
- ✅ export_job (ajouté précédemment)

### Modèles existants à enrichir / aligner
- ⚠ `school_settings` — actuellement géré via `Branding` ; le spec voudrait une table dédiée pour grading scale, passing threshold, etc. → **différé Phase 7 settings**
- ⚠ `enrollment_request` — actuellement dérivé de `Guardianship.notes` avec flags JSON ; le spec demande une table dédiée → **différé R6/sprint séparé** (acceptable pour MVP)
- ⚠ `alert_rule`, `alert`, `alert_status_history` — n'existent pas, on a 4 règles hardcodées dans le service → **différé R6**
- ⚠ `notification` — actuellement dérivé de `announcement_receipt` → **différé R8**
- ⚠ `student_subject_snapshot`, `student_global_snapshot`, `class_subject_distribution` — n'existent pas, on calcule à la volée → **acceptable, optimisation future**
- ⚠ `assessment_plan` vs `assessment_result` — actuellement combinés dans `assessment` + `grade` → **structure différente mais équivalente**
- ⚠ `file_object` — actuellement on a `ExportJob.fileUrl` qui pointe vers MinIO → **à factoriser quand on aura plus d'usages**

### Migrations nécessaires pour ce sprint
Aucune migration cassante. Toutes les nouvelles tables (alert_rule, notification, enrollment_request dédié, school_settings dédié) seront planifiées dans des sprints ultérieurs.

---

## 7. Sécurité, tests, accessibilité

### Tests
- **TypeScript** : `pnpm typecheck` propre sur 11 tâches (déjà ✓)
- **Lint** : `pnpm lint` (à vérifier au fil)
- **E2E Playwright** : compléter `tests/e2e/admin.spec.ts` avec :
  - Login admin
  - Navigation : visiter chaque section du sidebar groupé
  - Élèves : recherche, filtre, ouverture détail
  - Classes : ajout via drawer, filtre par niveau
  - Enseignants : recherche, filtrage par matière
- **A11y** : `pnpm test:e2e:a11y` (axe-core) sur 5 pages clés

### Sécurité
- Toutes les actions sensibles (delete, archive, deactivate, role-change) passent par `ConfirmDialog`
- Audit log écrit pour : create/update/delete/archive sur student, teacher, class, role, settings, export
- ABAC : un parent ne voit pas un élève tant que la guardianship n'est pas approuvée (déjà en place)
- Class capacity : un override admin demande confirmation + audit log

### Accessibilité (WCAG 2.1 AA)
- Tous les inputs ont un `<label>` ou `aria-label`
- Focus ring visible sur tous les éléments interactifs
- Touch targets ≥ 44×44 px sur mobile
- Contraste 4.5:1 partout
- Drawers avec `role="dialog"` + `aria-modal="true"` + focus trap + Escape close

---

## 8. Estimation totale

| Phase | Travail | Estimation |
|---|---|---|
| Phase 1 — Design system | 15 nouveaux composants + refactor Sidebar groupée | 1-1.5 j |
| Phase 2 — 3 pages image | Students + Classes + Teachers | 2-3 j |
| Phase 3 — Structure scolaire | Sidebar regroupée + 5 pages | 1-2 j |
| Phase 4 — Personnes | Guardians + Enrollments + Assignments | 2 j |
| Phase 5 — Pédagogie | Assessments + Attendance + Alerts polish | 2-3 j |
| Phase 6 — Communication | Announcements + Imports + Exports polish | 1-2 j |
| Phase 7 — Admin meta | Audit + Users + Roles + Settings | 1-2 j |
| Phase 8 — QA / responsive / a11y | Pass mobile + axe-core + tests | 1 j |

**Total : 11-16 jours-personne** (réalisable sur 10-15 jours en continu).

---

## 9. Hors périmètre de ce plan (déjà acté)

- ❌ Moteur d'alertes BullMQ (R6) — restera stub
- ❌ Worker exports asynchrones (R7) — ExportJob seedé existant, le worker BullMQ reste à brancher
- ❌ Notifications dédiées (R8) — `notification` model
- ❌ Refonte Teacher portal et Parent portal — séparés
- ❌ Mobile native app
- ❌ I18n autre que français (déjà unique langue)

---

## 10. Décisions à valider explicitement

1. **Sidebar groupée** : labels de sections en uppercase petits (`MAIN`, `GESTION SCOLAIRE`, etc.) ou simplement un divider entre groupes sans label ?
2. **Drawer vs page séparée** pour création/édition : préférence drawer latéral droit, ou pages dédiées comme actuellement (`/admin/students/new`) ?
3. **Routes anglaises vs françaises** : le spec dit `/admin/levels` (anglais) mais on a `/admin/cycles` actuel (français). On garde le français partout ou on aligne sur le spec anglais ?
4. **`/admin/establishment` vs `/admin/school/branding`** : remplacer/aliaser ? Le contenu de branding deviendrait un onglet "Identité visuelle" dans Établissement.
5. **Délai** : OK avec 11-16 jours-personne (réalisable en ~2 semaines) ?
6. **Phase order** : OK avec Phase 1 → 8 dans l'ordre, ou veux-tu prioriser certaines pages (ex: Audit ou Assessments avant Settings) ?

---

## 11. Une fois validé

Je commence par **Phase 1 (design system)** sans interruption, en marquant un chapitre par phase.
Après chaque phase, je :
- Lance `pnpm typecheck` propre
- Documente l'avancement dans `REDESIGN-PROGRESS.md`
- Marque la phase suivante comme `in_progress`
- Continue jusqu'à la Phase 8

**Dis-moi GO + tes réponses aux 6 questions et j'enchaîne.**
