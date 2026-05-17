# Design System — Pilotage scolaire (v2)

> Approche: design **moderne, professionnel, mobile-first, bienveillant, harmonisé entre 3 portails**.
> Stack: Tailwind CSS v4 + shadcn/ui (Radix UI primitives) + Lucide icons + Recharts + Storybook 8.
> Conformité: WCAG 2.2 AA strict.
> White-label: branding par école override les tokens à runtime.

---

## 1. Principes directeurs

1. **Bienveillant, factuel, orienté solution** (règle UX cahier §6). Pas de panique, pas de stigmatisation.
2. **Lisibilité prioritaire** — parents non-techniques sur mobile.
3. **Hiérarchie claire** — l'essentiel sans cliquer, le détail à la demande (progressive disclosure).
4. **Accessibilité native** — contraste, clavier, lecteur d'écran, daltonisme, taille de police.
5. **Mobile-first**, desktop hérite et enrichit.
6. **Performance perçue** — skeletons, optimistic updates, transitions ≤ 200ms.
7. **Harmonisé cross-portail**: mêmes primitives. Différenciation par tonalité et densité, pas par redesign.
8. **Customizable par école**: branding (couleur + logo + police + libellés) override les tokens, jamais la structure.

---

## 2. Identité visuelle harmonisée

### 2.1 Tokens couleur (CSS custom properties via Tailwind v4)

```css
/* base tokens — overridable par branding tenant */
@theme {
  /* Neutral palette */
  --color-neutral-0:   oklch(1 0 0);
  --color-neutral-50:  oklch(0.98 0.005 250);
  --color-neutral-100: oklch(0.96 0.01 250);
  --color-neutral-200: oklch(0.92 0.01 250);
  --color-neutral-300: oklch(0.85 0.01 250);
  --color-neutral-500: oklch(0.55 0.02 250);
  --color-neutral-700: oklch(0.32 0.02 250);
  --color-neutral-900: oklch(0.15 0.02 250);

  /* Brand (default — surchargeable par branding école) */
  --color-brand-50:   oklch(0.97 0.02 250);
  --color-brand-100:  oklch(0.93 0.05 250);
  --color-brand-500:  oklch(0.62 0.18 250);
  --color-brand-600:  oklch(0.55 0.20 250);
  --color-brand-700:  oklch(0.48 0.20 250);

  /* Sémantique */
  --color-success-500: oklch(0.70 0.17 160);
  --color-warning-500: oklch(0.78 0.16 75);
  --color-danger-500:  oklch(0.60 0.22 25);
  --color-info-500:    oklch(0.72 0.13 220);

  /* Surfaces */
  --color-surface:        oklch(1 0 0);
  --color-surface-2:      oklch(0.98 0.005 250);
  --color-surface-elevated:oklch(1 0 0);
  --color-border:         oklch(0.92 0.01 250);
  --color-text:           oklch(0.18 0.02 250);
  --color-text-muted:     oklch(0.50 0.02 250);
  --color-focus-ring:     oklch(0.62 0.20 250 / 0.5);
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-surface:         oklch(0.15 0.02 250);
    --color-surface-2:       oklch(0.18 0.02 250);
    --color-surface-elevated:oklch(0.20 0.02 250);
    --color-border:          oklch(0.28 0.02 250);
    --color-text:            oklch(0.98 0.005 250);
    --color-text-muted:      oklch(0.68 0.02 250);
  }
}
```

### 2.2 Override de branding (white-label)
Au boot, le frontend `GET /api/v1/branding/me`, applique:
```css
:root[data-tenant="<id>"] {
  --color-brand-500: <school primary>;
  --color-brand-600: <darker shade computed>;
  --font-sans: <school font fallback Inter>;
}
```

### 2.3 Distinction par portail (subtile)
Chaque portail a un **accent secondaire** différent appliqué via `[data-portal]`:
- `data-portal="admin"` → accent slate-blue institutionnel (`oklch(0.55 0.10 250)`)
- `data-portal="teacher"` → accent teal pédagogique (`oklch(0.62 0.12 180)`)
- `data-portal="parent"` → accent warm-blue confiance (`oklch(0.65 0.13 230)`)

L'accent ne change PAS les couleurs sémantiques (success/warning/danger), seulement les éléments d'identité (header bar, focus rings, badges de rôle).

### 2.4 Typographie

| Échelle | Mobile | Desktop | Usage |
|---|---|---|---|
| display | 30px | 36px | H1 dashboards |
| h1 | 24px | 30px | titre page |
| h2 | 20px | 24px | section |
| h3 | 18px | 20px | card title |
| body-lg | 16px | 18px | texte parent mobile |
| body | 16px | 16px | texte standard |
| body-sm | 14px | 14px | métadonnées |
| caption | 12px | 12px | légendes |

- Font sans-serif par défaut: **Inter** (variable, latin-ext).
- Alternative dyslexie: **Atkinson Hyperlegible** (option utilisateur).
- Line-height: 1.5 sur body, 1.2 sur display/h1.

### 2.5 Espacement, rayons, ombres

- Échelle Tailwind 4-based: 0, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24.
- Padding card: 16px mobile, 24px desktop.
- Radius: `--radius-sm: 4px`, `--radius: 8px`, `--radius-lg: 12px`, `--radius-xl: 16px`, `--radius-2xl: 24px`.
- Ombres shadcn sm/md/lg, jamais d'ombres saturées.

---

## 3. Layouts par portail (architecture)

### 3.1 Layout commun
Tous portails partagent:
- `<RootProvider>`: theme, i18n, query client, toast container
- `<PortalShell portal="admin|teacher|parent">`: applique data-attr + théme overlay
- `<AuthGuard>`: vérifie rôle, redirige si mismatch
- `<NotificationStream>`: SSE listener + toast notifications

### 3.2 Layout ADMIN (desktop prioritaire, responsive)

**Desktop ≥ 1024px:**
```
┌─────────────────────────────────────────────────────────┐
│ [Logo] [School Name]   🔍 Search...  🔔  ❓  👤 Admin ▼ │ Topbar 56px
├─────────┬───────────────────────────────────────────────┤
│         │                                                │
│ Sidebar │   Main content area                            │
│  • Dash │                                                │
│  • Écol │   <Page title>                                 │
│  • Hier │   <Breadcrumbs>                                │
│  • Pers │                                                │
│  • Insc │   <Content>                                    │
│  • EmpT │                                                │
│  • Éval │                                                │
│  • Pres │                                                │
│  • Comm │                                                │
│  • Custo│                                                │
│  • Audit│                                                │
│  • Setts│                                                │
│         │                                                │
└─────────┴───────────────────────────────────────────────┘
```
Sidebar: 240px, collapsible vers 56px (rail mode). Sections groupées avec headers. Top: nom école + logo. Bottom: profil + theme switch.

**Mobile < 1024px:** sidebar devient drawer (Sheet) déclenché par burger menu dans topbar.

### 3.3 Layout TEACHER (mobile + desktop équilibré)

**Mobile < 768px:**
```
┌───────────────────────────┐
│ ☰ Pilotage   🔍  🔔  👤  │ Topbar 56px
├───────────────────────────┤
│                           │
│   Page content            │
│                           │
│                           │
├───────────────────────────┤
│ 📚    📅    📝   👥    ⚙️ │ Bottom tabs 56px
│ Class  EdT   Eval Risk  Set│
└───────────────────────────┘
```

**Desktop ≥ 768px:** sidebar 240px à gauche + topbar.

### 3.4 Layout PARENT (mobile prioritaire absolu)

**Mobile (priorité):**
```
┌───────────────────────────┐
│ ☰  [Enfant ▼]      🔔  👤 │ Topbar 56px (sélecteur enfant si plusieurs)
├───────────────────────────┤
│                           │
│  Dashboard / Page         │
│                           │
│                           │
├───────────────────────────┤
│  🏠    📊    📅    🔔   👤│ Bottom tabs
│ Home  Suivi  Cal  Alert  Me │
└───────────────────────────┘
```

**Desktop:** Sidebar 240px + content + side-panel optionnel (300px droite) pour alertes / activity feed.

### 3.5 Layout AUTH (3 portails)
Page centrée, max 440px de large, branding subtil:
```
┌────────────────────────────────────┐
│                                    │
│         [Logo Pilotage]            │
│                                    │
│         Portail Administrateur     │ Title portail
│                                    │
│ ┌────────────────────────────────┐ │
│ │  Email                          │ │
│ │  ────────────────────────────── │ │
│ │  Mot de passe        👁         │ │
│ │  ────────────────────────────── │ │
│ │  [ Mot de passe oublié ? ]     │ │
│ │                                 │ │
│ │  [   Se connecter       ]      │ │
│ │                                 │ │
│ │  ─── ou ───                     │ │
│ │                                 │ │
│ │  [ G ] Google  [⌘] Microsoft   │ │ (Phase 5)
│ │                                 │ │
│ │  Pas encore de compte ?         │ │
│ │  → Demander une invitation      │ │
│ └────────────────────────────────┘ │
│                                    │
│  Vous êtes parent ? → /parent/login│
│  Vous êtes prof ?  → /teacher/login│
└────────────────────────────────────┘
```

Variantes:
- Parent: bouton "Créer un compte" au lieu de "Demander invitation"
- Teacher: idem admin
- Tous: lien de bascule vers les autres portails en bas

---

## 4. Composants

### 4.1 Composants shadcn/ui de base
Button (variants: primary/secondary/ghost/destructive/outline), Card, Dialog, Sheet, Drawer (vaul), Form, Input, Textarea, Select, Combobox, Command (cmdk), DataTable (TanStack), Tabs, Toast (Sonner), Skeleton, Avatar, Badge, Progress, Tooltip, DropdownMenu, NavigationMenu, Calendar (react-day-picker), Popover, Accordion, Collapsible, RadioGroup, Checkbox, Switch, Slider, Alert, AlertDialog, Breadcrumb, Pagination, ScrollArea, Resizable, Separator, AspectRatio.

### 4.2 Composants métier (packages/ui)

#### Sémantique pédagogique
- `<GradeBadge score maxScore size />` — note avec couleur par seuil configurable
- `<TrendIndicator direction delta period />` — flèche + delta + libellé (forme + couleur + texte)
- `<SubjectChip subject size />` — icône + nom matière
- `<StudentAvatar student size />` — initiales colorées hashées si pas de photo
- `<TeacherAvatar />`, `<ParentAvatar />`
- `<AttendanceBadge status />` — présent/absent/retard/excusé
- `<RoleBadge role />`
- `<SeverityBadge severity />` — low/medium/high

#### Domaine
- `<AlertCard alert />` — règle + sévérité + explanation + recommandation
- `<AlertExplainer rule variables />` — affichage explicable d'une règle
- `<GradeMatrix students fields onSave />` — table éditable (clavier-friendly, autosave)
- `<AttendanceMatrix session students onMark />`
- `<GradeTimeline grades />` — chart historique
- `<SubjectGrid subjects />` — grid responsive matières
- `<UpcomingAssessmentsTimeline assessments />`
- `<TimetableGrid days slots editable />` — drag-drop grille horaires
- `<LessonCard lesson />`
- `<AnnouncementCard announcement />`
- `<DisciplinaryRecordCard record />`

#### Compositions layout
- `<PageHeader title actions breadcrumbs />`
- `<EmptyState icon title description action />`
- `<ErrorState />`, `<LoadingSkeleton variant="card|list|grid" />`
- `<DashboardWidget title size>` (resizable grid item)
- `<StatCard label value delta />` — KPI card
- `<FilterBar fields onChange />` — barre de filtres standard
- `<BulkActionsBar selectedCount actions />`
- `<RoleSwitcher availableRoles current />`
- `<TenantBranding>` — wrapper qui applique branding

#### Customization
- `<DynamicFormFields fields values onChange />` — rendu custom field definitions
- `<RuleBuilder rule onChange />` — builder visuel pour alert rules
- `<PermissionMatrix permissions onChange />` — checkbox grid
- `<TemplateEditor template onChange />` — éditeur templates Markdown + preview
- `<DashboardLayoutEditor layout widgets onChange />` — react-grid-layout

#### Recherche & navigation
- `<GlobalSearch />` — Cmd+K palette (cmdk)
- `<NotificationsBell />` — dropdown notifications + lien centre
- `<UserMenu />` — avatar dropdown profil/settings/logout

---

## 5. Patterns d'interaction

| Pattern | Composant | Note |
|---|---|---|
| Création / édition standard | Sheet (mobile) / Dialog (desktop) | Évite navigation contextuelle |
| Édition lourde (CRUD avec onglets) | Page dédiée | Préserve URL bookmarkable |
| Confirmation destructive | AlertDialog | Toujours nommer la conséquence |
| Filtrage table | Popover + Command | Sélection multi |
| Recherche globale | Cmd+K palette | Indexée Postgres tsvector |
| Notification SSE | Toast Sonner + bell | aria-live="polite" |
| Erreur formulaire | Inline sous champ + icône | aria-invalid + aria-describedby |
| Chargement | Skeleton → spinner → progress | Selon durée attendue |
| État vide | EmptyState + CTA | Toujours une action |
| Saisie nombre rapide | Stepper buttons + input | Clavier-friendly |
| Sélection date | Calendar popover | Locale-aware |
| Upload fichier | Drop zone + click | Preview + progress |
| Drag-drop ordre/layout | dnd-kit | A11y annotations |

---

## 6. Microcopy bienveillant (FR par défaut, override école possible via i18n_override)

Tonalité: vouvoiement par défaut; ton chaleureux mais professionnel; factuel.

| Contexte | Phrase |
|---|---|
| Empty dashboard parent | "Aucune donnée pour le moment. Les premières notes apparaîtront ici dès leur publication par l'établissement." |
| Empty list classe prof | "Aucune classe affectée pour le moment. Contactez l'administration si c'est une erreur." |
| Alerte LOW_SUBJECT_AVG | "Votre enfant est sous le seuil attendu en {{subject}}. Moyenne actuelle: {{average}}/{{maxScore}}. Un suivi ciblé est recommandé." |
| Alerte NEGATIVE_TREND | "Une baisse récente est observée en {{subject}}. Il peut être utile de vérifier la compréhension des derniers chapitres." |
| Suppression bloquée note | "Cette note est publiée. Vous pouvez la corriger via une révision, mais pas la supprimer (traçabilité obligatoire)." |
| Dérogation capacité | "La classe est complète ({{current}}/{{max}}). Enregistrer une dérogation administrative? Cette action sera journalisée." |
| Confirmation publication | "Vous allez publier {{n}} notes. Les parents recevront une notification. Continuer?" |
| Rattachement en attente | "Votre demande de rattachement est en cours de validation par l'établissement. Vous serez notifié dès la décision." |
| Connexion perdue | "Connexion perdue. Vos modifications sont conservées localement et seront envoyées au retour de la connexion." |
| Session expirée | "Votre session a expiré. Reconnectez-vous pour continuer." |
| MFA enrôlement | "Pour la sécurité des données scolaires, l'authentification à deux facteurs est requise. Scannez ce QR code dans votre application." |

---

## 7. Accessibilité — checklist d'implémentation (WCAG 2.2 AA)

- [ ] Contraste 4.5:1 texte normal, 3:1 grand texte — testé via `@axe-core/playwright` en CI
- [ ] Tous composants Radix utilisés (focus management ARIA natif)
- [ ] Skip-link "Aller au contenu principal" sur chaque layout
- [ ] Heading hierarchy respectée (H1 unique, pas de saut)
- [ ] Labels explicites (jamais placeholder seul)
- [ ] Boutons icône-only avec `aria-label`
- [ ] Notifications SSE annoncées via `aria-live="polite"`
- [ ] Touch targets ≥ 44×44 px sur mobile
- [ ] `prefers-reduced-motion` respecté (animations désactivables)
- [ ] Reading order linéaire en flexbox/grid
- [ ] Erreurs formulaire `aria-invalid` + `aria-describedby`
- [ ] Dark mode auto + override préférence utilisateur
- [ ] Police dyslexie en option (Atkinson Hyperlegible)
- [ ] Taille de police user-scalable
- [ ] Couleur jamais seule (forme + couleur + texte)
- [ ] Tests lecteur d'écran NVDA/VoiceOver sur parcours critiques

---

## 8. Charts (Recharts)

- Axes lisibles (12px, rotation 0 desktop)
- Légende sous chart mobile, à droite desktop
- Couleurs sémantiques cohérentes
- Tooltip détaillé
- **Toggle "vue tableau"** accessible sous chaque chart pour lecteurs d'écran
- Types: LineChart, BarChart, AreaChart, RadialBarChart, PieChart (rare), Scatter

---

## 9. Densité d'information par portail

| Portail | Vue | Densité | Justification |
|---|---|---|---|
| Parent | Dashboard | Faible | Mobile, lisibilité, parents non-tech |
| Parent | Détail matière | Moyenne | Plus de données contextuelles attendues |
| Teacher | Liste classes | Moyenne | Vue d'ensemble |
| Teacher | Gradebook | Élevée | Saisie rapide professionnelle |
| Teacher | Présences | Élevée | Saisie rapide |
| Admin | Tableaux | Moyenne-élevée | Pouvoir filtrer/trier/exporter |
| Admin | Audit | Élevée | Forensique |

---

## 10. Internationalisation

- next-intl, ICU MessageFormat (pluriels, genres)
- Tous libellés dans `messages/<locale>.json` (jamais en dur dans le JSX)
- Override par école via `i18n_override` (admin peut renommer "trimestre" → "module")
- Dates via `Intl.DateTimeFormat` (locale école)
- Nombres via `Intl.NumberFormat`
- Préparation RTL (arabe) via logique CSS `start/end`, jamais `left/right`
- Locales MVP: `fr-FR` (défaut), `en-US` (skeleton)

---

## 11. Performance design

- Recharts lazy-loaded (dynamic import)
- Images Next.js `<Image>` avec sizes responsive
- Police Inter via `next/font` (self-host, no FOUT)
- Tailwind v4 zero-runtime CSS
- Critical CSS inliné via App Router
- Préchargement `<Link prefetch>` sur navigation principale
- Bundle analyzer en CI, budget per route
- Lighthouse CI seuil ≥ 90 Perf/A11y/Best/SEO

---

## 12. États globaux UI

| État | Pattern | Composant |
|---|---|---|
| Loading initial route | Skeleton complet | `loading.tsx` |
| Loading carte | Skeleton localisé | `<Skeleton>` |
| Mutation optimiste | Rollback si erreur | TanStack Query |
| Erreur boundary | Page erreur + retry | `error.tsx` |
| Offline | Banner top + queue | Service Worker + IndexedDB |
| Session expirée | Modal "Reconnexion" | Auto-redirect login |
| Latency lente | Spinner + cancel | TanStack abort |
| Pas de résultats | EmptyState | Suggestion action |

---

## 13. PWA

- `manifest.json` avec icônes 192/512/maskable
- `theme-color` adapté light/dark
- Service worker via `@serwist/next`: cache statique, offline shell, revalidate dashboard
- Installable iOS/Android
- Web Push (Phase 4) avec subscription store
- Background sync queue mutations

---

## 14. Storybook (obligatoire — ADR-016)

Structure:
```
packages/ui/src/components/
├── GradeBadge/
│   ├── GradeBadge.tsx
│   ├── GradeBadge.stories.tsx     # ← obligatoire
│   ├── GradeBadge.test.tsx        # ← Vitest
│   └── index.ts
```

Stories couvrent: variants, taille, dark mode, RTL, états (default, hover, focus, disabled).

Visual regression via Chromatic ou Playwright snapshots en CI.

---

## 15. Adapter par portail (architecture)

Chaque portail a son `<PortalLayout>` qui:
1. Wrap dans `<PortalShell portal="admin">` qui ajoute `data-portal` sur `<html>`
2. Charge le `<Sidebar>` ou `<BottomTabs>` propre au portail
3. Vérifie le rôle utilisateur, redirige si mismatch
4. Charge les contextes spécifiques (ex. ChildSelector pour parent)

Code partagé maximal: 95% des composants UI sont communs; seuls les `<Sidebar>` et navigations sont distincts.

---

## 16. Inspirations & références

- shadcn/ui patterns (https://ui.shadcn.com)
- Linear (densité élégante, animations subtiles)
- Notion (microcopy, empty states)
- Stripe Dashboard (clarté tableaux financiers)
- Apple HIG (touch patterns mobile)
- Carbon Design System (gravity)
- Pronote / EcoleDirecte (concurrence française, à éviter en termes de UX datée)

**Notre différenciation:** UX moderne 2026, mobile-first vrai, dashboard décisionnel parent (pas un carnet de notes), customisation poussée.

---

## 17. Workflow de design avant code

1. Wireframe basse-fi (markdown ASCII ou Figma) → `docs/screens/`
2. Composant cible Storybook → variants
3. Implémentation page + intégration tests
4. Accessibilité check axe
5. Performance check Lighthouse
6. Revue design system (un mainteneur)
7. Merge
