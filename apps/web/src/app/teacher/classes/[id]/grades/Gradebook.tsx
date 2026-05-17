'use client';

import { CheckCircle2, Loader2, Plus, Save, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createAssessment, publishAssessment, refresh, saveGrades } from './actions';
import type { GradebookData } from './page';

export function Gradebook({
  initial,
  teachingAssignmentId,
}: {
  initial: GradebookData;
  teachingAssignmentId: string;
}) {
  const router = useRouter();
  const [data] = useState(initial);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // local edit buffer: { [assessmentId]: { [studentId]: { value, isAbsent } } }
  const [edits, setEdits] = useState<
    Record<string, Record<string, { value?: number | ''; isAbsent?: boolean }>>
  >({});

  const setCell = (assessmentId: string, studentId: string, patch: { value?: number | ''; isAbsent?: boolean }) => {
    setEdits((e) => ({
      ...e,
      [assessmentId]: { ...e[assessmentId], [studentId]: { ...e[assessmentId]?.[studentId], ...patch } },
    }));
  };

  const flushAssessment = async (assessmentId: string) => {
    const dirty = edits[assessmentId];
    if (!dirty) return;
    type Outgoing = { studentId: string; value?: number; isAbsent?: boolean };
    const grades: Outgoing[] = Object.entries(dirty)
      .filter(([, v]) => v.value !== undefined || v.isAbsent !== undefined)
      .map(([studentId, v]) => {
        const out: Outgoing = { studentId };
        if (v.isAbsent) {
          out.isAbsent = true;
        } else if (v.value !== '' && v.value !== undefined) {
          out.value = Number(v.value);
        }
        return out;
      })
      .filter((g) => g.isAbsent || g.value !== undefined);
    if (grades.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await saveGrades({ assessmentId, grades });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFeedback(`${grades.length} note(s) enregistrée(s).`);
    setEdits((e) => ({ ...e, [assessmentId]: {} }));
    await refresh(teachingAssignmentId);
    router.refresh();
  };

  const publish = async (assessmentId: string) => {
    if (!confirm('Publier cette évaluation ? Les notes deviennent visibles aux parents.')) return;
    await flushAssessment(assessmentId);
    setBusy(true);
    const res = await publishAssessment(assessmentId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setFeedback('Évaluation publiée.');
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}
      {feedback && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4" /> {feedback}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {data.rows.length} élève(s) · {data.assessments.length} évaluation(s) · Moyenne classe :{' '}
          <strong className="font-mono">{data.classAverage ?? '—'}</strong>
        </div>
        {!showNew && (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow"
          >
            <Plus className="h-3.5 w-3.5" /> Nouvelle évaluation
          </button>
        )}
      </div>

      {showNew && (
        <NewAssessmentForm
          teachingAssignmentId={teachingAssignmentId}
          baseCoefficient={data.assignment.baseCoefficient}
          onCancel={() => setShowNew(false)}
          onSuccess={() => {
            setShowNew(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {data.assessments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Aucune évaluation pour cette classe/matière. Créez-en une pour commencer la saisie.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-bold sticky left-0 bg-slate-50 z-10">Élève</th>
                {data.assessments.map((a) => (
                  <th key={a.id} className="px-3 py-3 text-center font-bold min-w-[120px] border-l border-slate-100">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-slate-700 truncate" title={a.title}>
                        {a.title.length > 18 ? a.title.slice(0, 18) + '…' : a.title}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        /{a.maxScore} · coef {a.effectiveCoefficient}
                      </span>
                      <div className="flex items-center justify-center gap-1 mt-1">
                        {a.isPublished ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 text-[9px] font-bold text-emerald-700">
                            ✓ publié
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 text-[9px] font-bold text-amber-700">
                            brouillon
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-bold bg-blue-50 text-blue-700 border-l border-slate-100">
                  Moy.
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((row) => (
                <tr key={row.studentId} className="hover:bg-slate-50/40">
                  <td className="px-4 py-2 font-bold text-slate-900 sticky left-0 bg-white">
                    {row.student.lastName.toUpperCase()} {row.student.firstName}
                    {row.student.externalRef && (
                      <span className="ml-1 font-mono text-[10px] font-normal text-slate-400">
                        {row.student.externalRef}
                      </span>
                    )}
                  </td>
                  {data.assessments.map((a, idx) => {
                    const g = row.grades[idx];
                    const buf = edits[a.id]?.[row.studentId];
                    const displayedValue =
                      buf?.value !== undefined ? buf.value : g?.value ?? '';
                    const displayedAbsent =
                      buf?.isAbsent !== undefined ? buf.isAbsent : g?.isAbsent ?? false;
                    return (
                      <td key={a.id} className="px-2 py-1 text-center border-l border-slate-100">
                        <div className="flex flex-col items-center gap-0.5">
                          <input
                            type="number"
                            step="0.25"
                            min={0}
                            max={a.maxScore}
                            value={displayedAbsent ? '' : (displayedValue as number | string)}
                            disabled={displayedAbsent}
                            onChange={(e) =>
                              setCell(a.id, row.studentId, {
                                value: e.target.value === '' ? '' : Number(e.target.value),
                                isAbsent: false,
                              })
                            }
                            className={`w-16 text-center rounded-md border px-1 py-1 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                              g?.status === 'revised'
                                ? 'border-amber-300 bg-amber-50'
                                : g?.status === 'published'
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-slate-200 bg-white'
                            }`}
                            placeholder="–"
                          />
                          <label className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                            <input
                              type="checkbox"
                              checked={displayedAbsent}
                              onChange={(e) =>
                                setCell(a.id, row.studentId, {
                                  isAbsent: e.target.checked,
                                  value: e.target.checked ? '' : undefined,
                                })
                              }
                              className="h-3 w-3"
                            />
                            abs.
                          </label>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-center font-mono font-bold tabular-nums text-blue-700 border-l border-slate-100">
                    {row.average ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.assessments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Par évaluation :</span>
          {data.assessments.map((a) => (
            <div
              key={a.id}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              <span className="font-bold text-slate-700">
                {a.title.length > 16 ? a.title.slice(0, 16) + '…' : a.title}
              </span>
              <button
                type="button"
                onClick={() => flushAssessment(a.id)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-700 hover:bg-blue-100"
                title="Enregistrer les notes saisies"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
              {!a.isPublished && (
                <button
                  type="button"
                  onClick={() => publish(a.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 hover:bg-emerald-100"
                  title="Publier — visible aux parents"
                >
                  <Send className="h-3 w-3" />
                  Publier
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAssessmentForm({
  teachingAssignmentId,
  baseCoefficient,
  onCancel,
  onSuccess,
  onError,
}: {
  teachingAssignmentId: string;
  baseCoefficient: number;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('written_test');
  const [maxScore, setMaxScore] = useState(20);
  const [scheduledAt, setScheduledAt] = useState('');
  const [coefOverride, setCoefOverride] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        const res = await createAssessment({
          teachingAssignmentId,
          title: title.trim(),
          kind,
          maxScore,
          ...(scheduledAt ? { scheduledAt: new Date(`${scheduledAt}T10:00:00`).toISOString() } : {}),
          ...(coefOverride ? { coefficientOverride: parseFloat(coefOverride) } : {}),
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Nouvelle évaluation</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Titre *
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="DST Chapitre 1"
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-xs font-bold text-slate-700">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="written_test">DST / Contrôle</option>
            <option value="oral">Oral</option>
            <option value="homework">Devoir maison</option>
            <option value="project">Projet</option>
            <option value="participation">Participation</option>
            <option value="practical">TP</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Note max
          <input
            type="number"
            min={1}
            max={100}
            value={maxScore}
            onChange={(e) => setMaxScore(Number(e.target.value))}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
          />
        </label>
        <label className="text-xs font-bold text-slate-700">
          Coef (défaut {baseCoefficient})
          <input
            type="number"
            step="0.5"
            min={0}
            max={20}
            value={coefOverride}
            onChange={(e) => setCoefOverride(e.target.value)}
            placeholder={String(baseCoefficient)}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
          />
        </label>
        <label className="text-xs font-bold text-slate-700">
          Date prévue
          <input
            type="date"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Créer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
