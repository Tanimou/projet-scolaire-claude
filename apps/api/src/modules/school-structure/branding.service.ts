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

  /**
   * Met à jour le branding d'une école **du locataire appelant**.
   *
   * `tenantId` est le premier paramètre et non une option : jusqu'à S-E06-2 la
   * méthode prenait un `schoolId` nu et le résolvait par `findUnique`, de sorte
   * qu'un administrateur d'un locataire pouvait réécrire le branding de
   * n'importe quelle école de n'importe quel autre locataire — et, le branding
   * étant injecté dans un `<style>` rendu côté serveur sur toutes les pages
   * authentifiées, y déposer du contenu visible par les quatre portails de la
   * victime. C'est `PF-88` ; il est réparé ici parce que la validation de
   * PF-45 seule aurait laissé la porte d'écriture inter-locataires ouverte.
   *
   * `findFirst({ id, tenantId })` et non `findUnique` + comparaison : la
   * contrainte entre dans la requête, donc il n'existe pas de chemin où l'on
   * lit la ligne d'un autre locataire avant de décider. L'absence renvoie 404 et
   * non 403 — un 403 confirmerait l'existence de l'identifiant.
   */
  async update(tenantId: string, schoolId: string, patch: UpdateBrandingDto): Promise<BrandingDto> {
    const school = await this.prisma.school.findFirst({ where: { id: schoolId, tenantId } });
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
