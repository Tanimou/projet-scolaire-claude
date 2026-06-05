import { fallbackLinkFor, renderDailyDigestEmail } from './daily-digest-email.template';
import type { DailyDigestRenderInput, DigestKindGroup } from './daily-digest.types';

function group(over: Partial<DigestKindGroup> = {}): DigestKindGroup {
  return {
    kind: 'grade_published',
    count: 2,
    sampleTitles: ['Note de Maths', 'Note de Français'],
    link: '/parent/grades',
    ...over,
  };
}

function input(over: Partial<DailyDigestRenderInput> = {}): DailyDigestRenderInput {
  return {
    recipientName: 'Marie Curie',
    dayLabel: '5 juin 2026',
    totalCount: 2,
    groups: [group()],
    ...over,
  };
}

const OPTS = { webBaseUrl: 'http://localhost:3000' };

describe('renderDailyDigestEmail', () => {
  it('builds a deterministic subject with the grouped, pluralised headline', () => {
    const out = renderDailyDigestEmail(
      input({
        totalCount: 3,
        groups: [
          group({ kind: 'grade_published', count: 2 }),
          group({ kind: 'announcement', count: 1, sampleTitles: ['Réunion'], link: '/a/1' }),
        ],
      }),
      OPTS,
    );
    expect(out.subject).toContain('2 nouvelles notes');
    expect(out.subject).toContain('1 annonce'); // singular form
  });

  it('renders one section per kind group with its count', () => {
    const out = renderDailyDigestEmail(
      input({
        groups: [
          group({ kind: 'grade_published', count: 2 }),
          group({ kind: 'message', count: 1, sampleTitles: ['Msg'], link: '/m/1' }),
        ],
      }),
      OPTS,
    );
    expect(out.html).toContain('2 nouvelles notes');
    expect(out.html).toContain('1 message');
  });

  it('absolutises each group deep link against the web base url', () => {
    const out = renderDailyDigestEmail(input({ groups: [group({ link: '/parent/grades/9' })] }), OPTS);
    expect(out.html).toContain('http://localhost:3000/parent/grades/9');
  });

  it('escapes user-provided titles (no raw HTML injection)', () => {
    const out = renderDailyDigestEmail(
      input({ groups: [group({ sampleTitles: ['<script>x</script>'] })] }),
      OPTS,
    );
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('shows a "+N autre(s)" overflow line when count exceeds the sample list', () => {
    const out = renderDailyDigestEmail(
      input({ groups: [group({ count: 5, sampleTitles: ['a', 'b', 'c'] })] }),
      OPTS,
    );
    expect(out.html).toContain('+2 autre(s)');
    expect(out.text).toContain('+2 autre(s)');
  });

  it('emits a plain-text fallback with the same headline and a settings link', () => {
    const out = renderDailyDigestEmail(input(), OPTS);
    expect(out.text).toContain('2 nouvelles notes');
    expect(out.text).toContain('http://localhost:3000/parent/settings');
  });

  it('fallbackLinkFor returns a per-kind dashboard/recommendations link', () => {
    expect(fallbackLinkFor('message')).toBe('/parent/messages');
    expect(fallbackLinkFor('alert')).toBe('/parent/recommendations');
    expect(fallbackLinkFor('grade_published')).toBe('/parent/dashboard');
  });
});
