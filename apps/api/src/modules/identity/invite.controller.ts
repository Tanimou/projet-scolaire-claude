import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class InviteUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  /** Keycloak realm role to grant (school_admin / teacher / parent) */
  @IsEnum(['school_admin', 'teacher', 'parent'])
  realmRole!: 'school_admin' | 'teacher' | 'parent';

  /** Optional custom role slug to also assign in our DB */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customRoleSlug?: string;
}

const PORTAL_CLIENT_ID: Record<InviteUserDto['realmRole'], string> = {
  school_admin: 'portal-admin',
  teacher: 'portal-teacher',
  parent: 'portal-parent',
};

const PORTAL_REDIRECT: Record<InviteUserDto['realmRole'], string> = {
  school_admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
};

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class InviteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  @Post('invite')
  @RequiresPermission('users.write')
  @ApiOkResponse({ description: 'Invitation envoyée par email' })
  async invite(@Body() body: InviteUserDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // Derived BEFORE the transaction opens (S-E06-6's rule). No `@Req()` on this
    // handler, so the client hints stay the honest blank they already were —
    // capturing them is PF-123's remaining half, not taken in this slice.
    const provenance = deriveAuditProvenance(jwt);
    const email = body.email.toLowerCase();

    // 1. Refuse if a Keycloak user already exists with this email
    const existing = await this.keycloak.findUserByEmail(email);
    if (existing) {
      throw new ConflictException(
        `Un utilisateur existe déjà avec l'email ${email}. Il peut se connecter directement.`,
      );
    }

    // 2. Required actions — MFA enforced for admin/teacher per ADR-004
    const requiredActions = ['UPDATE_PASSWORD'];
    if (body.realmRole === 'school_admin' || body.realmRole === 'teacher') {
      requiredActions.push('CONFIGURE_TOTP');
    }

    // 3. Create the Keycloak user with a random temporary password (user resets via email)
    const tempPassword = randomBytes(18).toString('base64url');
    const kcUserId = await this.keycloak.createUser({
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      enabled: true,
      emailVerified: false,
      realmRoles: [body.realmRole],
      requiredActions,
      temporaryPassword: tempPassword,
    });

    // 4. Send the "Execute actions email" — Keycloak email contains the magic link
    const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3100';
    const redirectUri = `${webBaseUrl}${PORTAL_REDIRECT[body.realmRole]}`;
    try {
      await this.keycloak.sendExecuteActionsEmail(
        kcUserId,
        requiredActions,
        PORTAL_CLIENT_ID[body.realmRole],
        redirectUri,
      );
    } catch (err) {
      // Email failed — keep the user but surface a warning so admin can manually share the temp password
      const message = (err as Error).message;
      throw new BadRequestException({
        message: `Utilisateur créé dans Keycloak mais l'envoi de l'email a échoué : ${message}. Configurez SMTP côté Keycloak.`,
        kcUserId,
      });
    }

    // 5-7. S-E04-7 — the local profile, its optional custom role and the audit
    // row are now written in ONE transaction. They were three separate
    // statements, so a failure after step 5 left a user_profile with no trace of
    // who invited it. Every Keycloak call (steps 1-4) stays OUTSIDE: an HTTP
    // round-trip inside an interactive transaction is how a 5 s Prisma timeout
    // becomes a production incident.
    const profile = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userProfile.create({
        data: {
          tenantId: me.tenantId,
          authProviderId: kcUserId,
          email,
          firstName: body.firstName,
          lastName: body.lastName,
          status: UserStatus.active,
        },
      });

      // 6. Optionally assign a custom DB role
      if (body.customRoleSlug) {
        const role = await tx.role.findFirst({
          where: { slug: body.customRoleSlug },
        });
        if (role) {
          await tx.userRole.create({
            data: { userProfileId: created.id, roleId: role.id, grantedBy: me.id },
          });
        }
      }

      // 7. Audit — same transaction, fail-closed (ADR-035 D2).
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'user.invite',
        resourceType: 'user_profile',
        resourceId: created.id,
        provenance,
        after: {
          email,
          realmRole: body.realmRole,
          customRoleSlug: body.customRoleSlug ?? null,
          requiredActions,
        },
      });

      return created;
    });

    return {
      ok: true,
      userProfileId: profile.id,
      kcUserId,
      emailSentTo: email,
    };
  }
}
