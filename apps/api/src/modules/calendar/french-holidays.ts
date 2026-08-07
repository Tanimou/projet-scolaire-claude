/**
 * Table des jours fériés français + calcul de Pâques (computus).
 *
 * Module **pur** (aucune dépendance Nest / Prisma) pour deux raisons :
 *
 * 1. `buildFrenchHolidayPlan` est l'**unique** implémentation du périmètre de
 *    l'import : la même fonction alimente le message de refus (`confirm`
 *    manquant), la simulation (`dryRun`) et l'écriture réelle. Un fork de cette
 *    logique — côté API ou côté `apps/web` — recréerait DNC-06 (une
 *    confirmation annonçant un périmètre plus étroit que ce que le runtime
 *    écrit) à une nouvelle adresse.
 * 2. `computeEaster` / `addDays` sont **déplacés VERBATIM** depuis
 *    `calendar.controller.ts` (S-E06-6). Ils sont corrects aujourd'hui
 *    (Lundi de Pâques = Pâques + 1, Ascension = Pâques + 39, Lundi de Pentecôte
 *    = Pâques + 50, tout ancré en UTC) : toute modification du computus est un
 *    échec de gate G-DNC (DNC-02 / DNC-03).
 */

/**
 * Bornes de l'année civile acceptée par l'endpoint de seed. Partagées entre le
 * DTO (`@Min` / `@Max`) et le plan, pour que le validateur et le périmètre
 * annoncé ne puissent pas diverger.
 *
 * NOTE (limite assumée, cf. pré-mortem FM-10) : l'import émet `year` **et**
 * `year + 1`, donc `year = MAX_SEED_YEAR` produit des événements en 2101, une
 * année civile que l'entrée refuserait. C'est volontaire — la borne encadre la
 * saisie de l'opérateur, pas la portée dérivée — et la réponse renvoie toujours
 * les deux années réellement écrites (`years`), donc l'UI ne peut pas annoncer
 * autre chose que ce qui est écrit.
 */
export const MIN_SEED_YEAR = 2000;
export const MAX_SEED_YEAR = 2100;

/** Une entrée de la table : intitulé + date ISO (`YYYY-MM-DD`). */
export interface FrenchHoliday {
  title: string;
  date: string;
}

/** Une entrée résolue en instants UTC, prête à devenir un `CalendarEvent`. */
export interface PlannedHoliday {
  title: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/** Le périmètre complet d'un import : deux années civiles, 22 événements. */
export interface FrenchHolidayPlan {
  /** L'année demandée par l'opérateur. */
  requestedYear: number;
  /** Les DEUX années civiles réellement couvertes — `[year, year + 1]`. */
  years: [number, number];
  /** Les 22 entrées, dans l'ordre chronologique de la table. */
  entries: PlannedHoliday[];
  /** `entries.length` — le nombre annoncé par la confirmation. */
  planned: number;
}

export const FRENCH_PUBLIC_HOLIDAYS = (year: number): FrenchHoliday[] => {
  // Easter-anchored: Easter Monday & Pentecost Monday.
  const easter = computeEaster(year);
  const easterMonday = addDays(easter, 1);
  const pentecostMonday = addDays(easter, 50);
  const ascension = addDays(easter, 39);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [
    { title: 'Jour de l’an', date: `${year}-01-01` },
    { title: 'Lundi de Pâques', date: iso(easterMonday) },
    { title: 'Fête du Travail', date: `${year}-05-01` },
    { title: 'Victoire 1945', date: `${year}-05-08` },
    { title: 'Ascension', date: iso(ascension) },
    { title: 'Lundi de Pentecôte', date: iso(pentecostMonday) },
    { title: 'Fête nationale', date: `${year}-07-14` },
    { title: 'Assomption', date: `${year}-08-15` },
    { title: 'Toussaint', date: `${year}-11-01` },
    { title: 'Armistice 1918', date: `${year}-11-11` },
    { title: 'Noël', date: `${year}-12-25` },
  ];
};

// Computus algorithm — returns Easter Sunday for a given Gregorian year.
export function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Construit le périmètre réel de l'import pour une année demandée.
 *
 * L'import a TOUJOURS couvert deux années civiles (`year` et `year + 1`, soit
 * 11 + 11 = 22 événements) alors que le libellé du bouton n'en nommait aucune :
 * c'est la moitié « périmètre non annoncé » de PF-29. Cette fonction est la
 * source unique de ce périmètre, pour que la confirmation ne puisse pas
 * annoncer moins que ce que l'écriture fait.
 */
export function buildFrenchHolidayPlan(year: number): FrenchHolidayPlan {
  const entries = FRENCH_PUBLIC_HOLIDAYS(year)
    .concat(FRENCH_PUBLIC_HOLIDAYS(year + 1))
    .map((h) => ({
      title: h.title,
      date: h.date,
      startsAt: new Date(`${h.date}T00:00:00Z`),
      endsAt: new Date(`${h.date}T23:59:59Z`),
    }));

  return {
    requestedYear: year,
    years: [year, year + 1],
    entries,
    planned: entries.length,
  };
}
