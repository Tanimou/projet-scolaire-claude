import PDFDocument from 'pdfkit';

import type { GenerateArgs, GenerateResult } from './types';

/**
 * Report card PDF — one page per student in a class section, for a given term.
 *
 * Parameters (required):
 *   - classSectionId
 *   - termId
 *
 * Optional (E4-S2, additive — parent self-service bulletin):
 *   - studentId  → narrows the roster to exactly ONE student so the produced PDF
 *                  contains only that child (RGPD minimal access). When omitted,
 *                  the behaviour is byte-for-byte the admin class-wide path.
 *
 * Layout: header (school + class + term) → table (subject / moyenne /20 /
 * coef / appréciation) → footer with overall weighted average.
 */
export async function generateReportCardPdf(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, schoolId, parameters } = args;
  let classSectionId = parameters.classSectionId as string | undefined;
  let termId = parameters.termId as string | undefined;
  // Optional single-student narrowing (parent bulletin). Absent → class-wide.
  const studentId = parameters.studentId as string | undefined;

  // Sensible defaults so the export still produces something useful when called
  // from a one-click button (v1 has no parameter picker UI).
  if (!classSectionId) {
    const cs = await prisma.classSection.findFirst({
      where: {
        tenantId,
        status: 'active',
        ...(schoolId ? { gradeLevel: { cycle: { schoolId } } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    if (!cs) throw new Error('No active class section found in scope');
    classSectionId = cs.id;
  }
  if (!termId) {
    const t = await prisma.term.findFirst({
      where: { tenantId, academicYear: { status: 'active' } },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    if (!t) throw new Error('No term found for the active academic year');
    termId = t.id;
  }

  const classSection = await prisma.classSection.findFirst({
    where: { id: classSectionId, tenantId },
    include: {
      academicYear: true,
      gradeLevel: { include: { cycle: { include: { school: true } } } },
    },
  });
  if (!classSection) throw new Error('Class section not found');

  const term = await prisma.term.findFirst({ where: { id: termId, tenantId } });
  if (!term) throw new Error('Term not found');

  const enrollments = await prisma.enrollment.findMany({
    where: {
      classSectionId,
      academicYearId: classSection.academicYearId,
      status: 'active',
      // Additive single-student narrowing: when a parent requests their own
      // child's bulletin the PDF must contain exactly one student. Omitting
      // `studentId` leaves the admin class-wide path unchanged.
      ...(studentId ? { studentId } : {}),
    },
    include: { student: true },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  });

  // For each student, aggregate grades grouped by subject within the term.
  const studentIds = enrollments.map((e) => e.studentId);
  const grades = await prisma.grade.findMany({
    where: {
      tenantId,
      studentId: { in: studentIds },
      status: 'published',
      assessment: {
        termId,
        teachingAssignment: { classSectionId },
      },
    },
    include: {
      assessment: {
        include: { teachingAssignment: { include: { subject: true } } },
      },
    },
  });

  // students[studentId][subjectId] = { name, code, sum, weight }
  type SubjectBucket = {
    name: string;
    code: string;
    coefficient: number;
    sum: number;
    weight: number;
    count: number;
  };
  const studentBuckets = new Map<string, Map<string, SubjectBucket>>();
  for (const g of grades) {
    if (g.value == null || g.isAbsent) continue;
    const subj = g.assessment.teachingAssignment.subject;
    const max = Number(g.assessment.maxScore);
    const value = (Number(g.value) / max) * 20;
    const coef =
      g.assessment.coefficientOverride != null ? Number(g.assessment.coefficientOverride) : 1;
    let subjectMap = studentBuckets.get(g.studentId);
    if (!subjectMap) {
      subjectMap = new Map();
      studentBuckets.set(g.studentId, subjectMap);
    }
    const bucket = subjectMap.get(subj.id) ?? {
      name: subj.name,
      code: subj.code,
      coefficient: Number(subj.defaultCoefficient ?? 1),
      sum: 0,
      weight: 0,
      count: 0,
    };
    bucket.sum += value * coef;
    bucket.weight += coef;
    bucket.count += 1;
    subjectMap.set(subj.id, bucket);
  }

  // Build a single PDF with one page per student.
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk as Buffer));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  const schoolName = classSection.gradeLevel.cycle.school.name;
  const className = classSection.name;
  const yearName = classSection.academicYear.name;
  const termName = term.name;

  enrollments.forEach((e, idx) => {
    if (idx > 0) doc.addPage();

    // Header
    doc.fontSize(10).fillColor('#475569').text(schoolName, { align: 'right' });
    doc.fontSize(8).fillColor('#94a3b8').text(`${yearName} · ${termName}`, { align: 'right' });
    doc.moveDown(1.5);

    doc.fontSize(22).fillColor('#0f172a').text('Bulletin scolaire', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#334155').text(`Classe : ${className}`, { align: 'center' });
    doc.moveDown(1.2);

    doc.fontSize(16).fillColor('#0f172a').text(
      `${e.student.lastName.toUpperCase()} ${e.student.firstName}`,
      { align: 'left' },
    );
    if (e.student.birthDate) {
      doc.fontSize(9).fillColor('#64748b').text(
        `Né·e le ${e.student.birthDate.toISOString().slice(0, 10)}`,
      );
    }
    doc.moveDown(1);

    // Subject table
    const buckets = [...(studentBuckets.get(e.studentId)?.values() ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    drawTableHeader(doc);
    let overallSum = 0;
    let overallWeight = 0;
    for (const b of buckets) {
      if (b.weight === 0) continue;
      const avg = b.sum / b.weight;
      overallSum += avg * b.coefficient;
      overallWeight += b.coefficient;
      drawTableRow(doc, {
        subject: b.name,
        average: avg,
        coefficient: b.coefficient,
        count: b.count,
      });
    }
    if (buckets.length === 0) {
      doc
        .fontSize(10)
        .fillColor('#94a3b8')
        .text("Aucune note publiée pour ce trimestre.", { align: 'center' });
    }

    // Overall average
    doc.moveDown(1);
    if (overallWeight > 0) {
      const overall = overallSum / overallWeight;
      doc
        .fontSize(13)
        .fillColor('#0f172a')
        .text(`Moyenne générale : ${overall.toFixed(2)} / 20`, { align: 'right' });
    }

    // Footer
    doc
      .fontSize(7)
      .fillColor('#94a3b8')
      .text(
        `Document généré le ${new Date().toLocaleDateString('fr-FR')} — Pilotage scolaire`,
        48,
        doc.page.height - 36,
        { align: 'center', width: doc.page.width - 96 },
      );
  });

  if (enrollments.length === 0) {
    doc
      .fontSize(14)
      .fillColor('#475569')
      .text('Aucun élève inscrit pour cette classe / ce trimestre.', { align: 'center' });
  }

  doc.end();
  await done;

  return {
    buffer: Buffer.concat(chunks),
    contentType: 'application/pdf',
  };
}

function drawTableHeader(doc: PDFKit.PDFDocument) {
  const startX = doc.x;
  const startY = doc.y;
  const cols = [
    { label: 'Matière', width: 220 },
    { label: 'Moyenne /20', width: 90, align: 'right' as const },
    { label: 'Coef.', width: 60, align: 'right' as const },
    { label: 'Évaluations', width: 90, align: 'right' as const },
  ];
  doc.fontSize(9).fillColor('#475569');
  doc.rect(startX, startY, cols.reduce((s, c) => s + c.width, 0), 18).fill('#f1f5f9');
  doc.fillColor('#0f172a');
  let x = startX + 6;
  for (const c of cols) {
    doc.text(c.label, x, startY + 5, { width: c.width - 12, align: c.align ?? 'left' });
    x += c.width;
  }
  doc.y = startY + 22;
  doc.fillColor('#0f172a');
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  row: { subject: string; average: number; coefficient: number; count: number },
) {
  const startX = 48;
  const startY = doc.y;
  const cols: Array<{ width: number; text: string; align?: 'left' | 'right' }> = [
    { width: 220, text: row.subject },
    { width: 90, text: row.average.toFixed(2), align: 'right' },
    { width: 60, text: row.coefficient.toFixed(0), align: 'right' },
    { width: 90, text: String(row.count), align: 'right' },
  ];
  doc.fontSize(10).fillColor('#0f172a');
  let x = startX + 6;
  for (const c of cols) {
    doc.text(c.text, x, startY + 4, { width: c.width - 12, align: c.align ?? 'left' });
    x += c.width;
  }
  doc.y = startY + 20;
  // separator
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(0.5)
    .moveTo(startX, doc.y - 1)
    .lineTo(startX + cols.reduce((s, c) => s + c.width, 0), doc.y - 1)
    .stroke();
}
