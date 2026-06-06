/* eslint-disable no-console */
/**
 * Throwaway demo helper — populate the NEW v4 feature surfaces with realistic,
 * consistent data so they are visible in the UI (the routine ships the features
 * but not their demo data). Idempotent — safe to re-run.
 *
 *   pnpm --filter @pilotage/api exec tsx prisma/seed-demo-surfaces.ts
 *
 * Seeds, for the `voltaire-demo` tenant, anchored on the demo parent
 * (`parent.demo@voltaire.fr`), their child, and a REAL teacher of that child's
 * class (so the messaging dual-wall ABAC stays consistent):
 *   • E2 — a parent↔teacher Conversation + participants + 2 messages
 *   • E1 — a MeetingRequest (only if the child has an alert)
 *   • E7 — a published Tutor + a weekly availability + a RemediationPlan + a Booking
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding demo data for the new feature surfaces…\n');

  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) throw new Error('voltaire-demo tenant not found — run pnpm prisma:seed:demo first');
  const tenantId = tenant.id;

  // --- Resolve the people/anchors -------------------------------------------
  const parentUP = await prisma.userProfile.findFirst({
    where: { tenantId, email: 'parent.demo@voltaire.fr' },
  });
  if (!parentUP) throw new Error('parent.demo@voltaire.fr UserProfile not found — run seed-demo-parent.ts first');

  const adminUP = await prisma.userProfile.findFirst({
    where: { tenantId, email: 'mme.dupont@voltaire.fr' },
  });

  const guardian = await prisma.guardian.findFirst({
    where: { tenantId, userProfileId: parentUP.id },
    include: { guardianships: { include: { student: true } } },
  });
  const child = guardian?.guardianships?.[0]?.student;
  if (!child) throw new Error('No child linked to parent.demo — run seed-demo-parent.ts first');
  console.log(`  ▸ Parent: parent.demo  ·  Child: ${child.firstName} ${child.lastName}`);

  const enrollment = await prisma.enrollment.findFirst({
    where: { tenantId, studentId: child.id, status: 'active' },
  });
  const classSectionId = enrollment?.classSectionId;

  const assignment = classSectionId
    ? await prisma.teachingAssignment.findFirst({
        where: { tenantId, classSectionId },
        include: { teacherProfile: { include: { userProfile: true } }, subject: true },
      })
    : null;
  const teacherProfile = assignment?.teacherProfile ?? null;
  const teacherUP = teacherProfile?.userProfile ?? null;
  const subject = assignment?.subject ?? null;
  if (!teacherUP || !subject) {
    throw new Error('Could not resolve a teacher + subject for the child class — aborting (need a teaching_assignment).');
  }
  console.log(`  ▸ Teacher: ${teacherUP.firstName} ${teacherUP.lastName}  ·  Subject: ${subject.name}`);

  const schoolId = child.schoolId;
  let alert = await prisma.alertInstance.findFirst({
    where: { tenantId, studentId: child.id },
    orderBy: { detectedAt: 'desc' },
  });
  // The child has no alert (her grades don't trip a rule) → seed one realistic,
  // non-stigmatising LOW_SUBJECT_AVG alert so the E1 parent action-loop has data.
  if (!alert) {
    const rule = await prisma.alertRule.findFirst({ where: { tenantId, code: 'LOW_SUBJECT_AVG' } });
    if (rule) {
      alert = await prisma.alertInstance.create({
        data: {
          tenantId, schoolId, ruleId: rule.id, code: 'LOW_SUBJECT_AVG', severity: 'medium',
          status: 'open', studentId: child.id, subjectId: subject.id,
          title: `Moyenne sous le seuil en ${subject.name}`,
          body: `La moyenne récente de ${child.firstName} en ${subject.name} est en dessous du seuil attendu. Un suivi ciblé est recommandé.`,
          recommendation: `Renforcer ${subject.name} : revoir les derniers chapitres, ou échanger avec l'enseignant.`,
          context: { subjectAverage: 8.5, threshold: 10, period: 'T2-2026', trend: 'down' },
          detectedAt: new Date(),
        },
      });
      console.log('     ✓ Demo alert created (LOW_SUBJECT_AVG, open) for the E1 action loop');
    }
  }

  // --- E2: Conversation + participants + messages ---------------------------
  let conv = await prisma.conversation.findFirst({
    where: { tenantId, parentId: parentUP.id, teacherId: teacherUP.id, studentId: child.id },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        tenantId,
        schoolId,
        studentId: child.id,
        parentId: parentUP.id,
        teacherId: teacherUP.id,
        subjectId: subject.id,
        alertId: alert?.id ?? null,
        status: 'active',
        topic: `Suivi en ${subject.name}`,
        createdBy: parentUP.id,
      },
    });
    await prisma.conversationParticipant.createMany({
      data: [
        { tenantId, conversationId: conv.id, userProfileId: parentUP.id, role: 'parent' },
        { tenantId, conversationId: conv.id, userProfileId: teacherUP.id, role: 'teacher' },
      ],
      skipDuplicates: true,
    });
    const m1 = await prisma.conversationMessage.create({
      data: {
        tenantId, conversationId: conv.id, senderId: parentUP.id, senderRole: 'parent',
        body: `Bonjour, j'ai vu que ${child.firstName} a quelques difficultés en ${subject.name}. Comment puis-je l'aider à la maison ?`,
      },
    });
    const m2 = await prisma.conversationMessage.create({
      data: {
        tenantId, conversationId: conv.id, senderId: teacherUP.id, senderRole: 'teacher',
        body: `Bonjour, merci de votre message. Quelques exercices de révision ciblés cette semaine aideraient. Je vous envoie une fiche.`,
      },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: m2.createdAt, lastMessageById: teacherUP.id },
    });
    console.log('     ✓ Conversation + 2 messages created');
  } else {
    console.log('     ↺ Conversation already exists');
  }

  // --- E1: MeetingRequest (needs an alert) ----------------------------------
  if (alert) {
    const existing = await prisma.meetingRequest.findFirst({
      where: { tenantId, alertId: alert.id, requestedBy: parentUP.id },
    });
    if (!existing) {
      await prisma.meetingRequest.create({
        data: {
          tenantId, schoolId, alertId: alert.id, studentId: child.id,
          subjectId: alert.subjectId ?? subject.id, alertCode: alert.code,
          requestedBy: parentUP.id, assignedToId: teacherUP.id, status: 'open',
        },
      });
      console.log('     ✓ MeetingRequest created (open)');
    } else console.log('     ↺ MeetingRequest already exists');
  } else {
    console.log('     ⚠ No alert for the child → skipped MeetingRequest');
  }

  // --- E7: Tutor + availability + RemediationPlan + Booking -----------------
  let tutor = await prisma.tutor.findFirst({
    where: { tenantId, schoolId, displayName: `Soutien ${subject.name} — ${teacherUP.lastName}` },
  });
  if (!tutor) {
    tutor = await prisma.tutor.create({
      data: {
        tenantId, schoolId, type: 'teacher', costKind: 'free',
        displayName: `Soutien ${subject.name} — ${teacherUP.lastName}`,
        blurb: `Séances de soutien en ${subject.name}, en petit groupe, le midi.`,
        subjectIds: [subject.id], teacherProfileId: teacherProfile?.id ?? null,
        userProfileId: teacherUP.id, published: true,
        createdBy: (adminUP ?? parentUP).id,
      },
    });
    console.log('     ✓ Tutor created (published)');
  } else console.log('     ↺ Tutor already exists');

  let availability = await prisma.tutorAvailability.findFirst({ where: { tenantId, tutorId: tutor.id } });
  if (!availability) {
    availability = await prisma.tutorAvailability.create({
      data: {
        tenantId, schoolId, tutorId: tutor.id, kind: 'recurring_weekly',
        weekday: 2, startTime: '12:30', endTime: '13:15', capacity: 4, active: true,
        createdBy: (adminUP ?? teacherUP).id,
      },
    });
    console.log('     ✓ TutorAvailability created (Wed 12:30)');
  } else console.log('     ↺ TutorAvailability already exists');

  let plan = await prisma.remediationPlan.findFirst({
    where: { tenantId, studentId: child.id, subjectId: subject.id, status: 'open' },
  });
  if (!plan) {
    plan = await prisma.remediationPlan.create({
      data: {
        tenantId, schoolId, studentId: child.id, subjectId: subject.id, alertId: alert?.id ?? null,
        status: 'open', objective: `Consolider les bases en ${subject.name} ce trimestre.`,
        createdBy: parentUP.id,
      },
    });
    console.log('     ✓ RemediationPlan created (open)');
  } else console.log('     ↺ RemediationPlan already exists');

  // a concrete future Wednesday session
  const sessionAt = new Date();
  sessionAt.setDate(sessionAt.getDate() + ((2 - sessionAt.getDay() + 7) % 7 || 7));
  sessionAt.setHours(12, 30, 0, 0);
  const existingBooking = await prisma.booking.findFirst({
    where: { tenantId, availabilityId: availability.id, planId: plan.id },
  });
  if (!existingBooking) {
    await prisma.booking.create({
      data: {
        tenantId, schoolId, planId: plan.id, tutorId: tutor.id, availabilityId: availability.id,
        studentId: child.id, sessionAt, status: 'requested',
        note: 'Première séance de soutien.', bookedBy: parentUP.id,
      },
    });
    console.log('     ✓ Booking created (requested)');
  } else console.log('     ↺ Booking already exists');

  // --- Summary ---------------------------------------------------------------
  const counts = {
    conversation: await prisma.conversation.count({ where: { tenantId } }),
    conversation_message: await prisma.conversationMessage.count({ where: { tenantId } }),
    meeting_request: await prisma.meetingRequest.count({ where: { tenantId } }),
    tutor: await prisma.tutor.count({ where: { tenantId } }),
    remediation_plan: await prisma.remediationPlan.count({ where: { tenantId } }),
    booking: await prisma.booking.count({ where: { tenantId } }),
  };
  console.log('\n══════════════════════════════════════════════');
  console.log('  ✓ Demo surfaces seeded. Row counts (voltaire-demo):');
  for (const [k, v] of Object.entries(counts)) console.log(`     ${k.padEnd(22)} ${v}`);
  console.log('══════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('\n✗ seed-demo-surfaces failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
