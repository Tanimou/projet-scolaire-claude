/**
 * Demo enrichment — fills the cross-portal "Annonces" surface so the admin,
 * teacher and parent portals all show a coherent, non-empty announcements feed.
 *
 * Idempotent: re-deletes its own marker announcements (authorRoleHint = SEED_TAG)
 * for the demo school, then recreates them. Anchored on the `voltaire-demo`
 * tenant created by seed-demo.ts; no-ops cleanly if that tenant is absent.
 *
 * Run AFTER seed-demo.ts (needs the demo school + an admin UserProfile).
 *   pnpm --filter @pilotage/api run prisma:seed:demo:enrich
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient, AnnouncementScope, AnnouncementPriority } from '@prisma/client';

loadEnv({ path: resolve(__dirname, '..', '.env') });
const prisma = new PrismaClient();

const SEED_TAG = 'seed-enrich';

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) {
    console.warn('! voltaire-demo tenant not found — run prisma:seed:demo first. Skipping enrich.');
    return;
  }
  const school = await prisma.school.findFirst({ where: { tenantId: tenant.id } });
  if (!school) {
    console.warn('! no school for voltaire-demo — skipping enrich.');
    return;
  }

  // Author: prefer the demo admin (Sophie Dupont), else any admin-ish profile.
  const author =
    (await prisma.userProfile.findFirst({
      where: { tenantId: tenant.id, email: 'mme.dupont@voltaire.fr' },
    })) ?? (await prisma.userProfile.findFirst({ where: { tenantId: tenant.id } }));
  if (!author) {
    console.warn('! no UserProfile to author announcements — skipping enrich.');
    return;
  }

  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

  const ANNOUNCEMENTS = [
    {
      title: 'Bienvenue sur le nouvel espace numérique du Lycée Voltaire',
      body: "L'établissement met à votre disposition ce portail pour suivre la scolarité au quotidien : notes, absences, cahier de texte et messagerie avec l'équipe pédagogique. Toute l'équipe vous souhaite une excellente fin d'année scolaire.",
      scope: AnnouncementScope.school_wide,
      priority: AnnouncementPriority.normal,
      pinned: true,
      publishedAt: inDays(-3),
      expiresAt: inDays(60),
    },
    {
      title: 'Conseils de classe du 3e trimestre',
      body: "Les conseils de classe du troisième trimestre se tiendront la semaine du 23 juin. Les bulletins seront disponibles dans votre espace dès la fin des conseils. Les professeurs principaux prendront contact avec les familles concernées.",
      scope: AnnouncementScope.school_wide,
      priority: AnnouncementPriority.high,
      pinned: false,
      publishedAt: inDays(-1),
      expiresAt: inDays(30),
    },
    {
      title: 'Réunion parents-professeurs — inscriptions ouvertes',
      body: "La dernière réunion parents-professeurs de l'année aura lieu le 26 juin de 17h à 20h. Vous pouvez dès à présent réserver un créneau avec les enseignants depuis l'onglet « Rendez-vous » de votre espace parent.",
      scope: AnnouncementScope.school_wide,
      priority: AnnouncementPriority.normal,
      pinned: false,
      publishedAt: now,
      expiresAt: inDays(20),
    },
  ];

  // Idempotent: remove this script's prior announcements (receipts cascade), then
  // recreate. Re-running converges to the same 3 announcements + fresh receipts.
  const del = await prisma.announcement.deleteMany({
    where: { schoolId: school.id, authorRoleHint: SEED_TAG },
  });

  // school_wide visibility is RECEIPT-driven: each portal's feed reads the current
  // user's AnnouncementReceipt rows, materialised at publish time for every active
  // UserProfile in the tenant. Mirror that here so admin/teacher/parent/student all
  // see the feed (without receipts the announcement exists but no one's feed shows it).
  const profiles = await prisma.userProfile.findMany({
    where: { tenantId: tenant.id, status: 'active' },
    select: { id: true },
  });

  let receipts = 0;
  for (const a of ANNOUNCEMENTS) {
    const ann = await prisma.announcement.create({
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        priority: a.priority,
        pinned: a.pinned,
        publishedAt: a.publishedAt,
        expiresAt: a.expiresAt,
        authorId: author.id,
        authorRoleHint: SEED_TAG,
      },
    });
    const r = await prisma.announcementReceipt.createMany({
      data: profiles.map((p) => ({ announcementId: ann.id, userProfileId: p.id })),
      skipDuplicates: true,
    });
    receipts += r.count;
  }

  console.info(
    `✓ Enrich: ${ANNOUNCEMENTS.length} announcements for ${school.name} (removed ${del.count} stale) → ${receipts} receipts across ${profiles.length} active profiles, author ${author.firstName} ${author.lastName}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
