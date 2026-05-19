import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { AnnouncementComposer } from './AnnouncementComposer';

export const metadata: Metadata = { title: 'Nouvelle annonce' };
export const dynamic = 'force-dynamic';

interface CycleRow {
  id: string;
  name: string;
  gradeLevels: Array<{ id: string; name: string; classSections?: Array<{ id: string }> }>;
}

interface ClassRow {
  id: string;
  name: string;
  capacity?: number | null;
  enrolledCount?: number;
  gradeLevel: { id?: string; name: string; cycle?: { id: string; name: string } | null };
}

export default async function NewAnnouncementPage() {
  const [cycles, classes] = await Promise.all([
    api<{ data: CycleRow[] }>('/api/v1/cycles', { cache: 'no-store' }),
    api<{ data: ClassRow[] }>('/api/v1/classes', { cache: 'no-store' }),
  ]);

  return (
    <PortalShell portal="admin">
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Fil d'Ariane" className="text-xs text-slate-500">
          <a className="hover:text-slate-900" href="/admin/dashboard">
            Tableau de bord
          </a>
          <span className="mx-1.5 text-slate-300">/</span>
          <a className="hover:text-slate-900" href="/admin/communications">
            Communications
          </a>
          <span className="mx-1.5 text-slate-300">/</span>
          <span className="font-medium text-slate-700">Nouvelle annonce</span>
        </nav>
        <header className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30"
            >
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
                Diffuser une annonce
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Composez votre message, choisissez l&apos;audience et vérifiez le rendu avant la
                publication. Le nombre de destinataires se met à jour en direct.
              </p>
            </div>
          </div>
        </header>

        <div className="mt-8">
          <AnnouncementComposer cycles={cycles.data} classes={classes.data} />
        </div>
      </div>
    </PortalShell>
  );
}
