import { getHandler, type ImportContext } from '@pilotage/imports-core';

import { mapOneRosterBundle, ONEROSTER_MAX_ROWS, rowsToCsv } from './oneroster.adapter';

/**
 * E11-S3 (Murat P0) — the OneRoster CSV-bundle adapter guards.
 *
 *  1. A mapped bundle produces rows that pass the SAME type `validateRow` an
 *     equivalent CSV upload would (no forked validation; AC-7).
 *  2. The OneRoster `sourcedId` is the idempotency anchor carried in
 *     `externalRef` (a re-sync converges, never duplicates; AC-4).
 *  3. Mapping reads ONLY roster identity + enrollment — no grades / no medical /
 *     no birthDate (which lives in RGPD-sensitive demographics.csv) leak.
 *  4. Non-student users and soft-deleted (`tobedeleted`) rows are skipped.
 */

const USERS_CSV = [
  'sourcedId,status,role,givenName,familyName,email,dateLastModified',
  'stu-001,active,student,Léa,Martin,lea.martin@ex.fr,2026-01-01',
  'stu-002,active,student,Tom,Bernard,,2026-01-01',
  'tea-001,active,teacher,Marie,Dupont,marie@ex.fr,2026-01-01', // skipped (not student)
  'stu-003,tobedeleted,student,Old,Student,,2026-01-01', // skipped (soft-deleted)
].join('\n');

const CLASSES_CSV = [
  'sourcedId,status,title,grades,classCode',
  'cls-6a,active,6eA,6ème,6A',
  'cls-5b,active,5eB,5ème,5B',
].join('\n');

const ENROLLMENTS_CSV = [
  'sourcedId,status,classSourcedId,userSourcedId,role',
  'enr-1,active,cls-6a,stu-001,student',
  'enr-2,active,cls-6a,stu-002,student',
  'enr-3,active,cls-6a,tea-001,teacher', // skipped (not student)
].join('\n');

describe('mapOneRosterBundle', () => {
  it('maps users.csv (role=student) onto students rows with sourcedId → externalRef', () => {
    const { mapped } = mapOneRosterBundle({ users: USERS_CSV });
    const students = mapped.find((m) => m.type === 'students');
    expect(students).toBeDefined();
    expect(students!.rows).toHaveLength(2); // tea-001 + soft-deleted stu-003 skipped
    expect(students!.skipped).toBe(2);

    const lea = students!.rows[0]!;
    expect(lea.firstname).toBe('Léa');
    expect(lea.lastname).toBe('Martin');
    // The idempotency anchor — sourcedId carried verbatim into externalRef.
    expect(lea.externalref).toBe('stu-001');
    expect(lea.email).toBe('lea.martin@ex.fr');
    // RGPD-min: no birthDate (demographics.csv is intentionally not read).
    expect(lea.birthdate).toBe('');
    expect(lea.notes).toBe('');
  });

  it('maps classes.csv onto classes rows (title → name, first grade → gradeLevel)', () => {
    const { mapped } = mapOneRosterBundle({ classes: CLASSES_CSV });
    const classes = mapped.find((m) => m.type === 'classes');
    expect(classes!.rows).toHaveLength(2);
    expect(classes!.rows[0]).toMatchObject({ name: '6eA', gradelevel: '6ème' });
  });

  it('maps enrollments.csv (role=student) onto (studentExternalRef, className)', () => {
    const { mapped } = mapOneRosterBundle({
      users: USERS_CSV,
      classes: CLASSES_CSV,
      enrollments: ENROLLMENTS_CSV,
    });
    const enr = mapped.find((m) => m.type === 'enrollments');
    expect(enr!.rows).toHaveLength(2); // teacher enrollment skipped
    expect(enr!.rows[0]).toMatchObject({ studentexternalref: 'stu-001', classname: '6eA' });
    expect(enr!.rows[1]).toMatchObject({ studentexternalref: 'stu-002', classname: '6eA' });
  });

  it('orders mapped types classes → students → enrollments (apply-safe dependency order)', () => {
    const { mapped } = mapOneRosterBundle({
      users: USERS_CSV,
      classes: CLASSES_CSV,
      enrollments: ENROLLMENTS_CSV,
    });
    expect(mapped.map((m) => m.type)).toEqual(['classes', 'students', 'enrollments']);
  });

  it('produces a warning (and zero mapped types) on an empty bundle', () => {
    const { mapped, warnings } = mapOneRosterBundle({});
    expect(mapped).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('mapped student rows pass the SAME studentsHandler.validateRow as a CSV upload', () => {
    const { mapped } = mapOneRosterBundle({ users: USERS_CSV });
    const handler = getHandler('students')!;
    const ctx: ImportContext = {
      tenantId: 't1',
      schoolId: 's1',
      caches: {
        gradeLevelsByCode: new Map(),
        gradeLevelsByName: new Map(),
        classNamesPerYearLevel: new Set(),
        classSectionsByName: new Map(),
        subjectsByCode: new Map(),
        studentExternalRefs: new Map(),
        studentsByExternalRef: new Map(),
        guardiansByEmail: new Map(),
        activeAcademicYearId: 'ay1',
      },
    };
    for (const raw of mapped.find((m) => m.type === 'students')!.rows) {
      const parsed = handler.parseRow(raw);
      const result = handler.validateRow(parsed, ctx);
      expect(result.ok).toBe(true);
      // externalRef survives the parse → normalized payload (the anchor).
      expect((result.normalized as { externalRef?: string }).externalRef).toBe(raw.externalref);
    }
  });
});

describe('rowsToCsv', () => {
  it('serialises mapped rows back to a re-parseable CSV body (BOM + escaping)', () => {
    const csv = rowsToCsv(
      ['firstName', 'lastName', 'externalRef'],
      [{ firstname: 'A,B', lastname: 'C"D', externalref: 'x1' }],
    );
    expect(csv).toContain('firstName,lastName,externalRef');
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"C""D"');
  });
});

describe('ONEROSTER_MAX_ROWS', () => {
  it('mirrors the import pipeline 5000-row cap', () => {
    expect(ONEROSTER_MAX_ROWS).toBe(5_000);
  });
});
