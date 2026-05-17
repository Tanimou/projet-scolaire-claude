import type { GenerateArgs, GenerateResult } from './types';

/**
 * Audit CSV — append-only export of the audit log.
 *
 * Parameters (optional):
 *   - from / to: ISO dates bounding `created_at`
 */
export async function generateAuditCsv(args: GenerateArgs): Promise<GenerateResult> {
  const { prisma, tenantId, parameters } = args;
  const fromIso = (parameters.from as string | undefined) ?? null;
  const toIso = (parameters.to as string | undefined) ?? null;
  const from = fromIso ? new Date(fromIso) : daysAgo(90);
  const to = toIso ? new Date(toIso) : new Date();

  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: 'desc' },
    take: 50_000,
  });

  const header = [
    'created_at',
    'actor_id',
    'portal',
    'action',
    'resource_type',
    'resource_id',
    'ip_address',
  ];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.actorId ?? '',
        r.portal ?? '',
        r.action,
        r.resourceType,
        r.resourceId ?? '',
        r.ipAddress ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return {
    buffer: Buffer.from(lines.join('\n'), 'utf-8'),
    contentType: 'text/csv; charset=utf-8',
  };
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
