import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  authLinked: boolean;
  roles: { slug: string; name: string }[];
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<UserListItem[]> {
    const rows = await this.prisma.userProfile.findMany({
      where: { tenantId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        userRoles: {
          where: { revokedAt: null },
          include: { role: true },
        },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      authLinked: u.authProviderId !== null,
      roles: u.userRoles.map((ur) => ({ slug: ur.role.slug, name: ur.role.name })),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async assignRole(userId: string, roleId: string, grantedById: string, tenantId: string) {
    const user = await this.prisma.userProfile.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.tenantId !== tenantId) throw new ForbiddenException('Cross-tenant assignment refused');

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    // Check if already assigned (and not revoked)
    const existing = await this.prisma.userRole.findFirst({
      where: { userProfileId: userId, roleId, revokedAt: null },
    });
    if (existing) return existing;

    return this.prisma.userRole.create({
      data: {
        userProfileId: userId,
        roleId,
        schoolId: null,
        grantedBy: grantedById,
      },
    });
  }

  async revokeRole(userRoleId: string, tenantId: string) {
    const ur = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: { userProfile: true },
    });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.userProfile.tenantId !== tenantId) throw new ForbiddenException();
    return this.prisma.userRole.update({
      where: { id: userRoleId },
      data: { revokedAt: new Date() },
    });
  }
}
