import type { ChildDigest, DigestRenderInput, DigestTrend } from './digest-email.types';

export interface RenderedDigestEmail {
  subject: string;
  html: string;
  text: string;
}

export interface DigestRenderOptions {
  /** Web origin used to absolutise the in-app deep links, e.g. http://localhost:3000 */
  webBaseUrl: string;
}

/** Accent colour per trend (paired ALWAYS with an arrow/label — never colour alone). */
const TREND_COLOR: Record<DigestTrend, string> = {
  improving: '#10B981',
  stable: '#2563EB',
  declining: '#F59E0B',
  unknown: '#64748B',
};

const TREND_ARROW: Record<DigestTrend, string> = {
  improving: '▲',
  stable: '➡',
  declining: '▼',
  unknown: '•',
};

/** Minimal HTML-entity escaping for user-provided strings (mirrors notification-email.template). */
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

/** "13,4 / 20" with a French decimal comma, or a dash when no grades. */
function fmtAverage(avg: number | null): string {
  if (avg == null) return '—';
  return `${avg.toFixed(1).replace('.', ',')} / 20`;
}

/** "▲ +0,6 vs semaine dernière" / "➡ stable" — colour is paired with text. */
function trendPillText(child: ChildDigest): string {
  if (child.trendDelta == null) return 'tendance inchangée';
  const sign = child.trendDelta > 0 ? '+' : '';
  return `${TREND_ARROW[child.trend]} ${sign}${child.trendDelta.toFixed(1).replace('.', ',')} vs semaine dernière`;
}

function fmtDate(iso: string): string {
  const months = [
    'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
  ];
  const days = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const d = new Date(iso);
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** Build one child card (HTML). */
function childCardHtml(child: ChildDigest, opts: DigestRenderOptions): string {
  const color = TREND_COLOR[child.trend];
  const fullName = `${child.firstName} ${child.lastName}`.trim();
  const initial = (child.firstName[0] ?? '?').toUpperCase();

  // Block 2 — new alerts.
  const alertsBlock =
    child.newAlertsCount > 0
      ? `<ul style="margin:6px 0 0;padding-left:18px;color:#334155;font-size:14px;line-height:1.6;">
           ${child.newAlertTitles.map((t) => `<li>${esc(t)}</li>`).join('')}
           ${child.newAlertsCount > child.newAlertTitles.length ? `<li style="color:#64748b;">+${child.newAlertsCount - child.newAlertTitles.length} autre(s)</li>` : ''}
         </ul>`
      : `<p style="margin:6px 0 0;color:#10B981;font-size:14px;">Aucune nouvelle alerte cette semaine. 🎉</p>`;

  // Block 3 — upcoming.
  const upcomingBlock =
    child.upcoming.length > 0
      ? `<ul style="margin:6px 0 0;padding-left:18px;color:#334155;font-size:14px;line-height:1.6;">
           ${child.upcoming
             .map(
               (u) =>
                 `<li>${esc(fmtDate(u.scheduledAt))} · ${esc(u.subjectName)} · ${esc(u.kindLabel)}</li>`,
             )
             .join('')}
         </ul>`
      : `<p style="margin:6px 0 0;color:#64748b;font-size:14px;">Pas d’évaluation programmée pour l’instant.</p>`;

  const ctaUrl = absoluteLink(opts.webBaseUrl, child.recommendationLink);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #e2e8f0;border-radius:14px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="34" style="vertical-align:middle;">
            <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:${color}1A;color:${color};font-weight:800;font-size:13px;">${esc(initial)}</span>
          </td>
          <td style="vertical-align:middle;color:#0f172a;font-size:15px;font-weight:800;">
            ${esc(fullName)}${child.className ? ` <span style="color:#64748b;font-weight:600;font-size:12px;">· ${esc(child.className)}</span>` : ''}
          </td>
        </tr>
      </table>

      <p style="margin:12px 0 2px;color:#0f172a;font-size:13px;font-weight:700;">📈 Tendance globale</p>
      <p style="margin:0;color:#0f172a;font-size:18px;font-weight:800;">
        ${esc(fmtAverage(child.globalAverage))}
        <span style="display:inline-block;margin-left:8px;background:${color}1A;color:${color};border-radius:999px;padding:4px 11px;font-weight:700;font-size:12px;vertical-align:middle;">${esc(trendPillText(child))}</span>
      </p>

      <p style="margin:14px 0 0;color:#0f172a;font-size:13px;font-weight:700;">⚠️ Nouvelles alertes cette semaine</p>
      ${alertsBlock}

      <p style="margin:14px 0 0;color:#0f172a;font-size:13px;font-weight:700;">🗓️ Évaluations à venir</p>
      ${upcomingBlock}

      <p style="margin:14px 0 0;color:#0f172a;font-size:13px;font-weight:700;">✅ À faire</p>
      <p style="margin:4px 0 10px;color:#334155;font-size:14px;line-height:1.6;">${esc(child.recommendation)}</p>
      <a href="${esc(ctaUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;">
        Voir le détail
      </a>
    </td></tr>
  </table>`;
}

/** Plain-text mirror of one child block. */
function childCardText(child: ChildDigest, opts: DigestRenderOptions): string {
  const lines: string[] = [];
  const fullName = `${child.firstName} ${child.lastName}`.trim();
  lines.push(`— ${fullName}${child.className ? ` (${child.className})` : ''} —`);
  lines.push(`TENDANCE : ${fmtAverage(child.globalAverage)} · ${trendPillText(child)}`);
  if (child.newAlertsCount > 0) {
    lines.push(`ALERTES (${child.newAlertsCount}) :`);
    for (const t of child.newAlertTitles) lines.push(`  - ${t}`);
    if (child.newAlertsCount > child.newAlertTitles.length) {
      lines.push(`  - +${child.newAlertsCount - child.newAlertTitles.length} autre(s)`);
    }
  } else {
    lines.push('ALERTES : aucune nouvelle alerte cette semaine.');
  }
  if (child.upcoming.length > 0) {
    lines.push('ÉVALUATIONS :');
    for (const u of child.upcoming) {
      lines.push(`  - ${fmtDate(u.scheduledAt)} · ${u.subjectName} · ${u.kindLabel}`);
    }
  } else {
    lines.push('ÉVALUATIONS : pas d’évaluation programmée pour l’instant.');
  }
  lines.push(`ACTION : ${child.recommendation}`);
  lines.push(`  ${absoluteLink(opts.webBaseUrl, child.recommendationLink)}`);
  return lines.join('\n');
}

/**
 * Render a branded, email-client-safe (inline-styled, table-based) weekly digest
 * email plus a plain-text fallback. Pure + deterministic so it is unit-testable
 * without SMTP. Mirrors the conventions of `renderNotificationEmail`.
 */
export function renderDigestEmail(
  input: DigestRenderInput,
  opts: DigestRenderOptions,
): RenderedDigestEmail {
  const childCount = input.children.length;
  const [firstChild] = input.children;
  const subject =
    childCount === 1 && firstChild
      ? `📊 Votre résumé de la semaine — ${firstChild.firstName}`
      : `📊 Votre résumé de la semaine — ${childCount} enfants`;

  const dashboardUrl = absoluteLink(opts.webBaseUrl, '/parent/dashboard');
  const settingsUrl = absoluteLink(opts.webBaseUrl, '/parent/settings');
  const greeting = `Bonjour ${input.recipientName},`;
  const childNames = input.children.map((c) => c.firstName).join(', ');

  // ----- Plain text -----
  const text = [
    greeting,
    '',
    `Voici le suivi de la semaine (${input.weekLabel}) pour ${childNames}.`,
    '',
    ...input.children.map((c) => childCardText(c, opts)).flatMap((block) => [block, '']),
    `Tableau de bord : ${dashboardUrl}`,
    '',
    '—',
    'Vous recevez ce résumé car vous avez activé le Récapitulatif hebdomadaire.',
    `Gérez-le ou désactivez-le dans Réglages › Notifications : ${settingsUrl}`,
  ].join('\n');

  // ----- HTML -----
  const cards = input.children.map((c) => childCardHtml(c, opts)).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Votre résumé de la semaine — ${esc(input.weekLabel)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 28px -12px rgba(2,6,23,0.18);">
        <tr><td style="height:6px;background:#7c3aed;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <span style="display:inline-block;background:#7c3aed1A;color:#7c3aed;font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;">
            📊 Résumé hebdomadaire · ${esc(input.weekLabel)}
          </span>
        </td></tr>
        <tr><td style="padding:8px 32px 4px;">
          <p style="margin:6px 0 2px;color:#0f172a;font-size:14px;">${esc(greeting)}</p>
          <p style="margin:2px 0 10px;color:#334155;font-size:14px;line-height:1.6;">Voici le suivi de la semaine pour ${esc(childNames)}.</p>
        </td></tr>
        <tr><td style="padding:4px 24px 8px;">
          ${cards}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 8px 4px;">
            <a href="${esc(dashboardUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;">
              Ouvrir mon tableau de bord
            </a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 14px;" />
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
            Vous recevez ce résumé car vous avez activé le Récapitulatif hebdomadaire.
            Gérez-le ou désactivez-le dans
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
