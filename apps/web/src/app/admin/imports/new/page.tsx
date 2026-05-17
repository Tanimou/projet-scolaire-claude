import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { ImportWizard } from './ImportWizard';

export const metadata: Metadata = { title: 'Nouvel import' };
export const dynamic = 'force-dynamic';

export interface ImportTypeMeta {
  type: string;
  label: string;
  description: string;
  icon: string;
  headers: string[];
  notes: string[];
}

export default async function NewImportPage() {
  const { data } = await api<{ data: ImportTypeMeta[] }>('/api/v1/imports/types', { cache: 'no-store' });

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/imports"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux imports
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">Opérations · Nouvel import</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Importer un fichier CSV</h1>
        <p className="mt-1 text-sm text-slate-600">
          Wizard 4 étapes : choisir le type → uploader le fichier → vérifier la preview → appliquer.
        </p>
      </div>
      <div className="mt-8">
        <ImportWizard types={data} />
      </div>
    </PortalShell>
  );
}
