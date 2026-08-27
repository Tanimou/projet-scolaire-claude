/**
 * L'ancre calendrier, résolue dans le fuseau DÉCLARÉ de l'école
 * (S-E03-8 / PF-40 / PF-406, ADR-078 §D3).
 *
 * ─── Pourquoi ce fichier n'est pas dans `../calendar/` ───────────────────────
 * `packages/contracts/src/calendar/**` est sous cliquet R4 : zéro `import`, zéro
 * horloge, zéro fuseau. C'est ce qui garantit que le prédicat de fenêtre est de
 * l'arithmétique pure sur une {@link CalendarAnchor} déjà résolue. Résoudre un
 * fuseau IANA demande `Intl` **et** un import — les deux sont interdits là-bas,
 * délibérément. La résolution vit donc ici, à côté du module canonique et non
 * dedans, et lui passe le résultat par {@link calendarAnchorOf}.
 *
 * ─── Le défaut que ce module ferme ──────────────────────────────────────────
 * La première version de la tranche exposait `resolveCalendarAnchor(now)`, qui
 * dérivait le décalage de `now.getTimezoneOffset()` — c'est-à-dire du fuseau du
 * PROCESSUS. Or `infra/docker/Dockerfile.web` part de `node:22-alpine` et aucun
 * `TZ` n'est posé dans `infra/docker-compose*.yml` : en production le conteneur
 * `web` est en UTC, pendant que l'école est à `Europe/Paris` (le même dépôt
 * écrit déjà `X-WR-TIMEZONE:Europe/Paris` dans ses exports ICS). Un congé « toute
 * la journée » saisi depuis le navigateur d'un admin parisien est persisté en
 * `2026-11-09T23:00:00Z` ; sous un décalage de 0 il retombe au 9 novembre sur
 * les trois portails, et un férié du 1er novembre satisfait le prédicat de
 * chevauchement d'OCTOBRE **et** de NOVEMBRE.
 *
 * Avant la tranche, l'hydratation corrigeait silencieusement le rendu serveur
 * avec l'horloge (correcte) du visiteur. La tranche a supprimé cette correction
 * — c'est son but — et aurait donc GELÉ la mauvaise valeur. Le fuseau doit être
 * DÉCLARÉ, pas ambiant : c'est la même règle que `S-E04-5` a déjà posée pour
 * l'audit (le fuseau vient de `Tenant.timezone`, il est renvoyé, il n'est jamais
 * deviné).
 */

import { assertKnownTimezone, zoneOffsetMinutes } from '../audit/window';
import { calendarAnchorOf, type CalendarAnchor } from '../calendar/window';

/**
 * Le fuseau de repli — IDENTIQUE au défaut de `School.timezone` et de
 * `Tenant.timezone` dans `schema.prisma`, et au `X-WR-TIMEZONE` des exports ICS.
 * Un repli qui ne serait pas celui de la base ferait diverger l'écran et la
 * donnée sans que personne ne le voie.
 */
export const DEFAULT_SCHOOL_TIMEZONE = 'Europe/Paris';

/**
 * Résout l'ancre d'une surface calendrier dans le fuseau **de l'école**.
 *
 * `now` est l'instant absolu (une seule lecture d'horloge, côté serveur, dans une
 * page `force-dynamic`) ; `timeZone` est un identifiant IANA DÉCLARÉ. Le décalage
 * est lu **à cet instant-là**, donc l'heure d'été est correcte au moment du
 * rendu ; il reste ensuite figé pour toute la requête, ce qui est exactement la
 * portée de `PF-402` (une borne de mois peut être décalée d'une heure de part et
 * d'autre d'un changement d'heure — effet nul sur des événements `allDay`).
 *
 * Lève `UnknownTimezoneError` si le fuseau est inconnu du runtime. L'appelant
 * décide quoi en faire ; il ne peut pas ne pas le savoir.
 */
export function resolveCalendarAnchorInZone(now: Date, timeZone: string): CalendarAnchor {
  const zone = assertKnownTimezone(timeZone);
  return calendarAnchorOf(now.getTime(), zoneOffsetMinutes(now, zone));
}
