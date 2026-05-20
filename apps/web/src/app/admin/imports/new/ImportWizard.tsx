'use client';

import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  FileText,
  GraduationCap,
  Loader2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { uploadImport } from '../actions';

import type { ImportTypeMeta } from './page';

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  students: Users,
  classes: GraduationCap,
  subjects: BookOpen,
};

const TYPE_GRADIENT: Record<string, string> = {
  students: 'from-sky-400 via-blue-500 to-indigo-600',
  classes: 'from-teal-400 via-teal-500 to-emerald-600',
  subjects: 'from-amber-400 via-orange-500 to-red-500',
};

export function ImportWizard({ types }: { types: ImportTypeMeta[] }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<ImportTypeMeta | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    setError(null);
    if (f.size > 5_000_000) {
      setError('Fichier trop volumineux (max 5 MB).');
      return;
    }
    const text = await f.text();
    setFile(f);
    setCsvPreview(text);
  };

  const onUpload = async () => {
    if (!selectedType || !file) return;
    setError(null);
    setUploading(true);
    const res = await uploadImport(selectedType.type, {
      fileName: file.name,
      rawCsv: csvPreview,
    });
    setUploading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/imports/${res.data.id}`);
  };

  const downloadTemplate = (type: string) => {
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/imports/templates/${type}`);
  };

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            1. Quel type de données importez-vous ?
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {types.map((t) => {
              const Icon = TYPE_ICONS[t.type] ?? FileText;
              const gradient = TYPE_GRADIENT[t.type] ?? 'from-slate-400 to-slate-600';
              const isSelected = selectedType?.type === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => setSelectedType(t)}
                  className={`group relative overflow-hidden rounded-2xl border-2 bg-white p-5 text-left transition ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-blue-300'
                  }`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient}`} />
                  <div className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="mt-3 text-base font-bold text-slate-900">{t.label}</div>
                  <p className="mt-1.5 text-xs text-slate-600">{t.description}</p>
                  {isSelected && (
                    <div className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedType && (
            <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Colonnes attendues</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedType.headers.map((h) => (
                  <code
                    key={h}
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-mono text-slate-700"
                  >
                    {h}
                  </code>
                ))}
              </div>
              {selectedType.notes.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-xs text-slate-600">
                  {selectedType.notes.map((n) => (
                    <li key={n} className="flex gap-1.5">
                      <span className="text-slate-400">•</span>
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => downloadTemplate(selectedType.type)}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold accent-text hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger un template CSV pré-rempli
              </button>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selectedType}
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Suivant <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {step === 2 && selectedType && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            2. Uploader votre fichier CSV
          </h2>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) await onFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center transition hover:border-blue-400 hover:bg-blue-50/30"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onFile(f);
              }}
            />
            <Upload className="mx-auto h-10 w-10 text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-900">
              {file ? file.name : 'Glissez votre fichier CSV ici, ou cliquez pour parcourir'}
            </p>
            <p className="mt-1 text-xs text-slate-500">UTF-8 · délimiteur auto-détecté · max 5 MB</p>
          </div>

          {csvPreview && (
            <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Aperçu (5 premières lignes)
              </h3>
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
                {csvPreview.split('\n').slice(0, 6).join('\n')}
              </pre>
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Retour
            </button>
            <button
              type="button"
              disabled={!file || uploading}
              onClick={onUpload}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {uploading ? 'Validation…' : 'Valider et continuer'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 }) {
  const steps = [
    { n: 1, label: 'Type', Icon: FileText },
    { n: 2, label: 'Upload', Icon: Upload },
    { n: 3, label: 'Preview', Icon: AlertTriangle },
    { n: 4, label: 'Appliquer', Icon: CheckCircle2 },
  ];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <div
              className={[
                'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold',
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                    ? 'bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30'
                    : 'bg-slate-200 text-slate-500',
              ].join(' ')}
            >
              {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <s.Icon className="h-4 w-4" />}
            </div>
            <span
              className={[
                'truncate text-sm font-semibold',
                done ? 'text-slate-700' : active ? 'text-slate-900' : 'text-slate-400',
              ].join(' ')}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <div className={`h-px flex-1 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
