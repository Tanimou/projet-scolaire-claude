# ADR-013: Customization Layer — settings + custom fields + JSONB + rule engine

**Status:** Accepted
**Date:** 2026-05-15
**Decision drivers:** Demande utilisateur v2 — "plateforme complètement customizable surtout pour le portail administrateur".

## Context

L'admin doit pouvoir customiser sans code:
- Branding (logo, couleurs, police)
- Échelle de notation
- Seuils d'alerte
- Règles d'alerte complètes (rule builder)
- Custom fields sur entités (élève, prof, classe...)
- Custom forms (form builder)
- Custom roles & permissions
- Templates emails et rapports
- Libellés (i18n override)
- Dashboard widgets layout

Sans pour autant exposer un risque de sécurité (injection) ou de dégradation perf.

## Decision

**Strategy: persistance JSONB pour structures flexibles + tables relationnelles pour références fortes + rule engine interprété en sandbox**.

### 13.1 Couches
1. **Branding & settings** — tables dédiées avec colonnes typées; valeurs lues au boot via API et appliquées en CSS variables côté front.
2. **Custom fields** — `custom_field_definition` (schéma) + `custom_field_value` (data en JSONB); rendu front via `<DynamicFormFields>` qui interprète la définition.
3. **Custom forms** — `custom_form_definition.schema` JSON Schema; rendu via librairie `formily` ou implémentation maison; soumissions stockées en JSONB.
4. **Rule engine alertes** — `alert_rule.rule_definition` JSONB stockant un AST de règle; interpréteur strict en TS dans `apps/worker` qui évalue contre snapshot.
5. **Custom roles** — tables `permission`, `role`, `role_permission`, `user_role`; permissions appliquées via décorateur `@RequiresPermission('xxx')` côté NestJS.
6. **Templates email/report** — sources Markdown + variables (handlebars-like); compilées + sanitisées avant rendu.
7. **i18n override** — `i18n_override` table merge avec messages next-intl côté serveur.
8. **Dashboard layouts** — `dashboard_layout.layout` JSONB compatible react-grid-layout.

### 13.2 Sandbox d'évaluation du rule engine
Le rule engine ne doit jamais exécuter du code arbitraire:
- AST limité aux opérateurs: comparaison (`<`, `<=`, `=`, `>=`, `>`), logique (`AND`, `OR`, `NOT`), arithmétique sur variables connues.
- Variables résolues uniquement depuis snapshot contexte (jamais arbitraire).
- Timeout 1s par évaluation.
- Pas d'eval JS; interpréteur custom.

### 13.3 Sécurité templates
- Markdown templates sanitizés via DOMPurify côté rendu HTML.
- Variables échappées par défaut; `{{{ rawHtml }}}` interdit.
- PDF rendering côté worker en process isolé.

### 13.4 Performances
- Branding/settings cachés en mémoire applicative + invalidation sur PUT.
- Custom field definitions cachées; valeurs lues à la volée avec JSONB GIN index si recherche.
- Rule engine: pre-compile règle au save, cache compiled.

## Options Considered

### Option A: JSONB + rule engine custom (choisi)
- Flexibilité max sans schéma fixe
- Performance Postgres GIN ok
- Sécurité contrôlée

### Option B: EAV (Entity-Attribute-Value) tables séparées par type
- Plus complexe à requêter
- Performance dégradée si beaucoup d'attributs

### Option C: Tout via plugin engine (extensions JS chargées dynamiquement)
- Trop risqué côté sécurité pour ce contexte (données enfants)

## Consequences

**Facile:**
- Admin auto-suffisant pour customisation MVP
- Pas de code nécessaire pour ajouter custom fields ou rules
- Evolution future sans migration breaking

**Difficile:**
- UI dynamique demande composants robustes (`<DynamicFormFields>` + tests)
- Rule engine doit être testé exhaustivement (cas tordus)
- Migration de définitions custom-fields (renommage clé) à gérer

## Action Items

1. [ ] Implémenter `<DynamicFormFields>` avec tests Storybook complets
2. [ ] Rule engine TS isolé en `packages/rule-engine` + tests exhaustifs
3. [ ] Sanitization templates testée
4. [ ] Documentation utilisateur "Customiser votre instance" dans docs/admin-guide
