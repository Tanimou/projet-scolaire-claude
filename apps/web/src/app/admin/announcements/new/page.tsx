import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { AnnouncementForm } from './AnnouncementForm';

export const metadata: Metadata = { title: 'Nouvelle annonce' };
export const dynamic = 'force-dynamic';

export default async function NewAnnouncementPage() {
  const [cycles, classes] = await Promise.all([
    api<{
      data: Array<{
        id: string;
        name: string;
        gradeLevels: Array<{ id: string; name: string }>;
      }>;
    }>('/api/v1/cycles', { cache: 'no-store' }),
    api<{ data: Array<{ id: string; name: string; gradeLevel: { name: string } }> }>('/api/v1/classes', {
      cache: 'no-store',
    }),
  ]);

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/announcements"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux annonces
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">Communications · Nouvelle annonce</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Diffuser une annonce</h1>
        <p className="mt-1 text-sm text-slate-600">
          Choisissez la portée : toute l&apos;école, un cycle, un niveau, une classe, ou un élève (= ses
          parents). À la publication, les destinataires sont calculés automatiquement.
        </p>
      </div>
      <div className="mt-8 max-w-3xl">
        <AnnouncementForm cycles={cycles.data} classes={classes.data} />
      </div>
    </PortalShell>
  );
}
