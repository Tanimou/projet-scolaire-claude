import ExcelJS from 'exceljs';

import type { GenerateArgs, GenerateResult } from './types';

/**
 * Grades XLSX — one sheet per class section.
 *
 * Columns: élève + une colonne par évaluation publiée + moyenne pondérée.
 * Rows:    enrollments actifs de la classe.
 *
 * Parameters (optional):
 *   - classSectionId: limit to a single class
 *   - academicYearId: required by Enrollment; defaults to the active year
 *   - termId:         only include assessments from this term
 */
export async function generateGradesXlsx(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, schoolId, parameters } = args;
  const classSectionId = (parameters.classSectionId as string | undefined) ?? null;
  const academicYearId = (parameters.academicYearId as string | undefined) ?? null;
  const termId = (parameters.termId as string | undefined) ?? null;

  // 1. Pick class sections in scope
  const classes = await prisma.classSection.findMany({
    where: {
      tenantId,
      ...(classSectionId ? { id: classSectionId } : {}),
      ...(academicYearId ? { academicYearId } : {}),
      ...(schoolId ? { gradeLevel: { cycle: { schoolId } } } : {}),
      status: { not: 'closed' },
    },
    include: {
      academicYear: true,
      gradeLevel: true,
    },
    orderBy: { name: 'asc' },
    take: 50,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pilotage scolaire';
  wb.created = new Date();

  for (const cs of classes) {
    // 2. Active enrollments → students
    const enrollments = await prisma.enrollment.findMany({
      where: {
        classSectionId: cs.id,
        status: 'active',
        academicYearId: cs.academicYearId,
      },
      include: { student: true },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    // 3. Published assessments scoped to that class section (via teachingAssignment)
    const assessments = await prisma.assessment.findMany({
      where: {
        tenantId,
        isPublished: true,
        ...(termId ? { termId } : {}),
        teachingAssignment: { classSectionId: cs.id, academicYearId: cs.academicYearId },
      },
      include: { teachingAssignment: { include: { subject: true } } },
      orderBy: { scheduledAt: 'asc' },
    });

    // 4. Grades indexed by (studentId, assessmentId)
    const grades = await prisma.grade.findMany({
      where: {
        tenantId,
        status: 'published',
        assessmentId: { in: assessments.map((a) => a.id) },
        studentId: { in: enrollments.map((e) => e.studentId) },
      },
      select: { studentId: true, assessmentId: true, value: true, isAbsent: true },
    });
    const gradeIdx = new Map<string, { value: number | null; isAbsent: boolean }>();
    for (const g of grades) {
      gradeIdx.set(`${g.studentId}|${g.assessmentId}`, {
        value: g.value == null ? null : Number(g.value),
        isAbsent: g.isAbsent,
      });
    }

    const sheet = wb.addWorksheet(safeSheetName(cs.name), {
      properties: { defaultRowHeight: 18 },
    });

    // Header row
    const headerCols: Array<Partial<ExcelJS.Column>> = [
      { header: 'Élève', key: 'student', width: 28 },
    ];
    for (const a of assessments) {
      headerCols.push({
        header: `${a.title}\n${a.teachingAssignment.subject.code} /${Number(a.maxScore)}`,
        key: `a_${a.id}`,
        width: 14,
      });
    }
    headerCols.push({ header: 'Moyenne /20', key: 'avg', width: 14 });
    sheet.columns = headerCols;

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(1).height = 36;

    // Data rows
    for (const e of enrollments) {
      const row: Record<string, string | number | null> = {
        student: `${e.student.lastName.toUpperCase()} ${e.student.firstName}`,
      };
      let weightedSum = 0;
      let weightTotal = 0;
      for (const a of assessments) {
        const cell = gradeIdx.get(`${e.studentId}|${a.id}`);
        if (!cell) {
          row[`a_${a.id}`] = null;
        } else if (cell.isAbsent) {
          row[`a_${a.id}`] = 'ABS';
        } else if (cell.value != null) {
          const normalized = (cell.value / Number(a.maxScore)) * 20;
          row[`a_${a.id}`] = round2(cell.value);
          const coef = a.coefficientOverride != null ? Number(a.coefficientOverride) : 1;
          weightedSum += normalized * coef;
          weightTotal += coef;
        } else {
          row[`a_${a.id}`] = null;
        }
      }
      row.avg = weightTotal > 0 ? round2(weightedSum / weightTotal) : null;
      sheet.addRow(row);
    }

    // Freeze header + style the average column
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    const avgColLetter = sheet.getColumn('avg').letter;
    sheet.getColumn(avgColLetter).font = { bold: true };

    // Cycle header banner (informational, on the top-right of the sheet)
    sheet.headerFooter.oddHeader = `&L&B${cs.name}&R${cs.academicYear.name}`;
  }

  if (classes.length === 0) {
    const sheet = wb.addWorksheet('Aucune donnée');
    sheet.addRow(['Aucune classe trouvée dans le périmètre.']);
  }

  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no  / \ * ? : [ ]
  return name.replace(/[\\/?*:\[\]]/g, '_').slice(0, 31);
}
