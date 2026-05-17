import { ArrowLeft, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';

import { NewMessageForm, type TeachableClass } from './NewMessageForm';

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
  const levelMap = new Map<string, { id: string; name: string; cycleName: string }>();
  const cycleMap = new Map<string, { id: string; name: string; color: string | null }>();

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

  const classes = [...classMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const levels = [...levelMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const cycles = [...cycleMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PortalShell portal="teacher">
      <Link
        href="/teacher/messages"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la messagerie
      </Link>
      <div className="mt-4 max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-wider text-violet-600">
          Messagerie · Nouveau message
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Diffuser un message aux familles
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Adressez une annonce aux parents d&apos;une classe, d&apos;un niveau ou d&apos;un cycle où
          vous enseignez. À la publication, les destinataires sont calculés automatiquement.
        </p>
      </div>

      {classes.length === 0 ? (
        <div className="mt-8 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Info className="h-4 w-4" />
            </div>
            <div className="text-sm text-amber-900">
              <p className="font-bold">Aucune classe rattachée à votre profil</p>
              <p className="mt-1">
                Vous devez être assigné(e) à au moins une classe pour pouvoir diffuser un message.
                Contactez l&apos;administration de votre établissement.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 max-w-3xl">
          <NewMessageForm classes={classes} levels={levels} cycles={cycles} />
        </div>
      )}
    </PortalShell>
  );
}
