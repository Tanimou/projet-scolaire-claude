'use client';

import { LifeBuoy, LogOut, Settings as SettingsIcon, UserRound } from 'lucide-react';
import { signOut } from 'next-auth/react';

import { UserMenu, type UserMenuItem } from '@pilotage/ui';

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
 * TopbarUserMenu — wires `@pilotage/ui` UserMenu with NextAuth signOut.
 */
export function TopbarUserMenu({
  portal,
  firstName,
  lastName,
  email,
  avatarSrc,
}: TopbarUserMenuProps) {
  // The student portal (E8-S1) has no /student/profile or /student/settings
  // surface yet — render only the help + logout entries so the menu never links
  // to a 404.
  const isStudent = portal === 'student';
  const items: UserMenuItem[] = [
    ...(isStudent
      ? []
      : [
          {
            id: 'profile',
            icon: <UserRound className="h-4 w-4 text-slate-500" />,
            label: 'Mon profil',
            href: `/${portal}/profile`,
          },
          {
            id: 'settings',
            icon: <SettingsIcon className="h-4 w-4 text-slate-500" />,
            label: 'Paramètres',
            href: `/${portal}/settings`,
          },
        ]),
    {
      id: 'help',
      icon: <LifeBuoy className="h-4 w-4 text-slate-500" />,
      label: "Centre d'aide",
      href: '/help',
      separator: !isStudent,
    },
    {
      id: 'logout',
      icon: <LogOut className="h-4 w-4" />,
      label: 'Se déconnecter',
      separator: true,
      danger: true,
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
