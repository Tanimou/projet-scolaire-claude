import { buildBrandingCss, sanitizeAssetUrl, CSP_NONCE_HEADER } from '@pilotage/contracts';
import {
  AppShell,
  DISPLAY_PREFS_DEFAULTS,
  DisplayPrefsProvider,
  HelpSidebarCard,
  Sidebar,
  TipOfTheDayCard,
  Topbar,
  TopbarTodayChip,
  type DisplayPreferences,
  type SidebarGroup,
  type SidebarItemDef,
} from '@pilotage/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';


import { MobileSidebarToggle } from './MobileSidebarToggle';
import { PortalBrand } from './PortalBrand';
import { TopbarBell } from './TopbarBell';
import { TopbarUserMenu } from './TopbarUserMenu';
import {
  adminSidebar,
  resolveActive,
  sidebarItemsFor,
  type PortalKey,
  type SidebarItemConfig,
} from './sidebar-items';

import { auth } from '@/auth';
import { fetchBranding, fetchMe, type BrandingResponse, type MeResponse } from '@/lib/me';

export interface AppShellRootProps {
  portal: PortalKey;
  /** Topbar title — defaults to the page metadata title via children */
  title?: string;
  /** Topbar subtitle */
  subtitle?: string;
  /** Override sidebar items if a page needs to inject extras */
  itemsOverride?: SidebarItemConfig[];
  /** Optional extra topbar action slot rendered before bell+user */
  topbarExtras?: ReactNode;
  /** Padding tweak on the main area */
  contentClassName?: string;
  children: ReactNode;
}

const PORTAL_DEFAULT_TITLE: Record<PortalKey, string> = {
  admin: 'Tableau de bord',
  teacher: 'Tableau de bord',
  parent: 'Tableau de bord',
  student: 'Mes notes',
};

const PORTAL_DEFAULT_SUBTITLE: Record<PortalKey, string> = {
  admin: "Vue d'ensemble de l'établissement",
  teacher: 'Bienvenue dans votre espace pédagogique',
  parent: "Vue d'ensemble des performances et activités",
  student: 'Ton espace élève',
};

/**
 * AppShellRoot — server component that:
 *  - Validates session (redirects to login on expiry)
 *  - Fetches /me + /branding in parallel
 *  - Builds sidebar items + topbar with NotificationBell + UserMenu
 *  - Renders the AppShell with a footer card (TipOfTheDay for teacher/admin, Help for parent)
 *
 * Used by the rewritten PortalShell — pages don't need to change their imports.
 */
export async function AppShellRoot({
  portal,
  title,
  subtitle,
  itemsOverride,
  topbarExtras,
  contentClassName,
  children,
}: AppShellRootProps) {
  const session = await auth();
  if (!session?.user) redirect(`/${portal}/login`);
  if (session?.error) redirect(`/${portal}/login?error=session_expired`);

  const [me, branding] = await Promise.all([fetchMe(), fetchBranding()]);
  if (!me) redirect(`/${portal}/login?error=session_expired`);

  // Detect active sidebar entry from the requested pathname
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? hdrs.get('x-next-pathname') ?? '/';
  // Nonce CSP de CETTE réponse, posé par `middleware.ts` (S-E06-2 / PF-45).
  // Absent seulement si le middleware n'a pas tourné pour ce chemin — dans ce
  // cas les blocs en ligne partent sans nonce et la politique les bloque, ce qui
  // est la dégradation voulue : jamais de repli silencieux vers `unsafe-inline`.
  const cspNonce = hdrs.get(CSP_NONCE_HEADER) ?? undefined;

  // Admin gets the grouped sidebar (per spec §5); teacher/parent stay flat for now.
  let sidebarGroups: SidebarGroup[] | undefined;
  let sidebarItems: SidebarItemDef[] | undefined;
  if (itemsOverride) {
    sidebarItems = resolveActive(itemsOverride, pathname);
  } else if (portal === 'admin') {
    sidebarGroups = adminSidebar(pathname);
  } else {
    sidebarItems = resolveActive(sidebarItemsFor(portal), pathname);
  }

  const sidebar = (
    <Sidebar
      portal={portal}
      brand={<PortalBrand branding={branding} portal={portal} />}
      groups={sidebarGroups}
      items={sidebarItems}
      footer={
        portal === 'parent' || portal === 'student' ? (
          // `ctaHref` is passed explicitly even though it is also the component's
          // default. The link gate's source set is `apps/web/src` only
          // (`scripts/link-integrity-check.js`), so an href written in
          // `packages/ui` is invisible to it — and this card's CTA pointed at
          // `/help` while `/help` did not exist, on every parent and student page,
          // unseen (S-E06-5). Stating the target here puts it inside the scanned
          // tree until the gate's root is widened.
          <HelpSidebarCard ctaHref="/help" />
        ) : (
          <TipOfTheDayCard
            body="Planifiez vos évaluations à l'avance pour un meilleur suivi des apprentissages."
            seen={2}
            total={5}
          />
        )
      }
    />
  );

  const topbar = (
    <Topbar
      title={title ?? PORTAL_DEFAULT_TITLE[portal]}
      subtitle={subtitle ?? PORTAL_DEFAULT_SUBTITLE[portal]}
      burger={<MobileSidebarToggle sidebar={sidebar} />}
      actions={
        <>
          {topbarExtras}
          <TopbarTodayChip />
          {/* E8-S1: the student portal has no notification channel — omit the bell. */}
          {portal !== 'student' && <TopbarBell portal={portal} />}
          <TopbarUserMenu
            portal={portal}
            firstName={me.firstName || 'Utilisateur'}
            lastName={me.lastName || ''}
            email={me.email}
            avatarSrc={me.photoUrl}
          />
        </>
      }
    />
  );

  const display = resolveDisplayPrefs(me);

  return (
    <>
      <BrandingStyle branding={branding} nonce={cspNonce} />
      <BootstrapDisplayPrefsStyle prefs={display} nonce={cspNonce} />
      <DisplayPrefsProvider initial={display}>
        <AppShell portal={portal} sidebar={sidebar} topbar={topbar} contentClassName={contentClassName}>
          {children}
        </AppShell>
      </DisplayPrefsProvider>
    </>
  );
}

/**
 * Extract the user's display preferences from the `/me` payload.
 * `MeResponse.preferences.display` is normalised server-side (see
 * `me.controller.ts#normalizeDisplay`); we still fall back to defaults if the
 * field is missing (e.g. legacy users, or `/me` returned an older snapshot).
 */
function resolveDisplayPrefs(me: MeResponse | null): DisplayPreferences {
  const raw =
    me && me.preferences && typeof me.preferences === 'object'
      ? ((me.preferences as Record<string, unknown>).display as DisplayPreferences | undefined)
      : undefined;
  return {
    density: raw?.density ?? DISPLAY_PREFS_DEFAULTS.density,
    accent: raw?.accent ?? DISPLAY_PREFS_DEFAULTS.accent,
    dateFormat: raw?.dateFormat ?? DISPLAY_PREFS_DEFAULTS.dateFormat,
    gradeFormat: raw?.gradeFormat ?? DISPLAY_PREFS_DEFAULTS.gradeFormat,
  };
}

/**
 * Server-rendered <style> so the first paint already carries the user's accent
 * CSS variables and `data-density` selector matches (the client provider then
 * keeps them in sync across navigations).
 */
function BootstrapDisplayPrefsStyle({ prefs, nonce }: { prefs: DisplayPreferences; nonce?: string }) {
  const acc = ACCENT_PALETTE[prefs.accent];
  const css =
    `:root{` +
    `--display-accent-solid:${acc.solid};` +
    `--display-accent-soft:${acc.soft};` +
    `--display-accent-text:${acc.text};` +
    `--display-accent-ring:${acc.ring};` +
    `}` +
    `html{`+
    // `data-density` is set by the client provider; this is the SSR fallback.
    `}`;
  return (
    <>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} />
      <script
        nonce={nonce}
        // No-flash density init: write `data-density` and `data-accent` on <html>
        // synchronously, before React hydrates, so CSS selectors apply on first paint.
        dangerouslySetInnerHTML={{
          __html: `(function(){var r=document.documentElement;r.setAttribute('data-density',${JSON.stringify(
            prefs.density,
          )});r.setAttribute('data-accent',${JSON.stringify(prefs.accent)});})();`,
        }}
      />
    </>
  );
}

const ACCENT_PALETTE: Record<DisplayPreferences['accent'], { solid: string; soft: string; text: string; ring: string }> = {
  default: { solid: 'var(--brand-primary, #2563EB)', soft: '#EFF6FF', text: 'var(--brand-primary, #2563EB)', ring: 'var(--brand-primary, #2563EB)' },
  blue: { solid: '#2563EB', soft: '#EFF6FF', text: '#1D4ED8', ring: '#BFDBFE' },
  violet: { solid: '#7C3AED', soft: '#F5F3FF', text: '#6D28D9', ring: '#DDD6FE' },
  emerald: { solid: '#059669', soft: '#ECFDF5', text: '#047857', ring: '#A7F3D0' },
  rose: { solid: '#E11D48', soft: '#FFF1F2', text: '#BE123C', ring: '#FECDD3' },
  amber: { solid: '#D97706', soft: '#FFFBEB', text: '#B45309', ring: '#FDE68A' },
};

/**
 * Inline <style> that injects the school's branding palette as CSS variables.
 * Server-rendered so first paint has the correct colors.
 *
 * ---------------------------------------------------------------------------
 * S-E06-2 / PF-45 — POURQUOI L'ASSAINISSEMENT EST ICI *AUSSI*
 * ---------------------------------------------------------------------------
 * Ce bloc interpolait `branding.primaryColor` (etc.) directement dans un
 * `dangerouslySetInnerHTML`. React n'échappe rien dans ce contexte, et
 * l'analyseur HTML ferme un `<style>` sur la seule séquence `</style` : une
 * valeur de 37 caractères comme `red}</style><script>alert(1)</script>` tenait
 * dans le `@MaxLength(60)` du DTO, donc le sink n'était pas une injection CSS
 * mais un XSS stocké, servi sur **toutes** les pages authentifiées des **quatre**
 * portails du locataire.
 *
 * `UpdateBrandingDto` valide désormais à l'écriture, et cela ne suffit pas : la
 * base porte déjà des lignes écrites avant ce correctif, et les scripts de seed
 * écrivent `branding` via Prisma sans jamais traverser le DTO. Le rendu doit
 * donc être sûr **indépendamment** de ce qui est stocké — c'est ce que
 * `buildBrandingCss` garantit, et son garde-fou terminal lève si le CSS produit
 * contient malgré tout un caractère capable de terminer l'élément.
 */
function BrandingStyle({ branding, nonce }: { branding: BrandingResponse | null; nonce?: string }) {
  if (!branding) return null;
  const css = buildBrandingCss(branding);
  const faviconUrl = sanitizeAssetUrl(branding.faviconUrl);
  return (
    <>
      {/* React 19 hoists this <link> into <head>; an explicit rel="icon" wins
          over the default /favicon.ico, so the school's favicon shows in the tab
          across every authenticated portal page. */}
      {faviconUrl ? <link rel="icon" href={faviconUrl} /> : null}
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}

/**
 * Server-side helper for pages that need to know the current user without re-rendering the shell.
 */
export async function getCurrentUser(): Promise<{ me: MeResponse | null; branding: BrandingResponse | null }> {
  return {
    me: await fetchMe(),
    branding: await fetchBranding(),
  };
}
