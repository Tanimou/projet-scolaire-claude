/**
 * Subject color mapping — REDESIGN-PLAN.md §1.8
 *
 * Returns a stable color triplet (primary, tonal, Tailwind gradient classes)
 * for a given subject code, ensuring teacher/parent portals show the same
 * Maths/History/etc. color.
 *
 * Maps map both canonical codes (e.g. MATH) and common French aliases
 * (e.g. MATHEMATIQUES, MATHS) so seed data with various spellings still works.
 */

/**
 * Les faits AUTORISÉS d'une matière — ce qu'un auteur écrit à la main.
 *
 * Tout le reste (l'encre lisible sur le dégradé, son ratio de contraste) en est
 * **dérivé** : ajouter une matière ne demande jamais d'entretenir une seconde
 * liste, et une liste tenue à la main est précisément la façon dont ce dépôt a
 * déjà dérivé ailleurs.
 */
export interface SubjectPalette {
  /** Primary hue (filled icons, dots, charts) — OKLCH */
  primary: string;
  /** Tonal background (badges, soft fills) — OKLCH */
  tonal: string;
  /** Tailwind gradient classes for SubjectKpiCard background (`from-X to-Y`) */
  gradient: string;
  /** Plain hex fallback for charts / non-CSS contexts */
  hex: string;
  /** Tonal hex */
  tonalHex: string;
}

/**
 * L'encre à poser SUR le dégradé : `light` = blanc, `dark` = ardoise 900.
 * Ce n'est pas un goût, c'est le résultat d'une mesure — cf. {@link onGradientInk}.
 */
export type OnGradientInk = 'light' | 'dark';

export interface SubjectColor extends SubjectPalette {
  /** Stable code so the canonical name is known after normalization */
  code: SubjectCode;
  /**
   * L'encre lisible sur `gradient`, **mesurée** (WCAG 2.x) sur le stop le plus
   * défavorable des deux, jamais saisie à la main.
   */
  onGradient: OnGradientInk;
  /**
   * Le ratio de contraste qu'obtient `onGradient` sur le stop LE PLUS
   * DÉFAVORABLE du dégradé.
   *
   * C'est une **mesure**, pas une promesse : elle peut être inférieure à 4,5:1,
   * et dans ce cas la carte reste non conforme au SC 1.4.3 *quelle que soit*
   * l'encre — aucune des deux ne passe, seul le dégradé lui-même pourrait être
   * corrigé (et il porte l'identité couleur d'une matière à travers les quatre
   * portails, donc ce n'est pas une décision de composant). Exposé pour qu'un
   * contrôle puisse l'affirmer et pour que le résidu soit DÉRIVÉ de l'arbre au
   * lieu d'être une liste tenue à la main.
   */
  onGradientContrast: number;
}

export type SubjectCode =
  | 'MATH'
  | 'HIST_GEO'
  | 'HIST'
  | 'GEO'
  | 'PHYS_CHIM'
  | 'SVT'
  | 'FR'
  | 'ENG'
  | 'ESP'
  | 'ALL'
  | 'EPS'
  | 'ART'
  | 'MUS'
  | 'TECH'
  | 'PHILO'
  | 'DEFAULT';

const MAP: Record<SubjectCode, SubjectPalette> = {
  MATH:      { primary: 'oklch(0.55 0.20 280)', tonal: 'oklch(0.95 0.05 280)', gradient: 'from-indigo-500 to-violet-500', hex: '#6366F1', tonalHex: '#EEF2FF' },
  HIST_GEO:  { primary: 'oklch(0.62 0.15 240)', tonal: 'oklch(0.95 0.05 240)', gradient: 'from-blue-500 to-cyan-500',    hex: '#3B82F6', tonalHex: '#EFF6FF' },
  HIST:      { primary: 'oklch(0.58 0.17 230)', tonal: 'oklch(0.95 0.05 230)', gradient: 'from-blue-600 to-sky-500',     hex: '#2563EB', tonalHex: '#EFF6FF' },
  GEO:       { primary: 'oklch(0.70 0.16 60)',  tonal: 'oklch(0.95 0.07 60)',  gradient: 'from-amber-500 to-yellow-500', hex: '#F59E0B', tonalHex: '#FEF3C7' },
  PHYS_CHIM: { primary: 'oklch(0.65 0.14 175)', tonal: 'oklch(0.95 0.05 175)', gradient: 'from-teal-500 to-emerald-500', hex: '#14B8A6', tonalHex: '#CCFBF1' },
  SVT:       { primary: 'oklch(0.63 0.16 145)', tonal: 'oklch(0.95 0.06 145)', gradient: 'from-green-500 to-emerald-500', hex: '#22C55E', tonalHex: '#DCFCE7' },
  FR:        { primary: 'oklch(0.70 0.18 45)',  tonal: 'oklch(0.95 0.07 45)',  gradient: 'from-orange-500 to-amber-500', hex: '#FB923C', tonalHex: '#FFEDD5' },
  ENG:       { primary: 'oklch(0.65 0.20 0)',   tonal: 'oklch(0.95 0.06 0)',   gradient: 'from-rose-500 to-red-500',     hex: '#F43F5E', tonalHex: '#FFE4E6' },
  ESP:       { primary: 'oklch(0.78 0.15 90)',  tonal: 'oklch(0.96 0.07 90)',  gradient: 'from-yellow-400 to-amber-400', hex: '#FACC15', tonalHex: '#FEF9C3' },
  ALL:       { primary: 'oklch(0.55 0.10 60)',  tonal: 'oklch(0.94 0.05 60)',  gradient: 'from-yellow-700 to-amber-700', hex: '#A16207', tonalHex: '#FEF3C7' },
  EPS:       { primary: 'oklch(0.72 0.18 130)', tonal: 'oklch(0.96 0.06 130)', gradient: 'from-lime-500 to-green-500',   hex: '#84CC16', tonalHex: '#ECFCCB' },
  ART:       { primary: 'oklch(0.65 0.22 330)', tonal: 'oklch(0.95 0.07 330)', gradient: 'from-pink-500 to-fuchsia-500', hex: '#EC4899', tonalHex: '#FCE7F3' },
  MUS:       { primary: 'oklch(0.60 0.20 300)', tonal: 'oklch(0.95 0.06 300)', gradient: 'from-purple-500 to-fuchsia-500', hex: '#A855F7', tonalHex: '#F3E8FF' },
  TECH:      { primary: 'oklch(0.55 0.05 250)', tonal: 'oklch(0.95 0.02 250)', gradient: 'from-slate-500 to-slate-600',  hex: '#64748B', tonalHex: '#F1F5F9' },
  PHILO:     { primary: 'oklch(0.45 0.08 50)',  tonal: 'oklch(0.93 0.04 50)',  gradient: 'from-amber-800 to-orange-900', hex: '#78350F', tonalHex: '#FEF3C7' },
  DEFAULT:   { primary: 'oklch(0.60 0.10 250)', tonal: 'oklch(0.95 0.02 250)', gradient: 'from-slate-400 to-slate-500',  hex: '#64748B', tonalHex: '#F1F5F9' },
};

const ALIASES: Record<string, SubjectCode> = {
  // Mathématiques
  MATH: 'MATH', MATHS: 'MATH', MATHEMATIQUES: 'MATH', MATHEMATIQUE: 'MATH', MATHÉMATIQUES: 'MATH',
  // Histoire + Géographie
  HG: 'HIST_GEO', 'HIST-GEO': 'HIST_GEO', 'HIST_GEO': 'HIST_GEO', 'HISTOIRE-GEOGRAPHIE': 'HIST_GEO', 'HISTOIRE-GÉOGRAPHIE': 'HIST_GEO',
  HISTGEO: 'HIST_GEO',
  // Histoire seule
  HIST: 'HIST', HISTOIRE: 'HIST',
  // Géo seule
  GEO: 'GEO', GEOGRAPHIE: 'GEO', GÉOGRAPHIE: 'GEO',
  // Physique-Chimie
  PC: 'PHYS_CHIM', PHYSCHIM: 'PHYS_CHIM', 'PHYS-CHIM': 'PHYS_CHIM', PHYS_CHIM: 'PHYS_CHIM',
  PHYSIQUE: 'PHYS_CHIM', CHIMIE: 'PHYS_CHIM', 'PHYSIQUE-CHIMIE': 'PHYS_CHIM',
  // Sciences de la Vie et de la Terre
  SVT: 'SVT', BIOLOGIE: 'SVT', 'SCIENCES-VIE': 'SVT',
  // Français
  FR: 'FR', FRANCAIS: 'FR', FRANÇAIS: 'FR', LITTERATURE: 'FR', LITTÉRATURE: 'FR',
  // Anglais
  ENG: 'ENG', EN: 'ENG', ANGLAIS: 'ENG',
  // Espagnol
  ESP: 'ESP', SPANISH: 'ESP', ESPAGNOL: 'ESP',
  // Allemand
  ALL: 'ALL', DE: 'ALL', ALLEMAND: 'ALL', GERMAN: 'ALL',
  // EPS
  EPS: 'EPS', SPORT: 'EPS', 'EDUCATION-PHYSIQUE': 'EPS',
  // Arts
  ART: 'ART', ARTS: 'ART', 'ARTS-PLASTIQUES': 'ART', AP: 'ART',
  // Musique
  MUS: 'MUS', MUSIQUE: 'MUS', MUSIC: 'MUS',
  // Technologie
  TECH: 'TECH', TECHNOLOGIE: 'TECH', INFORMATIQUE: 'TECH',
  // Philosophie
  PHILO: 'PHILO', PHILOSOPHIE: 'PHILO',
};

function normalizeCode(input: string | undefined | null): SubjectCode {
  if (!input) return 'DEFAULT';
  const upper = input
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents for lookup but keep them as alias keys too
    .trim()
    .replace(/[\s_]+/g, '_');
  if (ALIASES[upper]) return ALIASES[upper];
  const compact = upper.replace(/[^A-Z]/g, '');
  if (ALIASES[compact]) return ALIASES[compact];
  if (upper in MAP) return upper as SubjectCode;
  return 'DEFAULT';
}

/* ─────────────── Encre sur dégradé : une DÉRIVATION, pas une liste ───────────────
 *
 * Une carte matière (`SubjectKpiCard`) écrit son texte PAR-DESSUS `gradient`.
 * Écrire ce texte en blanc partout est un choix par défaut, pas une mesure : sur
 * les dégradés clairs (jaune, citron vert, ambre) le blanc tombe autour de
 * 1,5:1 — très en dessous du 4,5:1 exigé par le SC 1.4.3, et le chiffre que la
 * carte affiche (« 3 classes · 46 élèves ») devient illisible.
 *
 * On ne corrige pas ça avec une liste « matières à encre foncée » écrite à la
 * main : elle dériverait au premier ajout de matière. On MESURE. Les deux stops
 * du dégradé sont lus dans la chaîne `gradient` elle-même (source unique), leur
 * luminance relative WCAG est calculée, et l'encre retenue est celle dont le
 * ratio sur le stop LE PLUS DÉFAVORABLE est le meilleur.
 */

/**
 * Hex des stops Tailwind employés par les dégradés de `MAP`.
 *
 * Ce sont des faits de palette (Tailwind), pas des jugements. Un stop absent de
 * cette table n'est pas une erreur bloquante : la dérivation retombe alors sur
 * `hex`, la teinte primaire de la matière, qui est toujours définie.
 */
const TAILWIND_STOP_HEX: Record<string, string> = {
  'blue-500': '#3B82F6',
  'blue-600': '#2563EB',
  'sky-500': '#0EA5E9',
  'cyan-500': '#06B6D4',
  'indigo-500': '#6366F1',
  'violet-500': '#8B5CF6',
  'purple-500': '#A855F7',
  'fuchsia-500': '#D946EF',
  'pink-500': '#EC4899',
  'rose-500': '#F43F5E',
  'red-500': '#EF4444',
  'orange-500': '#F97316',
  'orange-900': '#7C2D12',
  'amber-400': '#FBBF24',
  'amber-500': '#F59E0B',
  'amber-700': '#B45309',
  'amber-800': '#92400E',
  'yellow-400': '#FACC15',
  'yellow-500': '#EAB308',
  'yellow-700': '#A16207',
  'lime-500': '#84CC16',
  'green-500': '#22C55E',
  'emerald-500': '#10B981',
  'teal-500': '#14B8A6',
  'slate-400': '#94A3B8',
  'slate-500': '#64748B',
  'slate-600': '#475569',
};

/** Les deux encres candidates, et rien d'autre. */
const INK_HEX: Record<OnGradientInk, string> = {
  light: '#FFFFFF',
  dark: '#0F172A', // slate-900
};

/** Seuil AA pour du texte de taille normale (SC 1.4.3). */
export const WCAG_AA_NORMAL_TEXT = 4.5;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminance relative WCAG 2.x d'une couleur `#RRGGBB`. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** Ratio de contraste WCAG 2.x entre deux couleurs `#RRGGBB`. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Les hex effectivement peints par une chaîne `from-X to-Y`. */
function gradientStopHexes(gradient: string, fallbackHex: string): string[] {
  const stops = gradient
    .split(/\s+/)
    .filter((token) => /^(from|to|via)-/.test(token))
    .map((token) => TAILWIND_STOP_HEX[token.replace(/^(from|to|via)-/, '')])
    .filter((hex): hex is string => hex !== undefined);
  return stops.length > 0 ? stops : [fallbackHex];
}

/**
 * Choisit l'encre à poser sur un dégradé, et renvoie le ratio obtenu sur le
 * stop le plus défavorable.
 *
 * Règle unique, sans exception : on garde l'encre dont le PIRE stop est le
 * meilleur. Si les deux encres échouent, on renvoie quand même la meilleure —
 * un texte plus lisible reste plus lisible — et `contrast` dit la vérité, à
 * savoir que la carte n'atteint pas AA. Le composant n'a alors aucun moyen de
 * la sauver : c'est le dégradé qu'il faudrait corriger, et il porte l'identité
 * couleur de la matière sur les quatre portails.
 */
export function onGradientInk(
  gradient: string,
  fallbackHex: string,
): { ink: OnGradientInk; contrast: number } {
  const stops = gradientStopHexes(gradient, fallbackHex);
  const worst = (ink: OnGradientInk) =>
    Math.min(...stops.map((stop) => contrastRatio(INK_HEX[ink], stop)));
  const light = worst('light');
  const dark = worst('dark');
  return dark > light ? { ink: 'dark', contrast: dark } : { ink: 'light', contrast: light };
}

/**
 * Resolves a subject color from a free-form code or name.
 * Accepts canonical codes (MATH), French names (Mathématiques), or aliases (Maths).
 */
export function subjectColor(codeOrName: string | undefined | null): SubjectColor {
  const code = normalizeCode(codeOrName);
  const palette = MAP[code];
  const { ink, contrast } = onGradientInk(palette.gradient, palette.hex);
  return { code, ...palette, onGradient: ink, onGradientContrast: contrast };
}

/** All canonical subject codes (useful for tests/legends). */
export const SUBJECT_CODES: SubjectCode[] = Object.keys(MAP).filter(
  (k): k is SubjectCode => k !== 'DEFAULT',
);
