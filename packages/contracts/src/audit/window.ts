/**
 * Fenêtre temporelle d'audit — **la seule résolution de bornes** (S-E04-5).
 *
 * Le défaut mesuré : `analytics.service.ts` bornait avec `lte: new Date(to)`.
 * `to=2026-08-08` devient `2026-08-08T00:00:00Z`, donc **toute la journée
 * sélectionnée est jetée** ; et `gte: new Date(from)` prend minuit **UTC**, soit
 * 02:00 à Paris en été — les lignes écrites entre 00:00 et 02:00 le premier jour
 * disparaissent elles aussi. Corriger une borne et pas l'autre n'est pas une
 * correction : c'est le même mensonge déplacé de deux heures.
 *
 * Ce module résout **les deux** bornes dans le fuseau du tenant :
 *
 *     gte = minuit local du jour `from`
 *     lt  = minuit local du jour **suivant** `to`   (borne EXCLUSIVE)
 *
 * `lt` exclusif plutôt que `lte: 23:59:59.999` : une borne inclusive sur un
 * timestamp doit choisir une précision, et Postgres stocke des microsecondes.
 * `lt` n'a pas de précision à choisir.
 *
 * **Trois consommateurs, une fonction** (ADR-037, même discipline que le
 * vocabulaire) : `analytics.service.ts` (le tableau + les KPI), le générateur
 * CSV du worker (le fichier remis au régulateur), et — via l'écho
 * `filters.timezone` — l'affichage web. Le bouton « Exporter en CSV » poste les
 * mêmes `from`/`to` que le tableau : deux résolutions de bornes = deux réponses
 * à un seul filtre, sur la surface dont toute la thèse est qu'elle ne ment pas.
 *
 * **Pur.** `Intl` seul — aucune dépendance date (`luxon`, `date-fns-tz`,
 * `dayjs`, `@js-temporal`) n'entre dans `apps/api` : ce serait une dérive de la
 * pile épinglée (GUARDRAILS §3). Node 22 embarque l'ICU complet ; ce module
 * **vérifie** ce fait au lieu de le supposer (voir `assertKnownTimezone`).
 *
 * **DST.** On n'ajoute jamais 86 400 000 ms : le 29 mars 2026 dure 23 h à Paris
 * et le 25 octobre 2026 en dure 25. On incrémente la **date civile**, puis on
 * relit le décalage du fuseau **à cet instant-là** (double lecture Intl).
 */

/** Le fuseau de repli, identique au défaut de `Tenant.timezone`. */
export const DEFAULT_AUDIT_TIMEZONE = 'Europe/Paris';

/**
 * Le fuseau demandé n'existe pas — ou l'ICU du runtime est incapable de le
 * résoudre. **Jamais avalée en silence** : un repli muet sur UTC est exactement
 * le défaut que cette tranche supprime (DNC-08). L'appelant décide s'il répond
 * 500 ou s'il annonce le repli, mais il le décide en connaissance de cause.
 */
export class UnknownTimezoneError extends Error {
  readonly timezone: string;

  constructor(timezone: string, reason: string) {
    super(`Fuseau horaire inutilisable : ${JSON.stringify(timezone)} — ${reason}`);
    this.name = 'UnknownTimezoneError';
    this.timezone = timezone;
    // TS descendant d'Error : sans cela `instanceof` est faux quand la cible de
    // compilation est ES5 (ce paquet est construit en CJS, GUARDRAILS §2).
    Object.setPrototypeOf(this, UnknownTimezoneError.prototype);
  }
}

/**
 * Les identifiants qui résolvent **légitimement** vers `UTC`.
 *
 * Sert à distinguer « on m'a demandé UTC » de « ce runtime est en small-ICU et
 * répond UTC à tout ». Sans cette distinction, un conteneur sans ICU complet
 * décale silencieusement toutes les bornes d'une à deux heures — sans erreur,
 * sans log, sans rien (pré-mortem P0-4).
 */
const UTC_ALIASES: readonly string[] = [
  'utc',
  'gmt',
  'gmt0',
  'gmt+0',
  'gmt-0',
  'greenwich',
  'universal',
  'zulu',
  'etc/utc',
  'etc/gmt',
  'etc/gmt+0',
  'etc/gmt-0',
  'etc/greenwich',
  'etc/universal',
  'etc/zulu',
  'z',
];

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (err) {
    throw new UnknownTimezoneError(
      timeZone,
      `identifiant IANA refusé par Intl (${(err as Error)?.message ?? 'RangeError'})`,
    );
  }
  const resolved = fmt.resolvedOptions().timeZone;
  if (resolved === 'UTC' && UTC_ALIASES.indexOf(timeZone.trim().toLowerCase()) === -1) {
    // small-ICU : `Intl` accepte l'identifiant puis rend UTC. Aucune exception,
    // aucune trace — et toutes les bornes deviennent fausses d'une heure ou
    // deux. On échoue fort plutôt que de compter juste par accident en hiver.
    throw new UnknownTimezoneError(
      timeZone,
      "résolu en « UTC » par ce runtime : l'ICU embarqué est incomplet (small-ICU), les bornes seraient silencieusement décalées",
    );
  }
  FORMATTERS.set(timeZone, fmt);
  return fmt;
}

/**
 * Valide un identifiant de fuseau et renvoie sa forme **utilisable**
 * (espaces extérieurs retirés).
 *
 * Lève `UnknownTimezoneError` si le fuseau n'existe pas ou si le runtime ne sait
 * pas le résoudre. Ne remplace **jamais** par un défaut : c'est à l'appelant de
 * décider, et de l'annoncer.
 */
export function assertKnownTimezone(timeZone: string): string {
  const trimmed = (timeZone ?? '').trim();
  if (trimmed === '') {
    throw new UnknownTimezoneError(timeZone, 'valeur vide');
  }
  formatterFor(trimmed);
  return trimmed;
}

/** `true` si le fuseau est résoluble par ce runtime. N'avale pas l'erreur ailleurs. */
export function isKnownTimezone(timeZone: string): boolean {
  try {
    assertKnownTimezone(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: string): number => {
    const hit = parts.find((p) => p.type === type);
    if (!hit) {
      throw new UnknownTimezoneError(timeZone, `Intl n'a pas produit le champ « ${type} »`);
    }
    return parseInt(hit.value, 10);
  };
  // `hour12: false` peut rendre « 24 » pour minuit selon l'ICU — normalisé ici
  // plutôt que découvert par un test qui tourne à 14 h.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Décalage du fuseau à cet instant précis, en ms (`local - UTC`). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // `instant` porte des ms ; les parts n'en portent pas. On aligne à la seconde.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const YMD_LEADING = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

/**
 * Ramène une entrée au jour civil `YYYY-MM-DD`, ou `null` si elle n'en est pas
 * un.
 *
 * Accepte un datetime ISO (le worker en reçoit) en n'en gardant que le jour :
 * sous une sémantique « jour inclus », `2026-08-08T14:00:00Z` **est** le
 * 8 août. Rejette `2026-02-30` : une date de calendrier invalide n'est pas une
 * date, et la traiter comme absente vaut mieux que de produire le 2 mars.
 */
export function normalizeYmd(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const m = YMD_LEADING.exec(value.trim());
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Aller-retour : `Date.UTC(2026, 1, 30)` glisse au 2 mars et se dénonce.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Le jour civil (`YYYY-MM-DD`) qu'il est **dans ce fuseau** à cet instant. */
export function zonedYmd(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, assertKnownTimezone(timeZone));
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * L'instant UTC de **minuit local** du jour `ymd` dans `timeZone`.
 *
 * Double lecture du décalage, parce qu'une seule est fausse deux fois par an :
 * on estime avec le décalage lu à minuit UTC, puis on **relit** le décalage à
 * l'instant candidat et on corrige s'il a changé. Le résultat est ensuite
 * vérifié : s'il ne retombe pas sur le jour demandé — cas d'un minuit qui
 * *n'existe pas* dans les fuseaux qui avancent l'heure à 00:00 — on garde le
 * premier candidat, qui tombe juste après le saut.
 *
 * @throws {UnknownTimezoneError} fuseau inconnu ou runtime small-ICU.
 * @throws {RangeError} `ymd` n'est pas un jour civil valide (jamais avalé :
 *   `resolveAuditWindow` normalise en amont, donc y arriver est un bug).
 */
export function zonedDayStartUtc(ymd: string, timeZone: string): Date {
  const zone = assertKnownTimezone(timeZone);
  const normalized = normalizeYmd(ymd);
  if (normalized === null || normalized !== ymd.trim().slice(0, 10)) {
    throw new RangeError(
      `zonedDayStartUtc: jour civil attendu au format YYYY-MM-DD, reçu ${JSON.stringify(ymd)}`,
    );
  }
  const year = parseInt(normalized.slice(0, 4), 10);
  const month = parseInt(normalized.slice(5, 7), 10);
  const day = parseInt(normalized.slice(8, 10), 10);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  const firstOffset = zoneOffsetMs(new Date(wallClockAsUtc), zone);
  const first = new Date(wallClockAsUtc - firstOffset);
  const secondOffset = zoneOffsetMs(first, zone);
  if (secondOffset === firstOffset) return first;

  const second = new Date(wallClockAsUtc - secondOffset);
  const check = partsInZone(second, zone);
  const lands =
    check.year === year &&
    check.month === month &&
    check.day === day &&
    check.hour === 0 &&
    check.minute === 0;
  return lands ? second : first;
}

/** Minuit local du **lendemain** de `ymd` — la borne `lt`, exclusive. */
export function zonedNextDayStartUtc(ymd: string, timeZone: string): Date {
  const normalized = normalizeYmd(ymd);
  if (normalized === null) {
    throw new RangeError(
      `zonedNextDayStartUtc: jour civil attendu au format YYYY-MM-DD, reçu ${JSON.stringify(ymd)}`,
    );
  }
  const year = parseInt(normalized.slice(0, 4), 10);
  const month = parseInt(normalized.slice(5, 7), 10);
  const day = parseInt(normalized.slice(8, 10), 10);
  // Incrément de la **date civile** — jamais `+ 86 400 000 ms`.
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const nextYmd = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
  return zonedDayStartUtc(nextYmd, timeZone);
}

/**
 * Les bornes résolues d'une fenêtre d'audit.
 *
 * `timezone` est **rendu à l'appelant** pour être ré-affiché : une surface qui
 * annonce « du 1 au 9 août inclus » sans dire dans quel fuseau n'a pas énoncé sa
 * portée, elle l'a suggérée.
 */
export interface ResolvedAuditWindow {
  /** Inclusive. `null` = pas de borne basse. */
  gte: Date | null;
  /** **Exclusive** — minuit du lendemain de `to`. `null` = pas de borne haute. */
  lt: Date | null;
  /** Le fuseau réellement utilisé, tel qu'il doit être affiché. */
  timezone: string;
  /** Le jour civil `from` retenu, ou `null` — pour l'écho `filters.from`. */
  fromDay: string | null;
  /** Le jour civil `to` retenu, ou `null` — pour l'écho `filters.to`. */
  toDay: string | null;
}

/**
 * Résout `from`/`to` (jours civils) en bornes UTC dans le fuseau donné.
 *
 * - `to` est **inclus** : la borne haute est minuit du lendemain, exclusive.
 * - une date malformée est traitée comme **absente** (et l'écho le dit : le
 *   champ correspondant revient `null`, jamais la valeur illisible).
 * - un fuseau inconnu **lève** : il n'y a pas de repli silencieux ici.
 */
export function resolveAuditWindow(
  from: string | null | undefined,
  to: string | null | undefined,
  timeZone: string,
): ResolvedAuditWindow {
  const zone = assertKnownTimezone(timeZone);
  const fromDay = normalizeYmd(from);
  const toDay = normalizeYmd(to);
  return {
    gte: fromDay === null ? null : zonedDayStartUtc(fromDay, zone),
    lt: toDay === null ? null : zonedNextDayStartUtc(toDay, zone),
    timezone: zone,
    fromDay,
    toDay,
  };
}

/**
 * Le fragment Prisma `createdAt` correspondant, ou `undefined` quand la fenêtre
 * est ouverte des deux côtés.
 *
 * Existe pour que les deux consommateurs n'écrivent pas deux fois la même
 * traduction : c'est la traduction qui dérive, pas l'intention.
 */
export function auditWindowCreatedAtFilter(
  window: ResolvedAuditWindow,
): { gte?: Date; lt?: Date } | undefined {
  if (window.gte === null && window.lt === null) return undefined;
  return {
    ...(window.gte === null ? {} : { gte: window.gte }),
    ...(window.lt === null ? {} : { lt: window.lt }),
  };
}
