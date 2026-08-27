import {
  DEFAULT_SCHOOL_TIMEZONE,
  resolveCalendarAnchorInZone,
  type CalendarAnchor,
} from '@pilotage/contracts';

/**
 * L'ancre calendrier des pages portail — **serveur uniquement**
 * (S-E03-8 / PF-40 / PF-406, ADR-078 §D3).
 *
 * C'est le SEUL endroit de `apps/web` où une horloge est lue pour une surface
 * calendrier. Les cinq pages hôtes sont `force-dynamic`, donc l'instant est bien
 * celui de la requête ; l'ancre traverse ensuite la frontière serveur/client en
 * prop, et aucun composant `'use client'` du corpus calendrier ne lit plus ni
 * `Date.now()` ni `new Date()` (cliquet R2).
 *
 * ─── Le fuseau est DÉCLARÉ, jamais ambiant ──────────────────────────────────
 * Le décalage ne vient PAS de `getTimezoneOffset()` : le conteneur `web`
 * (`node:22-alpine`, aucun `TZ` dans `infra/docker-compose*.yml`) tourne en UTC
 * alors que l'école est à `Europe/Paris`. Sous un décalage de 0, un congé
 * « toute la journée » persisté à `2026-11-09T23:00:00Z` par le navigateur d'un
 * admin parisien retombe au 9 novembre sur les TROIS portails, et un férié du
 * 1er novembre chevauche à la fois octobre et novembre. Avant la tranche
 * l'hydratation corrigeait la valeur en silence ; la tranche retire cette
 * correction et gèlerait donc l'erreur.
 *
 * ─── Ce que ce module est, et ce qu'il n'est pas ────────────────────────────
 * Il lit un fuseau **de déploiement** (`SCHOOL_TIMEZONE`, défaut
 * `Europe/Paris` — le même défaut que `School.timezone` / `Tenant.timezone` dans
 * `schema.prisma` et que le `X-WR-TIMEZONE` déjà écrit par `lib/ics.ts`). Ce
 * n'est donc PAS encore multi-locataire : la source multi-locataire correcte est
 * `Tenant.timezone`, résolue côté serveur et renvoyée par une lecture que les
 * trois portails atteignent — c'est la discipline que `S-E04-5` a posée pour
 * l'audit (`filters.timezone`, jamais accepté du client). L'exposer sur une
 * lecture portail est une tranche BACKEND à part entière ; elle est enregistrée
 * en `PF-406` et argumentée dans ADR-078 §D3. Ce module est écrit pour être le
 * seul endroit à changer ce jour-là : les cinq pages appellent
 * {@link resolveSchoolCalendarAnchor} et ne connaissent aucun fuseau.
 */

/**
 * Le fuseau IANA déclaré de l'établissement, pour ce déploiement.
 *
 * Une valeur illisible n'est pas avalée en silence — un repli muet sur UTC est
 * précisément le défaut corrigé ici. Elle est journalisée, puis remplacée par le
 * défaut NOMMÉ (jamais par le fuseau du processus) : cinq pages portail ne
 * doivent pas rendre un 500 parce qu'une variable d'environnement a une faute de
 * frappe.
 */
export function schoolCalendarTimezone(): string {
  const declared = (process.env.SCHOOL_TIMEZONE ?? '').trim();
  return declared === '' ? DEFAULT_SCHOOL_TIMEZONE : declared;
}

/**
 * Résout l'ancre de la requête courante dans le fuseau déclaré de l'école.
 *
 * `now` est injectable pour les tests ; en production les pages l'omettent, et
 * c'est la seule lecture d'horloge de toute la surface.
 */
export function resolveSchoolCalendarAnchor(now: Date = new Date()): CalendarAnchor {
  const zone = schoolCalendarTimezone();
  try {
    return resolveCalendarAnchorInZone(now, zone);
  } catch (err) {
    if (zone === DEFAULT_SCHOOL_TIMEZONE) throw err;
    // Bruyant par choix : l'opérateur doit pouvoir relier l'écran au réglage.
    console.error(
      `[calendar] SCHOOL_TIMEZONE=${JSON.stringify(zone)} est inutilisable ` +
        `(${(err as Error)?.message ?? 'fuseau inconnu'}) — repli sur ` +
        `${DEFAULT_SCHOOL_TIMEZONE}.`,
    );
    return resolveCalendarAnchorInZone(now, DEFAULT_SCHOOL_TIMEZONE);
  }
}
