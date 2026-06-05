import type { Job } from 'bullmq';

import type { MailerService } from '../../shared/mail/mailer.service';

import { NotificationsEmailProcessor } from './notifications-email.processor';
import { renderNotificationEmail } from './notification-email.template';
import type { NotificationEmailJob } from './notification-email.types';

/**
 * E5-S1 — the worker consumer of the `notifications-email` queue had ZERO
 * coverage. We instantiate the processor directly with a mocked MailerService
 * (no Nest context, mirroring `alerts-evaluator.notify.spec.ts`) and assert the
 * happy path, the WEB_PUBLIC_URL link-absolutisation seam, the default base
 * fallback, and — critically — that a `mailer.send` rejection makes `process()`
 * REJECT rather than swallow.
 *
 * Deliberate asymmetry (recorded here so future readers don't "fix" it):
 *   - The API PRODUCER (`NotificationsService.dispatchEmails`) SWALLOWS enqueue
 *     failures — email is a side channel and must never break the in-app insert
 *     the caller depends on.
 *   - This CONSUMER does the opposite: it RE-THROWS on a send failure so BullMQ's
 *     `attempts: 3` + exponential backoff (5 s) re-delivers the job. Swallowing
 *     here would silently drop a mail that the recipient opted into. Retry/backoff
 *     is the queue's contract, not the dispatcher's.
 */

function makeJob(over: Partial<NotificationEmailJob> = {}): Job<NotificationEmailJob> {
  const data: NotificationEmailJob = {
    tenantId: 't1',
    to: 'parent@example.test',
    recipientName: 'Marie Curie',
    locale: 'fr-FR',
    kind: 'grade_published',
    severity: 'info',
    title: 'Nouvelle note — Contrôle de maths',
    body: 'La note de Léa en Mathématiques a été publiée.',
    link: '/parent/grades?studentId=abc',
    sourceType: 'assessment',
    sourceId: 'abc',
    ...over,
  };
  return { data } as Job<NotificationEmailJob>;
}

function makeProcessor() {
  const send = jest.fn().mockResolvedValue(undefined);
  const mailer = { send } as unknown as MailerService;
  const processor = new NotificationsEmailProcessor(mailer);
  return { processor, send };
}

describe('NotificationsEmailProcessor.process', () => {
  const ORIGINAL_WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL;

  afterEach(() => {
    // Always restore the env so other suites see the original value.
    if (ORIGINAL_WEB_PUBLIC_URL === undefined) delete process.env.WEB_PUBLIC_URL;
    else process.env.WEB_PUBLIC_URL = ORIGINAL_WEB_PUBLIC_URL;
  });

  it('renders the snapshot and forwards {to, subject, html, text} to mailer.send, resolving {sent:true}', async () => {
    delete process.env.WEB_PUBLIC_URL; // exercise the default-base fallback below
    const { processor, send } = makeProcessor();
    const job = makeJob();

    const result = await processor.process(job);

    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);

    // The processor must forward exactly what the (real, pure) renderer produced,
    // addressed to the snapshot recipient — no re-derivation, no DB hit.
    const expected = renderNotificationEmail(job.data, { webBaseUrl: 'http://localhost:3000' });
    expect(send).toHaveBeenCalledWith({
      to: 'parent@example.test',
      subject: expected.subject,
      html: expected.html,
      text: expected.text,
    });
  });

  it('honours WEB_PUBLIC_URL for deep-link absolutisation (env saved/restored)', async () => {
    process.env.WEB_PUBLIC_URL = 'https://app.pilotage.test';
    const { processor, send } = makeProcessor();

    await processor.process(makeJob({ link: '/parent/grades?studentId=abc' }));

    const sent = send.mock.calls[0]![0] as { html: string; text: string };
    expect(sent.html).toContain('https://app.pilotage.test/parent/grades?studentId=abc');
    expect(sent.text).toContain('https://app.pilotage.test/parent/grades?studentId=abc');
    expect(sent.html).not.toContain('http://localhost:3000');
  });

  it('falls back to the default base url when WEB_PUBLIC_URL is unset', async () => {
    delete process.env.WEB_PUBLIC_URL;
    const { processor, send } = makeProcessor();

    await processor.process(makeJob({ link: '/parent/grades?studentId=abc' }));

    const sent = send.mock.calls[0]![0] as { html: string };
    expect(sent.html).toContain('http://localhost:3000/parent/grades?studentId=abc');
  });

  it('RE-THROWS when mailer.send rejects so BullMQ attempts:3 backoff engages (no swallow)', async () => {
    const { processor, send } = makeProcessor();
    send.mockRejectedValueOnce(new Error('SMTP unavailable'));

    // Unlike the producer (which swallows enqueue failures), the consumer must
    // surface the send failure: BullMQ retries the job on the configured backoff.
    await expect(processor.process(makeJob())).rejects.toThrow('SMTP unavailable');
  });
});
