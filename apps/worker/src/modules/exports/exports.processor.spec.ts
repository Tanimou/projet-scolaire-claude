import { ExportsProcessor, type ExportJobPayload } from './exports.processor';

/**
 * S-E04-11 / PF-149 — **the worker half of AC-6, proven at the seam that a human
 * actually reads.**
 *
 * `exports.processor.ts:112-124` is NOT changed by this slice, and that is the
 * finding's answer rather than a gap in it: the deliberate, logged failure seam
 * already exists — it catches, logs `[audit_csv] <id> — failed: <msg>`, persists
 * `errorMessage: msg.slice(0, 500)` on the `ExportJob` row, marks the row
 * `failed`, and re-throws so BullMQ records the outcome and the `failed` metric
 * fires. `GenerateArgs` (`generators/types.ts:3-8`) carries no logger and no Nest
 * DI, so generators stay pure functions; the generator only *rewords* the error.
 *
 * What was missing was the PROOF that the reworded message reaches the operator.
 * `/admin/exports` renders `ExportRow.errorMessage` verbatim, so this test is
 * the one place where « the DPO learns which zone is broken, in the UI, without
 * a log dive » is a behaviour rather than a claim.
 *
 * It also closes the pre-mortem's highest-probability implementation error: an
 * unusable zone must NEVER produce a "successful" export — no upload, no
 * `succeeded` row, no empty file with a header and no rows.
 */

const BAD_ZONE = 'Mars/Olympus_Mons';
const TENANT = 'tenant-1';

function makeHarness(): {
  processor: ExportsProcessor;
  job: { data: ExportJobPayload };
  updates: Array<Record<string, unknown>>;
  upload: jest.Mock;
} {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    exportJob: {
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { id: args.where.id, fileName: 'audit.csv' };
      }),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: BAD_ZONE }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const upload = jest.fn().mockResolvedValue('s3://never');
  const processor = new ExportsProcessor(prisma as never, { upload } as never);
  return {
    processor,
    updates,
    upload,
    job: {
      data: {
        exportJobId: 'job-1',
        tenantId: TENANT,
        schoolId: null,
        kind: 'audit_csv',
        parameters: { to: '2026-08-08' },
        requestedBy: 'u-1',
      },
    },
  };
}

describe('ExportsProcessor — an unusable Tenant.timezone reaches the operator, not a log', () => {
  it('marks the job failed and persists a message NAMING the offending zone', async () => {
    const { processor, job, updates } = makeHarness();
    // Silence the deliberate `logger.error` — its content is asserted through
    // the persisted row below, and a red console line in a green suite trains
    // readers to ignore console lines.
    const logged: string[] = [];
    jest
      .spyOn(
        (processor as unknown as { logger: { error: (m: string) => void } }).logger,
        'error',
      )
      .mockImplementation((m: string) => {
        logged.push(m);
      });

    await expect(processor.process(job as never)).rejects.toBeDefined();

    const failed = updates.find((d) => d.status === 'failed');
    expect(failed).toBeDefined();
    const message = String(failed!.errorMessage);
    expect(message).toContain(BAD_ZONE);
    expect(message).toContain(TENANT);
    // Fits the column write the processor performs, and therefore the span the
    // exports table renders.
    expect(message.length).toBeLessThanOrEqual(500);
    // French UI copy, not a class name (S-UX-1).
    expect(message).not.toContain('UnknownTimezoneError');
    expect(message.startsWith('Export impossible')).toBe(true);
    // …and the same text reached the log, for the second audience.
    expect(logged.join('\n')).toContain(BAD_ZONE);
  });

  it('never uploads and never records success — it fails closed, not quietly', async () => {
    const { processor, job, updates, upload } = makeHarness();
    jest
      .spyOn(
        (processor as unknown as { logger: { error: (m: string) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(processor.process(job as never)).rejects.toBeDefined();

    // The worst possible "fix" for PF-149 would have been a caught error and an
    // empty CSV: a regulator receiving a header, no rows, and no error.
    expect(upload).not.toHaveBeenCalled();
    expect(updates.some((d) => d.status === 'succeeded')).toBe(false);
  });
});
