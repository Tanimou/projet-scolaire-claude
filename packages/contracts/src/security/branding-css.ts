/**
 * Assainissement des valeurs de branding avant leur injection dans un bloc
 * `<style>` rendu côté serveur (S-E06-2 / PF-45, preuve G-AUTHZ).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE SEULE COPIE, DANS `@pilotage/contracts`
 * ---------------------------------------------------------------------------
 * La même règle doit tenir à **deux** endroits qui ne se voient pas :
 *
 *  • **à l'écriture**, dans `apps/api` (`UpdateBrandingDto`), pour qu'une valeur
 *    hostile n'entre jamais en base ;
 *  • **au rendu**, dans `apps/web` (`AppShellRoot#BrandingStyle`), parce que la
 *    validation d'écriture ne dit **rien** des lignes déjà écrites — le seed
 *    (`apps/api/prisma/seed-*.ts`) écrit `branding` directement via Prisma, sans
 *    jamais traverser le DTO, et la base locale comme la base hébergée portent
 *    déjà des valeurs posées avant l'existence de ce fichier.
 *
 * Les deux moitiés sont donc **indépendamment nécessaires**, et c'est exactement
 * la raison pour laquelle il ne peut pas y en avoir deux copies : il suffit
 * qu'une seule oublie `</style>` pour que la surface se rouvre. Même discipline
 * que `packages/contracts/src/observability/tracing-policy.ts` (S-E02-14).
 *
 * ---------------------------------------------------------------------------
 * SÛR PAR CONSTRUCTION, PAS PAR ÉNUMÉRATION
 * ---------------------------------------------------------------------------
 * Aucune fonction ici ne cherche les motifs dangereux pour les retirer — c'est
 * la forme « on a pensé à tous les cas », et il suffit d'un encodage oublié
 * (`\3c script`, `&lt;`, un point de code homoglyphe) pour la contourner. Elles
 * **reconnaissent une grammaire close** et rejettent tout le reste : une valeur
 * qui n'est pas une couleur CSS reconnaissable ne devient pas « une couleur
 * nettoyée », elle devient `null` et la variable n'est pas émise du tout. Le
 * portail retombe alors sur sa couleur par défaut, ce qui est une dégradation
 * cosmétique et jamais une panne.
 */

/** Longueurs maximales acceptées, alignées sur `UpdateBrandingDto`. */
export const BRANDING_MAX_LENGTHS = {
  displayName: 120,
  color: 60,
  fontFamily: 120,
  url: 500,
} as const;

/**
 * Fonctions de couleur CSS admises. Volontairement une liste close : `var()` et
 * `url()` en sont absents, et la grammaire d'arguments ci-dessous interdit toute
 * parenthèse imbriquée, donc ils sont hors d'atteinte même par composition.
 */
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
]);

/**
 * Arguments admis à l'intérieur d'une fonction de couleur.
 *
 * Ce jeu de caractères est le cœur de la garantie : il ne contient ni `(` ni
 * `)`, donc aucune fonction ne peut être imbriquée (`url(...)`, `expression(...)`,
 * `var(--x, ...)`), ni `;` `:` `{` `}` donc aucune déclaration ne peut être
 * ajoutée, ni `<` `>` `"` `'` `\` `/*` donc ni sortie de l'élément `<style>` ni
 * commentaire. Les lettres sont admises pour les unités (`deg`, `turn`, `none`).
 * `/` est admis parce que la syntaxe moderne l'utilise pour l'alpha
 * (`oklch(0.62 0.18 250 / 50%)`) — il est inoffensif seul, `/*` exigeant `*`.
 */
const COLOR_ARGUMENT_GRAMMAR = /^[0-9a-zA-Z.%,\s/+-]{0,50}$/;

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Mot-clé de couleur (`red`, `transparent`, `currentColor`, …).
 *
 * Délibérément une **forme** et non la liste des 148 couleurs nommées CSS : une
 * suite de lettres ne peut ni fermer une déclaration, ni sortir de l'élément,
 * donc elle est sûre qu'elle nomme une vraie couleur ou non — un mot-clé inconnu
 * rend la déclaration invalide et le navigateur l'ignore. Énumérer aurait été
 * plus « précis » et aurait dérivé au premier ajout du standard.
 */
const COLOR_KEYWORD = /^[a-zA-Z]{3,20}$/;

/**
 * Un nom de police : lettres, chiffres, espaces et tirets. Ni guillemet, ni
 * virgule (le découpage est fait avant), ni aucun caractère de contrôle CSS.
 */
const FONT_NAME = /^[a-zA-Z0-9 -]{1,40}$/;

/**
 * Vrai si la chaîne contient un caractère de contrôle (C0, DEL, ou C1).
 *
 * Écrit comme une boucle sur les points de code et non comme une classe de
 * caractères d'expression régulière : `no-control-regex` refuse la seconde forme,
 * et la désactiver localement aurait affaibli une règle pour du confort
 * d'écriture — exactement ce que S-E02-7 a refusé de faire. La boucle est aussi
 * plus honnête : elle dit *quels* points de code sont refusés, sans dépendre de
 * la façon dont l'analyseur d'expressions régulières interprète `U+0000`.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Normalise une valeur d'entrée en chaîne exploitable, ou `null`.
 * `null`, `undefined`, non-chaînes et chaînes vides donnent toutes `null` — un
 * appelant ne doit jamais avoir à distinguer ces cas avant d'appeler.
 */
function asTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Renvoie la couleur CSS si elle appartient à la grammaire admise, sinon `null`.
 */
export function sanitizeCssColor(value: unknown): string | null {
  const raw = asTrimmedString(value, BRANDING_MAX_LENGTHS.color);
  if (raw === null) return null;

  if (HEX_COLOR.test(raw)) return raw;
  if (COLOR_KEYWORD.test(raw)) return raw;

  const call = /^([a-zA-Z]{2,6})\((.*)\)$/s.exec(raw);
  if (!call) return null;
  const name = call[1]!.toLowerCase();
  const args = call[2]!;
  if (!COLOR_FUNCTIONS.has(name)) return null;
  if (!COLOR_ARGUMENT_GRAMMAR.test(args)) return null;
  return `${name}(${args})`;
}

/**
 * Renvoie une liste `font-family` ré-sérialisée à partir des seuls noms admis,
 * ou `null` si aucun nom n'a survécu.
 *
 * La sortie est **reconstruite**, jamais recopiée : les noms contenant une
 * espace sont re-guillemetés par ce code, donc la forme émise ne dépend pas de
 * la forme reçue. Un guillemet dans l'entrée n'est pas échappé — le nom entier
 * est rejeté, parce qu'échapper suppose de connaître le contexte d'échappement
 * et c'est précisément l'hypothèse qui casse.
 */
export function sanitizeFontFamily(value: unknown): string | null {
  const raw = asTrimmedString(value, BRANDING_MAX_LENGTHS.fontFamily);
  if (raw === null) return null;

  const names: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim().replace(/^["']|["']$/g, '').trim();
    if (!FONT_NAME.test(name)) return null;
    names.push(name.includes(' ') ? `"${name}"` : name);
  }
  if (names.length === 0) return null;
  return names.join(', ');
}

/**
 * Renvoie une URL d'actif (logo, favicon) si elle est `http:`/`https:` absolue
 * ou relative à la racine, sinon `null`.
 *
 * `javascript:`, `data:` et `vbscript:` sont rejetés : `data:` n'exécute rien
 * dans un `<link rel="icon">`, mais `logoUrl` finit aussi dans un `<img src>` et
 * une image inline arbitraire est un vecteur d'hameçonnage sur une page
 * authentifiée. Les URL protocole-relatives (`//hôte/x`) sont rejetées parce
 * qu'elles nomment un hôte sans le dire.
 */
export function sanitizeAssetUrl(value: unknown): string | null {
  const raw = asTrimmedString(value, BRANDING_MAX_LENGTHS.url);
  if (raw === null) return null;
  // Un caractère de contrôle ou une espace interne rend l'URL ambiguë selon
  // l'analyseur — refuser plutôt que deviner.
  if (/[\s<>"'\\]/.test(raw) || hasControlCharacter(raw)) return null;

  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/')) return raw;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

/** Nom d'affichage : rendu par React comme texte, donc échappé par React. */
export function sanitizeDisplayName(value: unknown): string | null {
  return asTrimmedString(value, BRANDING_MAX_LENGTHS.displayName);
}

/** Forme des champs de branding qui traversent l'assainissement. */
export interface BrandingAppearance {
  primaryColor?: unknown;
  accentColor?: unknown;
  fontFamily?: unknown;
  logoUrl?: unknown;
  faviconUrl?: unknown;
}

/** Résultat d'un assainissement : chaque champ est sûr, ou absent. */
export interface SanitizedBrandingAppearance {
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
}

/** Applique la grammaire à tous les champs d'apparence en une passe. */
export function sanitizeBrandingAppearance(
  branding: BrandingAppearance | null | undefined,
): SanitizedBrandingAppearance {
  return {
    primaryColor: sanitizeCssColor(branding?.primaryColor),
    accentColor: sanitizeCssColor(branding?.accentColor),
    fontFamily: sanitizeFontFamily(branding?.fontFamily),
    logoUrl: sanitizeAssetUrl(branding?.logoUrl),
    faviconUrl: sanitizeAssetUrl(branding?.faviconUrl),
  };
}

/**
 * Motifs qui ne doivent JAMAIS apparaître dans le texte d'un élément `<style>`.
 *
 * `<` suffit à ouvrir une balise, et l'analyseur HTML ferme un `<style>` sur la
 * seule séquence `</style` — mais on refuse `<` et `>` tout court plutôt que la
 * séquence exacte, parce que la version « exacte » invite à la contourner par
 * la casse ou par un caractère intercalaire. `\` interdit les échappements CSS
 * (`\3c`), et `\u0000` neutralise le remplacement par U+FFFD que fait
 * l'analyseur HTML.
 */
const STYLE_TEXT_FORBIDDEN = /[<>\\]/;

/**
 * Garde-fou terminal : lève si un texte destiné à un `<style>` peut en sortir.
 *
 * Redondant avec les fonctions ci-dessus **par conception**. Elles décident ce
 * qui est admis ; celle-ci vérifie la seule propriété dont dépend la sécurité du
 * rendu, sans rien savoir de la grammaire. Si une grammaire est un jour élargie
 * à tort, ce test échoue quand même.
 */
export function assertStyleTextIsInert(css: string): string {
  if (STYLE_TEXT_FORBIDDEN.test(css) || hasControlCharacter(css)) {
    throw new Error('branding CSS contains characters that can terminate a <style> element');
  }
  return css;
}

/**
 * Construit le bloc `:root{…}` injecté au premier rendu, à partir des seules
 * valeurs assainies. Une valeur rejetée n'est pas émise : la variable CSS reste
 * absente et la feuille de style principale fournit sa valeur par défaut.
 */
export function buildBrandingCss(branding: BrandingAppearance | null | undefined): string {
  const safe = sanitizeBrandingAppearance(branding);
  const declarations = [
    safe.primaryColor ? `--brand-primary:${safe.primaryColor};` : '',
    safe.accentColor ? `--brand-accent:${safe.accentColor};` : '',
    safe.fontFamily ? `--brand-font:${safe.fontFamily};` : '',
  ].join('');
  return assertStyleTextIsInert(`:root{${declarations}}`);
}
