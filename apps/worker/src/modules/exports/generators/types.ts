import type { PrismaService } from '../../../shared/prisma/prisma.service';

export interface GenerateArgs {
  prisma: PrismaService;
  tenantId: string;
  schoolId: string | null;
  parameters: Record<string, unknown>;
}

export interface GenerateResult {
  buffer: Buffer;
  contentType: string;
}

export type Generator = (args: GenerateArgs) => Promise<GenerateResult>;
