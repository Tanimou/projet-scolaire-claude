'use client';

import { Building2, Check, GraduationCap, Loader2, Plus, School as SchoolIcon, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createSchool, switchActiveSchool } from './actions';
import type { SchoolItem } from './page';

export function SchoolsManager({
  schools,
  activeSchoolId,
}: {
  schools: SchoolItem[];
  activeSchoolId?: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [country, setCountry] = useState('FR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveActive = activeSchoolId ?? schools[0]?.id;

  const onSwitch = async (id: string) => {
    setBusy(true);
    setError(null);
    const res = await switchActiveSchool(id);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    const res = await createSchool({ name: name.trim(), schoolCode: code.trim(), country: country.toUpperCase() });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setAdding(false);
      setName('');
      setCode('');
      router.refresh();
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      <div className="flex items-center justify-end">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30"
          >
            <Plus className="h-4 w-4" /> Nouvelle école
          </button>
        )}
      </div>

      {adding && (
        <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
          <h3 className="text-sm font-bold text-slate-900">Ajouter une école</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Nom</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Ex : Lycée Jean Jaurès" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Code</span>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono" placeholder="LJJ-PARIS-2026" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Pays (ISO 2)</span>
              <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Annuler
            </button>
            <button
              type="button"
              disabled={busy || !name.trim() || !code.trim()}
              onClick={onCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Créer
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {schools.map((s) => {
          const isActive = s.id === effectiveActive;
          return (
            <article
              key={s.id}
              className={`group relative overflow-hidden rounded-2xl bg-white p-5 ring-1 transition ${
                isActive ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10' : 'ring-slate-200 hover:ring-slate-300'
              }`}
            >
              {isActive && (
                <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Check className="h-2.5 w-2.5" /> Active
                </span>
              )}
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-500 text-white">
                <SchoolIcon className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-900">{s.name}</h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <code className="font-mono">{s.schoolCode}</code>
                <span>·</span>
                <span>{s.country}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {s.status}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <Stat icon={<Users className="h-3.5 w-3.5" />} label="Élèves" value={s._count.students} />
                <Stat icon={<GraduationCap className="h-3.5 w-3.5" />} label="Années" value={s._count.academicYears} />
              </dl>
              {!isActive && (
                <button
                  type="button"
                  onClick={() => onSwitch(s.id)}
                  disabled={busy}
                  className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                  Définir comme école active
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
