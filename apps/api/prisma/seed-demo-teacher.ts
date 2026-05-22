/**
 * Throwaway helper: create or refresh a demo teacher you can sign in with.
 *
 *   pnpm tsx apps/api/prisma/seed-demo-teacher.ts
 *
 * What it does:
 *   1. Picks an active TeacherProfile in the `voltaire-demo` tenant with the
 *      most teaching assignments (so the gradebook is interesting).
 *   2. Renames the linked UserProfile email to `teacher.demo@voltaire.fr`.
 *   3. Provisions the user in Keycloak with the `teacher` realm role and the
 *      shared demo password `Demo!2024Pilotage`.
 *   4. Patches UserProfile.authProviderId so the JWT → UserProfile mapping
 *      works on first login.
 *
 * Idempotent — re-run any time. Connect at:
 *   http://localhost:3100/teacher/login
 *   email    : teacher.demo@voltaire.fr
 *   password : Demo!2024Pilotage
 */

import { PrismaClient } from '@prisma/client';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire';
const KEYCLOAK_ADMIN = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const KEYCLOAK_ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const DEMO_EMAIL = 'teacher.demo@voltaire.fr';
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

async function main() {
  console.log('🌱 Provisioning demo teacher…\n');

  // 1. Locate the voltaire-demo tenant
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) throw new Error('voltaire-demo tenant not found — run `pnpm prisma:seed:demo` first');

  // 2. Pick the active teacher profile with the most teaching assignments
  console.log('  ▸ Looking for a teacher with most assignments…');
  const candidates = await prisma.teacherProfile.findMany({
    where: { tenantId: tenant.id, active: true },
    include: {
      userProfile: true,
      _count: { select: { teachingAssignments: true, assessments: true } },
    },
    take: 200,
  });
  if (candidates.length === 0) {
    throw new Error(
      'No active teacher in voltaire-demo. Run `pnpm prisma:seed:demo` first.',
    );
  }
  const best = candidates.sort(
    (a, b) =>
      (b._count.teachingAssignments + b._count.assessments) -
      (a._count.teachingAssignments + a._count.assessments),
  )[0]!;
  const { userProfile } = best;
  console.log(
    `     → teacher ${userProfile.firstName} ${userProfile.lastName} (${best._count.teachingAssignments} affectations, ${best._count.assessments} évaluations)`,
  );

  // 3. Update the UserProfile email to the memorable demo email
  if (userProfile.email !== DEMO_EMAIL) {
    // Make sure no other UserProfile is squatting on the demo email
    const squatter = await prisma.userProfile.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL, NOT: { id: userProfile.id } },
    });
    if (squatter) {
      // Rename the squatter so we can take the demo email
      await prisma.userProfile.update({
        where: { id: squatter.id },
        data: { email: `archived-${squatter.id.slice(0, 8)}@voltaire.fr` },
      });
      console.log(`     ↺ Renamed previous squatter ${squatter.id} aside`);
    }
    await prisma.userProfile.update({
      where: { id: userProfile.id },
      data: { email: DEMO_EMAIL },
    });
    console.log(`     ✓ Reset UserProfile email to ${DEMO_EMAIL}`);
  }

  // 4. Provision in Keycloak
  console.log('\n  ▸ Provisioning Keycloak user…');
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

  // 5. Set password (always — idempotent)
  const pwRes = await kc('PUT', `/users/${kcUser.id}/reset-password`, {
    type: 'password',
    value: DEMO_PASSWORD,
    temporary: false,
  });
  if (!pwRes.ok) {
    throw new Error(`Password set failed: ${pwRes.status} ${await pwRes.text()}`);
  }
  console.log(`     ✓ Password set to ${DEMO_PASSWORD}`);

  // 6. Assign realm role `teacher`
  const role = await findRealmRole('teacher');
  if (!role) throw new Error('Realm role "teacher" not found in Keycloak');
  const roleRes = await kc('POST', `/users/${kcUser.id}/role-mappings/realm`, [role]);
  if (!roleRes.ok && roleRes.status !== 409) {
    console.warn(`     ⚠ Could not assign teacher role: ${roleRes.status}`);
  } else {
    console.log(`     ✓ Assigned realm role: teacher`);
  }

  // 7. Patch UserProfile.authProviderId
  await prisma.userProfile.update({
    where: { id: userProfile.id },
    data: { authProviderId: kcUser.id },
  });
  console.log(`     ✓ UserProfile.authProviderId synced`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✓ Demo teacher ready');
  console.log('  ──────────────────────────────────────────────────────────');
  console.log(`  URL      : http://localhost:3100/teacher/login`);
  console.log(`  Email    : ${DEMO_EMAIL}`);
  console.log(`  Mot pass : ${DEMO_PASSWORD}`);
  console.log(`  Prof     : ${userProfile.firstName} ${userProfile.lastName} (${best._count.teachingAssignments} affectations)`);
  console.log('══════════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
