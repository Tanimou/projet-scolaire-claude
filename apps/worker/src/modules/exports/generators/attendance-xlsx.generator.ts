import ExcelJS from 'exceljs';

import type { GenerateArgs, GenerateResult } from './types';

/**
 * Attendance XLSX — one sheet "Détail" (record-level) + one sheet "Synthèse"
 * (per-student tallies).
 *
 * Note: AttendanceRecord is linked to ClassSession; ClassSection lives behind
 * `classSession.teachingAssignment.classSection`.
 *
 * Parameters (optional):
 *   - classSectionId: limit to a single class
 *   - from / to:      ISO dates bounding `recordedAt`
 */
export async function generateAttendanceXlsx(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, schoolId, parameters } = args;
  const classSectionId = (parameters.classSectionId as string | undefined) ?? null;
  const fromIso = (parameters.from as string | undefined) ?? null;
  const toIso = (parameters.to as string | undefined) ?? null;
  const from = fromIso ? new Date(fromIso) : daysAgo(30);
  const to = toIso ? new Date(toIso) : new Date();

  const records = await prisma.attendanceRecord.findMany({
    where: {
      tenantId,
      recordedAt: { gte: from, lte: to },
      ...(classSectionId
        ? {
            classSession: {
              teachingAssignment: { classSectionId },
            },
          }
        : schoolId
          ? {
              classSession: {
                teachingAssignment: {
                  classSection: { gradeLevel: { cycle: { schoolId } } },
                },
              },
            }
          : {}),
    },
    include: {
      student: { select: { firstName: true, lastName: true } },
      classSession: {
        include: {
          teachingAssignment: {
            include: {
              classSection: { select: { name: true } },
              subject: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { recordedAt: 'asc' },
    take: 5000,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pilotage scolaire';
  wb.created = new Date();

  // ---- Détail sheet -----
  const detail = wb.addWorksheet('Détail');
  detail.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Heure', key: 'time', width: 10 },
    { header: 'Classe', key: 'classe', width: 14 },
    { header: 'Matière', key: 'matiere', width: 18 },
    { header: 'Élève', key: 'eleve', width: 28 },
    { header: 'Statut', key: 'statut', width: 18 },
    { header: 'Justifié', key: 'just', width: 10 },
    { header: 'Commentaire', key: 'comment', width: 36 },
  ];
  detail.getRow(1).font = { bold: true };
  detail.views = [{ state: 'frozen', ySplit: 1 }];

  for (const r of records) {
    const ta = r.classSession.teachingAssignment;
    detail.addRow({
      date: r.recordedAt.toISOString().slice(0, 10),
      time: r.recordedAt.toISOString().slice(11, 16),
      classe: ta.classSection.name,
      matiere: ta.subject.name,
      eleve: `${r.student.lastName.toUpperCase()} ${r.student.firstName}`,
      statut: STATUS_LABEL[r.status] ?? r.status,
      just: r.justifiedAt ? 'Oui' : '',
      comment: r.comment ?? '',
    });
  }

  // ---- Synthèse sheet (per student, counts by status) -----
  const synth = wb.addWorksheet('Synthèse');
  synth.columns = [
    { header: 'Élève', key: 'eleve', width: 28 },
    { header: 'Présent', key: 'present', width: 10 },
    { header: 'Absent', key: 'absent', width: 10 },
    { header: 'Absent (justifié)', key: 'absent_excused', width: 18 },
    { header: 'Retard', key: 'late', width: 10 },
    { header: 'Parti·e tôt', key: 'left_early', width: 12 },
  ];
  synth.getRow(1).font = { bold: true };
  synth.views = [{ state: 'frozen', ySplit: 1 }];

  const byStudent = new Map<string, { name: string; counts: Record<string, number> }>();
  for (const r of records) {
    const k = `${r.student.lastName}|${r.student.firstName}`;
    const entry = byStudent.get(k) ?? {
      name: `${r.student.lastName.toUpperCase()} ${r.student.firstName}`,
      counts: { present: 0, absent: 0, absent_excused: 0, late: 0, left_early: 0 },
    };
    entry.counts[r.status] = (entry.counts[r.status] ?? 0) + 1;
    byStudent.set(k, entry);
  }
  const sorted = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of sorted) {
    synth.addRow({
      eleve: s.name,
      present: s.counts.present ?? 0,
      absent: s.counts.absent ?? 0,
      absent_excused: s.counts.absent_excused ?? 0,
      late: s.counts.late ?? 0,
      left_early: s.counts.left_early ?? 0,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

const STATUS_LABEL: Record<string, string> = {
  present: 'Présent',
  absent: 'Absent',
  absent_excused: 'Absent (justifié)',
  late: 'Retard',
  left_early: 'Parti·e tôt',
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
