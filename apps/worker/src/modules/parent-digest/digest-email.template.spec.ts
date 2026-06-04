import { renderDigestEmail } from './digest-email.template';
import type { ChildDigest, DigestRenderInput } from './digest-email.types';

function child(over: Partial<ChildDigest> = {}): ChildDigest {
  return {
    studentId: 'stu-1',
    firstName: 'Léa',
    lastName: 'Martin',
    className: '6eA',
    globalAverage: 13.4,
    trendDelta: 0.6,
    trend: 'improving',
    newAlertsCount: 1,
    newAlertTitles: ['Moyenne faible en Mathématiques'],
    upcoming: [
      {
        scheduledAt: new Date(Date.UTC(2026, 5, 3, 8, 0, 0)).toISOString(),
        subjectName: 'Mathématiques',
        kindLabel: 'Contrôle',
        title: 'Contrôle chapitre 4',
      },
    ],
    recommendation: 'Renforcer les Mathématiques',
    recommendationLink: '/parent/grades?studentId=stu-1&subjectId=sub-9',
    ...over,
  };
}

function input(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return {
    recipientName: 'Marie Curie',
    weekLabel: '26 mai – 1 juin',
    children: [child()],
    ...over,
  };
}

const OPTS = { webBaseUrl: 'http://localhost:3000' };

describe('renderDigestEmail', () => {
  it('builds a single-child subject with the child first name', () => {
    const { subject } = renderDigestEmail(input(), OPTS);
    expect(subject).toContain('résumé de la semaine');
    expect(subject).toContain('Léa');
  });

  it('builds a multi-child subject with the count', () => {
    const { subject } = renderDigestEmail(
      input({ children: [child(), child({ studentId: 'stu-2', firstName: 'Tom' })] }),
      OPTS,
    );
    expect(subject).toContain('2 enfants');
  });

  it('renders the four blocks in order with French labels', () => {
    const { html } = renderDigestEmail(input(), OPTS);
    const iTrend = html.indexOf('Tendance globale');
    const iAlerts = html.indexOf('Nouvelles alertes');
    const iUpcoming = html.indexOf('Évaluations à venir');
    const iAction = html.indexOf('À faire');
    expect(iTrend).toBeGreaterThan(-1);
    expect(iAlerts).toBeGreaterThan(iTrend);
    expect(iUpcoming).toBeGreaterThan(iAlerts);
    expect(iAction).toBeGreaterThan(iUpcoming);
  });

  it('shows the global average with a French comma + own-prior-week trend (no named peers)', () => {
    const { html } = renderDigestEmail(input(), OPTS);
    expect(html).toContain('13,4 / 20');
    expect(html).toContain('+0,6 vs semaine dernière');
    expect(html).not.toMatch(/classe|camarade|moyenne de la classe/i);
  });

  it('shows a reassuring empty-alerts line when there are no new alerts', () => {
    const { html } = renderDigestEmail(
      input({ children: [child({ newAlertsCount: 0, newAlertTitles: [] })] }),
      OPTS,
    );
    expect(html).toContain('Aucune nouvelle alerte cette semaine');
  });

  it('absolutises the recommended-action CTA onto the web base url (no double slash)', () => {
    const { html, text } = renderDigestEmail(input(), { webBaseUrl: 'http://localhost:3000/' });
    expect(html).toContain('http://localhost:3000/parent/grades?studentId=stu-1&subjectId=sub-9');
    expect(text).toContain('http://localhost:3000/parent/grades?studentId=stu-1&subjectId=sub-9');
    expect(html).not.toContain('localhost:3000//parent');
  });

  it('includes the dashboard CTA and an opt-out footer to /parent/settings', () => {
    const { html } = renderDigestEmail(input(), OPTS);
    expect(html).toContain('http://localhost:3000/parent/dashboard');
    expect(html).toContain('http://localhost:3000/parent/settings');
    expect(html).toContain('Récapitulatif hebdomadaire');
  });

  it('escapes HTML in user-provided strings to prevent injection', () => {
    const { html } = renderDigestEmail(
      input({
        children: [
          child({
            newAlertTitles: ['<script>alert(1)</script>'],
            recommendation: 'a & b "c"',
          }),
        ],
      }),
      OPTS,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('renders a plain-text fallback mirroring every block', () => {
    const { text } = renderDigestEmail(input(), OPTS);
    expect(text).toContain('Marie Curie');
    expect(text).toContain('TENDANCE');
    expect(text).toContain('ALERTES');
    expect(text).toContain('ÉVALUATIONS');
    expect(text).toContain('ACTION');
  });

  it('handles a child with no grades (average dash, inchangée trend) without throwing', () => {
    const { html } = renderDigestEmail(
      input({
        children: [child({ globalAverage: null, trendDelta: null, trend: 'unknown' })],
      }),
      OPTS,
    );
    expect(html).toContain('— ');
    expect(html).toContain('tendance inchangée');
  });
});
