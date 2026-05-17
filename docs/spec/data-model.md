# Modèle de données — Pilotage scolaire v2

> Référence: cahier §9 + extensions v2 (customization, 3 portails, features enrichies).
> Base: **PostgreSQL 15**. Toutes tables métier portent `tenant_id` + RLS.

---

## Conventions

- UUID v7 (lexicographiquement triables) via extension `uuid-ossp` ou génération côté app.
- `created_at` / `updated_at` timestamptz, défaut `now()`.
- `deleted_at` timestamptz nullable pour soft-delete (jamais sur `assessment_result`, `audit_log`, `score_revision`).
- Énumérations natives Postgres (`CREATE TYPE`) versionnées via migrations Prisma.
- Index B-tree sur toutes les FK; index partiels sur status='active' quand pertinent.
- `tenant_id` est la première colonne de chaque index composite multi-tenant.
- Naming: `snake_case` côté DB, `camelCase` côté ORM.

## Extensions Postgres 15

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
-- pg_partman optionnel pour partitionner audit_log
```

---

## 1. Tenancy & école

### `tenant`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL |
| slug | text | UNIQUE, NOT NULL |
| status | tenant_status | active/suspended/archived |
| plan | text | DEFAULT 'standard' |
| settings | jsonb | tenant-level flags |
| created_at | timestamptz | DEFAULT now() |

### `school`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | FK → tenant |
| name | text | NOT NULL |
| school_code | text | UNIQUE — communiqué aux parents pour register |
| address | jsonb |  |
| country | text(2) | ISO 3166 |
| timezone | text | IANA TZ |
| locale | text | défaut 'fr-FR' |
| status | school_status | active/closed |
| created_at | timestamptz |  |

### `school_settings`
| Colonne | Type | Contrainte |
|---|---|---|
| school_id | uuid | PK + FK |
| grading_scale_id | uuid | FK → grading_scale |
| period_structure | text | trimester/semester/custom |
| alert_thresholds | jsonb | seuils par règle |
| notification_preferences | jsonb |  |
| policies | jsonb | guardianship auto-approve, etc. |
| feature_flags | jsonb |  |

### `branding`
| Colonne | Type | Contrainte |
|---|---|---|
| school_id | uuid | PK + FK |
| logo_file_id | uuid | FK → file_object |
| favicon_file_id | uuid | FK |
| display_name | text |  |
| primary_color | text | hex ou oklch |
| accent_color | text |  |
| font_family | text |  |
| email_from | text |  |
| email_reply_to | text |  |

### `grading_scale`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| name | text |  |
| max_score | numeric(5,2) |  |
| mapping | jsonb | tranches → labels |
| is_default | boolean |  |

### `academic_year`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid |  |
| school_id | uuid | FK |
| name | text | "2026-2027" |
| start_date | date |  |
| end_date | date | CHECK > start_date |
| status | year_status | active/closed/archived |
| UNIQUE | (school_id, name) | |

### `term`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| academic_year_id | uuid | FK |
| name | text | "T1", "S1" |
| order_index | smallint |  |
| start_date | date |  |
| end_date | date |  |
| UNIQUE | (academic_year_id, order_index) | |

### `school_calendar_event`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| type | event_type | holiday/vacation/meeting/exam/custom |
| date_from | date |  |
| date_to | date | nullable si 1 jour |
| label | text |  |
| color | text |  |
| audience | jsonb | filtres classe/niveau |

---

## 2. Hiérarchie scolaire

### `cycle`
`(school_id, code)` unique.

### `grade_level`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| cycle_id | uuid | FK |
| name | text |  |
| order_index | smallint |  |

### `class_section`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| academic_year_id | uuid | FK |
| grade_level_id | uuid | FK |
| name | text | "6eA" |
| max_students | smallint | CHECK > 0 |
| status | class_status | active/closed |
| main_teacher_id | uuid | FK teacher nullable |
| UNIQUE | (academic_year_id, grade_level_id, name) | |

### `subject`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| code | text | "MATH" |
| name | text |  |
| icon | text | nom Lucide icon |
| color | text |  |
| default_coefficient | numeric(4,2) |  |
| active | boolean |  |
| UNIQUE | (school_id, code) | |

### `subject_coefficient`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| grade_level_id | uuid | FK nullable |
| class_section_id | uuid | FK nullable |
| subject_id | uuid | FK |
| coefficient | numeric(4,2) | CHECK > 0 |
| effective_from_term_id | uuid | FK |
| CHECK | un seul de grade_level_id / class_section_id non-null | |

---

## 3. Personnes

### `user_profile`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | FK |
| auth_provider_id | text | UNIQUE — sub Keycloak |
| first_name | text |  |
| last_name | text |  |
| email | citext | UNIQUE per tenant |
| phone | text |  |
| email_verified_at | timestamptz |  |
| phone_verified_at | timestamptz |  |
| photo_file_id | uuid | FK file_object |
| status | user_status | active/suspended/deleted |
| locale | text |  |
| preferences | jsonb | UI, notifs |

### `teacher`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| user_profile_id | uuid | FK |
| school_id | uuid | FK |
| employee_number | text |  |
| specialities | text[] |  |
| status | active/inactive |  |
| UNIQUE | (school_id, user_profile_id) | |

### `guardian`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| user_profile_id | uuid | FK UNIQUE |
| profession | text |  |
| second_contact | jsonb | nom+phone second parent |

### `student`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| first_name | text |  |
| last_name | text |  |
| birth_date | date |  |
| external_ref | text | matricule école |
| photo_file_id | uuid |  |
| status | student_status | active/transferred/graduated |

### `guardianship`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| guardian_id | uuid | FK |
| student_id | uuid | FK |
| relationship | enum | mother/father/legal_guardian/other |
| legal_authority | boolean |  |
| status | enum | pending/approved/rejected/revoked |
| requested_at | timestamptz |  |
| reviewed_at | timestamptz |  |
| reviewed_by | uuid | FK |
| UNIQUE | (guardian_id, student_id) | |

---

## 4. Inscriptions

### `enrollment_request`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK |
| guardian_id | uuid | FK |
| requested_class_id | uuid | FK class_section |
| status | enum | pending/approved/rejected |
| reason | text |  |
| documents | jsonb | file_ids joints |
| requested_at | timestamptz |  |

### `enrollment`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK |
| class_section_id | uuid | FK |
| academic_year_id | uuid | FK |
| status | enum | active/transferred/cancelled |
| enrolled_at | timestamptz |  |
| UNIQUE PARTIAL | `(student_id, academic_year_id) WHERE status='active'` | |

### `class_capacity_audit`
Trace dérogations capacité.
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| class_section_id | uuid | FK |
| current_count | smallint |  |
| max_students | smallint |  |
| approved_by | uuid | FK |
| reason | text |  |

---

## 5. Pédagogie

### `teaching_assignment`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| teacher_id | uuid | FK |
| class_section_id | uuid | FK |
| subject_id | uuid | FK |
| term_id | uuid | FK nullable |
| status | active/ended |  |
| UNIQUE PARTIAL | `(teacher_id, class_section_id, subject_id, term_id) WHERE status='active'` | |

### `assessment_plan`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| assignment_id | uuid | FK |
| title | text |  |
| type | enum | homework/quiz/test/exam/composition |
| scheduled_at | timestamptz |  |
| duration_min | int |  |
| max_score | numeric(5,2) |  |
| weight | numeric(4,2) |  |
| visibility | enum | hidden/parent_visible |
| description | text |  |
| attachments | jsonb |  |
| version | int |  |

### `assessment_result`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| assessment_plan_id | uuid | FK |
| student_id | uuid | FK |
| score | numeric(5,2) | nullable |
| status | enum | draft/published/revised/cancelled/absent/exempt/missing |
| comment | text |  |
| published_at | timestamptz |  |
| published_by | uuid | FK |
| version | int |  |
| UNIQUE | (assessment_plan_id, student_id) | |

### `score_revision`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| result_id | uuid | FK |
| previous_score | numeric(5,2) |  |
| new_score | numeric(5,2) |  |
| previous_status | enum |  |
| new_status | enum |  |
| reason | text |  |
| changed_by | uuid | FK |
| changed_at | timestamptz |  |

---

## 6. Présences

### `attendance_session`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| class_section_id | uuid | FK |
| subject_id | uuid | FK nullable |
| teacher_id | uuid | FK |
| timetable_slot_id | uuid | FK nullable |
| scheduled_at | timestamptz |  |
| duration_min | int |  |

### `attendance_record`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| session_id | uuid | FK |
| student_id | uuid | FK |
| status | enum | present/absent/late/excused/exempt |
| arrival_at | timestamptz | nullable si retard |
| comment | text |  |
| marked_by | uuid | FK |
| marked_at | timestamptz |  |
| UNIQUE | (session_id, student_id) | |

### `attendance_justification`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| record_id | uuid | FK |
| submitted_by | uuid | FK guardian |
| reason | text |  |
| document_file_id | uuid | FK file_object |
| status | enum | pending/approved/rejected |
| reviewed_by | uuid |  |

---

## 7. Emploi du temps

### `timetable`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| academic_year_id | uuid | FK |
| name | text |  |
| status | active/archived |  |

### `timetable_slot`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| timetable_id | uuid | FK |
| day_of_week | smallint | 1-7 |
| start_time | time |  |
| end_time | time |  |
| class_section_id | uuid | FK |
| subject_id | uuid | FK |
| teacher_id | uuid | FK |
| room | text |  |
| frequency | enum | weekly/biweekly/once |
| effective_from | date |  |
| effective_to | date | nullable |

---

## 8. Cahier de texte

### `lesson`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| teaching_assignment_id | uuid | FK |
| scheduled_at | timestamptz |  |
| chapter | text |  |
| title | text |  |
| objectives | text |  |
| content | text | markdown |
| homework | text |  |
| status | enum | draft/published |
| visible_to_parents | boolean |  |

### `lesson_resource`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| lesson_id | uuid | FK |
| file_id | uuid | FK file_object nullable |
| external_url | text | nullable |
| label | text |  |

---

## 9. Discipline

### `disciplinary_record`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK |
| reporter_id | uuid | FK |
| type | enum | warning/detention/expulsion_temp/expulsion_perm/other |
| severity | enum | low/medium/high |
| incident_at | timestamptz |  |
| description | text |  |
| sanction | text |  |
| status | enum | open/in_progress/sanctioned/closed |

---

## 10. Communications

### `announcement`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| author_id | uuid | FK |
| title | text |  |
| body | text | markdown |
| audience | jsonb | filters JSON |
| status | enum | draft/scheduled/published/archived |
| scheduled_at | timestamptz |  |
| published_at | timestamptz |  |
| attachments | jsonb |  |

### `announcement_read`
| Colonne | Type | Contrainte |
|---|---|---|
| announcement_id | uuid | FK |
| user_id | uuid | FK |
| read_at | timestamptz |  |
| PK | (announcement_id, user_id) | |

### `conversation` (Phase 5)
### `message` (Phase 5)

---

## 11. Documents library

### `document_library_item`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| folder | text |  |
| title | text |  |
| description | text |  |
| file_id | uuid | FK |
| version | int |  |
| visibility | enum | public/admin/teacher/parent |
| tags | text[] |  |

---

## 12. Analytics (read models)

### `student_subject_snapshot`
| Colonne | Type | Contrainte |
|---|---|---|
| student_id | uuid |  |
| subject_id | uuid |  |
| term_id | uuid |  |
| average | numeric(5,2) |  |
| weighted_average | numeric(5,2) |  |
| trend | enum |  |
| risk_level | enum |  |
| sample_size | int |  |
| last_grade_at | timestamptz |  |
| computed_at | timestamptz |  |
| computation_version | int |  |
| PK | (student_id, subject_id, term_id) | |

### `student_term_snapshot`, `student_global_snapshot`
Idem agrégés.

### `class_subject_distribution`
Distribution notes par classe × matière × période.

### `school_kpi_snapshot`
KPIs agrégés école (nb élèves, taux présence, alertes ouvertes, moyenne globale par mois).

---

## 13. Alertes

### `alert_rule`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| code | text | unique per school |
| label | text |  |
| description | text |  |
| enabled | boolean |  |
| severity_default | enum |  |
| rule_definition | jsonb | AST custom rule |
| message_template_id | uuid | FK notification_template |
| recommendation_template | text |  |

### `alert`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| student_id | uuid | FK |
| subject_id | uuid | FK nullable |
| rule_id | uuid | FK alert_rule |
| severity | enum |  |
| explanation | jsonb | variables + message rendu |
| recommendation | text |  |
| status | enum | open/acknowledged/resolved/dismissed |
| raised_at | timestamptz |  |
| UNIQUE PARTIAL | `(student_id, subject_id, rule_id) WHERE status='open'` | déduplication |

### `alert_status_history`
Trace transitions.

---

## 14. Audit append-only

### `audit_log`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid |  |
| actor_id | uuid | FK |
| actor_role | text |  |
| portal | text | admin/teacher/parent/system |
| action | text |  |
| resource_type | text |  |
| resource_id | uuid |  |
| before | jsonb |  |
| after | jsonb |  |
| ip_address | inet |  |
| user_agent | text |  |
| hash | text | SHA-256 chained |
| prev_hash | text |  |
| created_at | timestamptz | DEFAULT now() |
| REVOKE UPDATE,DELETE | sur la table | |
| Index | (tenant_id, created_at DESC) | |
| Partitionnement | mensuel via pg_partman optionnel | |

---

## 15. Notifications

### `notification`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| recipient_user_id | uuid | FK |
| portal | text |  |
| type | text |  |
| title | text |  |
| body | text |  |
| data | jsonb |  |
| channels | text[] |  |
| read_at | timestamptz |  |
| created_at | timestamptz |  |

### `notification_template`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| event_type | text |  |
| channel | text | email/push/sms/in_app |
| locale | text |  |
| subject | text |  |
| body_html | text |  |
| body_text | text |  |
| variables | jsonb | doc |

### `webpush_subscription`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| user_profile_id | uuid | FK |
| endpoint | text | UNIQUE |
| p256dh | text |  |
| auth | text |  |
| user_agent | text |  |
| created_at | timestamptz |  |

### `notification_preference`
| Colonne | Type | Contrainte |
|---|---|---|
| user_profile_id | uuid | FK |
| event_type | text |  |
| channels | text[] |  |
| frequency | enum | instant/daily/weekly/never |
| quiet_hours_start | time |  |
| quiet_hours_end | time |  |
| PK | (user_profile_id, event_type) | |

---

## 16. Customization

### `custom_field_definition`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | FK |
| scope | enum | student/teacher/guardian/class/assessment |
| key | text |  |
| label | text |  |
| type | enum | text/textarea/number/date/select/multi/boolean/file/email/phone |
| required | boolean |  |
| options | jsonb | pour select |
| validation | jsonb | regex, min, max |
| visibility | jsonb | role-based |
| order_index | int |  |
| status | active/archived |  |
| UNIQUE | (school_id, scope, key) | |

### `custom_field_value`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| definition_id | uuid | FK |
| entity_id | uuid |  |
| value | jsonb |  |
| UNIQUE | (definition_id, entity_id) | |

### `custom_form_definition`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid |  |
| slug | text |  |
| title | text |  |
| description | text |  |
| schema | jsonb | fields[] |
| status | draft/published/archived |  |
| audience | jsonb |  |

### `custom_form_submission`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| definition_id | uuid | FK |
| submitted_by | uuid | FK |
| data | jsonb |  |
| files | jsonb | file_ids |
| status | submitted/reviewed/approved/rejected |
| reviewed_by | uuid |  |
| submitted_at | timestamptz |  |

### `permission`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| code | text | UNIQUE — "students.read" |
| label | text |  |
| resource_type | text |  |
| action | text |  |
| description | text |  |

### `role`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid | NULL = global |
| name | text |  |
| slug | text |  |
| description | text |  |
| is_system | boolean |  |
| portal | text | admin/teacher/parent — portail principal |

### `role_permission`
| Colonne | Type | Contrainte |
|---|---|---|
| role_id | uuid | FK |
| permission_id | uuid | FK |
| PK | (role_id, permission_id) | |

### `user_role`
| Colonne | Type | Contrainte |
|---|---|---|
| user_profile_id | uuid | FK |
| role_id | uuid | FK |
| school_id | uuid | FK |
| granted_by | uuid | FK |
| granted_at | timestamptz |  |
| revoked_at | timestamptz |  |
| PK | (user_profile_id, role_id, school_id) | |

### `report_template`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid |  |
| name | text |  |
| type | enum | bulletin/synthesis/class_grades/attendance |
| template_source | text | handlebars/markdown |
| variables | jsonb | documentation |
| status | active/archived |  |

### `i18n_override`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid |  |
| locale | text |  |
| key | text |  |
| value | text |  |
| UNIQUE | (school_id, locale, key) | |

### `dashboard_layout`
| Colonne | Type | Contrainte |
|---|---|---|
| user_profile_id | uuid | FK |
| portal | text |  |
| layout | jsonb | react-grid-layout |
| widgets_config | jsonb |  |
| PK | (user_profile_id, portal) | |

---

## 17. Bulk imports

### `import_batch`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| school_id | uuid |  |
| type | enum | students/teachers/classes/grades/attendance/parents |
| file_id | uuid | FK file_object |
| status | enum | uploaded/validated/previewed/applying/applied/failed/rolled_back |
| mode | enum | all_or_nothing/skip_invalid |
| summary | jsonb | counts |
| started_at | timestamptz |  |
| completed_at | timestamptz |  |
| triggered_by | uuid |  |

### `import_row`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| batch_id | uuid | FK |
| row_index | int |  |
| status | enum | pending/valid/invalid/applied/skipped |
| payload | jsonb |  |
| errors | jsonb |  |
| created_entity_id | uuid | si applied |

---

## 18. Sessions & device

### `user_session`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| user_profile_id | uuid | FK |
| portal | text |  |
| device | text |  |
| ip | inet |  |
| user_agent | text |  |
| created_at | timestamptz |  |
| last_seen_at | timestamptz |  |
| revoked_at | timestamptz |  |

---

## 19. Recherche full-text

### `search_index`
| Colonne | Type | Contrainte |
|---|---|---|
| entity_type | text |  |
| entity_id | uuid |  |
| tenant_id | uuid |  |
| school_id | uuid |  |
| portal_visibility | text[] |  |
| content_tsv | tsvector |  |
| metadata | jsonb |  |
| Index | GIN (content_tsv) | |
| PK | (entity_type, entity_id) | |

Alimenté par triggers sur entités sources (students, teachers, classes, subjects, documents).

---

## 20. Documents & fichiers

### `file_object`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid |  |
| s3_key | text |  |
| mime | text |  |
| size_bytes | bigint |  |
| owner_id | uuid |  |
| public | boolean |  |
| created_at | timestamptz |  |

### `document_export`
Métadonnées exports PDF (lien S3, type, période, génération).

### `outbox_event`
| Colonne | Type | Contrainte |
|---|---|---|
| id | uuid | PK |
| aggregate_type | text |  |
| aggregate_id | uuid |  |
| type | text |  |
| payload | jsonb |  |
| status | enum | pending/sent/failed |
| created_at | timestamptz |  |
| sent_at | timestamptz |  |
| Index PARTIAL | (created_at) WHERE status='pending' | |

---

## 21. Contraintes métier critiques (triggers + RLS)

### Triggers
```sql
-- Empêche dépassement capacité classe sauf dérogation
CREATE FUNCTION enforce_class_capacity() RETURNS trigger ...;

-- Empêche suppression note publiée
CREATE FUNCTION protect_published_results() RETURNS trigger ...;

-- Append-only sur audit_log
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC, app_user;
GRANT INSERT ON audit_log TO app_user;
GRANT SELECT ON audit_log TO auditor;

-- Trigger audit hash chaining
CREATE FUNCTION audit_hash_chain() RETURNS trigger AS $$
BEGIN
  NEW.prev_hash := (SELECT hash FROM audit_log WHERE tenant_id = NEW.tenant_id ORDER BY created_at DESC LIMIT 1);
  NEW.hash := encode(digest(NEW.id::text || NEW.action || NEW.resource_id::text || COALESCE(NEW.prev_hash, ''), 'sha256'), 'hex');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Trigger search index sync
CREATE FUNCTION sync_search_index() RETURNS trigger ...;
```

### Row-Level Security
Toutes les tables métier:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Rôles Postgres:
- `app_user` — application (RLS active)
- `app_migrator` — migrations (BYPASSRLS)
- `auditor` — super-admin lecture cross-tenant (BYPASSRLS)

---

## 22. Stratégie de migration

- Prisma migrations versionnées dans `apps/api/prisma/migrations/`.
- Pattern **expand-and-contract** pour zero-downtime.
- Migrations testées via testcontainers Postgres 15 en CI.
- Snapshot prod restauré en staging chaque semaine.

---

## 23. Compatibilité Postgres 15

Tous les features utilisés sont **compatibles Postgres 15**:
- ✓ JSONB + GIN
- ✓ RLS policies
- ✓ Partial indexes
- ✓ Generated columns (stored)
- ✓ tsvector + pg_trgm
- ✓ uuid-ossp / pgcrypto
- ✓ Partitionnement déclaratif
- ✓ Transactions ACID
- ✓ Async replication (futur)

Pas utilisé (features Postgres 16+ évitées): `JSON_TABLE`, `MERGE...RETURNING`, parallel hash join improvements (non bloquant).

Migration future PG15 → PG16 documentée comme non-breaking pour ce schéma.
