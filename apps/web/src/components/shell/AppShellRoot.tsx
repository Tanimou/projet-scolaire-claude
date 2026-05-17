import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { fetchBranding, fetchMe, type BrandingResponse, type MeResponse } from '@/lib/me';
import {
  AppShell,
  HelpSidebarCard,
  Sidebar,
  TipOfTheDayCard,
  Topbar,
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
};

const PORTAL_DEFAULT_SUBTITLE: Record<PortalKey, string> = {
  admin: "Vue d'ensemble de l'établissement",
  teacher: 'Bienvenue dans votre espace pédagogique',
  parent: "Vue d'ensemble des performances et activités",
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
        portal === 'parent' ? (
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
          <TopbarBell portal={portal} />
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

  return (
    <>
      <BrandingStyle branding={branding} />
      <AppShell portal={portal} sidebar={sidebar} topbar={topbar} contentClassName={contentClassName}>
        {children}
      </AppShell>
    </>
  );
}

/**
 * Inline <style> that injects the school's branding palette as CSS variables.
 * Server-rendered so first paint has the correct colors.
 */
function BrandingStyle({ branding }: { branding: BrandingResponse | null }) {
  if (!branding) return null;
  const css = `:root{${branding.primaryColor ? `--brand-primary:${branding.primaryColor};` : ''}${branding.accentColor ? `--brand-accent:${branding.accentColor};` : ''}${branding.fontFamily ? `--brand-font:${branding.fontFamily};` : ''}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
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
