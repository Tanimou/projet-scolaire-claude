import { BadRequestException, Body, ConflictException, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { KeycloakAdminService } from '../../shared/keycloak/keycloak-admin.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class RegisterParentDto {
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

  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit faire au moins 12 caractères.' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsBoolean()
  acceptTerms!: boolean;

  @IsBoolean()
  acceptPrivacy!: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

const DEMO_TENANT_SLUG = 'demo';

/**
 * Parent self-service registration.
 *
 * Public (unauthenticated) endpoint. Creates a Keycloak user with the `parent` realm role
 * and a permanent password, then a corresponding `user_profile` row. The user can immediately
 * log in via the credentials flow on /parent/login. A VERIFY_EMAIL action is set so Keycloak
 * sends an email (via Maildev in dev); the parent doesn't need to act on it before logging in.
 */
@ApiTags('auth')
@Controller('auth')
export class RegisterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  @Post('register-parent')
  @ApiOkResponse({ description: 'Compte parent créé' })
  async registerParent(@Body() body: RegisterParentDto) {
    if (!body.acceptTerms || !body.acceptPrivacy) {
      throw new BadRequestException("Vous devez accepter les CGU et la politique de confidentialité.");
    }
    if (!/[a-z]/.test(body.password) || !/[A-Z]/.test(body.password) || !/\d/.test(body.password) || !/[^A-Za-z0-9]/.test(body.password)) {
      throw new BadRequestException(
        'Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial.',
      );
    }

    const email = body.email.toLowerCase();

    // Reject if user already exists in Keycloak
    const existing = await this.keycloak.findUserByEmail(email);
    if (existing) {
      throw new ConflictException(
        `Un compte existe déjà avec ${email}. Connectez-vous, ou récupérez votre mot de passe.`,
      );
    }

    // Create Keycloak user WITHOUT a password. We set it explicitly below as non-temporary
    // to avoid two things:
    //   1. Keycloak's passwordHistory(5) policy would reject re-setting an identical password
    //      right after createUser if we passed it as temporaryPassword.
    //   2. ROPC ('Account is not fully set up') if we left required actions pending.
    //
    // Phase 1C dev tradeoff: emailVerified=true so the parent can log in immediately after
    // submitting the form (great UX for the demo). For production, set emailVerified=false +
    // requiredActions=['VERIFY_EMAIL'] and gate sensitive features until verification.
    const kcUserId = await this.keycloak.createUser({
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      enabled: true,
      emailVerified: true,
      realmRoles: ['parent'],
      requiredActions: [],
    });
    await this.keycloak.setUserPassword(kcUserId, body.password, false);

    // Provision local user_profile so /api/v1/me works immediately
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: DEMO_TENANT_SLUG },
      update: {},
      create: { slug: DEMO_TENANT_SLUG, name: 'Demo Tenant' },
    });

    await this.prisma.userProfile.create({
      data: {
        tenantId: tenant.id,
        authProviderId: kcUserId,
        email,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        status: UserStatus.active,
        preferences: { marketingOptIn: body.marketingOptIn ?? false },
      },
    });

    return { ok: true, email };
  }
}
