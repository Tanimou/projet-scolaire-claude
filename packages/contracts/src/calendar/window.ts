/**
 * LE prédicat de fenêtre calendrier — déclaration unique du dépôt (S-E03-8 / PF-40,
 * ADR-078).
 *
 * ─── Pourquoi ce module existe ───────────────────────────────────────────────
 * Avant cette tranche, « cet événement est-il dans le mois M ? » avait SEPT
 * réponses vivantes sur main : le manager admin filtrait sur `startsAt` seul, la
 * vue portail utilisait un chevauchement fermé à `23:59:59` (999 ms perdues), la
 * bande de KPI de cette même vue ouvrait sa propre fenêtre sur `today` pendant
 * que la grille au-dessous obéissait à `monthOffset`, les deux `SchoolEventsPanel`
 * redéclaraient « à venir » et une semaine glissante de 7 jours, et le
 * `CalendarPanel` prof jugeait l'appartenance au mois sur `getMonth()` sans
 * comparer l'année. Le même congé était « de novembre » pour un parent et pas
 * pour l'admin. C'est le défaut A2 §5.5 de l'audit, mot pour mot.
 *
 * ─── Les trois arbitrages, tranchés ici et défendus dans ADR-078 ─────────────
 *
 * D2 — CHEVAUCHEMENT, sur intervalle SEMI-OUVERT `[startMs, endMs)`.
 *   Un mois M contient un événement ssi `[startsAt, endsAt]` intersecte
 *   `[début de M, début de M+1)`. CONSÉQUENCE ASSUMÉE : des vacances du 28/10 au
 *   10/11 sont comptées UNE FOIS dans octobre ET UNE FOIS dans novembre.
 *   L'appartenance mensuelle n'est donc PAS une partition : `Σ(comptes mensuels)`
 *   est SUPÉRIEUR au total. Ce n'est pas un bug, et toute assertion future
 *   « les mois doivent faire le total » est fausse par construction : « combien
 *   d'événements CONCERNENT novembre » et « combien COMMENCENT en novembre » sont
 *   deux questions, et une grille mensuelle pose la première.
 *
 * D3 — L'INSTANT DE RÉFÉRENCE EST RÉSOLU UNE SEULE FOIS, CÔTÉ SERVEUR, DANS LE
 *   FUSEAU **DÉCLARÉ** DE L'ÉCOLE — jamais celui du processus ni celui du
 *   visiteur. La résolution vit dans `../school-time/anchor.ts` parce qu'elle
 *   exige `Intl` et un import, tous deux interdits ici par le cliquet R4.
 *   Toute l'arithmétique ci-dessous part d'une {@link CalendarAnchor} — un couple
 *   `(nowMs, tzOffsetMinutes)` — et se fait en MILLISECONDES ABSOLUES. Aucune
 *   fonction de ce fichier n'appelle `Date.now()`, ne construit une `Date` à
 *   partir de composantes locales, ni ne lit `getMonth()` / `getDate()` /
 *   `getDay()`. La conséquence est la propriété qui rend AC-4 prouvable sans
 *   navigateur : **la même ancre rend des bornes identiques quel que soit le
 *   fuseau du processus**, donc le SSR et l'hydratation calculent le même
 *   nombre, au caractère près.
 *
 * D1 — DOMICILE : `packages/contracts`. C'est le seul candidat à la fois
 *   atteignable depuis un bundle navigateur (`transpilePackages` liste
 *   `@pilotage/contracts`, et `/admin/audit` en importe DÉJÀ des valeurs via
 *   `audit-labels.ts`) et testable unitairement (`apps/api/jest.config.js` mappe
 *   `^@pilotage/contracts$` vers la SOURCE). Ni `apps/web/src/lib/` ni
 *   `packages/ui` n'ont de runner de tests.
 *
 * ─── Contrainte dure, asseyée par le cliquet R4 ─────────────────────────────
 * ZÉRO import. Zéro `Date.now()`. Zéro `new Date(` d'arité ≠ 1. Zéro
 * `getMonth` / `getDate` / `getDay` local. Un module redevenu dépendant du fuseau
 * ré-ouvrirait le défaut d'hydratation en silence.
 *
 * ─── Ce que ce module ne fait PAS ───────────────────────────────────────────
 * Il ne TRONQUE jamais. {@link upcomingEvents} rend tout le à-venir trié ; la
 * troncature est une décision de RENDU, portée par {@link capList}, qui expose
 * toujours le vrai total à côté de la liste coupée. Un module qui tronque est un
 * module qui peut cacher un total (PF-20 / PF-377).
 */

/** Millisecondes dans un jour civil de 24 h. */
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/**
 * L'instant de référence, résolu UNE fois côté serveur et traversant la frontière
 * serveur/client en prop.
 *
 * - `nowMs` : instant absolu (epoch ms). C'est la seule horloge du système.
 * - `tzOffsetMinutes` : minutes à AJOUTER à UTC pour obtenir l'heure locale de
 *   l'école (UTC+1 ⇒ `+60`). Attention : c'est l'OPPOSÉ de
 *   `Date.prototype.getTimezoneOffset()`, qui rend `-60` pour UTC+1 — et qui
 *   décrit de toute façon le fuseau du PROCESSUS, pas celui de l'école.
 *   `resolveCalendarAnchorInZone(now, timeZone)` (`../school-time/anchor.ts`)
 *   est le seul résolveur : il lit le décalage du fuseau IANA **déclaré**, à
 *   l'instant `now`. Ce champ TIENT donc sa promesse, au lieu de la formuler.
 *
 * Le décalage est FIGÉ à l'instant de l'ancre : une borne de mois peut donc être
 * décalée d'une heure de part et d'autre d'un changement d'heure d'été (effet nul
 * sur des événements `allDay`, non nul en principe). C'est `PF-402` — l'arithmétique
 * IANA complète est hors périmètre de cette tranche.
 */
export interface CalendarAnchor {
  readonly nowMs: number;
  readonly tzOffsetMinutes: number;
}

/**
 * Fenêtre temporelle SEMI-OUVERTE `[startMs, endMs)`.
 *
 * Le semi-ouvert n'est pas un détail de style : la borne fermée à `23:59:59` que
 * cette tranche retire perdait les 999 dernières millisecondes de chaque mois, et
 * une borne de semaine testée avec `<=` comptait deux fois un événement démarrant
 * lundi 00:00 pile.
 */
export interface CalendarWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** Le minimum qu'un événement doit exposer pour être situé dans une fenêtre. */
export interface CalendarEventLike {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Date civile locale décomposée — `monthIndex` est 0-based, comme en JS. */
export interface CalendarDateParts {
  readonly year: number;
  readonly monthIndex: number;
  readonly dayOfMonth: number;
  /** 0 = lundi … 6 = dimanche (ISO). */
  readonly weekdayMonday0: number;
}

/** Une case de grille mensuelle, entièrement dérivée de l'ancre. */
export interface CalendarGridCell {
  readonly year: number;
  readonly monthIndex: number;
  readonly dayOfMonth: number;
  /** `true` pour les jours de remplissage empruntés au mois précédent/suivant. */
  readonly isPadding: boolean;
  /** Vrai « aujourd'hui » : celui de l'ancre serveur, jamais celui du visiteur. */
  readonly isToday: boolean;
  readonly isWeekend: boolean;
  /** La fenêtre `[minuit, minuit+1j)` de cette case, en ms absolues. */
  readonly window: CalendarWindow;
  /** Clé stable de rendu (`YYYY-MM-DD`), sans dépendance à `toISOString()`. */
  readonly key: string;
}

/**
 * Liste plafonnée qui EXPOSE son plafond et son vrai total.
 *
 * Forme maison, alignée sur `alert-rule-population.ts` : le total est calculé
 * AVANT la coupe, et la surface rend `total`, jamais `items.length`. Un en-tête
 * qui rend la longueur d'une liste tronquée affirme quelque chose de faux sur
 * l'école — c'est la classe fermée sous PF-20 et ré-enregistrée sous PF-377.
 */
export interface CappedList<T> {
  /** Les éléments effectivement rendus (au plus `cap`). */
  readonly items: readonly T[];
  /** Le vrai total, AVANT troncature. Le seul nombre qu'une surface peut rendre. */
  readonly total: number;
  readonly cap: number;
  readonly truncated: boolean;
  /** `total - items.length` — ce que la liste ne montre pas. */
  readonly hidden: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arithmétique civile pure (algorithme days-from-civil / civil-from-days)
// ─────────────────────────────────────────────────────────────────────────────

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Numéro de jour depuis l'époque, pour une date civile PROLEPTIQUE grégorienne. */
function daysFromCivil(year: number, monthIndex: number, dayOfMonth: number): number {
  // Normalise un `monthIndex` hors [0,11] : c'est ce qui rend `monthWindow(a, -13)`
  // correct sans une seule branche de cas particulier.
  const y0 = year + floorDiv(monthIndex, 12);
  const m0 = monthIndex - floorDiv(monthIndex, 12) * 12; // 0..11
  const m = m0 + 1; // 1..12
  const y = y0 - (m <= 2 ? 1 : 0);
  const era = floorDiv(y, 400);
  const yoe = y - era * 400; // 0..399
  const doy = floorDiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + dayOfMonth - 1; // 0..365
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy; // 0..146096
  return era * 146097 + doe - 719468;
}

/** Inverse de {@link daysFromCivil}. */
function civilFromDays(dayNumber: number): { year: number; monthIndex: number; dayOfMonth: number } {
  const z = dayNumber + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097; // 0..146096
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153); // 0..11
  const d = doy - floorDiv(153 * mp + 2, 5) + 1; // 1..31
  const m = mp + (mp < 10 ? 3 : -9); // 1..12
  return { year: y + (m <= 2 ? 1 : 0), monthIndex: m - 1, dayOfMonth: d };
}

/** 0 = lundi … 6 = dimanche. Le jour 0 de l'époque (1970-01-01) est un JEUDI. */
function weekdayMonday0FromDays(dayNumber: number): number {
  return ((((dayNumber + 3) % 7) + 7) % 7);
}

/** Instant absolu → numéro de jour LOCAL, sous le décalage de l'ancre. */
function localDayNumber(anchor: CalendarAnchor, absoluteMs: number): number {
  return floorDiv(absoluteMs + anchor.tzOffsetMinutes * MS_PER_MINUTE, MS_PER_DAY);
}

/** Numéro de jour local → instant absolu de son minuit local. */
function localDayStartMs(anchor: CalendarAnchor, dayNumber: number): number {
  return dayNumber * MS_PER_DAY - anchor.tzOffsetMinutes * MS_PER_MINUTE;
}

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit une ancre à partir de ses deux composantes DÉJÀ RÉSOLUES — et c'est
 * le SEUL constructeur d'ancre de ce module.
 *
 * Il n'existe volontairement **aucune** fonction ici qui devine `tzOffsetMinutes`
 * : la version initiale de cette tranche exposait un `resolveCalendarAnchor(now)`
 * qui le dérivait de `now.getTimezoneOffset()`, c'est-à-dire du fuseau du
 * PROCESSUS — UTC dans le conteneur `web` livré, alors que l'école est à
 * `Europe/Paris`. Le fuseau AMBIANT est exactement ce que la tranche retire des
 * composants clients ; le lire côté serveur n'en fait pas une donnée déclarée,
 * juste un ambiant différent. La résolution est donc sortie du module canonique
 * et exige un identifiant IANA explicite :
 * `resolveCalendarAnchorInZone(now, timeZone)`
 * (`packages/contracts/src/school-time/anchor.ts`, ADR-078 §D3). Le cliquet R4
 * interdit désormais `getTimezoneOffset` ici, pour que la commodité ne revienne
 * pas par la petite porte.
 *
 * Sert aussi de point d'entrée unique côté client : Next sérialise déjà l'objet
 * sans perte, mais passer par cette fonction donne UN endroit à surveiller.
 */
export function calendarAnchorOf(nowMs: number, tzOffsetMinutes: number): CalendarAnchor {
  return { nowMs, tzOffsetMinutes };
}

/** La date civile LOCALE de l'ancre. */
export function anchorDateParts(anchor: CalendarAnchor): CalendarDateParts {
  const dayNumber = localDayNumber(anchor, anchor.nowMs);
  const civil = civilFromDays(dayNumber);
  return {
    year: civil.year,
    monthIndex: civil.monthIndex,
    dayOfMonth: civil.dayOfMonth,
    weekdayMonday0: weekdayMonday0FromDays(dayNumber),
  };
}

/**
 * La date civile LOCALE d'un instant QUELCONQUE, sous le fuseau de l'ancre.
 *
 * C'est ce qui permet à une pastille de date d'afficher « 31 oct » sur le
 * serveur ET dans le navigateur : sans elle, `toLocaleDateString` sans `timeZone`
 * rend « 31 oct » côté conteneur UTC et « 1 nov » côté visiteur UTC+1 pour le
 * même événement.
 */
export function instantDateParts(anchor: CalendarAnchor, absoluteMs: number): CalendarDateParts {
  const dayNumber = localDayNumber(anchor, absoluteMs);
  const civil = civilFromDays(dayNumber);
  return {
    year: civil.year,
    monthIndex: civil.monthIndex,
    dayOfMonth: civil.dayOfMonth,
    weekdayMonday0: weekdayMonday0FromDays(dayNumber),
  };
}

/** Deux instants tombent-ils le même jour LOCAL ? */
export function isSameLocalDay(anchor: CalendarAnchor, aMs: number, bMs: number): boolean {
  return localDayNumber(anchor, aMs) === localDayNumber(anchor, bMs);
}

/**
 * « Imminent » : l'événement COMMENCE dans les `days` prochains jours et n'a pas
 * encore commencé. Un événement démarré il y a trois jours mais non terminé
 * n'est pas imminent — il est en cours.
 *
 * Une seule déclaration remplace les deux `WEEK_MS` recopiés dans les
 * `SchoolEventsPanel` et le `addDays(today, 7)` de la vue portail, qui étaient
 * une TROISIÈME définition de « semaine » à côté de {@link weekWindow}.
 */
export function isStartingWithinDays(
  event: CalendarEventLike,
  anchor: CalendarAnchor,
  days: number,
): boolean {
  const start = eventStartMs(event);
  if (Number.isNaN(start)) return false;
  return start >= anchor.nowMs && start - anchor.nowMs <= days * MS_PER_DAY;
}

/** `[minuit du jour de l'ancre, minuit du lendemain)`. */
export function todayWindow(anchor: CalendarAnchor): CalendarWindow {
  const dayNumber = localDayNumber(anchor, anchor.nowMs);
  return {
    startMs: localDayStartMs(anchor, dayNumber),
    endMs: localDayStartMs(anchor, dayNumber + 1),
  };
}

/**
 * `[1er du mois M, 1er du mois M+1)`, où M = mois de l'ancre décalé de
 * `monthOffset`. Un offset négatif ou supérieur à 12 est correct sans cas
 * particulier (cf. la normalisation dans `daysFromCivil`).
 */
export function monthWindow(anchor: CalendarAnchor, monthOffset: number): CalendarWindow {
  const { year, monthIndex } = anchorDateParts(anchor);
  const first = daysFromCivil(year, monthIndex + monthOffset, 1);
  const next = daysFromCivil(year, monthIndex + monthOffset + 1, 1);
  return { startMs: localDayStartMs(anchor, first), endMs: localDayStartMs(anchor, next) };
}

/** Année/mois nommés par {@link monthWindow} — pour libeller un compte. */
export function monthLabelParts(
  anchor: CalendarAnchor,
  monthOffset: number,
): { year: number; monthIndex: number } {
  const { year, monthIndex } = anchorDateParts(anchor);
  const civil = civilFromDays(daysFromCivil(year, monthIndex + monthOffset, 1));
  return { year: civil.year, monthIndex: civil.monthIndex };
}

/**
 * `[lundi 00:00, lundi+7j 00:00)` — semaine ISO, lundi premier, EXACTEMENT
 * 7 jours. Le libellé « Sous 7 jours » qui accompagnait l'ancien calcul décrivait
 * une fenêtre glissante, c'est-à-dire un AUTRE prédicat que celui qui tournait.
 */
export function weekWindow(anchor: CalendarAnchor): CalendarWindow {
  const dayNumber = localDayNumber(anchor, anchor.nowMs);
  const monday = dayNumber - weekdayMonday0FromDays(dayNumber);
  return {
    startMs: localDayStartMs(anchor, monday),
    endMs: localDayStartMs(anchor, monday + 7),
  };
}

/** `[jour, jour+1)` pour un jour du mois `M = ancre + monthOffset`. */
export function dayWindow(
  anchor: CalendarAnchor,
  monthOffset: number,
  dayOfMonth: number,
): CalendarWindow {
  const { year, monthIndex } = anchorDateParts(anchor);
  const dayNumber = daysFromCivil(year, monthIndex + monthOffset, dayOfMonth);
  return {
    startMs: localDayStartMs(anchor, dayNumber),
    endMs: localDayStartMs(anchor, dayNumber + 1),
  };
}

/** Instant absolu de début d'un événement (`NaN` si la chaîne est illisible). */
export function eventStartMs(event: CalendarEventLike): number {
  return new Date(event.startsAt).getTime();
}

/** Instant absolu de fin d'un événement. */
export function eventEndMs(event: CalendarEventLike): number {
  return new Date(event.endsAt).getTime();
}

/**
 * LE prédicat. Chevauchement, borne haute EXCLUSIVE.
 *
 * `start < w.endMs && end >= w.startMs` — un événement qui finit à
 * `23:59:59.500` le dernier jour du mois EST dans le mois (le trou de 999 ms est
 * fermé), et un événement qui démarre au premier instant d'une semaine n'est
 * compté que dans celle-là.
 */
export function eventOverlapsWindow(event: CalendarEventLike, window: CalendarWindow): boolean {
  const start = eventStartMs(event);
  const end = eventEndMs(event);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start < window.endMs && end >= window.startMs;
}

/** Les événements qui chevauchent la fenêtre, dans l'ordre d'entrée. */
export function eventsInWindow<T extends CalendarEventLike>(
  events: readonly T[],
  window: CalendarWindow,
): T[] {
  return events.filter((event) => eventOverlapsWindow(event, window));
}

/** Combien d'événements chevauchent la fenêtre. */
export function countEventsInWindow(
  events: readonly CalendarEventLike[],
  window: CalendarWindow,
): number {
  return eventsInWindow(events, window).length;
}

/**
 * LE prédicat « à venir » : un événement est à venir tant qu'il n'est pas
 * TERMINÉ (`endsAt >= nowMs`), pas tant qu'il n'a pas commencé — un congé qui
 * court aujourd'hui est encore d'actualité.
 *
 * Une seule définition pour toutes les surfaces : c'est ce qui empêche la tuile
 * « PROCHAIN » et la liste « À venir » de se contredire sur un événement terminé
 * ce matin (elles divergeaient : la tuile comparait à MINUIT, la liste à
 * MAINTENANT).
 */
export function isUpcoming(event: CalendarEventLike, anchor: CalendarAnchor): boolean {
  const end = eventEndMs(event);
  return !Number.isNaN(end) && end >= anchor.nowMs;
}

/**
 * TOUT le à-venir, trié par `startsAt` croissant. **Jamais tronqué** — voir
 * {@link capList} pour l'affichage plafonné.
 */
export function upcomingEvents<T extends CalendarEventLike>(
  events: readonly T[],
  anchor: CalendarAnchor,
): T[] {
  return events
    .filter((event) => isUpcoming(event, anchor))
    .sort((a, b) => eventStartMs(a) - eventStartMs(b));
}

/**
 * Le tout prochain événement, ou `null`. Dérivé de {@link upcomingEvents} pour
 * que la tuile « PROCHAIN » ne puisse pas répondre autre chose que la tête de la
 * liste « À venir ».
 */
export function nextUpcomingEvent<T extends CalendarEventLike>(
  events: readonly T[],
  anchor: CalendarAnchor,
): T | null {
  return upcomingEvents(events, anchor)[0] ?? null;
}

/**
 * Plafonne une liste EN CONSERVANT son vrai total.
 *
 * Le contrat : une surface rend `total` (et, si `truncated`, dit qu'elle
 * plafonne), jamais `items.length`. `cap <= 0` signifie « pas de plafond ».
 */
export function capList<T>(items: readonly T[], cap: number): CappedList<T> {
  const total = items.length;
  const effective = cap > 0 && total > cap ? items.slice(0, cap) : items.slice();
  return {
    items: effective,
    total,
    cap,
    truncated: effective.length < total,
    hidden: total - effective.length,
  };
}

/**
 * Les cases d'une grille mensuelle (semaines complètes, lundi premier), y compris
 * le remplissage des mois voisins.
 *
 * Elle vit ici plutôt que dans la vue pour une raison précise : c'est la dernière
 * poche d'arithmétique de dates des composants clients. Tant qu'une grille
 * construisait ses propres `new Date(année, mois, jour)`, elle relisait le
 * calendrier du NAVIGATEUR, et `isToday` s'allumait sur une autre case côté
 * serveur et côté client.
 */
export function monthGridCells(anchor: CalendarAnchor, monthOffset: number): CalendarGridCell[] {
  const { year, monthIndex } = monthLabelParts(anchor, monthOffset);
  const firstDayNumber = daysFromCivil(year, monthIndex, 1);
  const nextMonthDayNumber = daysFromCivil(year, monthIndex + 1, 1);
  const daysInMonth = nextMonthDayNumber - firstDayNumber;
  const leading = weekdayMonday0FromDays(firstDayNumber);
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const todayDayNumber = localDayNumber(anchor, anchor.nowMs);

  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNumber = firstDayNumber - leading + i;
    const civil = civilFromDays(dayNumber);
    const weekday = weekdayMonday0FromDays(dayNumber);
    cells.push({
      year: civil.year,
      monthIndex: civil.monthIndex,
      dayOfMonth: civil.dayOfMonth,
      isPadding: i < leading || i >= leading + daysInMonth,
      isToday: dayNumber === todayDayNumber,
      isWeekend: weekday >= 5,
      window: {
        startMs: localDayStartMs(anchor, dayNumber),
        endMs: localDayStartMs(anchor, dayNumber + 1),
      },
      key: String(civil.year) + '-' + pad2(civil.monthIndex + 1) + '-' + pad2(civil.dayOfMonth),
    });
  }
  return cells;
}
