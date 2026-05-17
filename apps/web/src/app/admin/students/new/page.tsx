import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';

import { StudentForm } from './StudentForm';

export const metadata: Metadata = { title: 'Nouvel élève' };
export const dynamic = 'force-dynamic';

export default function NewStudentPage() {
  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/students"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la liste
      </Link>
      <div className="mt-4 max-w-3xl">
        <div className="text-xs text-slate-500">Personnes · Élèves</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Nouvel élève</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saisissez l&apos;identité de l&apos;élève. Les inscriptions en classe et les rattachements parents
          se font ensuite depuis la fiche détail.
        </p>
        <div className="mt-8">
          <StudentForm />
        </div>
      </div>
    </PortalShell>
  );
}
