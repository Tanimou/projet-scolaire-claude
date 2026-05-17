'use client';

import { Download, FileSpreadsheet, FileText, GraduationCap, History, Loader2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createExportAction, type ExportKindCode } from './actions';

interface ExportKindDef {
  code: ExportKindCode;
  label: string;
  description: string;
  icon: typeof FileSpreadsheet;
  tone: 'green' | 'rose' | 'blue' | 'amber' | 'violet';
}

const KINDS: ExportKindDef[] = [
  {
    code: 'grades_xlsx',
    label: 'Notes (Excel)',
    description: "Exporte les notes publiées de toutes les classes de l'année active.",
    icon: FileSpreadsheet,
    tone: 'green',
  },
  {
    code: 'report_card_pdf',
    label: 'Bulletins (PDF)',
    description: "Bulletins trimestriels — première classe + dernier trimestre par défaut.",
    icon: FileText,
    tone: 'rose',
  },
  {
    code: 'enrollment_xlsx',
    label: 'Inscriptions (Excel)',
    description: 'Liste complète des élèves inscrits avec parents et coordonnées.',
    icon: Users,
    tone: 'blue',
  },
  {
    code: 'attendance_xlsx',
    label: 'Présences (Excel)',
    description: "Suivi d'absences/retards sur les 30 derniers jours.",
    icon: GraduationCap,
    tone: 'amber',
  },
  {
    code: 'audit_csv',
    label: 'Audit (CSV)',
    description: "Journal d'audit sur les 90 derniers jours (append-only).",
    icon: History,
    tone: 'violet',
  },
];

const TONE_CLASS: Record<ExportKindDef['tone'], string> = {
  green: 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200',
  rose: 'bg-rose-100 text-rose-700 group-hover:bg-rose-200',
  blue: 'bg-blue-100 text-blue-700 group-hover:bg-blue-200',
  amber: 'bg-amber-100 text-amber-700 group-hover:bg-amber-200',
  violet: 'bg-violet-100 text-violet-700 group-hover:bg-violet-200',
};

export function ExportLauncher() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeKind, setActiveKind] = useState<ExportKindCode | null>(null);
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  function launch(code: ExportKindCode) {
    if (pending) return;
    setActiveKind(code);
    setFeedback(null);
    startTransition(async () => {
      const result = await createExportAction(code, {});
      if (result.ok) {
        setFeedback({
          kind: 'success',
          message: 'Export en cours — il apparaîtra dans la liste ci-dessous dans quelques secondes.',
        });
        router.refresh();
      } else {
        setFeedback({ kind: 'error', message: result.error ?? 'Erreur inconnue' });
      }
      setActiveKind(null);
    });
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Lancer un nouvel export</h2>
          <p className="mt-1 text-xs text-slate-500">
            Génération asynchrone — le worker BullMQ traite chaque demande puis stocke le fichier dans MinIO.
          </p>
        </div>
        {pending && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mise en file…
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const isActive = activeKind === k.code;
          return (
            <button
              key={k.code}
              type="button"
              disabled={pending}
              onClick={() => launch(k.code)}
              className="group flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition ${TONE_CLASS[k.tone]}`}
              >
                {isActive ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </span>
              <h3 className="text-sm font-bold text-slate-900">{k.label}</h3>
              <p className="text-xs text-slate-600">{k.description}</p>
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
                {isActive ? 'En cours…' : <>Générer <Download className="h-3 w-3" /></>}
              </span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          role="status"
          className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${
            feedback.kind === 'success'
              ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200'
              : 'bg-rose-50 text-rose-900 ring-1 ring-rose-200'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </section>
  );
}
