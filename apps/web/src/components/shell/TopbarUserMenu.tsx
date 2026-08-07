'use client';

import { UserMenu, type UserMenuItem } from '@pilotage/ui';
import { LifeBuoy, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';


export interface TopbarUserMenuProps {
  portal: 'admin' | 'teacher' | 'parent' | 'student';
  firstName: string;
  lastName: string;
  email: string;
  avatarSrc?: string | null;
}

const PORTAL_ROLE: Record<TopbarUserMenuProps['portal'], string> = {
  admin: 'Administrateur',
  teacher: 'Enseignant',
  parent: 'Parent',
  student: 'Élève',
};

/**
 * Where "Paramètres" points, per portal — LITERAL hrefs, and a `Partial` record on
 * purpose (S-E06-5 / AC-4).
 *
 * Two things are expressed as DATA here that used to be a runtime branch over a
 * template literal:
 *  • `student` is ABSENT because `/student/settings` is not an emitted route
 *    (PF-57, owner L2). A portal with no settings surface simply has no entry, so
 *    the menu cannot link to a 404 — and a static link check sees that, which it
 *    could not when the href was `` `/${portal}/settings` `` guarded by an
 *    `isStudent` branch it has no way to evaluate;
 *  • the other three are written out, so each one is an href the link-integrity
 *    gate resolves against the real route inventory.
 *
 * Adding a fifth portal id widens `TopbarUserMenuProps['portal']`; this map stays
 * valid (it is `Partial`) and that portal simply gets no settings entry until
 * someone adds its row — the safe direction.
 */
const PORTAL_SETTINGS_HREF: Partial<Record<TopbarUserMenuProps['portal'], string>> = {
  admin: '/admin/settings',
  teacher: '/teacher/settings',
  parent: '/parent/settings',
};

/**
 * TopbarUserMenu — wires `@pilotage/ui` UserMenu with NextAuth signOut.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO « Mon profil » ENTRY (S-E06-5 / AC-4, PF-97)
 * ---------------------------------------------------------------------------
 * No portal emits a `/profile` ROUTE: `/admin/profile`, `/teacher/profile`,
 * `/parent/profile` and `/student/profile` are none of them in the emitted route
 * inventory. The entry rendered `` `/${portal}/profile` `` for admin, teacher and
 * parent, so « Mon profil » 404'd on every authenticated page of three portals —
 * and the link gate printed PASS throughout, because its extractor's character
 * class excluded the backtick and template-literal hrefs were invisible to it
 * (PF-97).
 *
 * The idiom applied is the one this file already stated for the student portal:
 * when a surface does not exist, do not render the entry.
 *
 * Measured while doing it, and worth stating precisely because the story assumed
 * otherwise: a profile SURFACE does exist for two of the four portals, as a
 * « Mon profil » tab inside settings — `ProfilePanel` at
 * `app/parent/settings/page.tsx` and `app/teacher/settings/page.tsx`. `/admin/settings`
 * has no such tab (it configures the establishment, not the person) and the student
 * portal has no settings route at all (PF-57). So the defect this removes was a
 * WRONG HREF, not a wholly missing capability — and the entry is not merely
 * re-pointed at `/{portal}/settings` because the tab is selected by client state
 * with no URL parameter, so `/parent/settings` opens on its Notifications tab. A
 * « Mon profil » entry landing on Notifications is the same DNC-06 defect at a new
 * address. Deep-linking a settings tab, and the two portals with no profile surface
 * at all, are recorded as a finding with an owning story.
 */
export function TopbarUserMenu({
  portal,
  firstName,
  lastName,
  email,
  avatarSrc,
}: TopbarUserMenuProps) {
  const settingsHref = PORTAL_SETTINGS_HREF[portal];
  const items: UserMenuItem[] = [
    ...(settingsHref
      ? [
          {
            id: 'settings',
            icon: <SettingsIcon className="h-4 w-4 text-slate-500" />,
            label: 'Paramètres',
            href: settingsHref,
          },
        ]
      : []),
    {
      id: 'help',
      icon: <LifeBuoy className="h-4 w-4 text-slate-500" />,
      label: "Centre d'aide",
      href: '/help',
      // No separator: `@pilotage/ui`'s UserMenu draws `separator` as a TOP border,
      // and the identity block above already ends with one. With « Mon profil »
      // gone, help can be the FIRST item (student portal) or the second (the other
      // three) — either way a rule here would double the one above it. The single
      // rule the menu needs sits above the danger item below.
    },
    {
      id: 'logout',
      icon: <LogOut className="h-4 w-4" />,
      label: 'Se déconnecter',
      separator: true,
      danger: true,
      // The one template-literal href left in this file, deliberately: it is the
      // in-repo 4-portal canary for the widened link extractor (all four
      // `/<portal>/login` routes are emitted, so a correct expansion reports
      // nothing and a broken one reports four dead targets).
      onClick: () => signOut({ callbackUrl: `/${portal}/login` }),
    },
  ];

  return (
    <UserMenu
      firstName={firstName}
      lastName={lastName}
      email={email}
      avatarSrc={avatarSrc}
      role={PORTAL_ROLE[portal]}
      items={items}
    />
  );
}
