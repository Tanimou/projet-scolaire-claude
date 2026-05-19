import { Info, MessageSquarePlus } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

import {
  TeacherMessageComposer,
  type TeachableClass,
  type TeachableCycle,
  type TeachableLevel,
} from './TeacherMessageComposer';

export const metadata: Metadata = { title: 'Nouveau message' };
export const dynamic = 'force-dynamic';

interface AssignmentRow {
  id: string;
  classSection: {
    id: string;
    name: string;
    gradeLevel: {
      id: string;
      name: string;
      cycle: { id: string; name: string; color: string | null };
    };
  };
  subject: { id: string; code: string; name: string; color: string | null };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function NewTeacherMessagePage() {
  const resp = await safe(
    api<{ data: AssignmentRow[] }>('/api/v1/teachers/me/assignments', { cache: 'no-store' }),
  );
  const assignments = resp?.data ?? [];

  // Roll up assignments into unique class sections / grade levels / cycles
  // that the teacher is authorised to broadcast to.
  const classMap = new Map<string, TeachableClass>();
  const levelMap = new Map<string, TeachableLevel>();
  const cycleMap = new Map<string, TeachableCycle>();

  for (const a of assignments) {
    const cs = a.classSection;
    const lvl = cs.gradeLevel;
    const cy = lvl.cycle;

    if (!classMap.has(cs.id)) {
      classMap.set(cs.id, {
        id: cs.id,
        name: cs.name,
        gradeLevelName: lvl.name,
        cycleName: cy.name,
        cycleColor: cy.color,
      });
    }
    if (!levelMap.has(lvl.id)) {
      levelMap.set(lvl.id, { id: lvl.id, name: lvl.name, cycleName: cy.name });
    }
    if (!cycleMap.has(cy.id)) {
      cycleMap.set(cy.id, { id: cy.id, name: cy.name, color: cy.color });
    }
  }

  const classes = [...classMap.values()];
  const levels = [...levelMap.values()];
  const cycles = [...cycleMap.values()];

  const hasAnyTarget = classes.length > 0 || levels.length > 0 || cycles.length > 0;

  return (
    <PortalShell portal="teacher">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Fil d'Ariane" className="text-xs text-slate-500">
          <a className="hover:text-slate-900" href="/teacher/dashboard">
            Tableau de bord
          </a>
          <span className="mx-1.5 text-slate-300">/</span>
          <a className="hover:text-slate-900" href="/teacher/messages">
            Messagerie
          </a>
          <span className="mx-1.5 text-slate-300">/</span>
          <span className="font-medium text-slate-700">Nouveau message</span>
        </nav>
        <header className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/30"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
                Diffuser un message aux familles
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Composez votre message, choisissez l&apos;audience parmi vos rattachements et
                vérifiez le rendu avant publication. Le nombre exact de destinataires se met à
                jour en direct.
              </p>
            </div>
          </div>
        </header>

        {!hasAnyTarget ? (
          <div className="mt-8 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <Info className="h-4 w-4" />
              </div>
              <div className="text-sm text-amber-900">
                <p className="font-bold">Aucune classe rattachée à votre profil</p>
                <p className="mt-1">
                  Vous devez être assigné(e) à au moins une classe pour pouvoir diffuser un
                  message. Contactez l&apos;administration de votre établissement.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <TeacherMessageComposer classes={classes} levels={levels} cycles={cycles} />
          </div>
        )}
      </div>
    </PortalShell>
  );
}
