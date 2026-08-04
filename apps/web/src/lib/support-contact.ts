/**
 * Support contact — the single source of the product support address rendered by
 * `apps/web` (S-E06-1 / PF-17, PF-54).
 *
 * Why a module and not a literal at each call site: before this slice the address
 * was hard-coded on `/admin/register` while the neighbouring cards pointed users at
 * a development mail catcher. Four independent copies is how that drift happened;
 * one exported constant is how it stops.
 *
 * Build-time, deliberately. `NEXT_PUBLIC_*` is inlined by Next at build time, and
 * both register pages are prerendered — a server-only read would freeze at build
 * anyway. The fallback is therefore the REAL production address, not a placeholder:
 * if the variable is never supplied as a build arg the rendered page is
 * byte-identical to what shipped before, never blank and never a promise the
 * deployment cannot keep.
 *
 * Deviation from the story's literal `?? ` form, on purpose: `??` only catches
 * `undefined`, so a variable declared-but-empty (`NEXT_PUBLIC_SUPPORT_EMAIL=`)
 * would render an empty `mailto:`. Blank is the one output this slice exists to
 * remove, so an empty/whitespace value is treated as absent.
 */

/** Production support address — also the fallback, so the copy is never untrue. */
export const DEFAULT_SUPPORT_EMAIL = 'support@pilotage-scolaire.app';

const configured = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export const SUPPORT_EMAIL =
  typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_SUPPORT_EMAIL;
