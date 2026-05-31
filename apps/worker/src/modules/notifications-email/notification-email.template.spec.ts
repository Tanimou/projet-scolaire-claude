import { renderNotificationEmail } from './notification-email.template';
import type { NotificationEmailJob } from './notification-email.types';

function job(over: Partial<NotificationEmailJob> = {}): NotificationEmailJob {
  return {
    tenantId: 't1',
    to: 'parent@example.test',
    recipientName: 'Marie Curie',
    locale: 'fr-FR',
    kind: 'grade_published',
    severity: 'info',
    title: 'Nouvelle note publiée — Contrôle de maths',
    body: 'La note de Léa en Mathématiques a été publiée.',
    link: '/parent/grades?studentId=abc',
    sourceType: 'assessment',
    sourceId: 'abc',
    ...over,
  };
}

const OPTS = { webBaseUrl: 'http://localhost:3000' };

describe('renderNotificationEmail', () => {
  it('builds a subject with the kind label + title', () => {
    const { subject } = renderNotificationEmail(job(), OPTS);
    expect(subject).toContain('Nouvelle note');
    expect(subject).toContain('Contrôle de maths');
  });

  it('absolutises the deep link onto the web base url (no double slash)', () => {
    const { html, text } = renderNotificationEmail(
      job({ link: '/parent/grades?studentId=abc' }),
      { webBaseUrl: 'http://localhost:3000/' },
    );
    expect(html).toContain('http://localhost:3000/parent/grades?studentId=abc');
    expect(text).toContain('http://localhost:3000/parent/grades?studentId=abc');
    expect(html).not.toContain('localhost:3000//parent');
  });

  it('omits the CTA button when there is no link', () => {
    const { html } = renderNotificationEmail(job({ link: null }), OPTS);
    expect(html).not.toContain('Voir dans Pilotage scolaire');
  });

  it('escapes HTML in user-provided content to prevent injection', () => {
    const { html } = renderNotificationEmail(
      job({ title: 'Note <script>alert(1)</script>', body: 'a & b "c"' }),
      OPTS,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('renders a plain-text fallback with the title and body', () => {
    const { text } = renderNotificationEmail(job(), OPTS);
    expect(text).toContain('Marie Curie');
    expect(text).toContain('Contrôle de maths');
    expect(text).toContain('Mathématiques');
  });

  it('falls back gracefully for an unknown-ish kind/severity without throwing', () => {
    // danger severity → reddish accent; alert kind label
    const { subject, html } = renderNotificationEmail(
      job({ kind: 'alert', severity: 'danger', title: 'Absences répétées' }),
      OPTS,
    );
    expect(subject).toContain('Alerte de suivi');
    expect(html).toContain('#E11D48');
  });
});
