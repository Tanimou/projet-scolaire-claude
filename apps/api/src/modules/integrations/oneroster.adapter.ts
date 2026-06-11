import { parse } from 'papaparse';

/**
 * E11-S3 — the OneRoster v1.1 CSV-bundle adapter (pure, no DB).
 *
 * Maps a OneRoster CSV bundle onto the EXISTING `ImportRow` raw-row shape for
 * each matching `ImportType`, so a sync becomes a normal validated `ImportBatch`
 * that inherits S1's async apply + S2's reconciliation panel for free. We only
 * map **roster identity + enrollment** (RGPD minimal-data — no grades, no
 * attendance, no medical, no guardian-private fields). The OneRoster `sourcedId`
 * is carried into `externalRef` as the idempotency anchor (a re-sync converges,
 * never duplicates — the S2/S4 contract).
 *
 * This file does ZERO persistence and ZERO network IO: it parses the supplied
 * CSV text of each bundle member and returns, per `ImportType`, an array of
 * `Record<string,string>` rows in the SAME header shape the existing type
 * handlers' `parseRow`/`validateRow` already accept (verified against
 * `@pilotage/imports-core` handlers). The caller then runs those handlers
 * unchanged — no forked validation.
 */

/** The members of a OneRoster v1.1 CSV bundle this adapter reads. */
export interface OneRosterBundle {
  /** users.csv — we read only role=student rows for identity. */
  users?: string;
  /** classes.csv — class sections. */
  classes?: string;
  /** enrollments.csv — we read only role=student rows. */
  enrollments?: string;
  /** courses.csv — optional; used to resolve a class's subject/title context. */
  courses?: string;
  /** academicSessions.csv / orgs.csv — accepted but not mapped in v1 (roster-min). */
  academicSessions?: string;
  orgs?: string;
}

/** One mapped type's worth of raw rows, ready for the existing handler. */
export interface MappedType {
  type: 'students' | 'classes' | 'enrollments';
  rows: Record<string, string>[];
  /** Per-source-row diagnostics (skipped rows, never fatal). */
  skipped: number;
}

export interface MappedBundle {
  mapped: MappedType[];
  /** Total source rows seen across all members (for the audit `after`). */
  sourceRowCount: number;
  /** Non-fatal mapping warnings surfaced to the admin (never blocks). */
  warnings: string[];
}

/** Hard cap mirrored from the import pipeline — a bundle never produces a giant batch. */
export const ONEROSTER_MAX_ROWS = 5_000;

function parseCsv(raw: string | undefined): Record<string, string>[] {
  if (!raw || !raw.trim()) return [];
  const res = parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  return res.data.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
}

/** OneRoster status filter — skip soft-deleted (`tobedeleted`) source rows. */
function isLive(row: Record<string, string>): boolean {
  const status = (row.status ?? '').trim().toLowerCase();
  return status === '' || status === 'active';
}

/**
 * Map a parsed OneRoster bundle into per-type raw import rows.
 *
 * Pure + deterministic. Caller is responsible for enforcing `ONEROSTER_MAX_ROWS`
 * per produced type (the same MAX_ROWS the CSV upload path enforces) — this
 * function reports counts so the caller can reject a too-large pull as a
 * `failed` pull, never a corrupt apply.
 */
export function mapOneRosterBundle(bundle: OneRosterBundle): MappedBundle {
  const warnings: string[] = [];
  const users = parseCsv(bundle.users);
  const classes = parseCsv(bundle.classes);
  const enrollments = parseCsv(bundle.enrollments);
  const sourceRowCount = users.length + classes.length + enrollments.length;

  // ---- students (from users.csv, role=student) -----------------------------
  // OneRoster user: sourcedId, username, givenName, familyName, role, email,
  // dateLastModified, status, … . We carry sourcedId → externalRef (idempotency
  // anchor) and map only identity fields. No medical / no guardian linkage.
  const classSourcedIdToTitle = new Map<string, string>();
  for (const c of classes) {
    const sid = (c.sourcedid ?? '').trim();
    const title = (c.title ?? c.classcode ?? '').trim();
    if (sid && title) classSourcedIdToTitle.set(sid, title);
  }

  const studentRows: Record<string, string>[] = [];
  let studentsSkipped = 0;
  for (const u of users) {
    const role = (u.role ?? '').trim().toLowerCase();
    if (role !== 'student') {
      studentsSkipped++;
      continue;
    }
    if (!isLive(u)) {
      studentsSkipped++;
      continue;
    }
    const sourcedId = (u.sourcedid ?? '').trim();
    const firstName = (u.givenname ?? u.firstname ?? '').trim();
    const lastName = (u.familyname ?? u.lastname ?? '').trim();
    if (!firstName || !lastName) {
      studentsSkipped++;
      continue;
    }
    studentRows.push({
      // header keys the studentsHandler.parseRow already accepts (lowercased).
      firstname: firstName,
      lastname: lastName,
      externalref: sourcedId,
      email: (u.email ?? '').trim(),
      // OneRoster carries no birthDate in the base users profile (it lives in
      // demographics.csv, which is RGPD-sensitive) — intentionally omitted.
      birthdate: '',
      notes: '',
    });
  }

  // ---- classes (from classes.csv) ------------------------------------------
  // OneRoster class: sourcedId, title, grades, courseSourcedId, classCode, … .
  // The pilotage classes handler needs name + gradeLevel; OneRoster `grades` is
  // a comma list (we take the first) and `title` is the section name.
  const classRows: Record<string, string>[] = [];
  let classesSkipped = 0;
  for (const c of classes) {
    if (!isLive(c)) {
      classesSkipped++;
      continue;
    }
    const name = (c.title ?? c.classcode ?? '').trim();
    const grades = (c.grades ?? '').split(',')[0]?.trim() ?? '';
    if (!name || !grades) {
      classesSkipped++;
      continue;
    }
    classRows.push({
      name,
      gradelevel: grades,
      maxstudents: '',
    });
  }

  // ---- enrollments (from enrollments.csv, role=student) --------------------
  // OneRoster enrollment: sourcedId, classSourcedId, userSourcedId, role, … .
  // We map a student's class membership onto (studentExternalRef, className).
  const userSourcedIdToExtRef = new Map<string, string>();
  for (const u of users) {
    const sid = (u.sourcedid ?? '').trim();
    if (sid) userSourcedIdToExtRef.set(sid, sid); // externalRef == sourcedId (anchor)
  }

  const enrollmentRows: Record<string, string>[] = [];
  let enrollmentsSkipped = 0;
  for (const e of enrollments) {
    const role = (e.role ?? '').trim().toLowerCase();
    if (role !== 'student') {
      enrollmentsSkipped++;
      continue;
    }
    if (!isLive(e)) {
      enrollmentsSkipped++;
      continue;
    }
    const userSid = (e.usersourcedid ?? e.usersourcedId ?? '').trim();
    const classSid = (e.classsourcedid ?? '').trim();
    const studentExtRef = userSourcedIdToExtRef.get(userSid) ?? userSid;
    const className = classSourcedIdToTitle.get(classSid) ?? '';
    if (!studentExtRef || !className) {
      enrollmentsSkipped++;
      continue;
    }
    enrollmentRows.push({
      studentexternalref: studentExtRef,
      classname: className,
    });
  }

  if (studentRows.length === 0 && classRows.length === 0 && enrollmentRows.length === 0) {
    warnings.push(
      "Aucune donnée de roster exploitable dans le bundle (élèves / classes / inscriptions vides).",
    );
  }

  const mapped: MappedType[] = [];
  if (classRows.length > 0) mapped.push({ type: 'classes', rows: classRows, skipped: classesSkipped });
  if (studentRows.length > 0)
    mapped.push({ type: 'students', rows: studentRows, skipped: studentsSkipped });
  if (enrollmentRows.length > 0)
    mapped.push({ type: 'enrollments', rows: enrollmentRows, skipped: enrollmentsSkipped });

  return { mapped, sourceRowCount, warnings };
}

/**
 * Serialise a mapped type's rows back to a CSV string so the produced
 * `ImportBatch.rawCsv` carries a faithful, re-parseable body (the existing
 * storage shape — `rawCsv` already holds the uploaded CSV for a human import,
 * so a OneRoster batch reuses it 1:1; the rollback/preview surfaces read it).
 */
export function rowsToCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h.toLowerCase()] ?? '')).join(','));
  }
  return '﻿' + lines.join('\n');
}
