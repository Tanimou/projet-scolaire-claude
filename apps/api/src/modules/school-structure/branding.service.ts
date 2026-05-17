import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { type BrandingDto, type UpdateBrandingDto } from './branding.dto';

@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  async getForTenant(tenantId: string): Promise<BrandingDto> {
    // Phase 1B simplification: a tenant has 1 school for now.
    // Phase 2 wires user → school via enrollment / teaching_assignment / school_admin scope.
    const school = await this.prisma.school.findFirst({
      where: { tenantId },
      include: { branding: true },
    });
    if (!school) throw new NotFoundException('No school for tenant');

    return {
      schoolId: school.id,
      schoolName: school.name,
      schoolCode: school.schoolCode,
      logoUrl: school.branding?.logoUrl ?? null,
      faviconUrl: school.branding?.faviconUrl ?? null,
      displayName: school.branding?.displayName ?? school.name,
      primaryColor: school.branding?.primaryColor ?? 'oklch(0.62 0.18 250)',
      accentColor: school.branding?.accentColor ?? null,
      fontFamily: school.branding?.fontFamily ?? null,
    };
  }

  async update(schoolId: string, patch: UpdateBrandingDto): Promise<BrandingDto> {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');

    const updated = await this.prisma.branding.upsert({
      where: { schoolId },
      update: {
        displayName: patch.displayName ?? undefined,
        primaryColor: patch.primaryColor ?? undefined,
        accentColor: patch.accentColor ?? undefined,
        fontFamily: patch.fontFamily ?? undefined,
        logoUrl: patch.logoUrl ?? undefined,
        faviconUrl: patch.faviconUrl ?? undefined,
      },
      create: {
        schoolId,
        displayName: patch.displayName ?? school.name,
        primaryColor: patch.primaryColor ?? 'oklch(0.62 0.18 250)',
        accentColor: patch.accentColor ?? null,
        fontFamily: patch.fontFamily ?? null,
        logoUrl: patch.logoUrl ?? null,
        faviconUrl: patch.faviconUrl ?? null,
      },
    });

    return {
      schoolId,
      schoolName: school.name,
      schoolCode: school.schoolCode,
      logoUrl: updated.logoUrl,
      faviconUrl: updated.faviconUrl,
      displayName: updated.displayName,
      primaryColor: updated.primaryColor,
      accentColor: updated.accentColor,
      fontFamily: updated.fontFamily,
    };
  }
}
