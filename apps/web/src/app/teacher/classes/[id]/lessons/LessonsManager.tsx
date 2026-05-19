'use client';

import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Edit2,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createLesson, deleteLesson, updateLesson } from './actions';
import type { Lesson } from './types';

interface LessonGroup {
  key: string;
  label: string;
  rows: Lesson[];
}

export function LessonsManager({
  groups,
  totalEntries,
  filteredCount,
  teachingAssignmentId,
  hasActiveFilters,
  resetHref,
}: {
  groups: LessonGroup[];
  totalEntries: number;
  filteredCount: number;
  teachingAssignmentId: string;
  hasActiveFilters: boolean;
  resetHref: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async (id: string) => {
    if (!confirm('Supprimer cette entrée du cahier de texte ?')) return;
    setBusy(true);
    const res = await deleteLesson(id, teachingAssignmentId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-slate-200/60 shadow-sm">
        <div className="text-xs text-slate-500">
          {totalEntries === 0 ? (
            <>Aucune entrée pour le moment</>
          ) : hasActiveFilters ? (
            <>
              <span className="font-bold text-slate-900">{filteredCount}</span> entrée
              {filteredCount > 1 ? 's' : ''} sur {totalEntries} affichée
              {filteredCount > 1 ? 's' : ''}
            </>
          ) : (
            <>
              <span className="font-bold text-slate-900">{totalEntries}</span> entrée
              {totalEntries > 1 ? 's' : ''} au cahier de texte
            </>
          )}
        </div>
        {!creating && !editing ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <Plus className="h-3.5 w-3.5" /> Nouvelle entrée
          </button>
        ) : null}
      </div>

      {(creating || editing) && (
        <LessonForm
          initial={editing}
          teachingAssignmentId={teachingAssignmentId}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
            setError(null);
          }}
          onSuccess={() => {
            setCreating(false);
            setEditing(null);
            setError(null);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {groups.length > 0 ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <section
              key={group.key}
              className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60 shadow-sm"
            >
              <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
                <h3 className="text-sm font-bold text-slate-900">{group.label}</h3>
                <span className="inline-flex items-center justify-center rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                  {group.rows.length} entrée{group.rows.length > 1 ? 's' : ''}
                </span>
              </header>
              <ul className="divide-y divide-slate-100">
                {group.rows.map((l) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    busy={busy}
                    onEdit={() => setEditing(l)}
                    onDelete={() => onDelete(l.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LessonRow({
  lesson: l,
  busy,
  onEdit,
  onDelete,
}: {
  lesson: Lesson;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dueDate = l.homeworkDueAt ? new Date(l.homeworkDueAt) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = dueDate ? dueDate < today : false;
  const dueSoon = dueDate
    ? !overdue && dueDate.getTime() - today.getTime() <= 7 * 24 * 60 * 60 * 1000
    : false;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 font-bold text-teal-700">
              <Calendar className="h-3 w-3" />
              {new Date(l.date).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
            </span>
            {l.status === 'draft' ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                <EyeOff className="h-3 w-3" /> Brouillon
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Publié
              </span>
            )}
            {l.homework ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                <BookOpen className="h-3 w-3" /> Devoirs
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 text-base font-bold text-slate-900">{l.title}</h3>
          <p className="mt-1 text-sm text-slate-600 whitespace-pre-line">{l.content}</p>
          {l.homework && (
            <div
              className={`mt-3 rounded-xl border p-3 ${
                overdue
                  ? 'border-rose-200 bg-rose-50'
                  : dueSoon
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-violet-200 bg-violet-50'
              }`}
            >
              <div
                className={`flex flex-wrap items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${
                  overdue ? 'text-rose-800' : dueSoon ? 'text-amber-800' : 'text-violet-800'
                }`}
              >
                <BookOpen className="h-3 w-3" /> Devoirs
                {dueDate && (
                  <span className="font-normal">
                    · pour le{' '}
                    {dueDate.toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                  </span>
                )}
                {overdue ? (
                  <span className="rounded-full bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold text-rose-900">
                    Échéance passée
                  </span>
                ) : null}
                {dueSoon ? (
                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-900">
                    Sous 7 j
                  </span>
                ) : null}
              </div>
              <p
                className={`mt-1 text-sm whitespace-pre-line ${
                  overdue ? 'text-rose-900' : dueSoon ? 'text-amber-900' : 'text-violet-900'
                }`}
              >
                {l.homework}
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            title="Modifier"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50 disabled:opacity-50"
            title="Supprimer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function LessonForm({
  initial,
  teachingAssignmentId,
  onCancel,
  onSuccess,
  onError,
}: {
  initial: Lesson | null;
  teachingAssignmentId: string;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [date, setDate] = useState(
    initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [homework, setHomework] = useState(initial?.homework ?? '');
  const [homeworkDueAt, setHomeworkDueAt] = useState(
    initial?.homeworkDueAt?.slice(0, 10) ?? '',
  );
  const [status, setStatus] = useState<'draft' | 'published'>(initial?.status ?? 'published');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        const payload = {
          teachingAssignmentId,
          date,
          title: title.trim(),
          content,
          homework: homework.trim() || undefined,
          homeworkDueAt: homeworkDueAt || undefined,
          status,
        };
        const res = initial
          ? await updateLesson(initial.id, payload, teachingAssignmentId)
          : await createLesson(payload, teachingAssignmentId);
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/60 shadow-sm space-y-3"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
        {initial ? 'Modifier l’entrée' : 'Nouvelle entrée'}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold text-slate-700">
          Date *
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="sm:col-span-2 text-xs font-bold text-slate-700">
          Titre *
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex : Théorème de Pythagore"
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <label className="block text-xs font-bold text-slate-700">
        Contenu (markdown supporté) *
        <textarea
          required
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="# Titre&#10;Détail du cours..."
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-700">
          Devoirs (optionnel)
          <textarea
            rows={3}
            value={homework}
            onChange={(e) => setHomework(e.target.value)}
            placeholder="Ex : exercices 12, 14, 18 p.45"
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            Devoirs à rendre pour le
            <input
              type="date"
              value={homeworkDueAt}
              onChange={(e) => setHomeworkDueAt(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            Statut
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="published">Publié (visible parents)</option>
              <option value="draft">Brouillon</option>
            </select>
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim() || !content.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {initial ? 'Enregistrer' : 'Créer'}
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
