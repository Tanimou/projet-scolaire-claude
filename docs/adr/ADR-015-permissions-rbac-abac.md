# ADR-015: Permission model — RBAC + ABAC + Custom roles

**Status:** Accepted
**Date:** 2026-05-15

## Context

Le projet a:
- 3 rôles principaux (admin, teacher, parent) + super-admin
- Volonté de custom roles (ADR-013)
- Règles ABAC métier strictes (parent voit l'élève SEULEMENT si guardianship approuvé; prof note SEULEMENT son affectation)
- Multi-tenant strict

## Decision

**Modèle 3 couches:**

### Couche 1 — RBAC classique (Keycloak realm roles)
Rôles fixes: `super_admin`, `school_admin`, `teacher`, `parent`, `student` (futur).
Stockés dans JWT, lus par garde NestJS `@Roles('teacher')`.

### Couche 2 — Custom roles applicatifs
Tables `permission`, `role`, `role_permission`, `user_role` (voir data-model §16).
Custom roles ajoutables par admin (ex. "comptable", "surveillant").
Permissions sous forme de codes `<resource>.<action>` (ex. `students.read`, `enrollments.approve`).
Garde NestJS `@RequiresPermission('students.read')` vérifie permissions effectives = union(realm role permissions) + (custom role permissions assignées).

### Couche 3 — ABAC métier
Gardes spécifiques sur règles métier:
- `@AuthorizeStudentAccess()` — parent doit avoir `guardianship.status='approved'` sur l'élève
- `@AuthorizeTeachingAssignment()` — prof doit avoir `teaching_assignment` actif sur (classe, matière, période)
- `@SameTenant()` — vérifie cohérence tenant_id sur ressources
- `@SameSchool()` — vérifie cohérence school_id (multi-school dans même tenant)

### Couche 4 (défense en profondeur) — RLS Postgres
RLS active sur toutes tables métier (ADR-002).
Si garde NestJS est bypassé (bug), RLS refuse l'accès.

## Permission catalog (extrait)

| Code | Resource | Action |
|---|---|---|
| `schools.read` | school | read |
| `schools.write` | school | write |
| `classes.read/write/delete` | class | * |
| `students.read/write/delete` | student | * |
| `enrollments.read/write/approve` | enrollment | * |
| `grades.read/write/publish/revise` | grade | * |
| `attendance.read/write` | attendance | * |
| `lessons.read/write/publish` | lesson | * |
| `audit.read` | audit | read |
| `branding.write` | branding | write |
| `custom_fields.write` | custom_field | write |
| `roles.write` | role | write |
| `imports.execute` | import | execute |
| etc. |  |  |

## Rôles système prédéfinis

| Rôle | Description | Portail principal |
|---|---|---|
| `super_admin` | Opère la plateforme, accès cross-tenant | — |
| `school_admin` | Gère son école entièrement | admin |
| `teacher` | Pilote ses classes | teacher |
| `parent` | Voit ses enfants approuvés | parent |
| `student` (futur) | Voit son propre dossier | (futur) |

Custom roles peuvent être créés dans n'importe quel portail principal.

## Consequences

**Facile:**
- Flexibilité custom roles
- Vérifications composables via décorateurs NestJS
- Défense en profondeur (4 couches)

**Difficile:**
- Performance: garde ABAC fait des queries DB → cacher avec Redis (TTL court)
- Audit changements de rôle obligatoire

## Action Items

1. [ ] Catalog `permission` seedé en base avec ~80 permissions initiales
2. [ ] Rôles système (school_admin, teacher, parent) seedés avec leurs permissions par défaut
3. [ ] Décorateurs NestJS `@Roles`, `@RequiresPermission`, `@AuthorizeStudentAccess`, `@AuthorizeTeachingAssignment` implémentés Phase 1
4. [ ] Tests d'intégration permissions complets
5. [ ] Audit log obligatoire sur changements `user_role`
