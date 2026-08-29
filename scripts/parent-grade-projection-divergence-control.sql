-- S-E03-3 / PF-05 residual (i) — THE NEGATIVE CONTROL for the divergence probe.
--
-- The probe measured ZERO divergence on the seed. A zero from an instrument that
-- cannot register anything is not a measurement, so this script MANUFACTURES the
-- two divergences inside a transaction, re-measures with the SAME arithmetic, and
-- ROLLS BACK. If the counters move, the zero above is a fact about the SEED.
-- If they do not move, the probe is broken and its zero means nothing.
--
-- NOTHING IS COMMITTED. The final SELECT after ROLLBACK re-asserts the row count.

\pset pager off
\set ON_ERROR_STOP on

BEGIN;

-- The victim: a student who already has exactly one published grade.
CREATE TEMP TABLE victim AS
SELECT g.student_id, s.tenant_id, s.school_id
FROM grade g JOIN student s ON s.id = g.student_id
ORDER BY g.student_id
LIMIT 1;

-- (b) AXIS ABSENT: an absence row, in the window year, on an assessment the
--     victim has no grade for. B keeps it; A drops it.
INSERT INTO grade (id, tenant_id, assessment_id, student_id, value, is_absent,
                   status, entered_by, entered_at, created_at, updated_at)
SELECT gen_random_uuid(), v.tenant_id, a.id, v.student_id, NULL, true,
       'published', (SELECT entered_by FROM grade LIMIT 1),
       now(), now(), now()
FROM victim v
CROSS JOIN LATERAL (
  SELECT a.id FROM assessment a
  WHERE a.tenant_id = v.tenant_id
    AND NOT EXISTS (SELECT 1 FROM grade g2 WHERE g2.assessment_id = a.id AND g2.student_id = v.student_id)
  LIMIT 1
) a;

-- (a) AXIS YEAR: a whole assignment + assessment in a DIFFERENT academic year of
--     the same school, and a published, non-absent grade on it. B keeps it;
--     A drops it because it is outside the reporting window.
INSERT INTO teaching_assignment (id, tenant_id, teacher_profile_id, class_section_id,
                                 subject_id, academic_year_id, created_at, updated_at)
-- NOTE: `teaching_assignment` is UNIQUE on (teacher_profile_id, class_section_id,
-- subject_id) WITHOUT academic_year_id, so the same triple cannot be repeated in
-- a second year at all. The control therefore borrows a DIFFERENT subject. That
-- constraint is itself recorded as a finding — it is why the seed has one year.
SELECT '00000000-0000-0000-0000-0000000000a1', v.tenant_id, ta.teacher_profile_id,
       ta.class_section_id, other_subject.id, other.id, now(), now()
FROM victim v
CROSS JOIN LATERAL (SELECT * FROM teaching_assignment t WHERE t.tenant_id = v.tenant_id LIMIT 1) ta
CROSS JOIN LATERAL (
  SELECT s.id FROM subject s
  WHERE s.id <> ta.subject_id
    AND NOT EXISTS (
      SELECT 1 FROM teaching_assignment t2
      WHERE t2.teacher_profile_id = ta.teacher_profile_id
        AND t2.class_section_id = ta.class_section_id
        AND t2.subject_id = s.id
    )
  LIMIT 1
) other_subject
CROSS JOIN LATERAL (
  SELECT ay.id FROM academic_year ay
  WHERE ay.school_id = v.school_id AND ay.id <> ta.academic_year_id
  LIMIT 1
) other;

INSERT INTO assessment (id, tenant_id, teaching_assignment_id, teacher_profile_id,
                        title, kind, max_score, is_published, created_at, updated_at)
SELECT '00000000-0000-0000-0000-0000000000a2', v.tenant_id,
       '00000000-0000-0000-0000-0000000000a1', ta.teacher_profile_id,
       'CONTROL — other year', 'written_test', 20.0, true, now(), now()
FROM victim v
CROSS JOIN LATERAL (SELECT * FROM teaching_assignment t WHERE t.tenant_id = v.tenant_id LIMIT 1) ta;

INSERT INTO grade (id, tenant_id, assessment_id, student_id, value, is_absent,
                   status, entered_by, entered_at, created_at, updated_at)
SELECT gen_random_uuid(), v.tenant_id, '00000000-0000-0000-0000-0000000000a2',
       v.student_id, 15.0, false, 'published',
       (SELECT entered_by FROM grade LIMIT 1), now(), now(), now()
FROM victim v;

-- RE-MEASURE, restricted to the victim, with the SAME arithmetic as the probe.
WITH window_enrollment AS (
  SELECT DISTINCT ON (e.student_id) e.student_id, e.academic_year_id
  FROM enrollment e WHERE e.status = 'active'
  ORDER BY e.student_id, e.enrolled_at DESC, e.id DESC
)
SELECT
  'AFTER INJECTION (expected: b > a, both axes 1)' AS phase,
  COUNT(*) FILTER (WHERE g.status IN ('published','revised')) AS b_count,
  COUNT(*) FILTER (
    WHERE g.status IN ('published','revised') AND g.is_absent = false
      AND w.academic_year_id IS NOT NULL AND a.academic_year_id = w.academic_year_id
  ) AS a_count,
  COUNT(*) FILTER (WHERE g.status IN ('published','revised') AND g.is_absent = true) AS axis_absent,
  COUNT(*) FILTER (
    WHERE g.status IN ('published','revised') AND g.is_absent = false
      AND (w.academic_year_id IS NULL OR a.academic_year_id IS DISTINCT FROM w.academic_year_id)
  ) AS axis_year
FROM grade g
JOIN assessment a2 ON a2.id = g.assessment_id
JOIN teaching_assignment a ON a.id = a2.teaching_assignment_id
LEFT JOIN window_enrollment w ON w.student_id = g.student_id
WHERE g.student_id = (SELECT student_id FROM victim);

ROLLBACK;

-- AFTER ROLLBACK: the database is exactly as it was found.
SELECT 'AFTER ROLLBACK' AS phase,
       COUNT(*) AS grades,
       COUNT(*) FILTER (WHERE is_absent) AS absences
FROM grade;
