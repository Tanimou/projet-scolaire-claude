import { AlertTriangle, ArrowLeft, Megaphone, Pin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Annonces' };
export const dynamic = 'force-dynamic';

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  scope: string;
  priority: 'normal' | 'high' | 'urgent';
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  classSection?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  cycle?: { name: string } | null;
  student?: { firstName: string; lastName: string } | null;
  readAt?: string | null;
}

const PRIORITY_TONE: Record<string, string> = {
  normal: 'bg-slate-100 text-slate-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-rose-100 text-rose-700',
};

export default async function ParentAnnouncementsPage() {
  const list = await api<{ data: AnnouncementItem[] }>('/api/v1/announcements', { cache: 'no-store' });

  return (
    <PortalShell portal="parent" contentClassName="mx-auto max-w-md px-5 pb-24 pt-6">
      <Link
        href="/parent/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Annonces</h1>
      <p className="mt-1 text-sm text-slate-600">
        Communications de l&apos;établissement vous concernant.
      </p>

      {list.data.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-slate-200">
          <Megaphone className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Aucune annonce</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {list.data.map((a) => (
            <li
              key={a.id}
              className={`rounded-2xl bg-white p-4 ring-1 ${
                !a.readAt
                  ? 'ring-blue-300 shadow-md shadow-blue-100/40'
                  : a.pinned
                    ? 'ring-amber-200'
                    : 'ring-slate-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                    a.priority === 'urgent'
                      ? 'bg-rose-100 text-rose-700'
                      : a.priority === 'high'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {a.priority === 'urgent' ? <AlertTriangle className="h-4 w-4" /> : <Megaphone className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-amber-600" />}
                    {a.priority !== 'normal' && (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_TONE[a.priority]}`}
                      >
                        {a.priority}
                      </span>
                    )}
                    {!a.readAt && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                        Nouveau
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">{a.title}</h3>
                  <p className="mt-1 text-sm text-slate-600 line-clamp-3 whitespace-pre-line">{a.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    {a.publishedAt && (
                      <span>
                        {new Date(a.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                      </span>
                    )}
                    {a.classSection && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold">
                        Classe {a.classSection.name}
                      </span>
                    )}
                    {a.gradeLevel && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold">
                        {a.gradeLevel.name}
                      </span>
                    )}
                    {a.student && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold">
                        {a.student.firstName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
