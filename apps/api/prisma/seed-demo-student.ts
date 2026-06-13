/**
 * Demo student login — provisions a sign-in for the STUDENT portal (E8), anchored
 * on the SAME child the demo parent sees so all four portals are coherent:
 *   admin sees the child · teacher.demo teaches their class · parent.demo is the
 *   parent · eleve.demo IS the child (own grades / attendance / upcoming).
 *
 * What it does (idempotent — re-run any time):
 *   1. Resolves the voltaire-demo tenant + the demo parent's child (fallback: the
 *      student with the most grades).
 *   2. Ensures a UserProfile for that Student (email eleve.demo@voltaire.fr) and
 *      links Student.userProfileId.
 *   3. Ensures the `student` realm role EXISTS in Keycloak (creates it if missing —
 *      unlike parent/teacher, the imported realm ships no student role).
 *   4. Provisions the Keycloak user + password + the `student` realm role.
 *   5. Patches UserProfile.authProviderId so the JWT → UserProfile mapping works.
 *
 *   email : eleve.demo@voltaire.fr   password : Demo!2024Pilotage   → /student/login
 */
import { PrismaClient } from '@prisma/client';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire';
const KEYCLOAK_ADMIN = process.env.KEYCLOAK_ADMIN_USER ?? process.env.KEYCLOAK_ADMIN ?? 'admin';
const KEYCLOAK_ADMIN_PASS =
  process.env.KEYCLOAK_ADMIN_PASSWORD ?? process.env.KEYCLOAK_ADMIN_PASS ?? 'admin';
const DEMO_EMAIL = 'eleve.demo@voltaire.fr';
const DEMO_PASSWORD = process.env.KEYCLOAK_DEMO_PASSWORD ?? 'Demo!2024Pilotage';

const prisma = new PrismaClient();

async function adminToken(): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: KEYCLOAK_ADMIN,
      password: KEYCLOAK_ADMIN_PASS,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function kc(method: string, path: string, body?: unknown) {
  const token = await adminToken();
  return fetch(`${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function findKcUserByEmail(email: string): Promise<{ id: string } | null> {
  const r = await kc('GET', `/users?email=${encodeURIComponent(email)}&exact=true`);
  if (!r.ok) return null;
  const list = (await r.json()) as Array<{ id: string }>;
  return list[0] ?? null;
}

async function findRealmRole(name: string): Promise<{ id: string; name: string } | null> {
  const r = await kc('GET', `/roles/${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  return (await r.json()) as { id: string; name: string };
}

/** The imported realm has no `student` role — create it on demand (idempotent). */
async function ensureRealmRole(name: string): Promise<{ id: string; name: string }> {
  let role = await findRealmRole(name);
  if (!role) {
    const cr = await kc('POST', '/roles', {
      name,
      description: 'Élève — portail élève (lecture seule, auto-scopé)',
    });
    if (!cr.ok && cr.status !== 409) {
      throw new Error(`Failed to create realm role "${name}": ${cr.status} ${await cr.text()}`);
    }
    console.log(`     ✓ Created realm role: ${name}`);
    role = await findRealmRole(name);
  }
  if (!role) throw new Error(`Realm role "${name}" still missing after create`);
  return role;
}

async function main() {
  console.log('🌱 Provisioning demo student…\n');

  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) {
    console.warn('! voltaire-demo tenant not found — run prisma:seed:demo first. Skipping.');
    return;
  }

  // 1. Prefer the demo parent's child (cross-portal coherence); else the student
  //    with the most grades.
  let student:
    | { id: string; firstName: string; lastName: string; userProfileId: string | null }
    | null = null;

  const parentUP = await prisma.userProfile.findFirst({
    where: { tenantId: tenant.id, email: 'parent.demo@voltaire.fr' },
  });
  if (parentUP) {
    const guardian = await prisma.guardian.findFirst({
      where: { tenantId: tenant.id, userProfileId: parentUP.id },
      include: {
        guardianships: {
          where: { status: 'active' },
          include: { student: { select: { id: true, firstName: true, lastName: true, userProfileId: true } } },
        },
      },
    });
    student = guardian?.guardianships?.[0]?.student ?? null;
  }
  if (!student) {
    const best = await prisma.student.findFirst({
      where: { tenantId: tenant.id, status: 'active' },
      orderBy: { grades: { _count: 'desc' } },
      select: { id: true, firstName: true, lastName: true, userProfileId: true },
    });
    student = best ?? null;
  }
  if (!student) {
    console.warn('! no student found in voltaire-demo — run prisma:seed:demo first. Skipping.');
    return;
  }
  console.log(`  ▸ Anchoring student login on ${student.firstName} ${student.lastName}`);

  // 2. Ensure a UserProfile for the student + link Student.userProfileId.
  let userProfile = student.userProfileId
    ? await prisma.userProfile.findUnique({ where: { id: student.userProfileId } })
    : null;
  if (!userProfile) {
    userProfile = await prisma.userProfile.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL },
    });
  }
  if (!userProfile) {
    userProfile = await prisma.userProfile.create({
      data: {
        tenantId: tenant.id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: DEMO_EMAIL,
        status: 'active',
        locale: 'fr-FR',
      },
    });
    console.log(`     ✓ Created UserProfile ${userProfile.id}`);
  } else if (userProfile.email !== DEMO_EMAIL) {
    // Free the demo email if another profile squats it, then take it.
    const squatter = await prisma.userProfile.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL, NOT: { id: userProfile.id } },
    });
    if (squatter) {
      await prisma.userProfile.update({
        where: { id: squatter.id },
        data: { email: `archived-${squatter.id.slice(0, 8)}@voltaire.fr` },
      });
    }
    await prisma.userProfile.update({ where: { id: userProfile.id }, data: { email: DEMO_EMAIL } });
    console.log(`     ✓ Reset UserProfile email to ${DEMO_EMAIL}`);
  }
  if (student.userProfileId !== userProfile.id) {
    await prisma.student.update({ where: { id: student.id }, data: { userProfileId: userProfile.id } });
    console.log('     ✓ Linked Student → UserProfile');
  }

  // 3. Provision in Keycloak (create the `student` realm role first if needed).
  console.log('\n  ▸ Provisioning Keycloak user…');
  const role = await ensureRealmRole('student');

  let kcUser = await findKcUserByEmail(DEMO_EMAIL);
  if (!kcUser) {
    const createRes = await kc('POST', '/users', {
      username: DEMO_EMAIL,
      email: DEMO_EMAIL,
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
      enabled: true,
      emailVerified: true,
      attributes: { tenant_id: ['voltaire-demo'] },
    });
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Failed to create Keycloak user: ${createRes.status} ${await createRes.text()}`);
    }
    kcUser = await findKcUserByEmail(DEMO_EMAIL);
    if (!kcUser) throw new Error('Could not find Keycloak user after creation');
    console.log(`     ✓ Created Keycloak user ${kcUser.id}`);
  } else {
    console.log(`     ↺ Keycloak user already exists: ${kcUser.id}`);
  }

  const pwRes = await kc('PUT', `/users/${kcUser.id}/reset-password`, {
    type: 'password',
    value: DEMO_PASSWORD,
    temporary: false,
  });
  if (!pwRes.ok) throw new Error(`Password set failed: ${pwRes.status} ${await pwRes.text()}`);
  console.log(`     ✓ Password set to ${DEMO_PASSWORD}`);

  const roleRes = await kc('POST', `/users/${kcUser.id}/role-mappings/realm`, [role]);
  if (!roleRes.ok && roleRes.status !== 409) {
    console.warn(`     ⚠ Could not assign student role: ${roleRes.status}`);
  } else {
    console.log('     ✓ Assigned realm role: student');
  }

  await prisma.userProfile.update({ where: { id: userProfile.id }, data: { authProviderId: kcUser.id } });
  console.log('     ✓ UserProfile.authProviderId synced');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✓ Demo student ready');
  console.log(`  Email    : ${DEMO_EMAIL}`);
  console.log(`  Mot pass : ${DEMO_PASSWORD}`);
  console.log(`  Élève    : ${student.firstName} ${student.lastName}`);
  console.log('══════════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
