# Admin Dashboard — Plan de production "screenshot-perfect"

> **Statut** : à valider avant implémentation.
> **Objectif** : transformer le dashboard admin actuel (screenshot 1) en dashboard production (screenshot 2) — pas seulement visuellement mais aussi fonctionnellement et back-end.
> **Périmètre** : **uniquement le dashboard admin** (`/admin/dashboard`) + ses dépendances (sidebar, topbar, KPI cards, tables, donut, seed data, endpoints backend).

---

## 1. Diagnostic — État actuel vs cible

### 1.1 Ce que le screenshot 1 montre (état actuel rendu en local)

| Élément | État actuel | Conformité cible |
|---|---|---|
| Sidebar | Dark navy ✓ mais active item un poil pâle | Quasi OK, à durcir |
| Topbar | Bell + avatar initiales "SD" seulement | ❌ Manque YearSelector + nom complet + rôle + chevron |
| Titre | "Tableau de bord" / "Bonjour Sophie 👋 — voici votre établissement aujourd'hui" | ❌ doit être "Tableau de bord administrateur" / "Vue d'ensemble de votre établissement et des activités administratives." |
| Setup banner "5 / 6 étapes complétées" | Présent | ❌ **à supprimer** |
| 5 KPI cards | Présentes mais valeurs "—" + pas de sparkline visible | ❌ doivent montrer 2458 / 186 / 94 / 28 / 16 avec sparklines + delta colorés |
| Structure école (mini-grid 6 cellules ANNÉES/CYCLES/NIVEAUX/CLASSES/MATIÈRES/BRANDING) | Présent, valeurs à 0 | ❌ remplacer par grille **4 colonnes** (Années / Niveaux / Classes / Matières) avec sous-listes |
| "Mes permissions" (66 permissions techniques) | Présent | ❌ **à supprimer définitivement** |
| "Performance globale" (donut) | Présent mais "Pas encore de données" | ❌ doit afficher 76% + breakdown par cycle |
| "Activité récente" | Présent, vide | ❌ doit afficher 4-6 entrées timeline |
| Demandes de rattachement / inscriptions | **absent** | ❌ table à créer (6 colonnes, 5 lignes type) |
| Affectations professeurs | **absent** | ❌ table à créer (5 colonnes, 5 lignes type) |
| Règles d'alerte | **absent** | ❌ table à créer (5 colonnes, 4 lignes) |
| Journal d'audit détaillé | **absent** | ❌ table timeline (5 colonnes, 4 lignes) |
| Exports récents | **absent** | ❌ liste 3 fichiers .xlsx/.pdf avec icônes + download |

### 1.2 Pourquoi le screenshot 1 ne reflète pas mes dernières modifs

J'ai en effet déjà réécrit `apps/web/src/app/admin/dashboard/page.tsx` dans le tour précédent avec les sections cibles, et tous les composants `<KpiCard>`, `<DonutChart>`, `<StatusBadge>`, `<SectionHeader>`, `<TopbarYearSelector>` sont en place côté `@pilotage/ui`. Le build typecheck est vert. **Ce que le screenshot 1 montre est donc soit une page avant rebuild du dev server, soit une page sans seed data** — ce qui explique le "—" partout et les sections vides.

Cela ne change pas le travail à faire : il manque encore (1) le seed data réaliste, (2) la suppression définitive du setup banner et de "Mes permissions" (vérifier qu'aucune trace ne subsiste), (3) la polish visuelle, (4) le ExportJob stub.

### 1.3 Conformité avec le cahier des charges PDF

La fiche produit décrit "Pilotage scolaire" comme une plateforme **orientée décision**, pas un cahier de notes. Le dashboard admin matérialise cette intention en exposant à l'écran d'accueil les **6 modules MVP** :

1. **Structure scolaire** — années / cycles / niveaux / classes / matières ✓ (panneau Structure)
2. **Inscriptions** — workflow demandes en attente ✓ (table Demandes)
3. **Affectations enseignants** — Prof × Classe × Matière ✓ (table Affectations)
4. **Alertes explicables** — règles configurables ✓ (table Règles)
5. **Exports** — XLSX/PDF asynchrones ✓ (liste Exports récents)
6. **Audit append-only** — traçabilité ✓ (Journal d'audit)

Plus les KPI agrégés (élèves/profs/classes/demandes/alertes) avec tendances. Le dashboard est donc bien le **hub d'entrée** de la plateforme côté admin.

---

## 2. Architecture déjà en place (à conserver)

| Brique | Fichier | Statut |
|---|---|---|
| `AppShell` + `Sidebar` dark navy | `packages/ui/src/components/{AppShell,Sidebar}.tsx` | ✅ déjà fait |
| `Topbar` avec slot `actions` et `burger` | `packages/ui/src/components/Topbar.tsx` | ✅ |
| `KpiCard` v2 (icône + label, big number, sparkline pleine largeur, delta chip) | `packages/ui/src/components/KpiCard.tsx` | ✅ |
| `DonutChart` avec légende latérale | `packages/ui/src/components/DonutChart.tsx` | ✅ |
| `StatusBadge` (success/warning/danger/info/neutral) | `packages/ui/src/components/StatusBadge.tsx` | ✅ |
| `SectionHeader` (titre + lien) | `packages/ui/src/components/SectionHeader.tsx` | ✅ |
| `EmptyState` | `packages/ui/src/components/EmptyState.tsx` | ✅ |
| `YearSelector` + wrapper Next.js `TopbarYearSelector` | `packages/ui/src/components/YearSelector.tsx` + `apps/web/src/components/shell/TopbarYearSelector.tsx` | ✅ |
| `NotificationBell` + wrapper | `packages/ui/src/components/NotificationBell.tsx` + `apps/web/src/components/shell/TopbarBell.tsx` | ✅ |
| `UserMenu` + wrapper | `packages/ui/src/components/UserMenu.tsx` + `apps/web/src/components/shell/TopbarUserMenu.tsx` | ✅ |
| `MobileSidebarToggle` (burger drawer) | `apps/web/src/components/shell/MobileSidebarToggle.tsx` | ✅ |
| Sidebar items admin (17 entrées) | `apps/web/src/components/shell/sidebar-items.ts` | ✅ |
| Endpoint analytics admin | `apps/api/src/modules/analytics/{analytics.service,analytics.controller}.ts` → `GET /api/v1/analytics/dashboard` | ✅ |
| Notifications endpoint (bell) | `apps/api/src/modules/notifications/notifications.controller.ts` | ✅ |
| Proxy Next.js pour fetches client-side | `apps/web/src/app/api/proxy/[...path]/route.ts` | ✅ |
| Middleware injection `x-pathname` (active sidebar) | `apps/web/src/middleware.ts` | ✅ |

**Tout cela ne sera pas retouché**, sauf petite polish ciblée si on identifie un écart visuel par rapport à la cible.

---

## 3. Travail à effectuer (delta vers la cible)

### 3.1 Frontend — `apps/web/src/app/admin/dashboard/page.tsx`

Bien que la page ait déjà été réécrite, on doit :

#### 3.1.1 Suppression définitive des éléments parasites
- **Setup banner "5/6 étapes complétées"** : confirmer qu'aucun composant `SetupChecklist` n'est rendu sur le dashboard. Le composant peut rester dans le code (utile sur `/admin/setup`) mais ne doit pas s'afficher ici.
- **"Mes permissions"** : confirmer qu'il n'y a plus de bloc rendant la liste des permissions techniques. Si présence d'un `<div className="sr-only">` portant le compte de permissions, le supprimer aussi (pollue les screen readers).
- **`Bonjour Sophie`** : remplacer par titre/sous-titre fixes "Tableau de bord administrateur" / "Vue d'ensemble de votre établissement et des activités administratives." (déjà fait, à confirmer après reload).

#### 3.1.2 Réordonnancement éventuel
La page actuelle suit déjà l'ordre cible : KPI strip → Structure+Demandes → Affectations+Donut+Règles → Audit+Exports. RAS sauf polish.

#### 3.1.3 Polish ciblée
- KPI tone "Demandes en attente" → **orange** (déjà fait dans la rewrite, à vérifier)
- KPI tone "Alertes configurées" → **rose** (déjà fait)
- Active sidebar item : ajouter une teinte plus contrastée si on observe un défaut après reload (token `--surface-sidebar-active` à durcir d'un cran si besoin)

### 3.2 Polish visuelle — `packages/design-tokens/src/tokens.css`

| Token | Valeur actuelle | Valeur cible (si nécessaire) |
|---|---|---|
| `--surface-sidebar` | `oklch(0.20 0.06 260)` | OK |
| `--surface-sidebar-active` | `oklch(0.30 0.10 260)` | Durcir à `oklch(0.34 0.13 260)` si l'écart est trop subtil sur retina |
| `--ink-on-sidebar` | `oklch(0.96 0.01 250)` | OK |
| Sidebar gradient brand block | inexistant | Aucun ajout — la cible n'en a pas |

Pas de changement de palette systémique attendu.

### 3.3 Backend — AnalyticsService déjà fait

L'endpoint `GET /api/v1/analytics/dashboard` retourne déjà la forme exacte attendue par la page :
- `kpis.{students,teachers,classes,pendingRequests,configuredAlerts}` avec `delta` + `trend[]`
- `schoolStructure.{academicYears,levels,classesByGrade,topSubjects,totals}`
- `enrollmentRequests[]` (depuis Guardianship.pending)
- `teachingAssignmentsSummary[]` (depuis TeachingAssignment groupé)
- `performance.{overall,byCycle[]}`
- `alertRules[]` (4 hardcoded dans le service)
- `recentAudit[]`
- `recentExports[]` (array vide jusqu'à R7)

**Aucun changement de schéma Prisma requis** pour le screenshot cible.

### 3.4 Le vrai gros morceau : **seed data réaliste** (`apps/api/prisma/seed-demo.ts`)

Sans seed, les 5 KPI cards montrent "—" et toutes les tables sont vides. Le screenshot cible exige des valeurs concrètes. Stratégie : **un seed démo distinct du seed prod**, exécutable via `pnpm prisma:seed:demo`.

#### Contenu du seed démo

**Tenant + École**
- Tenant "Lycée Voltaire" (réutilise celui du seed prod si présent)
- 1 école "Lycée Voltaire" avec branding (logo + couleurs)

**Années scolaires (3)**
- `2021–2022` (status: `closed`)
- `2022–2023` (status: `closed`)
- `2023–2024` (status: `active`)
- 3 trimestres par année

**Cycles (3) — pour matcher cible (Primaire/Collège/Lycée)**
- `Primaire` (orderIndex 1, couleur ambre)
- `Collège` (orderIndex 2, couleur teal)
- `Lycée` (orderIndex 3, couleur indigo)

**Niveaux (12 + 18 + 14 = 44) — match exact des chiffres cible**
- Primaire : CP, CE1, CE2, CM1, CM2 + déclinaisons (12 niveaux/sections)
- Collège : 6e A-D, 5e A-D, 4e A-D, 3e A-D, … (18 niveaux/sections)
- Lycée : 2nde A-D, 1ère ES/L/S/STMG, Terminale × variantes (14)

> Pour respecter exactement le décompte cible (Primaire 12 / Collège 18 / Lycée 14) sans trop alourdir le seed, on définit 12 "grade levels" Primaire, 18 Collège, 14 Lycée — c'est conforme au schéma `gradeLevel`.

**Classes (~94)**
- Réparties dans chaque niveau de manière équilibrée. Le décompte par grade label (6e=12, 5e=12, 4e=12, 3e=12) doit matcher le cliché cible. Pour les autres niveaux, distribution réaliste.

**Matières (8)**
- Mathématiques, Français, Histoire-Géographie, Anglais, SVT, Physique-Chimie, EPS, Arts Plastiques (cf. seed existant)
- + Subject coefficients par niveau

**Professeurs (186)**
- 186 `UserProfile` + `TeacherProfile`
- Noms français réalistes (faker non-utilisé : liste manuelle + suffixe pour variété)
- Auto-provision via TeacherProfileService
- 5 enseignants nommés pour la table Affectations : M. Laurent, Mme Bernard, M. Girard, Mme Petit, M. Robert

**Affectations enseignants (TeachingAssignment) — minimum 6 pour remplir la table**
- M. Laurent → Mathématiques × (5eA, 5eB) → 18 h/sem
- Mme Bernard → Français × (4eA, 4eB) → 16 h
- M. Girard → Anglais × (6eA, 6eB) → 14 h
- Mme Petit → SVT × (3eA, 3eB) → 15 h **(over-capacité → status `overcapacity`)**
- M. Robert → Physique-Chimie × (2ndeA, 2ndeB) → 12 h
- + ~50 autres affectations distribuées (pour le total "186 profs")

**Élèves (~2458)**
- Création en bulk via `prisma.student.createMany` (par batches de 500)
- Distribution réaliste par grade level
- Tous status `active`
- 28 d'entre eux ont leur `createdAt` < 1 mois (pour la sparkline + delta +4.8%)

**Guardians (~3000) + Guardianships (≥28 pending)**
- 3000 guardians réalistes
- ~2400 guardianships active (1 par élève)
- **28 guardianships avec status `pending`** pour le KPI "Demandes en attente"
- 5 d'entre eux nommés explicitement pour la table Demandes :
  - Sophie Martin → Élise Martin (5eB) — Rattachement / En attente / 08 mai 2024
  - Karim Belkacem → Yanis Belkacem (4eA) — Inscription / À vérifier / 08 mai 2024
  - Nadia Lefèvre → Lucas Lefèvre (6eA) — Rattachement / En attente / 07 mai 2024
  - Julien Moreau → Chloé Moreau (3eB) — Inscription / Approuvé / 06 mai 2024
  - Fatou Diallo → Aminata Diallo (2ndeA) — Rattachement / À vérifier / 06 mai 2024

> Comme `Guardianship` n'a pas de champ "type de demande" (rattachement/inscription), on stocke ce libellé dans `notes` ou on dérive depuis la présence/absence d'une Enrollment associée. Le service analytics expose déjà `requestType` — on l'enrichira pour distinguer les 2 cas.

**Notes & évaluations (sample)**
- 30-50 Assessments + 200-500 Grades publiées
- Distribution pour donner ~76% de réussite global, avec ~82% Primaire / 74% Collège / 69% Lycée → match exact du donut cible

**AuditLog (~50 entries)**
- 50 entrées récentes mais 4 spécifiquement nommées pour la timeline :
  - `08 mai 2024 10:32` — Mme Dupont — Création — Année scolaire — "Création de l'année scolaire 2024–2025"
  - `08 mai 2024 09:18` — M. Lefebvre — Mise à jour — Professeur — "Modification de l'affectation de M. Laurent"
  - `07 mai 2024 16:45` — Mme Dupont — Validation — Inscription — "Validation de la demande de Lucas Lefèvre"
  - `07 mai 2024 11:03` — M. Girard — Export — Résultats — "Export des résultats – 3e trimestre"

> Pour stocker "actorName" et "detail" dans la timeline, l'`AuditLog` actuel a déjà `actorId`, `action`, `resourceType`, `resourceId`. **Mini-ajustement service-side** : on enrichira la réponse `recentAudit` du service `AnalyticsService.adminDashboard` pour joindre `UserProfile` via `actorId` et résoudre `actorName`. Le champ `detail` peut être stocké dans `after` (JSON) puis aplati.

**Comptes utilisateurs (seed pour démo)**
- Mme Dupont (`mme.dupont@voltaire.fr`) — `school_admin`
- M. Lefebvre — `school_admin`
- M. Girard, Mme Petit, M. Laurent, etc. — `teacher`
- 1-2 parents pour tester le flow

> Les mots de passe Keycloak seront générés via le script Keycloak existant ou en mode dev simplifié.

**ExportJobs seed (3 sample rows)**
- Pour matcher la liste Exports récents :
  - `Résultats_3e_trimestre.xlsx` — 08 mai 2024 10:10 — M. Girard
  - `Bulletins_2e_trimestre.pdf` — 07 mai 2024 15:22 — Mme Dupont
  - `Absences_avril_2024.xlsx` — 06 mai 2024 09:41 — M. Lefebvre

> Le modèle `ExportJob` n'existe pas encore. **Décision recommandée** : pour ce screenshot cible, on **ajoute un mini modèle Prisma `ExportJob`** (sans worker) :
> ```prisma
> enum ExportKind { grades_xlsx report_card_pdf attendance_xlsx audit_csv }
> enum ExportStatus { pending running succeeded failed }
> model ExportJob {
>   id String @id @default(uuid()) @db.Uuid
>   tenantId String @map("tenant_id") @db.Uuid
>   requestedBy String @map("requested_by") @db.Uuid
>   kind ExportKind
>   fileName String @map("file_name")
>   fileUrl String? @map("file_url")
>   fileSizeBytes Int? @map("file_size_bytes")
>   status ExportStatus @default(pending)
>   createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
>   @@index([tenantId, createdAt])
>   @@map("export_job")
> }
> ```
> Le seed insère 3 lignes avec `status = 'succeeded'`. Le worker BullMQ reste différé à R7 — la page n'a pas besoin du worker pour afficher la liste.

### 3.5 Backend — petits ajustements à apporter

#### 3.5.1 `AnalyticsService.adminDashboard` — enrichir `recentAudit`

Actuellement on retourne `actorId` brut. Pour la timeline cible on a besoin d'un `actorName` lisible et d'un `detail` exploitable. Modifications :

1. Ajouter une jointure `actorId → UserProfile.firstName/lastName` (LEFT JOIN, NULL safe)
2. Aplatir `after.detail` ou `after.summary` (Json) dans `detail` si présent ; sinon construire un libellé à partir de `action` + `resourceType`

Pas de migration nécessaire.

#### 3.5.2 `AnalyticsService.adminDashboard` — enrichir `recentExports`

Actuellement `recentExports: []` hardcodé. Une fois le modèle `ExportJob` créé :

```typescript
const recentExports = await this.prisma.exportJob.findMany({
  where: { tenantId },
  orderBy: { createdAt: 'desc' },
  take: 3,
  include: { /* requestedBy → UserProfile name */ },
});
```

Mapping :
- `kind = grades_xlsx | attendance_xlsx | audit_csv` → `kind: 'xlsx'` (UI)
- `kind = report_card_pdf` → `kind: 'pdf'`
- `fileName`, `requesterName`, `createdAt`, `downloadUrl` (signed MinIO URL, optionnel — sans worker on peut laisser null)

#### 3.5.3 `enrollmentRequests` — distinguer rattachement vs inscription

Aujourd'hui tout est `requestType: 'rattachement'`. Le seed marquera certaines guardianships avec `notes: 'inscription_request'` (ou champ dédié `kind` futur). Le service détecte ce flag et expose `requestType: 'inscription' | 'rattachement'`.

> Alternative plus propre : ajouter une vraie table `EnrollmentRequest` (cf. REDESIGN-PLAN §6.1). Mais c'est planifié pour R6 — pour ce sprint on reste sur Guardianship + flag pour ne pas bloquer.

#### 3.5.4 `enrollmentRequests` — supporter `À vérifier` et `Approuvé` en statut

Le `Guardianship.status` enum a `pending | active | revoked`. On ne va pas créer un nouveau status — à la place, on **expose dans la table seulement les `pending`** (statut "En attente") + 2 lignes seedées avec un flag custom (`notes: { status: 'to_verify' }` JSON) que le service traduit. C'est un compromis acceptable jusqu'à `EnrollmentRequest` complet.

### 3.6 Composant manquant — Aucun

Tous les composants nécessaires (`KpiCard`, `StatusBadge`, `DonutChart`, `EmptyState`, `SectionHeader`, `Sparkline`, etc.) sont déjà dans `@pilotage/ui`. Pas de nouveau composant.

---

## 4. Plan d'exécution étape par étape

### Étape A — Vérification & cleanup (≈ 30 min)
1. Relire `apps/web/src/app/admin/dashboard/page.tsx` et confirmer absence du setup banner et de "Mes permissions" (les supprimer si trace résiduelle)
2. Build typecheck propre
3. Confirmer que le sidebar utilise bien le token `--surface-sidebar` (foncé)

### Étape B — Ajout du modèle `ExportJob` (≈ 30 min)
1. Migration Prisma `export_job` (enum kind + status + fields ci-dessus)
2. Mise à jour `AnalyticsService.adminDashboard` pour requêter et formatter
3. Typecheck API

### Étape C — Enrichissement audit (≈ 30 min)
1. Ajouter jointure `actorId → UserProfile` dans `AnalyticsService.adminDashboard`
2. Compute `actorName` + `detail` (depuis `after` JSON)
3. Adapter le type `AdminDashboardResponse.recentAudit[]`

### Étape D — Seed démo (≈ 2-3 h)
1. Créer `apps/api/prisma/seed-demo.ts`
2. Définir les listes de noms FR (~200 prénoms × ~200 noms pour variété)
3. Pipeline :
   - Réutiliser tenant + school + branding du seed existant
   - Créer 3 academic years
   - Créer 3 cycles (Primaire/Collège/Lycée)
   - Créer 44 grade levels distribués
   - Créer 8 subjects + coefficients
   - Créer 94 class sections distribuées dans l'année active
   - Créer 186 UserProfile + TeacherProfile (5 nommés pour la table)
   - Créer 50+ teaching assignments (5 nommées pour la table + ~50 random)
   - Créer 2458 students (bulk)
   - Créer 3000 guardians + 2400 guardianships
   - Marquer 28 guardianships comme `pending` (5 nommées pour la table)
   - Créer 30 assessments + 300 grades (avec distribution donnant 76% réussite global)
   - Créer 50 AuditLog entries (4 nommées pour la timeline)
   - Créer 3 ExportJob (nommés)
4. Ajouter le script `package.json` : `"prisma:seed:demo": "tsx prisma/seed-demo.ts"`

### Étape E — Vérification visuelle (≈ 30 min)
1. `pnpm docker:up` + `pnpm prisma:migrate:dev` + `pnpm prisma:seed:demo`
2. `pnpm dev`
3. Charger `localhost:3100/admin/dashboard` connecté en `mme.dupont@voltaire.fr`
4. Comparer pixel par pixel avec le screenshot cible

### Étape F — Test E2E smoke
1. `pnpm test:e2e:smoke` (déjà en place)
2. Vérifier que rien n'est cassé

### Étape G — Documentation
1. Mettre à jour `docs/spec/REDESIGN-PROGRESS.md` avec le statut "screenshot cible atteint"
2. Documenter `seed-demo.ts` dans le README

---

## 5. Critères d'acceptation

Une fois la page chargée connectée en admin (`mme.dupont@voltaire.fr`) :

- [ ] **Topbar** affiche : burger | titre "Tableau de bord administrateur" + sous-titre | `2023–2024 ▾` | bell badge `3` | avatar+`Mme Dupont`+`Administrateur`+chevron
- [ ] **Sidebar** dark navy avec items : Tableau de bord (actif) / Écoles / Années scolaires / Classes / Matières / Professeurs / Élèves / Inscriptions / Alertes / Exports / Audit / Paramètres + footer "Besoin d'aide ?"
- [ ] **5 KPI cards** : Élèves `2 458` (+4,8%) bleu / Professeurs `186` (+2,1%) vert / Classes `94` (+1) violet / Demandes en attente `28` (-12%) orange / Alertes configurées `16` (+2) rouge — chacune avec **sparkline visible** + delta coloré
- [ ] **Setup banner absent**
- [ ] **"Mes permissions" absent**
- [ ] **Structure de l'établissement** : 4 sous-cartes (Années / Niveaux 12-18-14-Total 44 / Classes 6e=12, 5e=12, 4e=12, 3e=12 / Matières Français=8 Mathématiques=8 Anglais=6 Sciences=7)
- [ ] **Demandes de rattachement / inscriptions** : table 6 colonnes, 5 lignes nommées (Sophie Martin, Karim Belkacem, Nadia Lefèvre, Julien Moreau, Fatou Diallo) avec status pills (En attente=orange, À vérifier=bleu, Approuvé=vert), lien "Voir toutes les demandes"
- [ ] **Affectations professeurs** : table 5 colonnes, 5 lignes nommées (M. Laurent, Mme Bernard, M. Girard, Mme Petit, M. Robert) avec status pill (Actif=vert, En surcharge=orange)
- [ ] **Performances de l'établissement** : donut 76% + breakdown Primaire 82% / Collège 74% / Lycée 69% + dropdown "Année en cours" + lien "Voir le tableau de bord analytique"
- [ ] **Règles d'alerte** : table 5 colonnes, 4 lignes (LOW_SUBJECT_AVG, NEGATIVE_TREND, HIGH_ABSENCE, BEHAVIOR_ALERT) avec sévérité pill (Élevée=rouge, Moyenne=orange) + statut (Active=vert), lien "Gérer les règles d'alerte"
- [ ] **Journal d'audit — Activités récentes** : timeline verticale 4 entrées avec date+heure / utilisateur / action / entité / détails, dots bleus, lien "Voir tout"
- [ ] **Exports récents** : 3 lignes avec icônes file (xlsx vert, pdf rose, xlsx vert) + filename + meta date+user + bouton download, lien "Voir tous"
- [ ] **Responsive** : sidebar disparaît <lg et devient drawer, KPI strip empile en 1-2-3 colonnes selon viewport
- [ ] **Accessibilité** : `pnpm test:e2e:smoke` passe (smoke + a11y)
- [ ] **Typecheck monorepo** : `pnpm typecheck` vert sur 11 tâches

---

## 6. Fichiers à toucher

| Fichier | Action | Lignes estimées |
|---|---|---|
| `apps/web/src/app/admin/dashboard/page.tsx` | Vérification + cleanup mineur | ~5-10 retouches |
| `apps/api/prisma/schema.prisma` | Ajout `ExportJob` + enums | +30 lignes |
| `apps/api/prisma/migrations/<n>_export_job/migration.sql` | NOUVEAU | ~25 lignes |
| `apps/api/src/modules/analytics/analytics.service.ts` | Enrichir audit (jointure UserProfile) + lire ExportJob réel | ~40 retouches |
| `apps/api/src/modules/analytics/analytics.service.ts` | Type `recentAudit` étendu avec `actorName`, `detail` | déjà prévu |
| `apps/api/prisma/seed-demo.ts` | NOUVEAU | ~600-800 lignes |
| `apps/api/package.json` | + script `prisma:seed:demo` | +1 ligne |
| `docs/spec/REDESIGN-PROGRESS.md` | Update statut | ~30 lignes |
| `apps/web/src/app/admin/dashboard/page.tsx` | Mapper `detail` du `recentAudit` | ~5 lignes |

**Aucun changement** sur `@pilotage/ui` (les composants sont prêts).

---

## 7. Hors périmètre de ce sprint

Pour ne pas dériver, **on ne touche pas** à :

- ❌ Le **moteur d'alertes** (BullMQ worker R6) — les 4 règles restent hardcodées dans le service. Statut "Active" affiché statiquement.
- ❌ Le **worker exports** (R7) — la table `ExportJob` est créée et seedée mais sans worker async. Les boutons "Exports" sur `/admin/exports` restent stubs.
- ❌ Le modèle complet `EnrollmentRequest` (R6) — on continue à dériver depuis `Guardianship.pending` avec un flag.
- ❌ Le modèle complet `Notification` (R8) — le bell continue de tourner sur `AnnouncementReceipt`.
- ❌ Les **autres dashboards** (teacher image 6 + parent image 7) — déjà livrés au tour précédent, on n'y touche pas.
- ❌ La **landing page** — déjà polish.

---

## 8. Risques & mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| Le seed démo prend plus de 1 min à tourner | Moyenne | Bulk insert via `createMany`, batches de 500, désactiver triggers pendant le seed |
| Distribution des notes ne donne pas exactement 76% / 82% / 74% / 69% | Élevée | Le seed fait du fine-tuning : pour chaque cycle, on ajuste artificiellement les notes pour atteindre la cible ±1% |
| Conflit avec le seed prod existant | Moyenne | Le seed-demo commence par un `prisma.guardianship.deleteMany` + `prisma.student.deleteMany` etc. limité au tenant démo. **Ne JAMAIS faire tourner sur prod**. Garde-fou : `if (process.env.NODE_ENV === 'production') throw` |
| Keycloak users non-synchronisés | Moyenne | Le seed crée les `UserProfile` directement avec `authProviderId: null`. Le UserSyncService les lie au premier login. Pour Mme Dupont spécifiquement, créer le user Keycloak manuellement ou via script de provisionning |
| Performance dashboard lente avec 2458 étudiants | Faible | Le service `adminDashboard` fait du `count` (rapide) + `findMany` limited (take=5-6). Sparklines en cumulative count — index sur `createdAt` existant |
| Les sparklines montrent une ligne plate si tous les `createdAt` sont identiques | Élevée | Le seed étale les `createdAt` des étudiants/profs/classes/guardianships sur les 60 derniers jours avec une distribution réaliste (Poisson-like) |

---

## 9. Validation requise avant code

Merci de confirmer les points suivants :

1. **Périmètre OK ?** → Uniquement `/admin/dashboard` + dépendances directes (seed, AnalyticsService, ExportJob model). On ne touche **pas** aux autres pages admin (`/admin/students`, `/admin/classes`, etc.) sauf si elles deviennent visibles via les liens "Voir toutes…".
2. **Stratégie seed-demo distincte de seed prod : OK ?** → Le seed prod actuel (tenant + école minimaliste) **reste intact**. Le seed démo (`seed-demo.ts`) est additif et n'est jamais lancé en prod.
3. **Modèle `ExportJob` ajouté dès maintenant (sans worker) : OK ?** → Sinon, on peut continuer avec `recentExports: []` hardcodé dans le service et afficher l'empty state. Mais la cible exige 3 lignes peuplées.
4. **Comptes admin de démo** : `mme.dupont@voltaire.fr` + `m.lefebvre@voltaire.fr` créés via UserProfile seul (sans Keycloak) — utilisateur final devra **soit** créer ces utilisateurs dans Keycloak avant de se connecter, **soit** je crée un petit script `seed-keycloak-users.ts` qui les provisionne via l'admin REST API Keycloak. Préférence ?
5. **Décompte exact Primaire 12 / Collège 18 / Lycée 14** : la cible montre ces chiffres ; je les implémenterai par insertion de "grade levels" supplémentaires (ex: dans le primaire on aura CP1/CP2/CE1A/CE1B/...). C'est un peu artificiel pour matcher la cible. **Acceptable ?**
6. **Délai** : étape D (seed) est le gros morceau (~2-3 h). Total estimé ~4-5 h de travail effectif. **OK ?**

---

## 10. Une fois validé

J'enchaîne sans interruption :

1. Étape A → B → C en sériée
2. Étape D (seed) avec validation intermédiaire après chaque sous-étape (cycles → niveaux → classes → profs → élèves → guardianships → notes → audit → exports)
3. Étape E → F → G
4. Je livre le screenshot final pris depuis le browser, à comparer avec la cible
5. `pnpm typecheck` + `pnpm test:e2e:smoke` doivent passer

**Dis-moi GO et je commence par l'Étape A.**
Si tu veux modifier le périmètre (ex : ne pas faire ExportJob, ou utiliser un autre stack pour le seed, ou changer les noms), dis-le ici.
