import type { NotificationKind } from '@prisma/client';

import type { DailyDigestRenderInput, DigestKindGroup } from './daily-digest.types';

export interface RenderedDailyDigestEmail {
  subject: string;
  html: string;
  text: string;
}

export interface DailyDigestRenderOptions {
  /** Web origin used to absolutise the in-app deep links, e.g. http://localhost:3000 */
  webBaseUrl: string;
  /** Settings deep link path (parent vs teacher portal). Default parent. */
  settingsPath?: string;
}

/**
 * Per-kind French label, emoji + accent colour for a digest group header. Mirrors
 * `notifications-email/notification-email.template.ts#KIND_META` (single source of
 * truth for the per-kind voice) extended with a paired accent colour so the group
 * pill is icon+text+colour (never colour alone — WCAG 1.4.1).
 */
const KIND_META: Record<NotificationKind, { label: string; plural: string; emoji: string; color: string }> = {
  announcement: { label: 'Annonce', plural: 'annonces', emoji: '📣', color: '#2563EB' },
  alert: { label: 'Alerte de suivi', plural: 'alertes de suivi', emoji: '⚠️', color: '#E11D48' },
  grade_published: { label: 'Nouvelle note', plural: 'nouvelles notes', emoji: '📝', color: '#2563EB' },
  enrollment_status: { label: 'Inscription', plural: 'inscriptions', emoji: '🎓', color: '#10B981' },
  lesson_published: { label: 'Cahier de texte', plural: 'mises à jour du cahier de texte', emoji: '📚', color: '#2563EB' },
  system: { label: 'Information', plural: 'informations', emoji: 'ℹ️', color: '#64748B' },
  message: { label: 'Message', plural: 'nouveaux messages', emoji: '💬', color: '#7C3AED' },
  weekly_digest: { label: 'Récapitulatif', plural: 'récapitulatifs', emoji: '📊', color: '#7C3AED' },
  remediation: { label: 'Soutien scolaire', plural: 'soutiens scolaires', emoji: '🎓', color: '#4F46E5' },
};

const FALLBACK_META = {
  label: 'Notification',
  plural: 'notifications',
  emoji: '🔔',
  color: '#64748B',
};

/** Kind-level fallback deep link when a notification carried none. */
const KIND_FALLBACK_LINK: Record<NotificationKind, string> = {
  announcement: '/parent/dashboard',
  alert: '/parent/recommendations',
  grade_published: '/parent/dashboard',
  enrollment_status: '/parent/dashboard',
  lesson_published: '/parent/dashboard',
  system: '/parent/dashboard',
  message: '/parent/messages',
  weekly_digest: '/parent/dashboard',
  remediation: '/parent/dashboard',
};

function metaFor(kind: NotificationKind) {
  return KIND_META[kind] ?? FALLBACK_META;
}

export function fallbackLinkFor(kind: NotificationKind): string {
  return KIND_FALLBACK_LINK[kind] ?? '/parent/dashboard';
}

/** Minimal HTML-entity escaping (mirrors the other email templates). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteLink(webBaseUrl: string, link: string): string {
  const base = webBaseUrl.replace(/\/+$/, '');
  const path = link.startsWith('/') ? link : `/${link}`;
  return `${base}${path}`;
}

/** "3 nouvelles notes" / "1 annonce" — count + correctly-pluralised kind label. */
function groupHeadline(group: DigestKindGroup): string {
  const meta = metaFor(group.kind);
  const noun = group.count === 1 ? meta.label.toLowerCase() : meta.plural;
  return `${group.count} ${noun}`;
}

/** One kind-group card (HTML). */
function groupCardHtml(group: DigestKindGroup, opts: DailyDigestRenderOptions): string {
  const meta = metaFor(group.kind);
  const ctaUrl = absoluteLink(opts.webBaseUrl, group.link);
  const samples =
    group.sampleTitles.length > 0
      ? `<ul style="margin:8px 0 0;padding-left:18px;color:#334155;font-size:14px;line-height:1.6;">
           ${group.sampleTitles.map((t) => `<li>${esc(t)}</li>`).join('')}
           ${group.count > group.sampleTitles.length ? `<li style="color:#64748b;">+${group.count - group.sampleTitles.length} autre(s)</li>` : ''}
         </ul>`
      : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #e2e8f0;border-radius:14px;">
    <tr><td style="padding:16px 18px;">
      <span style="display:inline-block;background:${meta.color}1A;color:${meta.color};border-radius:999px;padding:5px 12px;font-weight:700;font-size:13px;">
        ${meta.emoji} ${esc(groupHeadline(group))}
      </span>
      ${samples}
      <div style="margin-top:12px;">
        <a href="${esc(ctaUrl)}" style="display:inline-block;background:${meta.color};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:9px 16px;border-radius:10px;">
          Voir le détail
        </a>
      </div>
    </td></tr>
  </table>`;
}

/** Plain-text mirror of one kind-group. */
function groupCardText(group: DigestKindGroup, opts: DailyDigestRenderOptions): string {
  const meta = metaFor(group.kind);
  const lines: string[] = [];
  lines.push(`— ${meta.emoji} ${groupHeadline(group)} —`);
  for (const t of group.sampleTitles) lines.push(`  - ${t}`);
  if (group.count > group.sampleTitles.length) {
    lines.push(`  - +${group.count - group.sampleTitles.length} autre(s)`);
  }
  lines.push(`  ${absoluteLink(opts.webBaseUrl, group.link)}`);
  return lines.join('\n');
}

/**
 * Render the branded, email-client-safe (inline-styled, table-based) cross-kind
 * daily digest email plus a plain-text fallback. Pure + deterministic so it is
 * unit-testable without SMTP. Mirrors the conventions of `renderDigestEmail`
 * (weekly) and `renderNotificationEmail` (per-event).
 */
export function renderDailyDigestEmail(
  input: DailyDigestRenderInput,
  opts: DailyDigestRenderOptions,
): RenderedDailyDigestEmail {
  const settingsPath = opts.settingsPath ?? '/parent/settings';
  const summaryLine = input.groups.map((g) => groupHeadline(g)).join(' · ');
  const subject = `🔔 Votre résumé du jour — ${summaryLine}`;

  const dashboardUrl = absoluteLink(opts.webBaseUrl, '/parent/dashboard');
  const settingsUrl = absoluteLink(opts.webBaseUrl, settingsPath);
  const greeting = `Bonjour ${input.recipientName},`;

  // ----- Plain text -----
  const text = [
    greeting,
    '',
    `Voici votre résumé du ${input.dayLabel} : ${summaryLine}.`,
    '',
    ...input.groups.map((g) => groupCardText(g, opts)).flatMap((block) => [block, '']),
    `Tableau de bord : ${dashboardUrl}`,
    '',
    '—',
    'Vous recevez ce résumé car vous avez choisi le « Résumé quotidien » pour ces notifications.',
    `Gérez la fréquence dans Réglages › Notifications : ${settingsUrl}`,
  ].join('\n');

  // ----- HTML -----
  const cards = input.groups.map((g) => groupCardHtml(g, opts)).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Votre résumé du jour — ${esc(summaryLine)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 28px -12px rgba(2,6,23,0.18);">
        <tr><td style="height:6px;background:#0ea5e9;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <span style="display:inline-block;background:#0ea5e91A;color:#0284c7;font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;">
            🔔 Résumé quotidien · ${esc(input.dayLabel)}
          </span>
        </td></tr>
        <tr><td style="padding:8px 32px 4px;">
          <p style="margin:6px 0 2px;color:#0f172a;font-size:14px;">${esc(greeting)}</p>
          <p style="margin:2px 0 10px;color:#334155;font-size:14px;line-height:1.6;">Voici votre résumé du jour : <strong>${esc(summaryLine)}</strong>.</p>
        </td></tr>
        <tr><td style="padding:4px 24px 8px;">
          ${cards}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 8px 4px;">
            <a href="${esc(dashboardUrl)}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">
              Ouvrir mon tableau de bord
            </a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 14px;" />
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
            Vous recevez ce résumé car vous avez choisi le « Résumé quotidien » pour ces notifications.
            Gérez la fréquence dans
            <a href="${esc(settingsUrl)}" style="color:#64748b;font-weight:700;text-decoration:underline;">Réglages › Notifications</a>.
          </p>
        </td></tr>
      </table>
      <p style="max-width:560px;margin:16px auto 0;color:#94a3b8;font-size:11px;text-align:center;">
        Pilotage scolaire — plateforme de suivi de la scolarité
      </p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
