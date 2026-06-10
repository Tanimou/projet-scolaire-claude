import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { fetchBranding, fetchMe, type BrandingResponse, type MeResponse } from '@/lib/me';
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

import { MobileSidebarToggle } from './MobileSidebarToggle';
import { PortalBrand } from './PortalBrand';
import {
  adminSidebar,
  resolveActive,
  sidebarItemsFor,
  type PortalKey,
  type SidebarItemConfig,
} from './sidebar-items';
import { TopbarBell } from './TopbarBell';
import { TopbarUserMenu } from './TopbarUserMenu';

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
          <HelpSidebarCard />
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
      <BrandingStyle branding={branding} />
      <BootstrapDisplayPrefsStyle prefs={display} />
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
function BootstrapDisplayPrefsStyle({ prefs }: { prefs: DisplayPreferences }) {
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
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <script
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
 */
function BrandingStyle({ branding }: { branding: BrandingResponse | null }) {
  if (!branding) return null;
  const css = `:root{${branding.primaryColor ? `--brand-primary:${branding.primaryColor};` : ''}${branding.accentColor ? `--brand-accent:${branding.accentColor};` : ''}${branding.fontFamily ? `--brand-font:${branding.fontFamily};` : ''}}`;
  return (
    <>
      {/* React 19 hoists this <link> into <head>; an explicit rel="icon" wins
          over the default /favicon.ico, so the school's favicon shows in the tab
          across every authenticated portal page. */}
      {branding.faviconUrl ? (
        <link rel="icon" href={branding.faviconUrl} />
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: css }} />
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
