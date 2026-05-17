/**
 * Throwaway helper: create or refresh a demo parent that you can sign in with.
 *
 *   pnpm tsx apps/api/prisma/seed-demo-parent.ts
 *
 * What it does:
 *   1. Picks an active Guardian in the `voltaire-demo` tenant whose child has
 *      published grades (so the dashboard is interesting).
 *   2. Creates a `UserProfile` if missing and links it to that Guardian
 *      (Guardian.userProfileId).
 *   3. Renames the guardian email to `parent.demo@voltaire.fr` for memorability.
 *   4. Provisions the user in Keycloak with the `parent` realm role and the
 *      shared demo password `Demo!2024`.
 *   5. Patches UserProfile.authProviderId so the JWT → UserProfile mapping
 *      works on first login.
 *
 * Idempotent — re-run any time. Connect at:
 *   http://localhost:3100/parent/login
 *   email    : parent.demo@voltaire.fr
 *   password : Demo!2024
 */

import { PrismaClient } from '@prisma/client';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire';
const KEYCLOAK_ADMIN = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const KEYCLOAK_ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const DEMO_EMAIL = 'parent.demo@voltaire.fr';
// Realm password policy requires min length 12. Reuse the same constant the
// other demo seeds use (`Demo!2024Pilotage`, overridable via env).
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
  console.log('🌱 Provisioning demo parent…\n');

  // 1. Locate the voltaire-demo tenant
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'voltaire-demo' } });
  if (!tenant) throw new Error('voltaire-demo tenant not found — run `pnpm prisma:seed:demo` first');

  // 2. Pick an active guardianship whose student has at least 5 published grades
  console.log('  ▸ Looking for a guardian with grade history…');
  const candidates = await prisma.guardianship.findMany({
    where: { tenantId: tenant.id, status: 'active' },
    include: {
      guardian: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          _count: { select: { grades: true } },
        },
      },
    },
    take: 500,
  });
  // Pick the student with the most grades; fall back to the first guardian
  // even if their child has 0 grades (still gives a working login).
  const best = candidates
    .sort((a, b) => b.student._count.grades - a.student._count.grades)[0];

  if (!best) {
    throw new Error(
      'No active guardianship in voltaire-demo. Run `pnpm prisma:seed:demo` first.',
    );
  }
  const { guardian, student } = best;
  console.log(
    `     → student ${student.firstName} ${student.lastName} (${student._count.grades} grades)`,
  );
  console.log(`     → guardian ${guardian.firstName} ${guardian.lastName} (${guardian.email ?? 'no email'})`);

  // 3. Ensure a UserProfile exists for the guardian
  let userProfile = guardian.userProfileId
    ? await prisma.userProfile.findUnique({ where: { id: guardian.userProfileId } })
    : null;

  if (!userProfile) {
    // Re-use an existing profile with that email if any (otherwise create one)
    userProfile = await prisma.userProfile.findFirst({
      where: { tenantId: tenant.id, email: DEMO_EMAIL },
    });
    if (!userProfile) {
      userProfile = await prisma.userProfile.create({
        data: {
          tenantId: tenant.id,
          firstName: guardian.firstName,
          lastName: guardian.lastName,
          email: DEMO_EMAIL,
          status: 'active',
          locale: 'fr-FR',
        },
      });
      console.log(`     ✓ Created UserProfile ${userProfile.id}`);
    }
    await prisma.guardian.update({
      where: { id: guardian.id },
      data: { userProfileId: userProfile.id, email: DEMO_EMAIL },
    });
    console.log(`     ✓ Linked Guardian → UserProfile`);
  } else {
    // Make sure the email matches the demo one for easy login
    if (userProfile.email !== DEMO_EMAIL) {
      await prisma.userProfile.update({
        where: { id: userProfile.id },
        data: { email: DEMO_EMAIL },
      });
      console.log(`     ✓ Reset UserProfile email to ${DEMO_EMAIL}`);
    }
    if (guardian.email !== DEMO_EMAIL) {
      await prisma.guardian.update({
        where: { id: guardian.id },
        data: { email: DEMO_EMAIL },
      });
    }
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

  // 6. Assign realm role `parent`
  const role = await findRealmRole('parent');
  if (!role) throw new Error('Realm role "parent" not found in Keycloak');
  const roleRes = await kc('POST', `/users/${kcUser.id}/role-mappings/realm`, [role]);
  if (!roleRes.ok && roleRes.status !== 409) {
    console.warn(`     ⚠ Could not assign parent role: ${roleRes.status}`);
  } else {
    console.log(`     ✓ Assigned realm role: parent`);
  }

  // 7. Patch UserProfile.authProviderId
  await prisma.userProfile.update({
    where: { id: userProfile.id },
    data: { authProviderId: kcUser.id },
  });
  console.log(`     ✓ UserProfile.authProviderId synced`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ✓ Demo parent ready');
  console.log('  ──────────────────────────────────────────────────────────');
  console.log(`  URL      : http://localhost:3100/parent/login`);
  console.log(`  Email    : ${DEMO_EMAIL}`);
  console.log(`  Mot pass : ${DEMO_PASSWORD}`);
  console.log(`  Enfant   : ${student.firstName} ${student.lastName} (${student._count.grades} notes)`);
  console.log('══════════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
