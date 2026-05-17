# Mockups visuels — Pilotage scolaire

> Quatre maquettes HTML haute fidélité, ouvrables dans un navigateur, qui servent de **référence visuelle directe** pour l'implémentation Next.js + Tailwind + shadcn/ui.

## Comment ouvrir
```powershell
start docs/mockups/landing.html
start docs/mockups/admin-dashboard.html
start docs/mockups/teacher-dashboard.html
start docs/mockups/parent-dashboard.html
```
Ou simplement double-cliquer chaque fichier.

## Les 4 maquettes

| Fichier | Cible | Viewport | Accent |
|---|---|---|---|
| `landing.html` | Page d'accueil publique `/` | Desktop responsive | Brand (slate-blue) |
| `admin-dashboard.html` | `/admin/dashboard` | Desktop ≥ 1280 | Brand institutionnel |
| `teacher-dashboard.html` | `/teacher/dashboard` | Desktop ≥ 1024 | Teal pédagogique |
| `parent-dashboard.html` | `/parent/dashboard` | Mobile 390 × 844 | Warm-blue confiance |

## Stack technique des maquettes

- **Tailwind CSS** via CDN (`cdn.tailwindcss.com`) — config inline avec tokens OKLCH du design system v2
- **Police**: Inter (Google Fonts) + JetBrains Mono pour les chiffres
- **Icônes**: Lucide-style en SVG inline (pas de dépendance externe)
- **Couleurs**: OKLCH pour cohérence perceptuelle
- **Accessibilité**: contraste AA, focus styles, ARIA prêt

## Mapping mockup → composants à implémenter

### `landing.html`
- `<MarketingHeader>` (logo + nav + login dropdown)
- `<HeroSection>` avec preview téléphone
- `<PortalCard>` × 3 (admin / teacher / parent)
- `<HowItWorksSection>`
- `<TrustSection>` (mode sombre)
- `<MarketingFooter>`

### `admin-dashboard.html`
- `<AdminLayout>` = `<AdminSidebar>` + `<AdminTopbar>` + main
- `<StatCard>` × 4 (KPI customisables)
- `<EnrollmentRequestsList>` (file d'attente)
- `<AtRiskStudentsList>`
- `<AuditFeed>` (timeline)
- `<SchoolTrendChart>` (recharts ou inline SVG)
- `<GlobalSearch>` (Cmd+K)

### `teacher-dashboard.html`
- `<TeacherLayout>` = `<TeacherSidebar>` + `<TeacherTopbar>` + main
- `<TodayScheduleTimeline>`
- `<MyClassesGrid>`
- `<TodoList>` (avec status)
- `<AtRiskList>` (avec règle déclenchée)
- `<AnnouncementCard>`

### `parent-dashboard.html` (mobile)
- `<ParentLayout>` = `<MobileTopbar>` (avec sélecteur enfant) + main + `<BottomTabs>`
- `<GlobalAverageCard>` (gradient)
- `<AlertBanner>`
- `<SubjectGrid>` (carte par matière avec couleur sémantique)
- `<UpcomingAssessmentsTimeline>`
- `<RecentGradesList>`
- `<AnnouncementCard>`

## Tokens à porter dans `packages/design-tokens/`

```ts
// Couleurs principales
export const tokens = {
  brand: {
    50:  'oklch(0.97 0.02 250)',
    500: 'oklch(0.62 0.18 250)',
    600: 'oklch(0.55 0.20 250)',
    700: 'oklch(0.48 0.20 250)',
  },
  // Par portail (accent)
  admin:   { 500: 'oklch(0.62 0.18 250)' }, // slate-blue
  teacher: { 500: 'oklch(0.62 0.12 180)' }, // teal
  parent:  { 500: 'oklch(0.65 0.13 230)' }, // warm-blue
  // Sémantiques
  success: { 500: 'oklch(0.70 0.17 160)' },
  warning: { 500: 'oklch(0.78 0.16 75)' },
  danger:  { 500: 'oklch(0.60 0.22 25)' },
  // Neutres
  ink: { /* 50..900 */ },
};
```

## Notes d'implémentation

- Tous les chiffres (notes, statistiques) utilisent `font-variant-numeric: tabular-nums` pour alignement vertical.
- Les badges de tendance utilisent **toujours forme + couleur + texte** (jamais couleur seule — daltonisme).
- Les alertes utilisent ambre pour "attention", rouge réservé aux blocages irréversibles uniquement.
- Le mockup parent est volontairement présenté **encadré dans un téléphone** pour rappeler que c'est l'écran cible. En implémentation Next.js, le contenu remplit naturellement le viewport mobile et s'étend sur desktop avec sidebar.
- Les bottom-tabs parent et teacher mobile sont `position: sticky bottom-0` avec `backdrop-filter: blur`.
- Les sidebars admin / teacher sont collapsibles vers "rail mode" (icônes seules) — non démontré dans le mockup statique mais à implémenter.

## Captures statiques (optionnel)

Pour générer des PNG à partir de ces HTML:
```powershell
# Avec Chrome headless installé
chrome.exe --headless --disable-gpu --screenshot=admin.png --window-size=1440,900 file:///C:/Users/HP/Downloads/pilotage-scolaire-claude/docs/mockups/admin-dashboard.html
chrome.exe --headless --disable-gpu --screenshot=parent.png --window-size=430,932 file:///C:/Users/HP/Downloads/pilotage-scolaire-claude/docs/mockups/parent-dashboard.html
```
