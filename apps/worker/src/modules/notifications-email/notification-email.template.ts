import type { NotificationKind, NotificationSeverity } from '@prisma/client';

import type { NotificationEmailJob } from './notification-email.types';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  /** Web origin used to absolutise the in-app deep link, e.g. http://localhost:3000 */
  webBaseUrl: string;
}

/** Per-kind French label + an emoji used in the subject + header pill. */
const KIND_META: Record<NotificationKind, { label: string; emoji: string }> = {
  announcement: { label: 'Annonce', emoji: '📣' },
  alert: { label: 'Alerte de suivi', emoji: '⚠️' },
  grade_published: { label: 'Nouvelle note', emoji: '📝' },
  enrollment_status: { label: 'Inscription', emoji: '🎓' },
  lesson_published: { label: 'Cahier de texte', emoji: '📚' },
  system: { label: 'Information', emoji: 'ℹ️' },
  message: { label: 'Messagerie', emoji: '💬' },
  weekly_digest: { label: 'Récapitulatif hebdomadaire', emoji: '📊' },
  remediation: { label: 'Soutien scolaire', emoji: '🎓' },
};

/** Accent colour per severity (also used for the header bar + CTA button). */
const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: '#2563EB',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#E11D48',
};

const FALLBACK_KIND = { label: 'Notification', emoji: '🔔' };

/** Minimal HTML-entity escaping for user-provided strings. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Join a base origin and an app-relative path without doubling the slash. */
function absoluteLink(webBaseUrl: string, link: string): string {
  const base = webBaseUrl.replace(/\/+$/, '');
  const path = link.startsWith('/') ? link : `/${link}`;
  return `${base}${path}`;
}

/**
 * Render a branded, email-client-safe (inline-styled, table-based) HTML email
 * plus a plain-text fallback from a notification snapshot. Pure + deterministic
 * so it is unit-testable without SMTP.
 */
export function renderNotificationEmail(
  job: NotificationEmailJob,
  opts: RenderOptions,
): RenderedEmail {
  const meta = KIND_META[job.kind] ?? FALLBACK_KIND;
  const color = SEVERITY_COLOR[job.severity] ?? SEVERITY_COLOR.info;

  const subject = `${meta.emoji} ${meta.label} — ${job.title}`;
  const ctaUrl = job.link ? absoluteLink(opts.webBaseUrl, job.link) : null;

  const greeting = `Bonjour ${job.recipientName},`;
  const bodyLine = job.body ?? '';

  // ----- Plain text -----
  const text = [
    greeting,
    '',
    `${meta.label} : ${job.title}`,
    bodyLine ? `\n${bodyLine}` : '',
    ctaUrl ? `\nVoir dans Pilotage scolaire : ${ctaUrl}` : '',
    '',
    '—',
    'Vous recevez cet email car vous avez activé les notifications par email',
    `pour « ${meta.label} ». Gérez vos préférences dans Réglages › Notifications.`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  // ----- HTML -----
  const ctaButton = ctaUrl
    ? `<tr><td style="padding:8px 0 4px;">
         <a href="${esc(ctaUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">
           Voir dans Pilotage scolaire
         </a>
       </td></tr>`
    : '';

  const bodyHtml = bodyLine
    ? `<tr><td style="padding:4px 0 12px;color:#334155;font-size:15px;line-height:1.6;">${esc(bodyLine)}</td></tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 28px -12px rgba(2,6,23,0.18);">
        <tr><td style="height:6px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <span style="display:inline-block;background:${color}1A;color:${color};font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;">
            ${meta.emoji} ${esc(meta.label)}
          </span>
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:6px 0 2px;color:#0f172a;font-size:14px;">${esc(greeting)}</td></tr>
            <tr><td style="padding:2px 0 6px;color:#0f172a;font-size:19px;font-weight:800;line-height:1.35;">${esc(job.title)}</td></tr>
            ${bodyHtml}
            ${ctaButton}
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 14px;" />
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
            Vous recevez cet email car vous avez activé les notifications par email pour
            « ${esc(meta.label)} ». Gérez vos préférences dans
            <strong style="color:#64748b;">Réglages › Notifications</strong>.
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
