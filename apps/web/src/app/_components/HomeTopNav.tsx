'use client';

import { ChevronDown, GraduationCap, Lock, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Landing-page top nav with the "Connexion" dropdown.
 *
 * Was originally a native `<details>` but browser extensions (Dark Reader,
 * password managers, translation tools) sometimes inject `open=""` before
 * React hydrates, breaking hydration. A controlled `useState` dropdown sidesteps
 * the whole class of issues and gives us click-outside + Escape close for free.
 */
export function HomeTopNav() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-slate-900">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-blue-600 to-blue-700 text-base font-bold text-white shadow-lg shadow-blue-500/30">
            P
          </span>
          <span className="text-base font-bold tracking-tight">
            Pilotage <span className="font-normal text-slate-500">scolaire</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
          <a href="#produit" className="transition-colors hover:text-slate-900">
            Produit
          </a>
          <a href="#comment" className="transition-colors hover:text-slate-900">
            Comment ça marche
          </a>
          <a href="#securite" className="transition-colors hover:text-slate-900">
            Sécurité
          </a>
        </nav>

        <div ref={wrapperRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Connexion
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10"
            >
              <Link
                href="/parent/login"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition hover:bg-blue-50 hover:text-blue-900"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-100 text-blue-700">
                  <Users className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Portail famille</div>
                  <div className="text-xs text-slate-500">Pour les parents</div>
                </div>
              </Link>
              <Link
                href="/teacher/login"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition hover:bg-teal-50 hover:text-teal-900"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-100 text-teal-700">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Portail professeur</div>
                  <div className="text-xs text-slate-500">Pour les enseignants</div>
                </div>
              </Link>
              <Link
                href="/admin/login"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-900"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 text-indigo-700">
                  <Lock className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Portail administrateur</div>
                  <div className="text-xs text-slate-500">Pour les écoles</div>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
