# Pilotage Scolaire — Plan de refonte UI/UX & architecture

> **Statut** : v2.0 — à valider avant implémentation.
> **Auteur** : Claude, après analyse des **7 maquettes de référence** (5 initiales + 2 nouveaux dashboards Teacher/Parent extra-détaillés) + audit complet du codebase existant.
> **Périmètre** : refonte visuelle complète des 3 portails (admin, prof, parent) + landing page + nouvelles capacités (sparklines, charts subject-coloré, gradebook inline éditable, alertes & recommandations explicables, conseil du jour, centre d'aide, exports, audit, multi-établissement super-admin).
> **Contrainte** : ne casser AUCUN backend existant (schéma + endpoints) sauf migration explicite et planifiée.
>
> **Δ v1 → v2** :
> - Section §1.7 NOUVELLE — analyse approfondie images 6 (Teacher dashboard riche) et 7 (Parent dashboard riche)
> - §1.2 enrichie de 11 nouveaux patterns (gradebook inline, subject-coloured KPI, profile hero, mini-calendar, comments feed, conseil du jour, etc.)
> - §1.8 NOUVELLE — mapping couleur par matière (palette stable cross-portal)
> - §4.2 +8 composants (`<SubjectKpiCard>`, `<EditableGradeTable>`, `<SubjectPerfCard>`, `<ChildProfileHero>`, `<MiniCalendar>`, `<CommentsFeed>`, `<TipOfTheDayCard>`, `<HelpSidebarCard>`)
> - §6.1 +1 modèle (`TipOfTheDay`) + §6.2 nouveaux endpoints `analytics/subject-stats`, `gradebook/inline-save`, `tips/of-the-day`
> - §7 phases R4 + R5 réécrites avec specs pixel-précises issues des nouvelles maquettes

---

## 1. Analyse visuelle des 5 maquettes

### 1.1 Identité visuelle commune

Les 5 maquettes partagent **un seul langage visuel** — c'est la base à standardiser :

| Élément | Spécification |
|---|---|
| **Sidebar** | Bleu marine très foncé (~`#0E2046` / `oklch(0.20 0.06 250)`), pleine hauteur, ~240 px, items icône + label |
| **Page bg** | Gris clair neutre (~`#F5F7FB` / `oklch(0.97 0.005 250)`) |
| **Cartes** | Blanc pur, `rounded-2xl` (16-20 px), ombre douce, padding 24 px |
| **Texte principal** | Slate-900 sur cartes, blanc sur sidebar |
| **Texte secondaire** | Slate-500 ~14 px |
| **Accent admin** | Bleu vif `#2D6EF5` |
| **Accent prof** | Vert/turquoise `#1FB97A` |
| **Accent parent** | Bleu doux `#3E7BD8` + vert progression `#1FB97A` |
| **Typographie** | Inter, hiérarchie : 28 px bold titres / 16 px regular body / 13 px caps labels |
| **Espacement** | Grille 8 px ; section gap = 24 px ; card gap = 16 px |
| **Radii** | `--r-sm` 8 px, `--r` 12 px, `--r-lg` 16 px, `--r-2xl` 20 px, `--r-pill` 999 px |
| **Iconographie** | Icônes outline 18-20 px (Lucide), enfermées dans un rond/carré coloré tonal |

### 1.2 Patterns récurrents (à composantiser)

#### Sidebar (image 1, 2, 3, 5)
- Logo en haut + nom plateforme
- Sous-titre rôle ("Administrateur" / "Professeur" / "Gestion scolaire intégrée")
- Liste verticale d'items : icône + label
- État actif : fond bleu plus clair + texte blanc/accent
- Badges de notification sur certains items (ex : "Messages 2", "Alertes 2")
- Footer : carte d'aide / centre d'aide + avatar utilisateur

#### Top bar (toutes)
- Burger pour collapse sidebar (image 5)
- Titre + sous-titre / description
- Actions à droite : CTA primaire + secondaire + sélecteur d'année + bell + user
- **Sélecteur d'année scolaire** en haut à droite, format `2023-2024 ▾` — présent partout
- Bell avec badge numérique

#### KPI cards (toutes)
- Icône sur fond coloré tonal (rond 48-64 px)
- Label en majuscules petit
- Grand nombre (32-40 px bold)
- Trend chip : `+4,8 % vs mois dernier` en vert ou `-12 %` en rouge
- **Sparkline 80×30 px sous chaque KPI** ← élément NOUVEAU à intégrer
- Lien de drilldown "Voir mes classes →"

#### Tables (image 1, 2, 5)
- En-tête gris clair, texte uppercase 12 px
- Avatars circulaires 32 px avec initiales colorées
- Cellules 14 px ligne 1, 12 px ligne 2 (sous-info)
- Status badges en bout de ligne : pill ronde avec fond pastel + texte de couleur tonale
- Pagination « < 1 2 3 4 5 > » + "Affichage de X à Y sur N"

#### Charts (images 1, 2, 3, 5)
- **Sparkline** : ligne SVG mono-couleur sans axes, sous KPI
- **Donut** : pourcentage central + segments colorés + légende latérale (Très bien / Bien / Satisfaisant / Fragile / Insuffisant) avec %
- **Line** : avec ligne d'objectif pointillée, derniers points annotés
- **Bar** : vertical, valeurs au-dessus de chaque barre, axe X libellé

#### Status / badges
| Label | Couleur de fond | Texte | Usage |
|---|---|---|---|
| Actif | vert pastel | vert foncé | enseignant, classe |
| En attente | orange pastel | orange foncé | demande |
| À vérifier | jaune pastel | jaune foncé | demande |
| Approuvé | vert pastel | vert foncé | demande |
| En surcharge | rouge pastel | rouge foncé | classe pleine |
| Élevée / Moyenne | gris/orange | tonal | sévérité |
| Risque élevé / modéré / À surveiller | rose / amber / sky | tonal | alerte élève |
| Très bien / Bien / Satisfaisant / Fragile / Insuffisant | vert/bleu/orange/rouge | tonal | note |

#### Date cards (image 2, 3 — "Prochaines évaluations")
- Bloc à gauche avec **jour court + numéro + mois** (`VEN / 24 / MAI`) en couleur tonale
- Titre + matière chip + durée + nombre d'élèves à droite

#### Activity timeline (image 1 — Journal d'audit)
- Trait vertical à gauche
- Points circulaires à chaque entrée
- Date/heure + utilisateur + action + entité concernée + détails

#### Alertes explicables (image 3)
- Icône cloche/triangle dans rond coloré (rouge / orange selon sévérité)
- Titre + description en 2 lignes
- Lien "Voir les détails et actions proposées →"
- Pas seulement « note basse » mais **explication** : « La moyenne est passée sous 13/20. Un soutien ciblé peut l'aider à progresser. »

#### Recommandations (image 3)
- Cartes avec icône + titre + sous-titre + chevron droit
- Cliquables, mènent à une action concrète

#### CTA strip avec illustration (image 3, 4)
- Bloc large coloré clair (sky-50)
- Illustration à gauche (famille, école)
- Titre + sous-titre
- 1-3 boutons CTAs à droite

#### Subject-coloured KPI cards (image 6)
- Carte avec gradient full background mappé sur la couleur de la matière (cf §1.8)
- Icône blanche en cercle translucide
- Nom matière 16-18 px bold blanc
- Stats `3 classes · 86 élèves` blanches
- Lien `Voir les classes →` blanc translucide

#### Inline editable gradebook (image 6)
- Carte pleine largeur
- Header avec sélecteur matière + bouton primaire "Enregistrer"
- Table compacte avec lignes alternées
- **Cellules de notes = pills tonales** (vert/jaune/rouge selon bucket 16-20 / 10-15 / 0-9)
- Au clic : transformation en input numérique avec validation min/max
- Ligne footer "Moyenne de la classe" agrégée
- Légende sous table pour signaler les buckets

#### Profile hero card (image 7)
- Photo enfant 96×96 px arrondie
- Nom big (28 px bold) + sous-ligne classe + école
- 4 chips de métadonnées (âge / DOB / identifiant / rang)
- Pleine largeur, hauteur 160-180 px
- Variante teacher : pas de photo, juste classe + matière

#### Subject performance cards (image 7)
- Grille 4 cards, chacune dédiée à une matière
- Icône carré coloré 32 px haut-gauche
- Big grade `18,2 / 20` (28 px mono bold)
- Badge tonal "Excellent" / "Bien" / "À améliorer" / "Insuffisant"
- Progress bar coloré matière
- 4 metric rows label-droite-valeur (classement / moy. classe / progression / coef)
- Menu kebab top-droite pour drill-down

#### Mini-calendar widget (images 6, 7)
- Header "< Mois Année >" avec navigation prev/next
- Grille 7×6 jours, jours hors-mois grisés
- **Dots colorés** sous certains jours (matière ou type d'évaluation)
- Jours sélectionnés cerclés plein
- Légende compacte (1-2 entries)
- Compatible avec passage en vue agenda complet via lien `Voir calendrier`

#### Stats 2×2 grid card (image 6)
- 4 cellules, chacune avec : grand chiffre coloré mono + label uppercase petit
- Couleur du chiffre = sémantique (bleu/vert/rouge/orange)
- Compact, ~120 px hauteur

#### Comments feed (image 7)
- Cartes empilées, chacune avec :
  - Avatar prof 40 px gauche
  - Nom + sous-ligne rôle/matière
  - Corps commentaire (3 lignes max avant clamp)
  - Date droite (format court `28/05/2025`)
- Lien "Voir tous les commentaires" en haut droite

#### Bar chart groupé multi-trimestre (image 7)
- Groupes (matières) × 3 séries (trimestres)
- Couleurs gradient mono-tonal du même hue (clair → foncé)
- Valeurs annotées au-dessus de chaque barre
- Axe Y graduations 0/5/10/15/20
- Légende en bas avec bullets colorés

#### Conseil du jour / Help sidebar card (images 6, 7)
- Sticky en bas de la sidebar dark
- Icône (étoile pour conseil, casque pour aide) + titre + corps texte
- Optionnel : barre de progression (gamification "2/5 conseils lus")
- Optionnel : CTA bouton secondaire
- Le contenu est administré côté admin/super-admin

#### Outils rapides / Quick actions list (image 6)
- Liste verticale 4-6 entries
- Icône colorée 20 px + label
- Hover : background tonal
- Cliquable → action ou route
- Lien "Voir tous les outils →" en bas

### 1.3 Variations par portail

| Portail | Sidebar items | Couleur accent | Particularités |
|---|---|---|---|
| **Admin** (image 1) | Tableau de bord, Écoles, Années scolaires, Classes, Matières, Professeurs, Élèves, Inscriptions, Alertes, Exports, Audit, Paramètres | Bleu `#2D6EF5` | 5 KPI cards · structure étab · demandes · perf donut · règles d'alerte · audit timeline · exports |
| **Super-admin** (image 5) | + Établissements, Affectations, Emplois du temps, Présences, Rapports | Bleu `#2D6EF5` + accent vert | Capacité par classe · répartition par niveau · multi-établissement |
| **Teacher** (image 6 ✱ prescriptive) | Tableau de bord, Mes classes, Élèves, Notes, Évaluations, Emploi du temps, Ressources, Messagerie `2`, Rapports, Paramètres | Subject-coloured KPI + teal accent `#1FB97A` | **4 subject KPI cards gradient** · saisie de notes inline en pills · mini-calendar évals · répartition moyennes donut · stats 2×2 · prochaines évals date-cards · classes enseignées · activité récente · outils rapides · **Conseil du jour sidebar** |
| **Parent** (image 7 ✱ prescriptive) | Tableau de bord, Profil de l'élève, Notes et évaluations, Suivi des matières, Évaluations à venir, Emploi du temps, Absences et retards, Commentaires, Recommandations, Documents, Communication | Bleu `#3E7BD8` + vert progression | **Profile hero photo+métadonnées** · performance globale donut · alertes/recos cards · **4 subject perf cards** · mini-calendar évals à venir · line chart évolution générale · bar chart groupé par matière/trimestre · table dernières notes · **commentaires enseignants feed** · **Besoin d'aide sidebar** |

### 1.4 États visuels manquants dans les maquettes

À concevoir nous-mêmes en cohérence :

- **Empty state** : icône + titre + 1-2 lignes + CTA (ex : "Aucune évaluation planifiée — Planifier la première")
- **Loading state** : skeleton shimmer sur cartes/tables
- **Error state** : icône triangle + message + bouton "Réessayer"
- **Filtres actifs** : chip retirable au-dessus du tableau
- **Recherche** : input + résultats live + état "Aucun résultat"
- **Multi-step forms** : breadcrumb d'étapes (déjà fait dans imports wizard)
- **Confirmation destructive** : modal avec icône warning + texte rouge + 2 boutons
- **Toast** : bottom-right, succès/erreur/info, auto-dismiss

### 1.5 Responsive

- **≥1280 px** : layout pleine grille (3-4 colonnes)
- **1024-1279 px** : sidebar visible, 2 colonnes contenu
- **640-1023 px** : sidebar collapse vers icônes seules (~72 px) ; contenu 1-2 col
- **<640 px** : sidebar en drawer (off-canvas), contenu pleine largeur stack

### 1.6 Inconsistances détectées dans les maquettes

- L'image 5 (super-admin) utilise un sidebar légèrement différent (logo cap + "Gestion Scolaire Intégrée") — on standardise sur l'image 1
- L'image 4 (landing) montre un mock parent dashboard avec un sidebar légèrement plus clair — c'est juste un rendu marketing
- L'image 2 (prof) a 2 badges de notification (`Messages 2`) tandis que l'image 3 (parent) en a 1 (`Alertes 2`) — pattern identique mais badge optionnel par item
- L'image 3 a un titre "Mme Koné" mais le badge plus loin dit "Aïssatou Koné Classe de 4ème A" — c'est le **switcher d'enfant**, pas le user — à distinguer clairement
- L'image 5 affiche des établissements (super-admin) mais les autres images n'ont pas cette dimension — à intégrer côté super-admin uniquement
- Les **images 6 (Teacher riche) et 7 (Parent riche)** introduisent une dimension supplémentaire : **gradient subject-coloured KPI cards**, **profile hero card**, **multi-chart layout** non présents dans les images 1-5 → considérés comme la **cible finale** car plus complets

---

## 1.7 Analyse approfondie images 6 (Teacher) & 7 (Parent)

Ces deux nouvelles maquettes représentent **la cible finale d'expérience produit** pour les portails Teacher et Parent. Elles introduisent une densité d'information et une finesse de composition supérieures aux images 2 et 3 initiales. **Ces deux maquettes deviennent prescriptives** ; les versions précédentes restent valides pour les patterns communs (KPI strip, sidebar, etc.) mais en cas de conflit, **images 6 & 7 priment**.

### 1.7.1 Image 6 — Teacher Dashboard "M. Dupont" (rich)

**Layout global** : Sidebar 240 px dark navy + Top bar 64 px + main 3-zone (left main flow + right rail aside + bottom 3-col strip).

**Sidebar dark navy** :
- Logo + texte "PILOTAGE SCOLAIRE" en haut
- 10 items verticaux : Tableau de bord (actif, bg `oklch(0.27 0.08 250)`), Mes classes, Élèves, Notes, Évaluations, Emploi du temps, Ressources, Messagerie (badge `2` accent rouge), Rapports, Paramètres
- **Carte "Conseil du jour"** en bas — étoile + titre + texte d'astuce + barre de progression 2/5 (gamification)
- Hauteur sidebar = full screen ; padding 16 px ; items 40 px rounded-lg

**Top bar 64 px** :
- À gauche : titre "Tableau de bord" (24 px bold) + sous-titre "Bienvenue, M. Dupont 👋" (13 px ink-muted)
- À droite : `<YearSelector>` "2024 - 2025 ▾", `<NotificationBell>` badge `3`, `<UserMenu>` avec avatar initiales "MD" + nom "M. Dupont / Enseignant"

**Zone 1 — KPI strip 4 cards subject-coloured (NOUVEAU PATTERN)** :
Chaque carte = gradient subject-coloured full background, 220×88 px arrondi 16 px :
1. **Mathématiques** — gradient `purple-500 → indigo-500`, icône book blanche, "3 classes · 86 élèves", lien "Voir les classes →" blanc/translucide
2. **Histoire-Géographie** — gradient `blue-500 → cyan-500`, icône globe
3. **Physique-Chimie** — gradient `teal-500 → emerald-500`, icône atom
4. **Français** — gradient `orange-500 → amber-500`, icône book-open

**Zone 2 — Saisie des notes inline (NOUVEAU PATTERN)** :
- Carte large pleine largeur main col
- Header : "Saisie des notes – 2nde A" (gauche) + select "Mathématiques ▼" + bouton primaire "Enregistrer" (droite, vert)
- Table compacte 6 colonnes : `# | Élève | Devoir 1 (20 pts) | Devoir 2 (20 pts) | Contrôle (20 pts) | Participation (10 pts) | Moyenne (/20)`
- Cellules de notes = **pills couleur tonale** selon bucket :
  - vert pastel = 16-20 (Excellent)
  - jaune pastel = 10-15 (Satisfaisant)
  - rouge pastel = 0-9 (Insuffisant)
- Footer ligne `Moyenne de la classe` (gris clair, valeurs agrégées)
- Légende sous table : 3 pastilles colorées
- **Comportement attendu** : clic sur pill → input éditable inline (auto-save ou save batch via bouton)

**Zone 3 — Aside droit (rail 360 px)** :
1. **Planning des évaluations (mini-calendar)** — header "Planning des évaluations", navigation mois `< Mai 2025 >`, grille 7×6 days, jours grisés hors mois, **dots violets sous certains jours** = évaluation prévue, **jours sélectionnés cerclés violet plein** (ex: 7, 14, 22). Légende violet "Évaluation prévue".
2. **Répartition des moyennes (donut)** — donut 3 segments (vert/jaune/rouge), légende à droite avec pourcentages et nombres : "Excellent (16-20) 22% (13 élèves)" / "Satisfaisant 48% (28 élèves)" / "Insuffisant 30% (17 élèves)"
3. **Statistiques de la classe (2×2 grid)** — 4 KPI compacts :
   - Moyenne générale `11,85` bleu
   - Meilleure moyenne `13,50` vert
   - Plus faible moyenne `7,25` rouge
   - Taux de réussite (≥10/20) `75%` orange
4. **Prochaines évaluations (liste date-cards)** — 4 entrées :
   - `<DateCard>` (jour + mois en pill violet/orange/etc.) + titre + sous-ligne matière/classe + badge "Dans X jours" à droite
   - Lien "Voir toutes les évaluations →"

**Zone 4 — Strip 3 colonnes bottom** :
- **Classes enseignées** — liste icônes + 2nde A / 2nde B / 1ère S, sous-titre matière, count élèves, lien "Voir toutes mes classes →"
- **Activité récente** — timeline 4 entries (point bleu + titre + date relative), lien "Voir toute l'activité →"
- **Outils rapides** — liste icônes + actions : "Créer une évaluation", "Importer des notes", "Générer un rapport", "Envoyer un message", lien "Voir tous les outils →"

### 1.7.2 Image 7 — Parent Dashboard "Mme Dubois" (rich)

**Layout global** : Sidebar 240 px (collapsible via burger) + Top bar avec breadcrumb "Tableau de bord — Vue d'ensemble des performances et activités" + main 3-zone (hero + body + right rail).

**Sidebar dark navy** — 11 items :
Tableau de bord (actif), Profil de l'élève, Notes et évaluations, Suivi des matières, Évaluations à venir, Emploi du temps, Absences et retards, Commentaires, Recommandations, Documents, Communication
+ **Carte "Besoin d'aide ?"** en bas avec icône casque + texte "Consultez notre centre d'aide ou contactez le support." + bouton "Centre d'aide"

**Zone 1 — Hero strip 3 cards** :
1. **Child Profile Hero (carte large 2 fr)** — photo enfant 96×96 px arrondie + nom big "Lucas Dubois" + "Classe de 5ème A" + "Collège Victor Hugo" + 4 chips d'info : "Âge 12 ans" · "Né(e) le 15/03/2012" · "Identifiant LD12345" · "Rang de la classe 7 / 28"
2. **Performance globale (carte 1 fr)** — donut center "84% Très bien" (anneau bleu épais) + 4 lignes métriques à droite : "Moyenne générale 16,8/20", "Moyenne de la classe 14,2/20", "Progression +1,6 pts ↑" (vert), "Assiduité 96%"
3. **Alertes et recommandations (carte 1 fr)** — header + lien "Tout voir", 2 cartes empilées :
   - WARNING fond `amber-50` : icône triangle-down rose + titre "Baisse de performance en Physique" + corps "Une baisse de 8% a été observée ce trimestre. Nous recommandons un accompagnement régulier." + bouton "Voir détails"
   - SUCCESS fond `emerald-50` : icône étoile verte + titre "Excellente progression en Mathématiques !" + corps + bouton "Voir détails"

**Zone 2 — Performance par matière (4 SubjectPerfCards NOUVEAU)** :
Grille 4 colonnes ; chaque carte 280×220 px arrondie 16 px :
- En-tête : icône carré coloré 32 px + nom matière + menu kebab `⋮`
- Big number `18,2 / 20` (28 px mono bold) + badge tonal "Excellent" / "Bien" / "À améliorer"
- Progress bar coloré (couleur matière) 100% width
- 4 metric rows label-droite-valeur :
  - `Classement de la classe — 3 / 28`
  - `Moyenne de la classe — 14,3 / 20`
  - `Progression — +2,1 pts ↑` (vert)
  - `Coefficient — 4`

**Zone 3 — Calendrier à droite (rail 320 px)** :
- "Évaluations à venir" + lien "Voir calendrier"
- Mini-calendar (mêmes specs que image 6 mais dots multi-couleurs : orange/bleu/vert/violet selon matière)
- Liste 4 entrées sous le calendrier : `<DateBadge>` couleur subject + nom éval + heure (`05 Juin — Contrôle d'Histoire — 09:00 - 10:00`)

**Zone 4 — Charts duo 2 colonnes** :
- **Line chart "Évolution des moyennes générales"** — 5 points sur axe X (1er trim / 2e trim / 1er sem / 3e trim / Année), ligne bleue Lucas + ligne gris clair classe, valeurs annotées au-dessus des points (`13,6 / 14,8 / 14,2 / 16,0 / 16,8`), axe Y graduations 0/5/10/15/20, légende bullets en bas
- **Bar chart groupé "Évolution par matière (moyennes par trimestre)"** — 4 groupes (Mathématiques / Histoire / Géographie / Physique-Chimie) × 3 barres (1er trim bleu clair / 2e trim bleu moyen / 3e trim bleu foncé), valeurs au-dessus des barres, légende en bas

**Zone 5 — Strip bottom 2 colonnes** :
- **Dernières notes et évaluations (table large)** — 9 colonnes : Date / Matière / Évaluation / Type / Note / `/` / Moy. classe / Coef. / Appréciation. 5 lignes données. Lien "Voir toutes les notes" en haut droite.
- **Commentaires des enseignants (feed)** — 3 entrées : avatar prof 40 px + nom + sous-ligne rôle ("Professeur de Mathématiques") + corps commentaire + date droite. Lien "Voir tous les commentaires".

### 1.7.3 Patterns transversaux confirmés / précisés

| Pattern | Confirmation par les nouvelles maquettes |
|---|---|
| **Sidebar dark navy** | Confirmée — items + footer card (Conseil du jour / Besoin d'aide) sont **mandatoires** |
| **Top bar avec year selector + bell + user** | Confirmée — bell badge numérique systématique |
| **Profile / hero card** | NOUVEAU — pour parent uniquement, dépend de l'enfant sélectionné |
| **Subject-coloured KPI cards** | NOUVEAU — pour teacher uniquement (les KPI admin restent neutres tonales) |
| **Donut + 2×2 stats grid + date-cards list** | NOUVEAU — bloc droit "aside" récurrent dans Teacher |
| **Charts duo** | NOUVEAU — pour parent (line + bar groupé côte à côte) |
| **Comments feed** | NOUVEAU — fil chronologique des commentaires enseignants |
| **Inline editable gradebook** | NOUVEAU — saisie de notes directement dans une carte du dashboard |
| **Outils rapides list** | NOUVEAU — raccourcis vers les actions principales du portail |
| **Activité récente timeline** | NOUVEAU — version courte de l'audit, scope user-centric |
| **Mini-calendar** | NOUVEAU — version compacte du calendrier en aside droit |
| **Multi-source alerts** | Confirmée — couleur fond (warning amber / success emerald) selon polarité |

### 1.7.4 Métriques de densité

| Maquette | Cartes total | Charts | Tables | Listes | Densité info |
|---|---|---|---|---|---|
| Image 6 (Teacher rich) | 12 | 1 donut | 1 table | 3 | Très haute |
| Image 7 (Parent rich)  | 13 | 1 donut + 1 line + 1 bar | 1 table | 2 | Très haute |

→ **Conséquence design** : padding cartes réduit à 20-24 px (vs 32 px maquettes 1-5) pour caser cette densité sur ≥1280 px. Sur ≤1024 px, basculement en stack vertical 1 colonne avec preservation de l'ordre.

---

## 1.8 Mapping couleur par matière (palette stable cross-portal)

Pour assurer la **cohérence visuelle inter-portail** (le parent voit la même couleur Maths que le prof), on définit une palette stable des couleurs de matières. Stockée sur `Subject.color` (déjà existant). Migration de seed à effectuer.

| Matière (code) | Couleur primaire | OKLCH | Hex approx | Tonal bg | Usage |
|---|---|---|---|---|---|
| `MATH` / Mathématiques | indigo-violet | `oklch(0.55 0.20 280)` | `#6366F1` | `oklch(0.95 0.05 280)` | KPI card gradient, progress bar, charts |
| `HIST_GEO` / Histoire-Géo | bleu cyan | `oklch(0.62 0.15 240)` | `#3B82F6` | `oklch(0.95 0.05 240)` | idem |
| `HIST` / Histoire | bleu primaire | `oklch(0.58 0.17 230)` | `#2563EB` | `oklch(0.95 0.05 230)` | idem |
| `GEO` / Géographie | orange terre | `oklch(0.70 0.16 60)` | `#F59E0B` | `oklch(0.95 0.07 60)` | idem |
| `PHYS_CHIM` / Physique-Chimie | teal émeraude | `oklch(0.65 0.14 175)` | `#14B8A6` | `oklch(0.95 0.05 175)` | idem |
| `SVT` / Sciences de la Vie | vert biologique | `oklch(0.63 0.16 145)` | `#22C55E` | `oklch(0.95 0.06 145)` | idem |
| `FR` / Français | orange chaud | `oklch(0.70 0.18 45)` | `#FB923C` | `oklch(0.95 0.07 45)` | idem |
| `ENG` / Anglais | rose framboise | `oklch(0.65 0.20 0)` | `#F43F5E` | `oklch(0.95 0.06 0)` | idem |
| `ESP` / Espagnol | jaune solaire | `oklch(0.78 0.15 90)` | `#FACC15` | `oklch(0.96 0.07 90)` | idem |
| `ALL` / Allemand | brun caramel | `oklch(0.55 0.10 60)` | `#A16207` | `oklch(0.94 0.05 60)` | idem |
| `EPS` / Sport | vert lime | `oklch(0.72 0.18 130)` | `#84CC16` | `oklch(0.96 0.06 130)` | idem |
| `ART` / Arts plastiques | rose magenta | `oklch(0.65 0.22 330)` | `#EC4899` | `oklch(0.95 0.07 330)` | idem |
| `MUS` / Musique | violet améthyste | `oklch(0.60 0.20 300)` | `#A855F7` | `oklch(0.95 0.06 300)` | idem |
| `TECH` / Technologie | gris ardoise | `oklch(0.55 0.05 250)` | `#64748B` | `oklch(0.95 0.02 250)` | idem |
| `PHILO` / Philosophie | brun cuir | `oklch(0.45 0.08 50)` | `#78350F` | `oklch(0.93 0.04 50)` | idem |
| (fallback) | bleu neutre | `oklch(0.60 0.10 250)` | `#64748B` | `oklch(0.95 0.02 250)` | si pas de mapping |

**Helper utilitaire** :
```typescript
// packages/ui/src/utils/subject-color.ts
export function subjectColor(code: string | undefined): { primary: string; tonal: string; gradient: string } {
  const map: Record<string, {primary: string; tonal: string; gradient: string}> = {
    MATH:     { primary: 'oklch(0.55 0.20 280)', tonal: 'oklch(0.95 0.05 280)', gradient: 'from-indigo-500 to-violet-500' },
    HIST_GEO: { primary: 'oklch(0.62 0.15 240)', tonal: 'oklch(0.95 0.05 240)', gradient: 'from-blue-500 to-cyan-500' },
    PHYS_CHIM:{ primary: 'oklch(0.65 0.14 175)', tonal: 'oklch(0.95 0.05 175)', gradient: 'from-teal-500 to-emerald-500' },
    FR:       { primary: 'oklch(0.70 0.18 45)',  tonal: 'oklch(0.95 0.07 45)',  gradient: 'from-orange-500 to-amber-500' },
    // ...
  };
  return map[code ?? ''] ?? map['fallback'] ?? defaultColor;
}
```

---

## 2. Analyse produit & fonctionnel

### 2.1 État actuel — déjà implémenté ✅

#### Backend (Phases 0-5)
- 34 modèles Prisma, 14 modules NestJS, 26 controllers
- Auth Keycloak avec 3 clients OIDC + ROPC + NextAuth
- Multi-tenant + multi-école (préférence stockée sur user_profile.preferences.activeSchoolId)
- Permissions catalog (66 codes) + realm role mapping
- Structure scolaire : School → Cycle → GradeLevel → ClassSection (par année), Subject ↔ Coefficient
- Personnes : Student, Guardian, Guardianship, UserProfile, TeacherProfile (auto-provisionnée)
- Inscriptions : Enrollment avec workflow active / transferred / dropped
- Évaluations : Assessment + Grade + GradeRevision (workflow draft → published → revised)
- Cahier de texte : LessonEntry (markdown + devoirs + due date)
- Présences : ClassSession + AttendanceRecord (5 statuts + justification)
- Annonces : Announcement + AnnouncementReceipt (scope school / cycle / level / class / student / user)
- Calendrier : CalendarEvent (vacances, fériés, examens, événements)
- Import CSV : ImportBatch + ImportRow (validation + dry-run + rollback 24 h)
- Audit : AuditLog append-only
- Outbox events pour intégrations futures

#### Frontend
- 44 pages Next.js 15 App Router
- 3 portails fonctionnels (login + register + dashboards + modules)
- Branding par école (logo/couleurs/police)
- PortalShell avec top-nav (à remplacer)

### 2.2 Partiellement implémenté — à compléter ⚠️

| Fonctionnalité | État | Manque |
|---|---|---|
| **KPIs dashboard admin** | Cards basiques | Sparklines + trend vs période précédente |
| **Charts** | Aucun | Donut performance, line trend, bar repartition |
| **Demandes de rattachement** | Modèle Guardianship existe avec status `pending`/`active`/`revoked` | UI workflow d'approbation par admin |
| **Audit timeline** | Modèle AuditLog existe, page `/admin/audit` minimaliste | Timeline visuelle + filtres |
| **Exports** | `imports.execute` permission existe, page `/admin/exports` n'existe pas | Module exports + génération PDF/XLSX + suivi |
| **Année scolaire active selector** | Une seule année active automatique | Switcher dans top bar partout |
| **Notifications bell** | Pas de stockage | NotificationCenter (basé sur AnnouncementReceipt + nouveaux types) |
| **Profil élève parent** | `/parent/children/[id]` existe | Onglets profil / notes / présences / cahier |
| **Profil élève prof** | `/admin/students/[id]` existe | Vue prof avec contexte ses cours uniquement |
| **Saisie de notes** | Gradebook existe | Vue "Saisie groupée par évaluation" plein écran |
| **Évolution de la moyenne** | Modèle Grade contient tout | Endpoint d'agrégation par semaine/mois + line chart |
| **Performance de la classe** | Service calcule moyenne | Distribution en buckets (Très bien / Bien / etc.) |
| **Alertes explicables** | Permission `alert_rules.write` existe | Modèle AlertRule + AlertInstance + moteur + UI |
| **Recommandations** | N'existe pas | Modèle Recommendation + UI cartes actions |
| **Commentaires enseignants** | `Grade.comment` existe par note | Vue cumulative "fil de commentaires" par élève |
| **Capacité classes (super-admin)** | `maxStudents` existe | Donut + alert "X classes en surcharge" |
| **Répartition par niveau** | Données existent | Bar chart `/admin/dashboard` |
| **Tendance globale école** | Données existent | KPI Tendance vs mois précédent (+0.7 pt) |

### 2.3 Manquant — à créer ❌

- **AlertRule** + **AlertInstance** : moteur d'alertes explicables (LOW_SUBJECT_AVG, NEGATIVE_TREND, HIGH_ABSENCE, BEHAVIOR_ALERT) — visible dans l'image 1
- **Recommendation** + **RecommendationDelivery** : moteur de conseils contextuels (image 3)
- **Notification** (notifs ciblées) : différent d'Announcement (broadcast) ; ex : « 3 notes publiées en Maths »
- **Export** : ExportJob + ExportFile + service async
- **TeacherComment** (séparé de Grade.comment) : commentaire bulletin/trimestre/élève (image 2 et 3)
- **DocumentLibrary** : Documents du portail teacher/parent (image 2 et 3 sidebar "Documents")
- **Message** : messagerie interne (image 2 sidebar "Messages 2") — Phase 6 ?
- **EnrollmentRequest** séparé d'Enrollment : demande en attente d'approbation par admin (image 1)
- **SuperAdmin scope** : gestion multi-établissement (image 5)
- **AlertRule editor** UI : grille code / nom / condition / sévérité / statut (image 1 bottom-right)
- **Performance de l'établissement** endpoint : `/api/v1/analytics/school-perf`
- **Sparkline data** endpoints : `/api/v1/analytics/kpi-trends?metric=students_count`

### 2.4 À redessiner (existant fonctionnellement mais visuellement à revoir)

- Tous les dashboards (admin / prof / parent) — match maquettes
- PortalShell → AppShell avec sidebar persistante (toutes les 5 maquettes)
- /admin/calendar → garder la grille mais styliser comme image 2 right-side date cards
- /admin/students list table → avatars + status badges + pagination format image 1
- /admin/teaching-assignments matrix → format table image 1 « Affectations professeurs »
- /admin/announcements → format timeline + scope chips
- /admin/imports wizard → garder logique, restyler en cohérence
- Landing page (image 4) → garder structure mais aligner sur le nouveau langage visuel

### 2.5 À reporter mais à préparer architecturalement

- **Messagerie interne** (Message + Conversation) — Phase 6/7
- **Emploi du temps** (Timetable + TimetableSlot) — Phase 6 (image 5 sidebar)
- **Bulletins PDF trimestriels** — Phase 6 (template + composition)
- **Mobile push notifications** — Phase 7
- **Discipline / sanctions** (DisciplinaryRecord enum existe déjà côté permissions) — Phase 6
- **Conseils de classe** (workflow + procès-verbaux) — Phase 6

### 2.6 Vision produit (rappel cahier des charges)

> Pilotage scolaire n'est PAS un cahier de notes numérique — c'est une plateforme **orientée décision** qui rend lisibles et actionnables : les notes, les progressions, les tendances, les évaluations à venir, les commentaires enseignants, les alertes explicables, et les recommandations.

Le redesign doit servir cette vision :
- **Lisibilité** : tout doit être scannable en 2 secondes (KPI + chart > tableau)
- **Explicabilité** : chaque alerte explique son « pourquoi »
- **Actionnabilité** : chaque insight propose une action concrète
- **Transparence** : audit visible, traçabilité des modifications

---

## 3. Plan fonctionnel par rôle

### 3.1 User stories — Administrateur

```
En tant qu'administrateur, je veux :
[Dashboard]
- voir d'un coup d'œil le nombre d'élèves / profs / classes / demandes / alertes
- voir l'évolution de ces KPIs (sparklines) pour repérer les tendances
- voir les demandes de rattachement et d'inscription en attente et les approuver
- voir la performance globale (taux de réussite) par cycle
- voir les règles d'alerte configurées et leur état (active/inactive)
- voir le journal d'audit récent
- accéder aux exports récents
[Gestion]
- créer / modifier / fermer des années scolaires
- créer / modifier la hiérarchie école → cycles → niveaux → classes
- créer / modifier les matières et les coefficients par niveau
- créer / modifier les enseignants et leurs affectations (Prof × Classe × Matière)
- créer / modifier les élèves et leurs inscriptions (élève × classe × année)
- valider les demandes de rattachement parents
- créer / publier des annonces ciblées
- configurer les règles d'alerte (LOW_SUBJECT_AVG, etc.)
- exporter des données (Excel/PDF) avec suivi async
- consulter le journal d'audit complet
- gérer les utilisateurs et leurs rôles
```

### 3.2 User stories — Professeur

```
En tant que professeur, je veux :
[Dashboard]
- voir mes classes affectées et le nombre d'élèves au total
- voir les évaluations planifiées dans les 30 jours
- savoir combien de notes sont à publier
- repérer les élèves à risque
- voir un sélecteur classe/matière pour zoomer
- voir les derniers résultats d'une éval
- voir les prochaines évaluations à droite (date cards)
- voir la perf de la classe en donut chart
- voir l'évolution de la moyenne en line chart
- voir la liste des élèves à suivre avec leur niveau de risque
[Quotidien]
- planifier une évaluation (date + matière + classe + type + max + coef)
- saisir les notes en grille (élève × évaluation)
- publier les notes (les rend visibles aux parents)
- modifier une note publiée (avec motif obligatoire — audit)
- noter le cahier de texte de la séance (markdown + devoirs)
- faire l'appel d'une séance (présent/absent/retard)
- écrire un commentaire élève (par évaluation ou trimestre)
- envoyer un message aux parents [Phase 6]
- consulter le calendrier annuel
- accéder aux documents pédagogiques de l'école
```

### 3.3 User stories — Parent

```
En tant que parent, je veux :
[Dashboard]
- voir la moyenne générale de mon enfant + son évolution
- voir une tendance globale (en progression / stable / en baisse)
- voir mes alertes actives (matières en difficulté)
- voir les examens à venir
- voir la progression par matière (barres + arrows)
- voir l'évolution de la moyenne sur 8 semaines / trimestre / semestre / année
- lire les commentaires enseignants récents
- voir des alertes EXPLICABLES (pas juste « note basse » mais « pourquoi » + « quoi faire »)
- recevoir des RECOMMANDATIONS pour aider mon enfant
- accéder à des ressources éducatives + conseils parents
- contacter l'établissement
[Détail]
- voir le profil de chaque enfant
- voir le détail des notes (avec barème, coef, commentaires prof)
- voir le cahier de texte (ce qui a été fait + devoirs à faire)
- voir le calendrier des évals
- voir les absences/présences de mon enfant
- voir les annonces de l'école et de la classe
- gérer mes notifications (email / push / web)
```

### 3.4 User stories — Super-admin (image 5)

```
En tant que super-administrateur (groupe scolaire) :
- voir le total élèves / classes / enseignants / établissements de tout le groupe
- voir les inscriptions récentes inter-établissements
- voir la capacité des classes (% occupation, donut)
- voir l'alerte « X classes en surcharge »
- voir les affectations enseignants à travers les établissements
- voir la répartition d'élèves par niveau
- créer / supprimer / archiver un établissement
- assigner un administrateur d'établissement
```

### 3.5 Pages cibles (matrice complète)

#### Admin (16 pages)
1. `/admin/dashboard` — refonte complète
2. `/admin/schools` — liste + détail (multi-école) ✓
3. `/admin/school/structure` — tree view ✓
4. `/admin/academic-years` ✓
5. `/admin/cycles` ✓
6. `/admin/subjects` (avec matrice coefficients)
7. `/admin/classes` + `/admin/classes/[id]` ✓
8. `/admin/teachers` + `/admin/teachers/[id]` (à compléter)
9. `/admin/teaching-assignments` ✓
10. `/admin/students` + `/admin/students/[id]` ✓
11. `/admin/guardians` + `/admin/guardians/[id]`
12. `/admin/enrollment-requests` ← NOUVEAU (demandes en attente)
13. `/admin/alerts` ← NOUVEAU (règles + instances)
14. `/admin/announcements` ✓
15. `/admin/calendar` ✓
16. `/admin/imports` ✓
17. `/admin/exports` ← NOUVEAU
18. `/admin/audit` (à refaire en timeline)
19. `/admin/users` + `/admin/users/invite` ✓
20. `/admin/roles` + `/admin/roles/new` + `/admin/roles/[id]/edit` ✓
21. `/admin/school/branding` ✓
22. `/admin/settings` ← NOUVEAU
23. `/admin/notifications` ← NOUVEAU

#### Teacher (12 pages)
1. `/teacher/dashboard` — refonte complète
2. `/teacher/classes` ← NOUVEAU (liste plate de mes classes)
3. `/teacher/classes/[id]` ✓ (hub)
4. `/teacher/classes/[id]/grades` ✓ (gradebook)
5. `/teacher/classes/[id]/lessons` ✓ (cahier de texte)
6. `/teacher/classes/[id]/attendance` ✓ (présences)
7. `/teacher/classes/[id]/students` ← NOUVEAU (roster détaillé)
8. `/teacher/classes/[id]/students/[studentId]` ← NOUVEAU
9. `/teacher/assessments` ← NOUVEAU (liste évals + planification)
10. `/teacher/grades/entry` ← NOUVEAU (saisie groupée plein écran)
11. `/teacher/calendar` ← NOUVEAU
12. `/teacher/documents` ← NOUVEAU
13. `/teacher/messages` ← NOUVEAU (Phase 6 stub)
14. `/teacher/alerts` ← NOUVEAU (élèves à risque)
15. `/teacher/settings` ← NOUVEAU

#### Parent (10 pages)
1. `/parent/dashboard` — refonte complète
2. `/parent/children` ← NOUVEAU (liste de mes enfants)
3. `/parent/children/[id]` ✓ (refonte avec onglets)
4. `/parent/children/[id]/grades` ← NOUVEAU (détail notes)
5. `/parent/children/[id]/lessons` ← NOUVEAU
6. `/parent/children/[id]/attendance` ← NOUVEAU
7. `/parent/grades` ✓ (toutes enfants confondues)
8. `/parent/calendar` ← NOUVEAU
9. `/parent/announcements` ✓
10. `/parent/alerts` ← NOUVEAU
11. `/parent/documents` ← NOUVEAU
12. `/parent/recommendations` ← NOUVEAU
13. `/parent/settings` ← NOUVEAU

#### Landing & shared (5 pages)
1. `/` — landing (image 4)
2. `/admin/login` ✓ · `/teacher/login` ✓ · `/parent/login` ✓
3. `/admin/register` ✓ · `/teacher/register` ✓ · `/parent/register` ✓
4. `/legal/privacy` ← NOUVEAU
5. `/legal/terms` ← NOUVEAU

### 3.6 Calculs dashboard (à formaliser)

| KPI | Formule | Filtre temps | Cache |
|---|---|---|---|
| Élèves totaux | `count(Student WHERE schoolId IN <scope> AND status='active')` | now | 1 min |
| Évolution Élèves | `current - count(...) at startOfMonth-1` | comparé au mois M-1 | 1 min |
| Sparkline Élèves | `count(... WHERE createdAt <= each_day)` sur 30j | 30 derniers jours | 5 min |
| Moyenne générale élève | `sum(grade.value × coef) / sum(coef) × 20/max` | trimestre actif | 1 min |
| Évolution moyenne | `current - average grade prior period` | 8 semaines | 5 min |
| Tendance | basée sur slope de régression sur 8 dernières évals publiées | 8 semaines | 5 min |
| Taux de réussite | `count(grade WHERE value >= 10/20) / count(grade)` × 100 | année active | 5 min |
| Taux de réussite par cycle | idem groupé par cycle | année active | 5 min |
| Capacité classes | `sum(activeEnrollments) / sum(maxStudents)` × 100 | snapshot | 1 min |
| Classes en surcharge | `count(class WHERE activeEnrollments > maxStudents)` | snapshot | 1 min |

### 3.7 Logique des alertes explicables

```typescript
interface AlertRule {
  id: string;
  code: 'LOW_SUBJECT_AVG' | 'NEGATIVE_TREND' | 'HIGH_ABSENCE' | 'BEHAVIOR_ALERT' | 'MISSING_HOMEWORK' | string;
  label: string;          // "Moyenne faible matière"
  condition: string;      // "Moyenne < 10/20" (humain) — règle JSON sous le capot
  severity: 'low' | 'medium' | 'high';
  active: boolean;
  scope: 'school' | 'subject' | 'class' | 'student';
  explanationTemplate: string; // "La moyenne en {{subject}} est passée sous {{threshold}}/20."
  recommendationTemplate: string; // "Un soutien ciblé en {{subject}} peut l'aider à progresser."
  actionsTemplates: Array<{ label: string; targetUrl: string }>;
}

interface AlertInstance {
  id: string;
  ruleId: string;
  subjectStudentId: string;
  triggeredAt: DateTime;
  resolvedAt?: DateTime;
  status: 'open' | 'acknowledged' | 'resolved';
  context: Json;           // {subject:"Maths", currentAvg:8.2, threshold:10}
  explanationCached: string;
  recommendationCached: string;
}
```

Évaluation périodique (cron 15 min ou trigger sur publication de note) — voir Phase implementation.

---

## 4. Plan du design system

### 4.1 Design tokens (`packages/design-tokens`)

```css
:root {
  /* === Surfaces === */
  --surface-page: oklch(0.97 0.005 250);     /* page bg */
  --surface-card: oklch(1 0 0);              /* card bg */
  --surface-sidebar: oklch(0.20 0.06 250);   /* dark navy */
  --surface-sidebar-active: oklch(0.27 0.08 250); /* hover/active row */
  --surface-tonal-blue: oklch(0.94 0.05 250);
  --surface-tonal-green: oklch(0.94 0.05 160);
  --surface-tonal-amber: oklch(0.95 0.07 75);
  --surface-tonal-red: oklch(0.94 0.05 25);
  --surface-tonal-purple: oklch(0.94 0.05 295);

  /* === Ink === */
  --ink-strong: oklch(0.18 0.03 250);
  --ink-default: oklch(0.30 0.03 250);
  --ink-muted: oklch(0.50 0.02 250);
  --ink-faint: oklch(0.70 0.02 250);
  --ink-on-sidebar: oklch(0.95 0.01 250);
  --ink-on-sidebar-muted: oklch(0.65 0.02 250);

  /* === Brand × Portal === */
  --admin-500: oklch(0.55 0.20 260);   /* indigo-blue */
  --admin-600: oklch(0.48 0.22 260);
  --teacher-500: oklch(0.62 0.15 165); /* teal */
  --teacher-600: oklch(0.55 0.17 165);
  --parent-500: oklch(0.60 0.16 240);  /* sky */
  --parent-600: oklch(0.52 0.18 240);
  --accent-active: var(--admin-500);   /* swapped via [data-portal] */

  /* === Semantic === */
  --success-50/100/500/700: ...
  --warning-50/100/500/700: ...
  --danger-50/100/500/700: ...
  --info-50/100/500/700: ...

  /* === Radii === */
  --r-sm: 0.5rem;
  --r: 0.75rem;
  --r-lg: 1rem;
  --r-xl: 1.25rem;
  --r-2xl: 1.5rem;
  --r-pill: 9999px;

  /* === Shadows === */
  --elev-1: 0 1px 2px oklch(0.20 0.02 250 / 0.06);
  --elev-2: 0 1px 2px oklch(0.20 0.02 250 / 0.05), 0 8px 24px oklch(0.20 0.02 250 / 0.06);
  --elev-3: 0 4px 8px oklch(0.20 0.02 250 / 0.06), 0 24px 48px oklch(0.20 0.02 250 / 0.12);

  /* === Motion === */
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --motion-slow: 280ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* === Spacing === */
  --space-2xs: 0.25rem; /* 4 */
  --space-xs: 0.5rem;   /* 8 */
  --space-sm: 0.75rem;  /* 12 */
  --space-md: 1rem;     /* 16 */
  --space-lg: 1.5rem;   /* 24 */
  --space-xl: 2rem;     /* 32 */
  --space-2xl: 3rem;    /* 48 */

  /* === Type === */
  --font-sans: 'Inter', ...;
  --font-mono: 'JetBrains Mono', ...;
  --fz-2xs: 0.6875rem;  /* 11 */
  --fz-xs: 0.75rem;     /* 12 */
  --fz-sm: 0.8125rem;   /* 13 */
  --fz-base: 0.875rem;  /* 14 */
  --fz-md: 1rem;        /* 16 */
  --fz-lg: 1.125rem;    /* 18 */
  --fz-xl: 1.5rem;      /* 24 */
  --fz-2xl: 1.75rem;    /* 28 — KPI numbers */
  --fz-3xl: 2.25rem;    /* 36 — section heroes */
}

[data-portal="teacher"]  { --accent-active: var(--teacher-500); }
[data-portal="parent"]   { --accent-active: var(--parent-500); }
```

### 4.2 Composants UI (`packages/ui`)

À étendre depuis l'existant (Badge / Button / Card / Input / Label). Ajouter :

| Composant | Variantes | Notes |
|---|---|---|
| `<AppShell>` | admin / teacher / parent / super-admin | Sidebar + topbar |
| `<Sidebar>` | rich (full) / compact (icons only) | Drawer mobile |
| `<SidebarItem>` | default / active / disabled, optional `badge` | |
| `<Topbar>` | with breadcrumbs / actions / year selector / bell / user |  |
| `<KpiCard>` | with icon + value + delta + sparkline | sparkline optional |
| `<Sparkline>` | line / area, mono color | SVG, no deps |
| `<DonutChart>` | with center label + side legend | based on recharts |
| `<LineChart>` | with target line + annotated points | recharts |
| `<BarChart>` | vertical / horizontal | recharts |
| `<ProgressBar>` | mono / segmented | for capacity, marks |
| `<DataTable>` | columns config + sortable + paginated | server-side or client |
| `<EmptyState>` | with icon + title + cta | |
| `<LoadingState>` | skeleton variants | shimmer |
| `<ErrorState>` | with retry button | |
| `<StatusBadge>` | 12 tones (status mapping table) | |
| `<Avatar>` | initials / photo / fallback gradient | 24/32/40/64 sizes |
| `<AvatarGroup>` | stacked with overflow `+N` | |
| `<DateCard>` | for "Prochaines évaluations" | jour court / numéro / mois |
| `<Modal>` | size: sm/md/lg/xl, with footer slot | already exists |
| `<Toast>` | success/error/info/warning | already exists |
| `<Tabs>` | underline / pill variants | |
| `<Select>` / `<Combobox>` | searchable | |
| `<DatePicker>` | single / range | native fallback |
| `<TimePicker>` | for séance opening | |
| `<RichText>` | markdown render | for lessons |
| `<AnnouncementCard>` | with scope chip + priority tone | |
| `<AlertCard>` | explainable (icon + title + desc + action link) | |
| `<RecommendationCard>` | with cta chevron | |
| `<CommentCard>` | avatar + name + role + comment + timestamp | |
| `<Timeline>` | vertical with bullets | for audit |
| `<YearSelector>` | dropdown of academic years | top-right |
| `<PortalSwitcher>` | when user has multi-role | |
| `<NotificationBell>` | with badge count + dropdown panel | |
| `<UserMenu>` | dropdown with profile / settings / logout | already exists |
| `<SubjectKpiCard>` | **NOUVEAU image 6** — gradient subject-coloured, icône blanche, stats, lien drill | Utilise `subjectColor()` helper §1.8 |
| `<EditableGradeTable>` | **NOUVEAU image 6** — gradebook inline avec pills colorées tonales par bucket | Auto-save ou batch via bouton ; supports keyboard tab nav |
| `<GradePill>` | **NOUVEAU image 6** — pill ronde avec couleur tonale selon score (16-20 / 10-15 / 0-9) | Variantes : `readonly` / `editable` (input au clic) |
| `<SubjectPerfCard>` | **NOUVEAU image 7** — icône subject + grade + badge + progress bar + 4 metric rows | Pour grilles 4-col parent |
| `<ChildProfileHero>` | **NOUVEAU image 7** — photo + nom + meta + 4 chips info | Hero card parent uniquement |
| `<MiniCalendar>` | **NOUVEAU images 6, 7** — grille mois + dots colorés + jours sélectionnés cerclés | Compatible drill-down vers vue agenda |
| `<CommentsFeed>` | **NOUVEAU image 7** — fil chronologique avatar + nom + rôle + commentaire + date | Variants : `compact` / `full` |
| `<TipOfTheDayCard>` | **NOUVEAU image 6** — étoile + titre + corps + progress 2/5 sticky bottom sidebar | Sidebar prof/admin |
| `<HelpSidebarCard>` | **NOUVEAU image 7** — casque + texte + bouton "Centre d'aide" sticky bottom sidebar | Sidebar parent |
| `<QuickActionsList>` | **NOUVEAU image 6** — liste verticale icône + label, lien "Voir tous" en bas | Outils rapides teacher dashboard |
| `<ActivityTimeline>` | **NOUVEAU image 6** — feed activité récente version courte (point bleu + titre + date relative) | Différent de `<Timeline>` audit (plus dense) |
| `<DonutWithLegendSide>` | **NOUVEAU image 6** — donut + légende latérale verticale avec % + nombres | Variante de `<DonutChart>` |
| `<Stats2x2Grid>` | **NOUVEAU image 6** — 4 KPI compacts en grid 2×2 avec chiffres colorés sémantiques | Bloc latéral récurrent |
| `<GroupedBarChart>` | **NOUVEAU image 7** — barres groupées multi-séries avec valeurs annotées | Recharts BarChart customisé |

### 4.3 Patterns réutilisables

```tsx
// Pattern: KPI strip neutre (admin)
<KpiStrip>
  <KpiCard icon={<Users />} tone="blue" label="Élèves" value={2458} delta={+4.8} trend={sparklineData}/>
  <KpiCard icon={<GraduationCap />} tone="green" label="Professeurs" value={186} delta={+2.1} trend={...}/>
</KpiStrip>

// Pattern: KPI strip subject-coloured (teacher) — image 6
<KpiStrip>
  <SubjectKpiCard subjectCode="MATH" label="Mathématiques" classCount={3} studentCount={86} href="/teacher/classes?subject=MATH"/>
  <SubjectKpiCard subjectCode="HIST_GEO" label="Histoire-Géographie" classCount={2} studentCount={54}/>
  <SubjectKpiCard subjectCode="PHYS_CHIM" label="Physique-Chimie" classCount={2} studentCount={88}/>
  <SubjectKpiCard subjectCode="FR" label="Français" classCount={2} studentCount={28}/>
</KpiStrip>

// Pattern: Section header
<SectionHeader title="Affectations professeurs" actionLabel="Voir toutes" actionHref="..."/>

// Pattern: Editable gradebook — image 6
<Card>
  <CardHeader title="Saisie des notes – 2nde A" action={<><SubjectSelect/><Button variant="primary">Enregistrer</Button></>}/>
  <EditableGradeTable
    assessments={[{id:'1', name:'Devoir 1', max:20}, ...]}
    students={[{id:'a', firstName:'Aïssa', lastName:'Diallo'}, ...]}
    grades={[{studentId:'a', assessmentId:'1', value:16}, ...]}
    onSave={async (changes) => { await saveGrades(changes); }}
    showClassAverageRow
  />
  <GradeBucketLegend/>
</Card>

// Pattern: Profile hero — image 7
<ChildProfileHero
  photo="/uploads/lucas.jpg"
  firstName="Lucas" lastName="Dubois"
  classLabel="Classe de 5ème A" schoolLabel="Collège Victor Hugo"
  meta={[
    {label:'Âge', value:'12 ans'},
    {label:'Né(e) le', value:'15/03/2012'},
    {label:'Identifiant', value:'LD12345'},
    {label:'Rang de la classe', value:'7 / 28'},
  ]}
/>

// Pattern: Subject performance grid — image 7
<Grid cols={4}>
  {subjects.map(s => (
    <SubjectPerfCard
      key={s.id}
      subjectCode={s.code}
      grade={18.2} max={20} badge="Excellent"
      progressValue={91}
      metrics={[
        {label:'Classement de la classe', value:'3 / 28'},
        {label:'Moyenne de la classe', value:'14,3 / 20'},
        {label:'Progression', value:'+2,1 pts', trend:'up'},
        {label:'Coefficient', value:'4'},
      ]}
    />
  ))}
</Grid>

// Pattern: Mini calendar with subject dots — images 6, 7
<MiniCalendar
  month={new Date('2025-05-01')}
  selected={[7, 14, 22]}
  events={[
    {day:7, color:'oklch(0.55 0.20 280)', subjectCode:'MATH'},
    {day:14, color:'oklch(0.62 0.15 240)', subjectCode:'HIST_GEO'},
  ]}
  legend={[{label:'Évaluation prévue', color:'violet'}]}
  onSelectDay={(d) => router.push(`/teacher/calendar?date=${d}`)}
/>

// Pattern: Comments feed — image 7
<CommentsFeed
  items={[
    {id:1, author:{firstName:'M.', lastName:'Bernard', avatar:'...'}, role:'Professeur de Mathématiques', body:'Lucas est un élève très sérieux...', date:'2025-05-28'},
    ...
  ]}
  showSeeAll href="/parent/children/lucas/comments"
/>
```

### 4.4 Règles d'accessibilité

- Contraste ≥ 4.5:1 partout (texte sur fond)
- Focus visible (`outline: 2px solid var(--focus-ring)` + offset 2px)
- Labels explicites sur tous les inputs
- ARIA roles sur les composants composites (`role="dialog"`, `aria-modal`, `role="tablist"`, etc.)
- Touche échap pour fermer modals/drawers
- Tab order logique
- Annonces SR pour les notifications/toasts
- Indication visuelle des erreurs de formulaire + texte explicite
- Touch targets ≥ 44×44 px sur mobile

---

## 5. Revue d'architecture

### 5.1 État actuel

**Frontend** (Next.js 15 + React 19 + Tailwind v4 + NextAuth v5)
- ✓ App Router avec server components
- ✓ Middleware d'auth en place
- ✓ Server actions pour les mutations
- ✓ NextAuth avec Keycloak + credentials providers
- ⚠ Components dispersés (apps/web/src/components + packages/ui partiellement utilisé)
- ⚠ Pas de chart lib installée (besoin de recharts ou équivalent)
- ⚠ Pas de framer-motion (utile pour animations modals)
- ⚠ Pas de date-fns (pour formatage cohérent — utilisé actuellement Intl.DateTimeFormat natif)
- ⚠ Pas de tests E2E (Playwright à installer)

**Backend** (NestJS 11 + Prisma 5 + PostgreSQL 15 + Redis + Keycloak)
- ✓ Modular monolith bien structuré (14 modules)
- ✓ Multi-tenant + multi-école via SchoolContextService
- ✓ ABAC en place dans Grades / Students / Lessons / Announcements
- ✓ Auth Keycloak via JWT + passport-jwt
- ✓ Audit logging sur opérations sensibles
- ⚠ Pas de jobs async actifs (BullMQ installé mais pas utilisé)
- ⚠ Pas de queue pour les analytics / alerts
- ⚠ Pas de WebSocket pour notifications temps réel

**Base de données**
- ✓ 34 modèles Prisma cohérents
- ✓ Indexes en place sur les FKs et lookups fréquents
- ✓ Soft delete pattern via status enums
- ⚠ Pas de RLS Postgres (multi-tenant fait côté applicatif uniquement)
- ⚠ Pas de partitionnement pour grades/attendance (acceptable pour MVP)

### 5.2 Recommandations

**Verdict** : architecture actuelle solide. **À refactorer dans la continuité** plutôt qu'à réécrire.

Ajouts ciblés à faire :

1. **Frontend** :
   - Installer `recharts` (10 KB gzip, suffisant pour nos charts)
   - Installer `date-fns` (formatage cohérent fr-FR)
   - Installer `@tanstack/react-query` (SWR-style cache côté client pour interactions) — optionnel
   - Optionnel : `framer-motion` si on veut des animations spring (sinon Tailwind transitions suffisent)
   - **Standardiser sur packages/ui** : déplacer tous les composants nouveaux dans `packages/ui/src/components` au lieu de `apps/web/src/components`
   - Installer **Playwright** pour tests E2E

2. **Backend** :
   - Activer **BullMQ worker** pour : recalcul analytics, génération exports PDF/XLSX, déclenchement alertes
   - Nouveau module `analytics` : agrégations + caching Redis
   - Nouveau module `alerts` : moteur de règles + instances
   - Nouveau module `recommendations` : génération contextuelle
   - Nouveau module `notifications` : Notification + NotificationDelivery
   - Nouveau module `exports` : ExportJob CRUD + worker

3. **Base de données** : ajouts via migrations (pas de breaking) — voir §6.

### 5.3 Décisions techniques

| Choix | Décision | Justification |
|---|---|---|
| Chart lib | **recharts** | léger, React-first, déclaratif, communauté, suffisant pour nos types de charts |
| Date lib | **date-fns** + `date-fns/locale/fr` | tree-shakeable, immutable, locale fr-FR |
| State client | **server components + server actions** (gardé) ; React Query si besoin spécifique d'interactivité riche | minimise le JS |
| Animations | **Tailwind transitions + CSS keyframes** d'abord, framer-motion seulement si besoin avéré | évite poids |
| Tests E2E | **Playwright** | meilleur DX, déjà utilisé dans nos sessions |
| Tests unitaires | **Jest** (déjà installé côté API) ; **Vitest** pour les services pure côté web | rapide |
| Exports PDF | **@react-pdf/renderer** dans worker BullMQ | maîtrise du rendu |
| Exports XLSX | **exceljs** dans worker BullMQ | flexible, supporte les styles |
| Notifications temps réel | **polling** dans MVP (`/notifications/unread-count` toutes les 30 s) ; SSE/WebSocket Phase 7 | simple, suffisant |

---

## 6. Plan base de données & API

### 6.1 Migrations nécessaires

#### a) AlertRule + AlertInstance

```prisma
enum AlertRuleCode {
  LOW_SUBJECT_AVG
  NEGATIVE_TREND
  HIGH_ABSENCE
  BEHAVIOR_ALERT
  MISSING_HOMEWORK
  IMPROVEMENT          // alerte positive
  custom
}

enum AlertSeverity { low medium high critical }
enum AlertStatus   { open acknowledged resolved dismissed }

model AlertRule {
  id           String        @id @default(uuid()) @db.Uuid
  tenantId     String        @map("tenant_id") @db.Uuid
  schoolId     String        @map("school_id") @db.Uuid
  code         AlertRuleCode
  customCode   String?       @map("custom_code")
  label        String
  conditionLabel String      @map("condition_label")     // "Moyenne < 10/20"
  conditionJson Json         @map("condition_json")      // {metric:"subject_avg", op:"<", value:10}
  severity     AlertSeverity @default(medium)
  active       Boolean       @default(true)
  scope        String        // "student" | "class" | "school"
  explanationTemplate    String @map("explanation_template")
  recommendationTemplate String @map("recommendation_template")
  actionsTemplate        Json   @default("[]") @map("actions_template")
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  instances AlertInstance[]
  school    School @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([tenantId, schoolId, active])
}

model AlertInstance {
  id              String        @id @default(uuid()) @db.Uuid
  tenantId        String        @map("tenant_id") @db.Uuid
  ruleId          String        @map("rule_id") @db.Uuid
  studentId       String?       @map("student_id") @db.Uuid
  classSectionId  String?       @map("class_section_id") @db.Uuid
  subjectId       String?       @map("subject_id") @db.Uuid
  triggeredAt     DateTime      @default(now()) @map("triggered_at") @db.Timestamptz(6)
  resolvedAt      DateTime?     @map("resolved_at") @db.Timestamptz(6)
  acknowledgedAt  DateTime?     @map("acknowledged_at") @db.Timestamptz(6)
  status          AlertStatus   @default(open)
  context         Json          // {subject:"Maths", currentAvg:8.2, threshold:10}
  explanation     String        @db.Text
  recommendation  String        @db.Text
  actions         Json          @default("[]")

  rule    AlertRule    @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  student Student?     @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, triggeredAt])
  @@index([studentId, status])
}
```

#### b) Recommendation

```prisma
model Recommendation {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  studentId       String   @map("student_id") @db.Uuid
  title           String
  description     String   @db.Text
  category        String   // "homework_help" | "tutoring" | "library" | "communication"
  icon            String?
  actionLabel     String?  @map("action_label")
  actionUrl       String?  @map("action_url")
  generatedFromAlertId String? @map("generated_from_alert_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  dismissedAt     DateTime? @map("dismissed_at") @db.Timestamptz(6)

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([tenantId, studentId, createdAt])
}
```

#### c) Notification + Delivery

```prisma
enum NotificationKind {
  grade_published
  alert_triggered
  announcement_published
  lesson_published
  attendance_recorded
  enrollment_request
  homework_due
  custom
}

model Notification {
  id            String           @id @default(uuid()) @db.Uuid
  tenantId      String           @map("tenant_id") @db.Uuid
  userProfileId String           @map("user_profile_id") @db.Uuid
  kind          NotificationKind
  title         String
  body          String           @db.Text
  payload       Json             @default("{}")
  link          String?
  readAt        DateTime?        @map("read_at") @db.Timestamptz(6)
  createdAt     DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([userProfileId, readAt])
  @@index([tenantId, createdAt])
}
```

#### d) ExportJob

```prisma
enum ExportKind { grades_xlsx report_card_pdf enrollment_xlsx attendance_xlsx audit_csv }
enum ExportStatus { pending running succeeded failed }

model ExportJob {
  id              String        @id @default(uuid()) @db.Uuid
  tenantId        String        @map("tenant_id") @db.Uuid
  requestedBy     String        @map("requested_by") @db.Uuid
  kind            ExportKind
  parameters      Json          @default("{}")
  status          ExportStatus  @default(pending)
  fileName        String?       @map("file_name")
  fileUrl         String?       @map("file_url")
  fileSizeBytes   Int?          @map("file_size_bytes")
  errorMessage    String?       @map("error_message")
  startedAt       DateTime?     @map("started_at") @db.Timestamptz(6)
  finishedAt      DateTime?     @map("finished_at") @db.Timestamptz(6)
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, status, createdAt])
}
```

#### e) EnrollmentRequest

Séparer la demande d'inscription (en attente d'approbation) de l'inscription effective.

```prisma
enum EnrollmentRequestStatus { pending approved rejected withdrawn }

model EnrollmentRequest {
  id              String                 @id @default(uuid()) @db.Uuid
  tenantId        String                 @map("tenant_id") @db.Uuid
  schoolId        String                 @map("school_id") @db.Uuid
  studentId       String                 @map("student_id") @db.Uuid
  requestedClassSectionId String?        @map("requested_class_section_id") @db.Uuid
  requestedGradeLevelId   String?        @map("requested_grade_level_id") @db.Uuid
  academicYearId  String                 @map("academic_year_id") @db.Uuid
  requestedBy     String                 @map("requested_by") @db.Uuid  // guardian's user profile
  status          EnrollmentRequestStatus @default(pending)
  reason          String?
  decisionBy      String?                @map("decision_by") @db.Uuid
  decisionAt      DateTime?              @map("decision_at") @db.Timestamptz(6)
  decisionReason  String?                @map("decision_reason")
  createdEnrollmentId String?            @map("created_enrollment_id") @db.Uuid
  createdAt       DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime               @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, schoolId, status])
}
```

#### f) TeacherComment (commentaire structuré)

```prisma
enum TeacherCommentScope { trimester semester annual general }

model TeacherComment {
  id                String              @id @default(uuid()) @db.Uuid
  tenantId          String              @map("tenant_id") @db.Uuid
  teacherProfileId  String              @map("teacher_profile_id") @db.Uuid
  studentId         String              @map("student_id") @db.Uuid
  classSectionId    String              @map("class_section_id") @db.Uuid
  subjectId         String?             @map("subject_id") @db.Uuid
  termId            String?             @map("term_id") @db.Uuid
  scope             TeacherCommentScope
  body              String              @db.Text
  isPublished       Boolean             @default(false) @map("is_published")
  publishedAt       DateTime?           @map("published_at") @db.Timestamptz(6)
  createdAt         DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([studentId, isPublished])
  @@index([termId])
}
```

#### g) Document (bibliothèque)

```prisma
enum DocumentScope { school class student private }

model Document {
  id              String        @id @default(uuid()) @db.Uuid
  tenantId        String        @map("tenant_id") @db.Uuid
  schoolId        String        @map("school_id") @db.Uuid
  uploadedBy      String        @map("uploaded_by") @db.Uuid
  scope           DocumentScope
  classSectionId  String?       @map("class_section_id") @db.Uuid
  studentId       String?       @map("student_id") @db.Uuid
  title           String
  description     String?
  category        String?       // "rules", "schedule", "course", "homework", "form"
  fileName        String        @map("file_name")
  fileUrl         String        @map("file_url")
  fileSizeBytes   Int           @map("file_size_bytes")
  mimeType        String        @map("mime_type")
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, schoolId, scope])
  @@index([classSectionId])
}
```

#### h) TipOfTheDay + TipDelivery (image 6 sidebar)

Pour alimenter la carte "Conseil du jour" en bas de la sidebar Teacher (et "Besoin d'aide" Parent peut référencer le même mécanisme avec un autre `audience`).

```prisma
enum TipAudience  { teacher parent admin all }
enum TipCategory  { pedagogy organization wellbeing communication legal }

model TipOfTheDay {
  id              String       @id @default(uuid()) @db.Uuid
  tenantId        String?      @map("tenant_id") @db.Uuid     // null = global (Anthropic-curated)
  audience        TipAudience
  category        TipCategory
  title           String
  body            String       @db.Text
  ctaLabel        String?      @map("cta_label")
  ctaUrl          String?      @map("cta_url")
  active          Boolean      @default(true)
  startDate       DateTime?    @map("start_date") @db.Date
  endDate         DateTime?    @map("end_date") @db.Date
  order           Int          @default(0)
  createdAt       DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)

  deliveries TipDelivery[]

  @@index([tenantId, audience, active])
}

model TipDelivery {
  id            String   @id @default(uuid()) @db.Uuid
  tipId         String   @map("tip_id") @db.Uuid
  userProfileId String   @map("user_profile_id") @db.Uuid
  seenAt        DateTime @default(now()) @map("seen_at") @db.Timestamptz(6)
  dismissedAt   DateTime? @map("dismissed_at") @db.Timestamptz(6)

  tip TipOfTheDay @relation(fields: [tipId], references: [id], onDelete: Cascade)

  @@unique([tipId, userProfileId])
  @@index([userProfileId, seenAt])
}
```

**Logique sélection** : la carte sidebar interroge `GET /api/v1/tips/of-the-day?audience=teacher` → retourne le 1er tip actif jamais vu par l'utilisateur, classé par `order` puis date. Affiche progression `2/5` = `count(TipDelivery WHERE user=me)` / `count(TipOfTheDay WHERE active AND audience=me.role)`.

#### i) Indexes additionnels

```sql
-- Pour les agrégations dashboard
CREATE INDEX grade_published_by_subject_idx ON grade (subject_id, status, published_at) WHERE status IN ('published','revised');
CREATE INDEX student_school_active_idx ON student (school_id, status) WHERE status='active';
CREATE INDEX enrollment_active_year_idx ON enrollment (academic_year_id, status) WHERE status='active';

-- Pour les sparklines (création par jour)
CREATE INDEX student_created_at_idx ON student (school_id, created_at);
CREATE INDEX enrollment_created_at_idx ON enrollment (academic_year_id, created_at);
```

### 6.2 Nouveaux endpoints API

#### Analytics module
```
GET /api/v1/analytics/dashboard                      → KPIs admin (5 cards + sparklines)
GET /api/v1/analytics/teacher-dashboard              → KPIs prof
GET /api/v1/analytics/parent-dashboard?studentId=    → KPIs parent par enfant
GET /api/v1/analytics/school-performance             → donut taux réussite par cycle
GET /api/v1/analytics/class-distribution?classId=    → distribution buckets (Très bien…)
GET /api/v1/analytics/student-evolution?studentId=&granularity=week|month → série temporelle
GET /api/v1/analytics/level-headcount                → bar chart par niveau
GET /api/v1/analytics/class-capacity                 → donut % occupation
GET /api/v1/analytics/kpi-trend?metric=X&window=30d  → sparkline data
```

#### Alerts module
```
GET  /api/v1/alert-rules                             → liste règles
POST /api/v1/alert-rules                             → créer
PATCH /api/v1/alert-rules/:id                        → modifier (active, severity, etc)
DELETE /api/v1/alert-rules/:id

GET  /api/v1/alerts                                  → instances (filtres status/severity/studentId)
GET  /api/v1/alerts/:id                              → détail avec explication + recommandations
POST /api/v1/alerts/:id/acknowledge
POST /api/v1/alerts/:id/resolve
POST /api/v1/alerts/recompute                        → trigger manuel (admin)
GET  /api/v1/alerts/students/:id/active              → alertes actives d'un élève (parent view)
```

#### Recommendations
```
GET  /api/v1/recommendations/students/:id            → liste actives
POST /api/v1/recommendations/:id/dismiss             → masquer
```

#### Notifications
```
GET  /api/v1/notifications?unreadOnly=true           → liste
GET  /api/v1/notifications/unread-count              → polling
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/read-all
```

#### Exports
```
POST /api/v1/exports                                 → créer job
GET  /api/v1/exports                                 → liste mes exports (status + download link)
GET  /api/v1/exports/:id                             → polling state
GET  /api/v1/exports/:id/download                    → signed URL → MinIO
DELETE /api/v1/exports/:id                           → cleanup
```

#### Enrollment requests
```
GET   /api/v1/enrollment-requests?status=pending     → demandes (admin)
POST  /api/v1/enrollment-requests                    → créer (parent)
POST  /api/v1/enrollment-requests/:id/approve        → admin valide → crée Enrollment
POST  /api/v1/enrollment-requests/:id/reject         → admin rejette avec motif
POST  /api/v1/enrollment-requests/:id/withdraw       → parent annule
```

#### Teacher comments
```
GET   /api/v1/teacher-comments?studentId=...&termId=...
POST  /api/v1/teacher-comments
PATCH /api/v1/teacher-comments/:id
POST  /api/v1/teacher-comments/:id/publish
DELETE /api/v1/teacher-comments/:id
```

#### Documents
```
GET   /api/v1/documents?scope=class&classSectionId=...
POST  /api/v1/documents                              → multipart upload
DELETE /api/v1/documents/:id
GET   /api/v1/documents/:id/download                 → signed URL
```

#### Analytics par matière (image 6 + 7) — NOUVEAU
```
GET /api/v1/analytics/teacher/subject-stats          → 4 cartes subject KPI (classes, élèves par matière du prof)
GET /api/v1/analytics/students/:id/subject-perf      → 4 SubjectPerfCards (grade, badge, classement, moy classe, progression, coef)
GET /api/v1/analytics/students/:id/term-evolution    → line chart (1er trim / 2e trim / 1er sem / 3e trim / Année) avec moyenne classe
GET /api/v1/analytics/students/:id/subject-evolution → bar chart groupé subject × trimester
GET /api/v1/analytics/classes/:id/grade-distribution → donut 3 buckets (Excellent / Satisfaisant / Insuffisant) + counts
GET /api/v1/analytics/classes/:id/class-stats        → 2×2 grid (moyenne / meilleure / pire / taux réussite)
```

#### Gradebook inline save (image 6) — NOUVEAU
```
POST /api/v1/gradebook/inline-save                   → batch save grades for a class+subject ; payload { teachingAssignmentId, assessmentId, grades:[{studentId, value, isAbsent}] } ; idempotent
GET  /api/v1/gradebook/teaching-assignments/:id/quick-entry → retourne matrice élèves × 4 dernières évals pour saisie inline
```

#### Quick actions, Outils rapides (image 6) — NOUVEAU
```
GET /api/v1/teacher/quick-actions                    → liste configurable (Créer éval, Importer notes, Générer rapport, Envoyer message...)
```

#### Tips of the day (images 6, 7) — NOUVEAU
```
GET    /api/v1/tips/of-the-day                       → 1 tip actif jamais vu par l'utilisateur, avec compteur progression
POST   /api/v1/tips/:id/seen                         → marque tip comme vu (crée TipDelivery)
POST   /api/v1/tips/:id/dismiss                      → masque définitivement pour cet utilisateur

# Admin (CRUD tips)
GET    /api/v1/admin/tips                            → liste tous les tips (avec filtre audience/category/active)
POST   /api/v1/admin/tips                            → créer
PATCH  /api/v1/admin/tips/:id                        → modifier
DELETE /api/v1/admin/tips/:id                        → supprimer
```

#### Recent activity feed (image 6) — NOUVEAU
```
GET /api/v1/activity-feed/me?limit=10                → fil d'activité user-centric (basé sur AuditLog filtré par actor=me)
```

### 6.3 Contrats de réponse type

```typescript
// Sparkline data
interface SparklinePoint { x: string /* ISO date */; y: number; }

// KPI card
interface KpiData {
  label: string;
  value: number;
  formatted: string;        // "2 458"
  delta?: { value: number; period: 'day'|'week'|'month'; sign: '+'|'-'|'='; };
  trend?: SparklinePoint[]; // 30 points typically
}

// Dashboard admin
interface AdminDashboardResponse {
  kpis: {
    students: KpiData;
    teachers: KpiData;
    classes: KpiData;
    pendingRequests: KpiData;
    activeAlerts: KpiData;
  };
  schoolStructure: { years: number; levels: number; classes: number; subjects: number; };
  pendingRequests: EnrollmentRequestSummary[];
  teachingAssignmentsSummary: TeachingAssignmentSummary[];
  performance: { overall: number; byCycle: Array<{ cycleName: string; rate: number; }>; };
  alertRules: AlertRuleSummary[];
  recentAudit: AuditEntry[];
  recentExports: ExportJobSummary[];
}
```

### 6.4 Stratégie de cache & recalcul

| Donnée | Strategie | TTL | Invalidation |
|---|---|---|---|
| KPI counts | Redis cache | 60 s | sur create/delete des entités sources |
| KPI sparklines | Redis cache | 5 min | sur changement seul des 24 h |
| Performance par cycle | Redis cache | 5 min | sur publish/revise grade |
| Élève évolution moyenne | Redis cache par studentId | 5 min | sur publish/revise grade |
| Alertes recalcul | Cron BullMQ 15 min + trigger sur publish | — | — |
| Notifications | DB + index | — | — |
| Exports | Worker async | — | — |

---

## 7. Roadmap d'implémentation

### Phase R0 — Audit & fondations (1-2 j)
**Objectif** : préparer le terrain sans casser l'existant.
- Installer `recharts`, `date-fns`, `@react-pdf/renderer`, `exceljs`, `@playwright/test`
- Tests E2E baseline : login admin / login teacher / login parent (smoke)
- Documentation `/docs/spec/REDESIGN-PLAN.md` (ce document) versionnée

**Acceptance** :
- `pnpm install` propre
- `pnpm playwright test --grep "smoke"` passe sur 3 logins
- Typecheck web + API propre

### Phase R1 — Design system (3-4 j)
**Objectif** : tokens + composants UI réutilisables.
- Refonte `packages/design-tokens/src/tokens.css` avec spec §4.1
- `packages/ui/src/components/` :
  - `AppShell`, `Sidebar`, `SidebarItem`, `Topbar`, `YearSelector`, `NotificationBell`, `UserMenu`
  - `KpiCard`, `Sparkline`, `DonutChart`, `LineChart`, `BarChart`, `ProgressBar`
  - `DataTable`, `EmptyState`, `LoadingState`, `ErrorState`
  - `StatusBadge`, `Avatar`, `AvatarGroup`, `DateCard`
  - `Tabs`, `Select`, `Combobox`, `DatePicker`, `RichText`
  - `AnnouncementCard`, `AlertCard`, `RecommendationCard`, `CommentCard`, `Timeline`
- Storybook-lite : page `/dev/components` listant tous les variants (dev only)

**Acceptance** :
- Tous composants ont 1+ exemple visible sur `/dev/components`
- Variants admin/teacher/parent fonctionnels
- Tests d'accessibilité axe-core sur la palette de composants
- Typecheck propre

**Risques** :
- recharts ne s'intègre pas bien avec server components → besoin de wrappers `'use client'`. Mitigation : wrapper systématique dans `<ClientChart>`.

### Phase R2 — App Shell unifié + Landing (2 j)
**Objectif** : nouvelle coquille (sidebar + topbar) + landing page refondu.
- `AppShell` server component qui résout session + branding + me + portal
- Sidebar collapse persisté en localStorage + drawer mobile
- Top bar avec YearSelector + NotificationBell + UserMenu
- Landing page rebuild conforme image 4
- Pages login/register : restyler sans changer la logique

**Acceptance** :
- Refresh `/admin/dashboard`, `/teacher/dashboard`, `/parent/dashboard` montre sidebar
- Cookie `sidebar:collapsed` fonctionne
- Mobile <640 px : drawer s'ouvre via burger
- Landing page conforme à image 4 (tests visuels)

**Risques** :
- Le PortalShell existant est utilisé par 40+ pages → on garde une alias temporaire pour migration progressive.

### Phase R3 — Admin Portal (3-4 j)
**Objectif** : dashboard + pages clés admin conformes image 1.
- Backend : `analytics.controller.ts` avec endpoints du §6.2
- `/admin/dashboard` complet : 5 KPI cards + sparklines + 4 sections + timeline + exports
- `/admin/enrollment-requests` (nouveau)
- `/admin/alerts` (règles + instances)
- `/admin/audit` redesign en timeline
- `/admin/exports` (nouveau)
- Refonte visuelle uniquement de : `/admin/students`, `/admin/classes`, `/admin/teaching-assignments`, `/admin/announcements`

**Acceptance** :
- Dashboard admin conforme image 1 (test visuel manuel + Playwright screenshot)
- KPIs calculés depuis vraies données
- Sparklines rendues correctement
- Toutes les nouvelles pages accessibles + permissions OK

### Phase R4 — Teacher Portal (4 j, **réécrit cible image 6**)
**Objectif** : dashboard + pages prof **pixel-correct image 6**.

**4.1 Backend extensions**
- `analytics.controller` :
  - `GET /api/v1/analytics/teacher/subject-stats` → retourne `[{ subjectCode, subjectName, classCount, studentCount }]` pour les 4 SubjectKpiCards
  - `GET /api/v1/analytics/classes/:id/grade-distribution` → 3 buckets (16-20 / 10-15 / 0-9) avec counts + pourcentages
  - `GET /api/v1/analytics/classes/:id/class-stats` → moyenne générale, meilleure, pire, taux réussite
  - `GET /api/v1/analytics/classes/:id/upcoming-assessments?limit=4` → date-cards prochaines évals
- `gradebook.controller` :
  - `GET /api/v1/gradebook/teaching-assignments/:id/quick-entry` → matrice élèves × 4 dernières évals (Devoir 1, Devoir 2, Contrôle, Participation)
  - `POST /api/v1/gradebook/inline-save` → batch save grades idempotent
- `activity-feed.controller` :
  - `GET /api/v1/activity-feed/me?limit=10` → fil utilisateur basé sur AuditLog actor=me
- `tips.controller` :
  - `GET /api/v1/tips/of-the-day?audience=teacher` → tip + progression `2/5`
  - `POST /api/v1/tips/:id/seen`

**4.2 Pages**
- **`/teacher/dashboard`** — layout strict image 6 :
  - **KPI strip 4 SubjectKpiCards** (gradient subject-coloured), liés à `subject-stats`
  - **Carte "Saisie des notes – 2nde A"** avec `<EditableGradeTable>` :
    - Sélecteur classe par défaut (1ère active du prof)
    - Sélecteur matière dans le header (matières du prof)
    - Pills colorées tonales par bucket, clic = input éditable inline, debounce 800ms ou batch save bouton
    - Ligne footer "Moyenne de la classe" auto-recalculée
    - Légende sous table
  - **Rail droit (sticky, 360 px)** :
    - `<MiniCalendar>` "Planning des évaluations" avec dots violets sur dates d'évals + nav prev/next
    - `<Card>` "Répartition des moyennes" avec `<DonutWithLegendSide>` (3 buckets)
    - `<Card>` "Statistiques de la classe" avec `<Stats2x2Grid>` (moyenne / meilleure / pire / taux)
    - `<Card>` "Prochaines évaluations" avec liste de 4 `<DateCard>` + badge "Dans X jours"
  - **Strip bottom 3 cols** :
    - `<Card>` "Classes enseignées" — liste classes prof + count élèves + lien
    - `<Card>` "Activité récente" — `<ActivityTimeline>` 4 entries depuis `activity-feed/me`
    - `<Card>` "Outils rapides" — `<QuickActionsList>` (Créer éval / Importer notes / Générer rapport / Envoyer message)
- **`/teacher/classes`** ✓ refonte visuelle (table avatars + status badges)
- **`/teacher/classes/[id]/students`** NOUVEAU — roster détaillé avec mini-stats par élève
- **`/teacher/classes/[id]/students/[studentId]`** NOUVEAU — vue prof d'un élève (notes ses matières, présences, commentaires)
- **`/teacher/grades/entry`** NOUVEAU — version plein écran de l'EditableGradeTable (UX classique + raccourcis clavier Tab/Enter)
- **`/teacher/assessments`** NOUVEAU — liste évals + formulaire planification (date, matière, classe, type, max, coef, override)
- **`/teacher/calendar`** NOUVEAU — agenda mensuel avec drill-down depuis MiniCalendar
- **`/teacher/documents`** NOUVEAU — bibliothèque école + ses propres documents
- **`/teacher/messages`** stub Phase 6 (page "Bientôt disponible" mais menu visible avec badge)
- **`/teacher/alerts`** NOUVEAU — élèves à risque (alertes filtrées sur ses classes)
- **`/teacher/settings`** NOUVEAU — préférences (notifications, langue, etc.)

**4.3 Sidebar Teacher** (image 6 confirmée) — items précis :
1. Tableau de bord (`LayoutDashboard`)
2. Mes classes (`Users`)
3. Élèves (`User`)
4. Notes (`PenTool`)
5. Évaluations (`ClipboardCheck`)
6. Emploi du temps (`Calendar`)
7. Ressources (`FolderOpen`)
8. Messagerie (`MessageSquare`, badge unread)
9. Rapports (`BarChart3`)
10. Paramètres (`Settings`)

Footer sticky : `<TipOfTheDayCard>` avec progression `seen/total`.

**Acceptance** :
- Dashboard prof **diff visuel < 5 %** vs image 6 (mesuré via Playwright screenshot diff)
- 4 SubjectKpiCards rendent gradients corrects depuis seed des Subjects
- EditableGradeTable : tab nav fonctionne, save batch < 300 ms, optimistic update visible
- MiniCalendar affiche dots aux bons jours pour assessments à venir
- Donut + Stats2x2 + DateCards + ActivityTimeline + QuickActionsList tous rendus depuis vraies données
- TipOfTheDay sidebar affiche tip actif + progression réelle
- Lighthouse mobile ≥ 90 perf

**Risques** :
- EditableGradeTable complexe (input + validation + auto-save) → prévoir tests unitaires extensifs
- Recharts SSR → tous les charts dans `<ClientChart>` wrapper

### Phase R5 — Parent Portal (3-4 j, **réécrit cible image 7**)
**Objectif** : dashboard + pages parent **pixel-correct image 7**.

**5.1 Backend extensions**
- `analytics.controller` :
  - `GET /api/v1/analytics/students/:id/global-performance` → donut % global + 4 métriques (moyenne, moy classe, progression, assiduité)
  - `GET /api/v1/analytics/students/:id/subject-perf` → 4 SubjectPerfCards (grade, badge, progress, classement, moy classe, progression, coef)
  - `GET /api/v1/analytics/students/:id/term-evolution` → line chart (5 points) avec ligne classe
  - `GET /api/v1/analytics/students/:id/subject-evolution` → bar chart groupé subject × trimester
  - `GET /api/v1/analytics/students/:id/upcoming-assessments?limit=4` → date-cards
  - `GET /api/v1/analytics/students/:id/recent-grades?limit=5` → table dernières notes avec appréciation
- `teacher-comments.controller` :
  - `GET /api/v1/teacher-comments?studentId=...&limit=3&isPublished=true` → feed commentaires
- `alerts.controller` :
  - `GET /api/v1/alerts/students/:id/active?limit=2` → 1-2 alertes top + 1-2 recos
- `tips.controller` :
  - audience `parent` → `<HelpSidebarCard>` (variant) ou link vers `/help`

**5.2 Pages**
- **`/parent/dashboard`** — layout strict image 7 :
  - **Sélecteur d'enfant** (top, si plusieurs enfants) — pills d'enfants cliquables
  - **Hero strip** :
    - `<ChildProfileHero>` (photo + nom + classe + école + 4 chips meta)
    - `<Card>` "Performance globale" — donut center % + 4 metric rows (moyenne, moy classe, progression, assiduité)
    - `<Card>` "Alertes et recommandations" — 2 cartes warning/success avec bouton "Voir détails"
  - **Section "Performance par matière"** :
    - Grille 4 `<SubjectPerfCard>` (Mathématiques / Histoire / Géographie / Physique-Chimie ou les 4 principales)
  - **Rail droit "Évaluations à venir"** :
    - `<MiniCalendar>` avec dots multi-couleurs par matière
    - Liste 4 entrées sous calendrier avec heure
  - **Charts duo 2 cols** :
    - `<LineChart>` "Évolution des moyennes générales" (ligne enfant + ligne classe, 5 points sur trimestres)
    - `<GroupedBarChart>` "Évolution par matière" (4 matières × 3 trimestres)
  - **Strip bottom 2 cols** :
    - `<Card>` "Dernières notes et évaluations" — table 9 colonnes (Date / Matière / Évaluation / Type / Note / / / Moy. classe / Coef. / Appréciation)
    - `<Card>` "Commentaires des enseignants" — `<CommentsFeed>` 3 entries
- **`/parent/children`** NOUVEAU — liste enfants (cartes profil)
- **`/parent/children/[id]`** redesign — onglets Profil / Notes / Présences / Cahier de texte
- **`/parent/children/[id]/grades`** NOUVEAU — table notes complète avec filtres trimestre/matière + appréciations
- **`/parent/children/[id]/lessons`** NOUVEAU — cahier de texte chronologique avec devoirs surlignés
- **`/parent/children/[id]/attendance`** NOUVEAU — calendrier d'absences + stats + justifications
- **`/parent/grades`** ✓ refonte (toutes enfants confondues, filtre par enfant)
- **`/parent/calendar`** NOUVEAU — vue agenda
- **`/parent/announcements`** ✓ refonte visuelle
- **`/parent/alerts`** NOUVEAU — toutes les alertes actives + historique
- **`/parent/documents`** NOUVEAU — documents école + classe + élève
- **`/parent/recommendations`** NOUVEAU — toutes recos + dismissable
- **`/parent/settings`** NOUVEAU — notifications par canal + préférences

**5.3 Sidebar Parent** (image 7 confirmée) — items précis :
1. Tableau de bord (`LayoutDashboard`)
2. Profil de l'élève (`User`)
3. Notes et évaluations (`PenTool`)
4. Suivi des matières (`BookOpen`)
5. Évaluations à venir (`CalendarClock`)
6. Emploi du temps (`Calendar`)
7. Absences et retards (`UserX`)
8. Commentaires (`MessageCircle`)
9. Recommandations (`Lightbulb`)
10. Documents (`FolderOpen`)
11. Communication (`Send`)

Footer sticky : `<HelpSidebarCard>` ("Besoin d'aide ? Consultez notre centre d'aide ou contactez le support." + bouton "Centre d'aide").

**Acceptance** :
- Dashboard parent **diff visuel < 5 %** vs image 7
- ChildProfileHero rendu avec photo (fallback initiales si pas de photo)
- Performance globale donut + 4 metric rows rendus depuis vraies données
- 4 SubjectPerfCards avec couleurs matière correctes
- LineChart : 2 séries (enfant vs classe), annotations sur points
- GroupedBarChart : 3 séries (1er/2e/3e trim) groupées par matière
- CommentsFeed : 3 derniers commentaires publiés des profs
- Alertes/recos cards : sources réelles (AlertInstance + Recommendation)
- Lighthouse mobile ≥ 90 perf

**Risques** :
- Photo enfant ne sera pas systématique (UX fallback : initiales sur fond gradient sky)
- Si <4 matières actives → adapter grid (1-2-3 cols selon)
- Si 0 commentaire publié → empty state élégant (image livre + texte)

### Phase R6 — Moteur d'alertes + recommandations (2 j)
**Objectif** : générer des alertes/recos depuis les données.
- Worker BullMQ avec cron 15 min
- Évaluation de chaque AlertRule contre chaque élève concerné
- Création/mise à jour AlertInstance
- Génération Recommendation depuis chaque alerte active
- Notification créée pour les parents concernés
- Trigger immédiat sur `assessment.publish`, `attendance.batch`, `enrollment.create`

**Acceptance** :
- Tests unitaires : règle LOW_SUBJECT_AVG marche
- Test E2E : prof publie note basse → alerte créée → parent voit notification

### Phase R7 — Exports asynchrones (1-2 j)
**Objectif** : worker BullMQ pour PDF/XLSX.
- `exports.controller.ts` + `exports.service.ts`
- Worker dans `apps/worker` : génère fichier dans MinIO + update ExportJob
- UI `/admin/exports` + `/teacher/exports` : liste + statut + download

**Acceptance** :
- Admin déclenche un export XLSX → fichier téléchargeable en <30 s
- Polling de status fonctionnel

### Phase R8 — Notifications + bell (1 j)
**Objectif** : notif center.
- Notification créée par : grade.publish, alert.trigger, announcement.publish, lesson.publish, enrollment_request.create
- Polling `/notifications/unread-count` toutes les 30 s (NotificationBell)
- Dropdown panel avec liste + mark-as-read + lien

**Acceptance** :
- Parent connecté voit bell+badge changer en temps réel quand prof publie

### Phase R9 — Responsive + accessibilité (1-2 j)
**Objectif** : passe complète mobile + WCAG.
- Audit Lighthouse mobile sur 5 pages clés
- Audit axe-core sur 10 pages clés
- Fix des problèmes critiques

**Acceptance** :
- Lighthouse mobile ≥ 90 perfs + 100 a11y sur dashboards
- 0 axe-core critical

### Phase R10 — Tests E2E + QA (1-2 j)
**Objectif** : couverture des flows clés.
- Playwright : login admin / teacher / parent
- Création éval prof → saisie notes → publication → parent voit la note
- Alerte automatique : prof publie note < seuil → parent voit alerte + recommandation
- Demande inscription parent → admin approuve → enrollment créé

**Acceptance** :
- Suite Playwright passe en CI

### Phase R11 — Polish & docs (1 j)
**Objectif** : finitions.
- Documentation utilisateur : guide rapide par portail
- Empty states sur toutes les pages
- Loading skeletons partout
- 404 / 500 / 403 pages stylisées

**Estimation totale** : ~22-28 jours-personne (+2-3 j vs v1 pour absorber la densité des images 6 & 7 : SubjectKpiCard gradient + EditableGradeTable inline + ChildProfileHero + SubjectPerfCard + GroupedBarChart + TipOfTheDay).

---

## 8. Règles d'implémentation

1. **Incrémental** : chaque PR/phase doit laisser l'app utilisable
2. **Pas de rewrite à blanc** : on remplace PortalShell par AppShell via alias compat, jamais en cassant tout d'un coup
3. **Vérification continue** : après chaque sous-tâche → typecheck + tests + smoke visuel
4. **Pas de mock hardcodé** : si une feature n'est pas finie, on affiche un empty state + label "Disponible bientôt"
5. **Préservation features existantes** : aucune perte fonctionnelle sans plan de migration explicite
6. **Composants réutilisables** : tout pattern dupliqué 3+ fois devient un composant dans `packages/ui`
7. **Conventions de nommage** :
   - Pages server-side : `page.tsx`
   - Client-side managers : `XxxManager.tsx`
   - Server actions : `actions.ts`
   - Types partagés API : `types.ts` ou via `@pilotage/contracts`
8. **Tests obligatoires** sur :
   - Toute formule de calcul d'agrégation (moyennes, tendances, taux)
   - Toute règle d'autorisation ABAC
   - Tout workflow multi-étapes (enrollment, grade publication, alert trigger)

---

## 9. Critères de qualité finaux

- ✅ Pixel-correct sur les 3 dashboards principaux (vs images de référence)
- ✅ Cohérence visuelle parfaite entre les 3 portails
- ✅ Pages chargent en <1.5 s sur connexion 4G simulée
- ✅ Lighthouse mobile ≥ 90 perf / ≥ 100 a11y / ≥ 100 best-practices
- ✅ axe-core 0 violation critique sur 10 pages testées
- ✅ Typecheck propre web + API
- ✅ Suite Playwright E2E passe (3 logins + 3 flows clés)
- ✅ Zero régression fonctionnelle vs Phase 5
- ✅ Documentation utilisateur en place
- ✅ Tests unitaires sur services analytics + alerts

---

## 10. Skills, outils et plugins prévus

| Catégorie | Outil | Statut |
|---|---|---|
| Frontend | Next.js 15 (App Router) | déjà installé |
| Frontend | React 19 | déjà installé |
| Frontend | Tailwind CSS v4 | déjà installé |
| Frontend | TypeScript 5.x | déjà installé |
| Frontend | NextAuth v5 | déjà installé |
| Frontend | lucide-react (icons) | déjà installé |
| Frontend | **recharts** | à installer |
| Frontend | **date-fns** + locale fr | à installer |
| Frontend | clsx + tailwind-merge | déjà installé |
| Backend | NestJS 11 | déjà installé |
| Backend | Prisma 5 | déjà installé |
| Backend | passport-jwt + jwks-rsa | déjà installé |
| Backend | **BullMQ** | déjà installé (à activer) |
| Backend | **@react-pdf/renderer** | à installer (dans worker) |
| Backend | **exceljs** | à installer (dans worker) |
| Backend | pino logger | déjà installé |
| Tests | **@playwright/test** | à installer |
| Tests | Jest + ts-jest | déjà installé côté API |
| Tests | **vitest** | à installer côté web (optionnel) |
| Quality | ESLint | déjà installé |
| Quality | TypeScript noEmit | déjà actif |
| Quality | **axe-core / @axe-core/playwright** | à installer |
| DB | Prisma migrate | déjà actif |
| Storage | MinIO (S3 compat) | déjà déployé en docker |
| Cache | Redis (ioredis) | déjà installé |
| Auth | Keycloak 26 | déjà déployé |
| Email | Maildev (dev) → SMTP prod | déjà déployé |
| Observability | OpenTelemetry + Jaeger | déjà déployé |

Outils Claude utilisés pour cette analyse :
- File search & grep
- TypeScript noEmit
- Image inspection (5 maquettes)
- Existing codebase audit (`find`, `grep`)

Outils non-disponibles à signaler :
- **Storybook** : pas installé — on créera une page `/dev/components` à la place
- **OpenAPI/Swagger** : `@nestjs/swagger` est déjà installé mais pas généré — à activer en Phase R0

---

## 11. Contrainte importante

> **Ce document v2 doit être validé avant toute implémentation.**

Aucun fichier de code ne sera modifié avant ton accord explicite sur :
- Le périmètre (toutes les pages listées en §3.5)
- L'architecture (extensions §5.2)
- Les nouvelles tables (§6.1) — **incluant le nouveau `TipOfTheDay` + `TipDelivery`**
- Le mapping couleur par matière (§1.8) — palette stable cross-portal
- Le nouveau catalogue de composants (§4.2) — 14 ajouts en v2
- La roadmap (§7) et son ordre — **phases R4 et R5 réécrites pour cibler images 6 & 7**

Une fois validé, j'attaquerai par la Phase R0 (audit + installations) → puis R1 (design system) avant de toucher aux dashboards.

### Points spécifiques à valider explicitement (v2)

1. **Subject-coloured KPI cards** (Teacher) — confirmes-tu le pattern gradient subject-coloured (image 6) plutôt que des KPIs neutres ? → impact `<SubjectKpiCard>` + helper `subjectColor()`
2. **Saisie de notes inline** sur dashboard prof — confirmes-tu que la saisie de notes s'effectue **directement dans une carte du dashboard** (image 6) + page plein écran `/teacher/grades/entry` en complément ? → impact UX prof
3. **Mapping couleur par matière** (§1.8) — confirmes-tu la palette ou veux-tu ajuster certaines couleurs (ex: SVT en vert vs bleu) ?
4. **Profile Hero parent** (image 7) — confirmes-tu la photo enfant uploadable (fallback initiales) ? → impact stockage + upload UI
5. **Conseil du jour** (image 6) — confirmes-tu un système de tips administré côté admin (CRUD) + livraison personnalisée ? Ou alternativement un set de tips hardcodés "Anthropic-curated" sans CRUD admin ?
6. **GroupedBarChart évolution par matière × trimestre** (image 7) — confirmes-tu 3 trimestres comme granularité fixe (vs 2 semestres ou découpage paramétrable) ?
7. **CommentsFeed parent** (image 7) — confirmes-tu que `TeacherComment.scope` couvre `trimester / semester / annual / general` (vs juste annuel) ?

Si tu veux ajuster ou prioriser différemment (ex : « commence par le parent », « pas de moteur d'alertes pour l'instant », « j'ajoute X comme requirement »), dis-le ici — je révise le plan, je ne pars pas du tout sans ton OK.

---

## 12. Changelog

### v2.0 (date courante)
- Intégration des **2 nouvelles maquettes** (images 6 Teacher rich + 7 Parent rich)
- §1.7 NOUVEAU — analyse approfondie des nouvelles maquettes (densité info, layout strict, specs pixel)
- §1.8 NOUVEAU — mapping couleur stable par matière
- §1.2 enrichie de 11 patterns (SubjectKpiCard, EditableGradeTable, ChildProfileHero, SubjectPerfCard, MiniCalendar, Stats2×2Grid, CommentsFeed, GroupedBarChart, TipOfTheDay, QuickActionsList, ActivityTimeline)
- §1.3 — table portails actualisée (Teacher → image 6 prescriptive, Parent → image 7 prescriptive)
- §4.2 — +14 composants
- §6.1 — +1 modèle (`TipOfTheDay` + `TipDelivery`)
- §6.2 — +6 sections d'endpoints (analytics par matière, gradebook inline, quick actions, tips, activity feed)
- §7 — R4 et R5 réécrits avec specs pixel-précises
- §11 — 7 points spécifiques de validation explicite ajoutés

### v1.0 (précédent)
- Plan initial après analyse des 5 maquettes de référence
- Audit codebase + roadmap 11 phases
