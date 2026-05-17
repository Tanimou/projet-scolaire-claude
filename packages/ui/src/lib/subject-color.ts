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

export interface SubjectColor {
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
  /** Stable code so the canonical name is known after normalization */
  code: SubjectCode;
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

const MAP: Record<SubjectCode, Omit<SubjectColor, 'code'>> = {
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

/**
 * Resolves a subject color from a free-form code or name.
 * Accepts canonical codes (MATH), French names (Mathématiques), or aliases (Maths).
 */
export function subjectColor(codeOrName: string | undefined | null): SubjectColor {
  const code = normalizeCode(codeOrName);
  return { code, ...MAP[code] };
}

/** All canonical subject codes (useful for tests/legends). */
export const SUBJECT_CODES: SubjectCode[] = Object.keys(MAP).filter(
  (k): k is SubjectCode => k !== 'DEFAULT',
);
