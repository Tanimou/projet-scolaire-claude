-- S-E03-3 / PF-05 residual (i) — MEASURE the A/B divergence on the real seed.
--
-- A = AnalyticsService.parentDashboard (analytics.service.ts:1102)
--     where: tenantId, studentId, status IN (published,revised), isAbsent=false,
--            assessment.teachingAssignment.academicYearId = <reporting window year>
--     The window year is selectReportingWindowEnrollment(): the ACTIVE enrollment
--     ordered by (enrolledAt DESC, id DESC), first row, its academicYearId.
--     When there is no active enrollment the read is NEVER EMITTED and A is [].
--
-- B = GradesController.studentGrades (grades.controller.ts:428), PARENT principal
--     where: tenantId, studentId, status IN (published,revised)
--     No year filter. No isAbsent filter.
--
-- This script ASSERTS NOTHING. It counts. The ruling is made from the numbers.

\pset pager off

WITH window_enrollment AS (
  SELECT DISTINCT ON (e.student_id)
         e.student_id,
         e.academic_year_id
  FROM enrollment e
  WHERE e.status = 'active'
  ORDER BY e.student_id, e.enrolled_at DESC, e.id DESC
),
per_student AS (
  SELECT
    g.student_id,
    -- B: what /parent/grades lists
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
    ) AS b_count,
    -- A: what /parent/dashboard scores
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
        AND g.is_absent = false
        AND w.academic_year_id IS NOT NULL
        AND a.academic_year_id = w.academic_year_id
    ) AS a_count,
    -- axis (b): rows B keeps and A drops because they are ABSENCES
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
        AND g.is_absent = true
    ) AS axis_absent,
    -- axis (a): non-absent rows B keeps and A drops because of the YEAR
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
        AND g.is_absent = false
        AND (w.academic_year_id IS NULL OR a.academic_year_id IS DISTINCT FROM w.academic_year_id)
    ) AS axis_year
  FROM grade g
  JOIN assessment a2 ON a2.id = g.assessment_id
  JOIN teaching_assignment a ON a.id = a2.teaching_assignment_id
  LEFT JOIN window_enrollment w ON w.student_id = g.student_id
  GROUP BY g.student_id
)
SELECT
  COUNT(*)                                        AS students_with_grades,
  SUM(b_count)                                    AS total_b,
  SUM(a_count)                                    AS total_a,
  SUM(axis_absent)                                AS total_axis_absent,
  SUM(axis_year)                                  AS total_axis_year,
  COUNT(*) FILTER (WHERE a_count <> b_count)      AS students_diverging,
  COUNT(*) FILTER (WHERE a_count = 0 AND b_count > 0) AS students_a_zero_b_nonzero
FROM per_student;

-- The ten worst divergences, named, so the ruling is made on rows and not on a total.
WITH window_enrollment AS (
  SELECT DISTINCT ON (e.student_id)
         e.student_id, e.academic_year_id
  FROM enrollment e
  WHERE e.status = 'active'
  ORDER BY e.student_id, e.enrolled_at DESC, e.id DESC
),
per_student AS (
  SELECT
    g.student_id,
    COUNT(*) FILTER (WHERE g.status IN ('published','revised')) AS b_count,
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
        AND g.is_absent = false
        AND w.academic_year_id IS NOT NULL
        AND a.academic_year_id = w.academic_year_id
    ) AS a_count,
    COUNT(*) FILTER (WHERE g.status IN ('published','revised') AND g.is_absent = true) AS axis_absent,
    COUNT(*) FILTER (
      WHERE g.status IN ('published','revised')
        AND g.is_absent = false
        AND (w.academic_year_id IS NULL OR a.academic_year_id IS DISTINCT FROM w.academic_year_id)
    ) AS axis_year
  FROM grade g
  JOIN assessment a2 ON a2.id = g.assessment_id
  JOIN teaching_assignment a ON a.id = a2.teaching_assignment_id
  LEFT JOIN window_enrollment w ON w.student_id = g.student_id
  GROUP BY g.student_id
)
SELECT s.last_name, s.first_name, p.b_count, p.a_count, p.axis_absent, p.axis_year
FROM per_student p
JOIN student s ON s.id = p.student_id
WHERE p.a_count <> p.b_count
ORDER BY (p.b_count - p.a_count) DESC, s.last_name
LIMIT 10;
