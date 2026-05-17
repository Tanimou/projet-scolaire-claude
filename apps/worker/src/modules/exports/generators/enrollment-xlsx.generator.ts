import ExcelJS from 'exceljs';

import type { GenerateArgs, GenerateResult } from './types';

/**
 * Enrollment XLSX — flat list of active enrollments with primary guardian
 * contact info. Used for back-to-school mailings, emergency rosters, etc.
 *
 * Parameters (optional):
 *   - academicYearId: defaults to the most recent year with active enrollments
 */
export async function generateEnrollmentXlsx(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, schoolId, parameters } = args;
  let academicYearId = (parameters.academicYearId as string | undefined) ?? null;

  if (!academicYearId) {
    const active = await prisma.academicYear.findFirst({
      where: {
        tenantId,
        status: 'active',
        ...(schoolId ? { schoolId } : {}),
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    academicYearId = active?.id ?? null;
  }

  const enrollments = academicYearId
    ? await prisma.enrollment.findMany({
        where: {
          tenantId,
          academicYearId,
          status: 'active',
          ...(schoolId ? { student: { schoolId } } : {}),
        },
        include: {
          student: {
            include: {
              guardianships: {
                where: { status: 'active' },
                orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
                take: 1,
                include: { guardian: true },
              },
            },
          },
          classSection: {
            include: { gradeLevel: { include: { cycle: true } } },
          },
          academicYear: true,
        },
        orderBy: [
          { classSection: { name: 'asc' } },
          { student: { lastName: 'asc' } },
          { student: { firstName: 'asc' } },
        ],
        take: 5000,
      })
    : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pilotage scolaire';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Inscriptions');

  sheet.columns = [
    { header: 'Classe', key: 'classe', width: 14 },
    { header: 'Niveau', key: 'niveau', width: 12 },
    { header: 'Cycle', key: 'cycle', width: 14 },
    { header: 'Nom', key: 'nom', width: 22 },
    { header: 'Prénom', key: 'prenom', width: 18 },
    { header: 'Date de naissance', key: 'dob', width: 14 },
    { header: 'Genre', key: 'gender', width: 8 },
    { header: 'Réf. externe', key: 'ref', width: 14 },
    { header: 'Email élève', key: 'studentEmail', width: 26 },
    { header: 'Téléphone élève', key: 'studentPhone', width: 16 },
    { header: 'Resp. principal — Nom', key: 'gNom', width: 22 },
    { header: 'Resp. principal — Prénom', key: 'gPrenom', width: 18 },
    { header: 'Resp. principal — Email', key: 'gEmail', width: 26 },
    { header: 'Resp. principal — Tél.', key: 'gPhone', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const e of enrollments) {
    const guardian = e.student.guardianships[0]?.guardian ?? null;
    sheet.addRow({
      classe: e.classSection.name,
      niveau: e.classSection.gradeLevel.name,
      cycle: e.classSection.gradeLevel.cycle.name,
      nom: e.student.lastName.toUpperCase(),
      prenom: e.student.firstName,
      dob: e.student.birthDate?.toISOString().slice(0, 10) ?? '',
      gender: e.student.gender ?? '',
      ref: e.student.externalRef ?? '',
      studentEmail: e.student.email ?? '',
      studentPhone: e.student.phone ?? '',
      gNom: guardian?.lastName.toUpperCase() ?? '',
      gPrenom: guardian?.firstName ?? '',
      gEmail: guardian?.email ?? '',
      gPhone: guardian?.phone ?? '',
    });
  }

  if (enrollments.length === 0) {
    sheet.addRow(['Aucune inscription active trouvée.']);
  }

  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
