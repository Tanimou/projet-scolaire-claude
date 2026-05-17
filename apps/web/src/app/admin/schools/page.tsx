import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { fetchMe } from '@/lib/me';

import { SchoolsManager } from './SchoolsManager';

export const metadata: Metadata = { title: 'Écoles' };
export const dynamic = 'force-dynamic';

export interface SchoolItem {
  id: string;
  name: string;
  schoolCode: string;
  country: string;
  timezone: string;
  locale: string;
  status: 'active' | 'closed';
  createdAt: string;
  _count: { students: number; academicYears: number };
}

export default async function SchoolsPage() {
  const [schools, me] = await Promise.all([
    api<{ data: SchoolItem[] }>('/api/v1/schools', { cache: 'no-store' }),
    fetchMe(),
  ]);
  const activeSchoolId = (me?.preferences as Record<string, unknown> | undefined)?.activeSchoolId as
    | string
    | undefined;

  return (
    <PortalShell portal="admin">
      <div>
        <div className="text-xs text-slate-500">Organisation · Écoles</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Écoles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Toutes les écoles de votre groupe. Sélectionnez l&apos;école active pour cibler vos opérations
          (classes, élèves, imports).
        </p>
      </div>
      <div className="mt-8">
        <SchoolsManager schools={schools.data} activeSchoolId={activeSchoolId} />
      </div>
    </PortalShell>
  );
}
