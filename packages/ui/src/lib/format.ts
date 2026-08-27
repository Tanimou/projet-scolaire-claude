/**
 * Formatting helpers (FR locale).
 * Used across cards/charts/tables to keep number/date rendering consistent.
 */

const FR = 'fr-FR';

/**
 * Format a grade with French locale and configurable decimals.
 *  - returns '—' for null/undefined/NaN
 *  - default 2 decimals, trailing zero kept (16,80)
 */
export function formatGrade(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(FR, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a /20 grade as "16,80 / 20" — handles null gracefully. */
export function formatGradeOnTwenty(value: number | null | undefined): string {
  return `${formatGrade(value)} / 20`;
}

/** Format a integer (uses FR grouping, e.g. "2 458"). */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(FR);
}

/** Format a percent (input 0-100 OR 0-1, auto-detected, defaults to 1 decimal). */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const v = Math.abs(value) <= 1 ? value * 100 : value;
  return `${v.toLocaleString(FR, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} %`;
}

/** Format a delta value with sign and arrow (e.g. "+2,1 pts ↑"). */
export function formatDelta(value: number | null | undefined, suffix = 'pts'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '';
  return `${sign}${formatGrade(value, 1)} ${suffix} ${arrow}`.trim();
}

/** Returns 'positive' | 'negative' | 'neutral' tone matching a numeric delta. */
export function deltaTone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value == null || Number.isNaN(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

/** Short date FR (28/05/2025). */
export function formatDateShort(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(FR, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Long date FR (28 mai 2025). */
export function formatDateLong(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(FR, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Date card composition: { dayShort: 'VEN', dayNum: '24', monthShort: 'MAI' }. */
export function formatDateCard(input: string | Date | null | undefined): {
  dayShort: string;
  dayNum: string;
  monthShort: string;
  year: string;
} {
  if (!input) return { dayShort: '—', dayNum: '—', monthShort: '—', year: '' };
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return { dayShort: '—', dayNum: '—', monthShort: '—', year: '' };
  const dayShort = d
    .toLocaleDateString(FR, { weekday: 'short' })
    .toUpperCase()
    .replace('.', '');
  const monthShort = d
    .toLocaleDateString(FR, { month: 'short' })
    .toUpperCase()
    .replace('.', '');
  return {
    dayShort,
    dayNum: String(d.getDate()).padStart(2, '0'),
    monthShort,
    year: String(d.getFullYear()),
  };
}

// -----------------------------------------------------------------------------
// Instants relatifs — et la seule chose à savoir avant de les appeler
// -----------------------------------------------------------------------------

/**
 * Un instant, quelle qu'en soit la forme d'entrée, ramené en **millisecondes
 * epoch**. `NaN` quand l'entrée n'est pas un instant lisible : les appelants
 * rendent alors « — » plutôt que d'inventer une date.
 *
 * Pourquoi des millisecondes et pas un `Date` : un nombre epoch est le seul
 * porteur d'instant qui **ne change pas de sens** en traversant la frontière
 * serveur → client. `new Date(y, m, d)` et les accesseurs locaux
 * (`getMonth`, `getDate`) lisent le fuseau du *processus* ; le même code rend
 * donc deux valeurs selon qu'il s'exécute dans le conteneur (UTC) ou dans le
 * navigateur du parent. Une arithmétique en ms absolues n'a pas ce défaut.
 */
function toMs(input: string | number | Date): number {
  if (typeof input === 'number') return input;
  if (typeof input === 'string') return new Date(input).getTime();
  return input.getTime();
}

/**
 * L'instant de référence d'une étiquette relative.
 *
 * **Le défaut `new Date()` est l'horloge de celui qui exécute**, et c'est un
 * piège dont il faut connaître la forme avant de l'accepter. Next.js rend les
 * composants clients **sur le serveur** puis les hydrate dans le navigateur :
 * une étiquette relative calculée sans `now` explicite est donc calculée
 * **deux fois, sur deux horloges différentes** — celle du conteneur, puis
 * celle du visiteur. React remplace silencieusement le nœud de texte, et
 * l'utilisateur voit une valeur **changer après le chargement, sans avoir rien
 * fait**.
 *
 * La règle de la maison, en une phrase : **si l'étiquette porte une
 * affirmation, passez `now` ; si elle est décorative, le défaut suffit.**
 *
 *   • Décoratif — le suffixe d'âge d'un `FreshnessChip` : il est `aria-hidden`,
 *     il redit autrement une valeur affirmée ailleurs dans le même chip, et il
 *     se rafraîchit **par conception**. Qu'il diverge d'une minute ne coûte
 *     rien, et c'est pour cela que cette exemption-là existe.
 *   • Affirmatif — « Dans 3 jours » à côté d'un événement, ou toute étiquette
 *     qui entre dans le nom accessible et qu'on cite pour décider. Là, une
 *     divergence serveur/client est indiscernable d'un changement de donnée :
 *     l'exemption du `FreshnessChip` ne s'y transporte pas.
 *
 * `now` accepte un **nombre** précisément pour rendre le bon geste le moins
 * cher. Quand une page serveur a déjà résolu son instant de référence et le
 * fait traverser en prop sous forme de ms epoch, l'appelant écrit
 * `formatInDays(e.startsAt, nowMs)` : sans reconstruire un `Date` par ligne
 * rendue, et surtout **sans écrire `new Date(...)` dans un composant client**,
 * ce qui laisse la porte ouverte à l'omission du second argument. La forme
 * `Date` reste acceptée telle quelle — aucun appelant existant ne change.
 *
 * (`formatPreferredDate` de `display-prefs.ts` accepte déjà un `number` en
 * entrée : c'était cette signature-ci l'exception, pas la règle.)
 */
export type RelativeNow = string | number | Date;

/** Relative time ("il y a 3 heures"). Voir {@link RelativeNow} pour `now`. */
export function formatRelativeTime(
  input: string | number | Date | null | undefined,
  now: RelativeNow = new Date(),
): string {
  if (input === null || input === undefined || input === '') return '—';
  const ms = toMs(input);
  if (Number.isNaN(ms)) return '—';
  const nowMs = toMs(now);
  if (Number.isNaN(nowMs)) return '—';
  const diffMs = nowMs - ms;
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (hr < 24) return `il y a ${hr} heure${hr > 1 ? 's' : ''}`;
  if (day < 7) return `il y a ${day} jour${day > 1 ? 's' : ''}`;
  return formatDateShort(new Date(ms));
}

/**
 * "Dans X jours" — for future date cards. Voir {@link RelativeNow} : passez
 * `now` dès que l'étiquette est autre chose que décorative.
 *
 * L'écart est mesuré en **millisecondes absolues**, jamais par comparaison de
 * champs de calendrier locaux. À `now` égal, cette fonction rend donc la même
 * chaîne quel que soit le fuseau du processus : c'est ce qui rend l'étiquette
 * réparable en passant simplement l'instant du serveur, sans second défaut de
 * fuseau caché dessous.
 */
export function formatInDays(
  input: string | number | Date | null | undefined,
  now: RelativeNow = new Date(),
): string {
  if (input === null || input === undefined || input === '') return '—';
  const ms = toMs(input);
  if (Number.isNaN(ms)) return '—';
  const nowMs = toMs(now);
  if (Number.isNaN(nowMs)) return '—';
  const days = Math.round((ms - nowMs) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Il y a ${-days} jour${-days > 1 ? 's' : ''}`;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `Dans ${days} jours`;
}
