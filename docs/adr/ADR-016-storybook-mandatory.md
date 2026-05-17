# ADR-016: Storybook obligatoire pour le design system

**Status:** Accepted
**Date:** 2026-05-15

## Context

3 portails partagent un design system. Sans documentation visuelle vivante, le système se fragmente et la dette UI explose.

## Decision

**Tout composant du design system (`packages/ui` + composants métier domain partagés) DOIT avoir des stories Storybook.**

Definition of Done inclut: stories couvrant variants, états (default/hover/focus/disabled/loading), light/dark mode, RTL skeleton, responsive.

Visual regression via:
- Chromatic (commercial, recommandé) OU
- Playwright snapshots (open source)

CI bloque si regression visuelle non approuvée.

## Setup
- `apps/storybook` (ou intégré dans `packages/ui`)
- Stories à côté du composant: `MyComponent/MyComponent.stories.tsx`
- Decorators globaux: theme provider, i18n provider, query client mock
- Accessibility addon: `@storybook/addon-a11y`

## Consequences

**Facile:**
- Composants documentés visuellement
- Détection régression automatique
- Onboarding nouveaux devs facilité
- Designer peut consulter le design system live

**Difficile:**
- Coût initial setup (mitigé par templates)
- Maintenance stories (mitigé par règle PR review)

## Action Items

1. [ ] Storybook initialisé Phase 0
2. [ ] Template story dans `packages/ui` à dupliquer
3. [ ] Chromatic ou Playwright snapshots en CI Phase 1
4. [ ] PR template inclut checkbox "Story Storybook ajoutée"
