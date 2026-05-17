'use client';

import { BookOpen, Calendar, Edit2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createLesson, deleteLesson, updateLesson } from './actions';

interface Lesson {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  status: 'draft' | 'published';
}

export function LessonsManager({
  lessons,
  teachingAssignmentId,
}: {
  lessons: Lesson[];
  teachingAssignmentId: string;
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
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{lessons.length} entrée(s) au cahier de texte</div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow"
          >
            <Plus className="h-3.5 w-3.5" /> Nouvelle entrée
          </button>
        )}
      </div>

      {(creating || editing) && (
        <LessonForm
          initial={editing}
          teachingAssignmentId={teachingAssignmentId}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {lessons.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Aucune entrée pour cette classe/matière.
        </div>
      ) : (
        <ul className="space-y-3">
          {lessons.map((l) => (
            <li key={l.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 font-bold text-teal-700">
                      <Calendar className="h-3 w-3" />
                      {new Date(l.date).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                    </span>
                    {l.status === 'draft' && (
                      <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                        Brouillon
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-base font-bold text-slate-900">{l.title}</h3>
                  <p className="mt-1 text-sm text-slate-600 whitespace-pre-line">{l.content}</p>
                  {l.homework && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
                        <BookOpen className="h-3 w-3" /> Devoirs
                        {l.homeworkDueAt && (
                          <span className="font-normal">
                            · pour le {new Date(l.homeworkDueAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-amber-900 whitespace-pre-line">{l.homework}</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(l)}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(l.id)}
                    disabled={busy}
                    className="grid h-8 w-8 place-items-center rounded-md text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [date, setDate] = useState(initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [homework, setHomework] = useState(initial?.homework ?? '');
  const [homeworkDueAt, setHomeworkDueAt] = useState(initial?.homeworkDueAt?.slice(0, 10) ?? '');
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
      className="rounded-2xl bg-white p-5 ring-1 ring-slate-200 space-y-3"
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
