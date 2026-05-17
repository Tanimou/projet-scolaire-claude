'use client';

import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useState } from 'react';

export function UserMenu({
  firstName,
  lastName,
  email,
  portal,
}: {
  firstName: string;
  lastName: string;
  email: string;
  portal: 'admin' | 'teacher' | 'parent';
}) {
  const [open, setOpen] = useState(false);
  const initials =
    `${firstName.charAt(0) ?? ''}${lastName.charAt(0) ?? ''}`.toUpperCase() || 'U';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-blue-600 text-xs font-bold text-white">
          {initials}
        </span>
        <span className="hidden text-sm font-semibold text-slate-800 sm:inline">
          {firstName} {lastName}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">
            <div className="px-3 py-2.5">
              <div className="text-sm font-bold text-slate-900">
                {firstName} {lastName}
              </div>
              <div className="truncate text-xs text-slate-500">{email}</div>
            </div>
            <div className="my-1 h-px bg-slate-100" />
            <Link
              href={`/${portal}/profile`}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <UserRound className="h-4 w-4 text-slate-500" />
              Mon profil
            </Link>
            <Link
              href={`/${portal}/settings`}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <Settings className="h-4 w-4 text-slate-500" />
              Paramètres
            </Link>
            <div className="my-1 h-px bg-slate-100" />
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: `/${portal}/login` })}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </div>
        </>
      )}
    </div>
  );
}
