import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';

import { SUPPORT_EMAIL } from '@/lib/support-contact';

/**
 * PublicInfoPage — the shared chrome for the three public information pages
 * `/pricing`, `/contact` and `/help` (S-E06-5 / AC-3, PF-94, PF-39).
 *
 * Why a shared component and not three hand-built pages: the three surfaces are
 * the same page with different words, and the parts that must not drift are
 * exactly the parts a copy-paste loses — the sibling navigation between them, the
 * single contact channel, and the accessibility scaffolding (one `<h1>`, a skip
 * link, focus rings, ≥44 px targets).
 *
 * Deliberately NOT reusing the landing page's `HomeTopNav` / `Footer`: both are
 * built around same-page anchors (`#produit`, `#comment`, `#securite`). Rendered
 * on `/pricing` those three links scroll nowhere — three affordances that do
 * nothing, which is DNC-06 in miniature. The header here carries sibling
 * navigation only, so every href is a plain literal the link-integrity gate can
 * resolve.
 *
 * Also deliberately absent: any link to `/legal/*`. Those three pages do not
 * exist (PF-38) and are blocked on decision D-08 — the routine may never author
 * policy text (R-13) — so this chrome does not spread the dead links to three
 * more surfaces.
 *
 * No `'use client'`: everything below is static markup and CSS transitions. A
 * public page must not pull a client bundle for decoration.
 */

/** The three public pages, in the order the header and footer list them. */
const SIBLINGS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Tarifs', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
  { label: 'Aide', href: '/help' },
];

export type PublicAccent = 'blue' | 'sky' | 'violet';

interface AccentTokens {
  /** Gradient for the hero icon tile and the primary CTA. */
  tile: string;
  /** Eyebrow pill (border + surface + ink). */
  pill: string;
  /** Focus ring, at the /40 opacity the codebase uses (ActivationHint.tsx). */
  ring: string;
  /** Hover surface for list rows. */
  row: string;
}

const ACCENTS: Record<PublicAccent, AccentTokens> = {
  blue: {
    tile: 'from-indigo-500 via-blue-600 to-blue-700',
    pill: 'border-blue-200 bg-blue-50 text-blue-700',
    ring: 'focus-visible:ring-blue-500/40',
    row: 'hover:bg-blue-50/60',
  },
  sky: {
    tile: 'from-sky-500 to-blue-600',
    pill: 'border-sky-200 bg-sky-50 text-sky-700',
    ring: 'focus-visible:ring-sky-500/40',
    row: 'hover:bg-sky-50/60',
  },
  violet: {
    tile: 'from-violet-500 to-indigo-600',
    pill: 'border-violet-200 bg-violet-50 text-violet-700',
    ring: 'focus-visible:ring-violet-500/40',
    row: 'hover:bg-violet-50/60',
  },
};

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

export interface PublicInfoPageProps {
  accent: PublicAccent;
  /** Short label in the eyebrow pill. */
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  /** The page's single `<h1>`. */
  title: string;
  /** One-paragraph lede under the title. */
  lede: string;
  /** Optional primary affordance rendered in the hero (e.g. "Retour à mon espace"). */
  heroAction?: ReactNode;
  children: ReactNode;
}

export function PublicInfoPage({
  accent,
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  lede,
  heroAction,
  children,
}: PublicInfoPageProps) {
  const a = ACCENTS[accent];

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      {/* SC 2.4.1 — the header is sticky and the footer is long. */}
      <a
        href="#contenu"
        className={`sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:ring-2 focus:ring-blue-500 ${FOCUS}`}
      >
        Aller au contenu
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6 lg:px-10">
          <Link
            href="/"
            className={`flex shrink-0 items-center gap-2.5 rounded-lg py-1 text-slate-900 ${FOCUS} focus-visible:ring-blue-500/40`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-blue-600 to-blue-700 text-base font-bold text-white shadow-lg shadow-blue-500/30">
              P
            </span>
            <span className="text-base font-bold tracking-tight">
              Pilotage <span className="hidden font-normal text-slate-500 sm:inline">scolaire</span>
            </span>
          </Link>

          <nav aria-label="Pages d'information" className="flex items-center gap-1 sm:gap-2">
            {SIBLINGS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                // `py-3` + a 20 px line box clears the 44 px target the codebase
                // standardised on in E5-S3, at 390 px as well as on desktop.
                className={`rounded-lg px-2.5 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 sm:px-3 ${FOCUS} ${a.ring}`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-white">
        {/* Purely decorative, and never in the way of a pointer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-400/15 blur-[120px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-10 right-1/4 h-72 w-72 rounded-full bg-violet-400/15 blur-[120px]"
        />
        <div className="relative mx-auto max-w-5xl px-6 py-14 lg:px-10 lg:py-20">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm ${a.pill}`}
              >
                <EyebrowIcon className="h-3.5 w-3.5" strokeWidth={2} />
                {eyebrow}
              </span>
              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900 lg:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">{lede}</p>
            </div>
            {heroAction ? <div className="shrink-0">{heroAction}</div> : null}
          </div>
        </div>
      </section>

      <div id="contenu" className="mx-auto max-w-5xl scroll-mt-20 px-6 pb-20 lg:px-10 lg:pb-28">
        {children}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-12 lg:px-10">
          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <Link
                href="/"
                className={`inline-flex items-center gap-2.5 rounded-lg py-1 ${FOCUS} focus-visible:ring-blue-500/40`}
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-blue-600 to-blue-700 text-base font-bold text-white shadow-lg shadow-blue-500/30">
                  P
                </span>
                <span className="text-base font-bold text-slate-900">Pilotage scolaire</span>
              </Link>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
                Le suivi scolaire qui rapproche école et famille.
              </p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <PublicFooterCol title="Informations" links={SIBLINGS} />
              <PublicFooterCol
                title="Portails"
                links={[
                  { label: 'Famille', href: '/parent/login' },
                  { label: 'Professeur', href: '/teacher/login' },
                  { label: 'Administrateur', href: '/admin/login' },
                  { label: 'Élève', href: '/student/login' },
                ]}
              />
            </div>
          </div>
          <div className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
            © Pilotage scolaire
          </div>
        </div>
      </footer>
    </main>
  );
}

function PublicFooterCol({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-slate-900">{title}</div>
      <ul className="mt-4 space-y-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={`-mx-1 inline-block rounded px-1 py-3 text-sm text-slate-600 transition hover:text-slate-900 ${FOCUS} focus-visible:ring-blue-500/40`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================ */
/*                     Shared building blocks                    */
/* ============================================================ */

/** A section with a `<h2>` and an optional intro paragraph. */
export function PublicSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      {intro ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{intro}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The card shell used by every block on the three pages. */
export function PublicCard({
  accent,
  icon: Icon,
  title,
  children,
}: {
  accent: PublicAccent;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <span
        className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br shadow-lg ${a.tile}`}
      >
        <Icon className="h-5 w-5 text-white" strokeWidth={1.9} />
      </span>
      <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
  );
}

/** Primary in-page CTA. `href` is always a literal at the call site. */
export function PublicCta({
  accent,
  href,
  label,
}: {
  accent: PublicAccent;
  href: string;
  label: string;
}) {
  const a = ACCENTS[accent];
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl ${a.tile} ${FOCUS} ${a.ring}`}
    >
      {label}
      <ChevronRight
        className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * A "go back where you came from" CTA — the arrow points left, because the action
 * is a return and not a next step. Used by `/help`, which is reached from inside
 * the authenticated shell and would otherwise be a one-way door.
 */
export function PublicBackCta({
  accent,
  href,
  label,
}: {
  accent: PublicAccent;
  href: string;
  label: string;
}) {
  const a = ACCENTS[accent];
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl ${a.tile} ${FOCUS} ${a.ring}`}
    >
      <ArrowLeft
        className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}

/** Secondary in-page link. */
export function PublicLink({
  accent,
  href,
  label,
}: {
  accent: PublicAccent;
  href: string;
  label: string;
}) {
  const a = ACCENTS[accent];
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 ${FOCUS} ${a.ring}`}
    >
      {label}
      <ChevronRight
        className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * A navigable row: icon + label + one-line description + chevron.
 * `py-3` plus two lines of text clears the 44 px target the codebase standardised
 * on in E5-S3 (above the SC 2.5.8 AA floor of 24 px).
 */
export function PublicRow({
  accent,
  href,
  icon: Icon,
  label,
  description,
}: {
  accent: PublicAccent;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const a = ACCENTS[accent];
  return (
    <li>
      <Link
        href={href}
        className={`group -mx-3 flex items-start gap-3 rounded-xl px-3 py-3 transition ${a.row} ${FOCUS} ${a.ring}`}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>
        </span>
        <ChevronRight
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

/**
 * The support address, rendered as its own link text (SC 2.4.4) and wrapping at
 * 320 px — the `ActivationHint.tsx` `SupportLink` pattern, same constant.
 *
 * The address is NEVER a literal here: it is `SUPPORT_EMAIL` from
 * `@/lib/support-contact`, the single source S-E06-1 introduced.
 */
export function SupportEmailLink({ accent }: { accent: PublicAccent }) {
  const a = ACCENTS[accent];
  return (
    <a
      href={`mailto:${SUPPORT_EMAIL}`}
      className={`inline-block break-words rounded-sm py-1 font-semibold text-slate-900 underline ${FOCUS} ${a.ring}`}
    >
      {SUPPORT_EMAIL}
    </a>
  );
}

/**
 * The one contact block the three pages share.
 *
 * Every clause is checkable against the runtime, which is the whole point
 * (S-E06-1's `ActivationHint` standard):
 *  - grades, attendance and enrolments are written on teacher/admin-permissioned
 *    endpoints; the parent portal reads them and cannot correct them — hence
 *    "lui seul peut les corriger";
 *  - the address is the configured `SUPPORT_EMAIL`, not an invented one.
 *
 * Deliberately NOT claimed, because nothing in the codebase backs it: a response
 * time, opening hours, a phone number, a postal address, a chat channel, or a
 * ticket queue. There is also no form — no endpoint accepts one, and a submit
 * button that posts nowhere is exactly the DNC-06 defect this slice closes.
 */
export function SupportContactBlock({ accent }: { accent: PublicAccent }) {
  return (
    <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
      <h2 className="text-base font-bold text-slate-900">À qui s&apos;adresser</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
        Les notes, les absences et les inscriptions sont saisies par votre établissement : lui seul
        peut les corriger. Pour un problème technique sur l&apos;application, écrivez à{' '}
        <SupportEmailLink accent={accent} />.
      </p>
    </div>
  );
}
