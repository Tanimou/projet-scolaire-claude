import { Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { type KeycloakJwtPayload } from './jwt.strategy';
import { REALM_ROLE_PERMISSIONS } from './permissions.constants';

const DEMO_TENANT_SLUG = 'demo';

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureUser(payload: KeycloakJwtPayload) {
    const sub = payload.sub;
    const email = (payload.email ?? payload.preferred_username ?? '').toLowerCase();
    const firstName = payload.given_name ?? '';
    const lastName = payload.family_name ?? '';

    let user = await this.prisma.userProfile.findUnique({
      where: { authProviderId: sub },
    });

    if (!user && email) {
      const byEmail = await this.prisma.userProfile.findFirst({ where: { email } });
      if (byEmail) {
        user = await this.prisma.userProfile.update({
          where: { id: byEmail.id },
          data: { authProviderId: sub },
        });
        this.logger.log(`Linked existing profile ${byEmail.id} to sub ${sub}`);
      }
    }

    if (!user) {
      const tenant = await this.prisma.tenant.upsert({
        where: { slug: DEMO_TENANT_SLUG },
        update: {},
        create: { slug: DEMO_TENANT_SLUG, name: 'Demo Tenant' },
      });
      user = await this.prisma.userProfile.create({
        data: {
          tenantId: tenant.id,
          authProviderId: sub,
          email,
          firstName: firstName || 'User',
          lastName: lastName || '',
          status: UserStatus.active,
          emailVerifiedAt: payload.email_verified ? new Date() : null,
        },
      });
      this.logger.log(`Created profile ${user.id} for ${email} (sub ${sub})`);
    }

    return user;
  }

  /**
   * Effective permission set = realm-role permissions ∪ custom-role permissions.
   */
  async effectivePermissions(sub: string, realmRoles: string[]): Promise<Set<string>> {
    const set = new Set<string>();
    for (const r of realmRoles) {
      const list = REALM_ROLE_PERMISSIONS[r] ?? [];
      for (const p of list) set.add(p);
    }

    const user = await this.prisma.userProfile.findUnique({
      where: { authProviderId: sub },
      include: {
        userRoles: {
          where: { revokedAt: null },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
      },
    });
    if (user) {
      for (const ur of user.userRoles) {
        for (const rp of ur.role.rolePermissions) set.add(rp.permission.code);
      }
    }

    return set;
  }

  async listPermissions(sub: string, realmRoles: string[]): Promise<string[]> {
    const set = await this.effectivePermissions(sub, realmRoles);
    return [...set].sort();
  }
}
