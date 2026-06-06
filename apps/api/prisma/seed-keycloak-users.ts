/* eslint-disable no-console */
/**
 * Seed Keycloak demo users — admin dashboard production.
 *
 * Creates the two named admin accounts referenced by the dashboard seed:
 *   - mme.dupont@voltaire.fr  (school_admin)
 *   - m.lefebvre@voltaire.fr  (school_admin)
 *
 * Both users get the realm role `school_admin`, are added to all 3 portal
 * clients (so they can log into portal-admin), and have their password set
 * to a predictable demo value: `Demo!2024`.
 *
 * The created auth_provider_id (Keycloak user UUID) is then patched back onto
 * the corresponding UserProfile row in Postgres so JWT → UserProfile mapping
 * works immediately on first login.
 *
 * Run with:
 *   pnpm prisma:seed:keycloak
 *
 * Requires the following env vars (typically in apps/api/.env):
 *   KEYCLOAK_URL          (e.g. http://localhost:8180)
 *   KEYCLOAK_REALM        (e.g. pilotage-scolaire)
 *   KEYCLOAK_ADMIN        (admin username, defaults to "admin")
 *   KEYCLOAK_ADMIN_PASS   (admin password)
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

loadEnv({ path: resolve(__dirname, '..', '.env') });

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire';
const KEYCLOAK_ADMIN = process.env.KEYCLOAK_ADMIN ?? 'admin';
const KEYCLOAK_ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASS ?? 'admin';
// Realm policy enforces min length 12 — keep this in sync with realm config.
const DEMO_PASSWORD = process.env.KEYCLOAK_DEMO_PASSWORD ?? 'Demo!2024Pilotage';

const prisma = new PrismaClient();

interface KcUser {
  email: string;
  firstName: string;
  lastName: string;
  realmRoles: string[];
  tenantId?: string;
  tenantSlug?: string;
}

const DEMO_USERS: KcUser[] = [
  {
    email: 'mme.dupont@voltaire.fr',
    firstName: 'Sophie',
    lastName: 'Dupont',
    realmRoles: ['school_admin'],
    tenantSlug: 'voltaire-demo',
  },
  {
    // The demo TEACHER: he has a teacher_profile (real classes/assignments), so he
    // also needs the `teacher` realm role — the web enforces a portal↔role match
    // (REALM_ROLES_FOR_PORTAL.teacher = ['teacher']); without it the teacher-portal
    // login fails with `wrong_portal`. He keeps `school_admin` too (admin access).
    email: 'm.lefebvre@voltaire.fr',
    firstName: 'Jacques',
    lastName: 'Lefebvre',
    realmRoles: ['school_admin', 'teacher'],
    tenantSlug: 'voltaire-demo',
  },
];

async function getAdminToken(): Promise<string> {
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
  if (!res.ok) {
    throw new Error(`Failed to get admin token: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function kc(method: string, path: string, body?: unknown): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const res = await kc('GET', `/users?email=${encodeURIComponent(email)}&exact=true`);
  if (!res.ok) return null;
  const list = (await res.json()) as Array<{ id: string }>;
  return list[0] ?? null;
}

async function findRealmRole(name: string): Promise<{ id: string; name: string } | null> {
  const res = await kc('GET', `/roles/${encodeURIComponent(name)}`);
  if (!res.ok) return null;
  return (await res.json()) as { id: string; name: string };
}

async function provisionUser(user: KcUser): Promise<string | null> {
  // Idempotent: find existing first
  let kcUser = await findUserByEmail(user.email);

  if (!kcUser) {
    const createRes = await kc('POST', '/users', {
      username: user.email,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: true,
      emailVerified: true,
      attributes: user.tenantId
        ? { tenant_id: [user.tenantId] }
        : user.tenantSlug
          ? { tenant_id: [user.tenantSlug] }
          : {},
    });
    if (!createRes.ok && createRes.status !== 409) {
      console.error(`  ✗ Failed to create ${user.email}: ${createRes.status} ${await createRes.text()}`);
      return null;
    }
    kcUser = await findUserByEmail(user.email);
    if (!kcUser) {
      console.error(`  ✗ Could not find ${user.email} after creation`);
      return null;
    }
  }

  // Set password (idempotent) — fail loudly if policy rejects
  const pwRes = await kc('PUT', `/users/${kcUser.id}/reset-password`, {
    type: 'password',
    value: DEMO_PASSWORD,
    temporary: false,
  });
  if (!pwRes.ok) {
    const errBody = await pwRes.text().catch(() => '<unreadable>');
    console.error(`  ✗ Password set failed for ${user.email}: ${pwRes.status} ${errBody}`);
    return null;
  }

  // Assign realm roles
  for (const roleName of user.realmRoles) {
    const role = await findRealmRole(roleName);
    if (!role) {
      console.warn(`  ⚠ Realm role "${roleName}" not found in realm ${KEYCLOAK_REALM}`);
      continue;
    }
    const roleRes = await kc('POST', `/users/${kcUser.id}/role-mappings/realm`, [role]);
    if (!roleRes.ok && roleRes.status !== 409) {
      console.warn(`  ⚠ Could not assign role ${roleName}: ${roleRes.status}`);
    }
  }

  return kcUser.id;
}

async function main() {
  console.info('🌱 Provisioning Keycloak demo users');
  console.info(`   Realm : ${KEYCLOAK_REALM}`);
  console.info(`   URL   : ${KEYCLOAK_URL}`);
  console.info('');

  // Resolve tenant ids from slugs
  for (const u of DEMO_USERS) {
    if (u.tenantSlug && !u.tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: u.tenantSlug } });
      if (tenant) u.tenantId = tenant.id;
    }
  }

  // Sanity check: ensure Keycloak is reachable
  try {
    const token = await getAdminToken();
    if (!token) throw new Error('empty token');
  } catch (e) {
    console.error('✗ Could not authenticate against Keycloak.');
    console.error('  Make sure Keycloak is running (`pnpm docker:up`) and admin creds in .env are correct.');
    console.error('  Detail:', (e as Error).message);
    process.exit(1);
  }

  for (const u of DEMO_USERS) {
    console.info(`  ▸ ${u.email}…`);
    const kcId = await provisionUser(u);
    if (!kcId) continue;
    console.info(`     ✓ Keycloak user id: ${kcId}`);

    // Patch UserProfile.authProviderId so JWT → UserProfile mapping works on first login
    if (u.tenantId) {
      const updated = await prisma.userProfile.updateMany({
        where: { tenantId: u.tenantId, email: u.email },
        data: { authProviderId: kcId },
      });
      if (updated.count > 0) {
        console.info(`     ✓ UserProfile.authProviderId mis à jour (${updated.count} row)`);
      } else {
        console.warn(`     ⚠ Aucun UserProfile trouvé pour ${u.email}. Lance \`pnpm prisma:seed:demo\` d'abord.`);
      }
    }
  }

  console.info('');
  console.info(`✓ Provisioning terminé. Mot de passe démo : ${DEMO_PASSWORD}`);
  console.info('  Connexion : http://localhost:3100/admin/login');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
