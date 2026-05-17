'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Avatar } from './Avatar';

export interface UserMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  /** Adds a danger style (e.g. logout) */
  danger?: boolean;
  /** Adds a separator above this item */
  separator?: boolean;
}

export interface UserMenuProps {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatarSrc?: string | null;
  /** Short role label (e.g. 'Enseignant') */
  role?: string;
  items: UserMenuItem[];
  className?: string;
}

/**
 * UserMenu — topbar user dropdown.
 * Renders avatar + name + role and exposes a menu of items.
 */
export function UserMenu({
  firstName,
  lastName,
  email,
  avatarSrc,
  role,
  items,
  className,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOut);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2.5 rounded-full pl-1 pr-2 transition hover:bg-slate-100"
      >
        <Avatar src={avatarSrc} firstName={firstName} lastName={lastName} size="md" />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold text-slate-900">{fullName || email}</span>
          {role && <span className="block text-[11px] text-slate-500">{role}</span>}
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Menu utilisateur"
          className="absolute right-0 z-40 mt-2 w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5"
        >
          {(fullName || email) && (
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="truncate text-sm font-bold text-slate-900">{fullName}</p>
              {email && <p className="mt-0.5 truncate text-xs text-slate-500">{email}</p>}
              {role && (
                <p className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {role}
                </p>
              )}
            </div>
          )}
          <ul className="py-1">
            {items.map((it) => (
              <li key={it.id}>
                {it.separator && <div className="my-1 border-t border-slate-100" />}
                {it.href ? (
                  <a
                    href={it.href}
                    role="menuitem"
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 text-sm transition',
                      it.danger
                        ? 'text-rose-700 hover:bg-rose-50'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {it.icon ?? (it.danger ? <LogOut className="h-4 w-4" /> : null)}
                    {it.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      it.onClick?.();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                      it.danger
                        ? 'text-rose-700 hover:bg-rose-50'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {it.icon ?? (it.danger ? <LogOut className="h-4 w-4" /> : null)}
                    {it.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
