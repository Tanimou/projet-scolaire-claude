'use client';

import { Calendar, Check, CheckCircle2, Clock, Loader2, LogOut, Save, X } from 'lucide-react';
import { useState } from 'react';

import { fetchRoster, openSession, submitAttendance } from './actions';

type AttendanceStatus = 'present' | 'absent' | 'absent_excused' | 'late' | 'left_early';

interface RosterRow {
  enrollmentId: string;
  student: { id: string; firstName: string; lastName: string; externalRef: string | null };
  record: null | {
    id: string;
    status: AttendanceStatus;
    arrivedAt: string | null;
    comment: string | null;
  };
}

interface SessionRoster {
  session: {
    id: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    topic: string | null;
    cancelled: boolean;
  };
  roster: RosterRow[];
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Présent',
  absent: 'Absent',
  absent_excused: 'Absent excusé',
  late: 'Retard',
  left_early: 'Parti tôt',
};

const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  absent: 'bg-rose-100 text-rose-800 border-rose-300',
  absent_excused: 'bg-amber-100 text-amber-800 border-amber-300',
  late: 'bg-orange-100 text-orange-800 border-orange-300',
  left_early: 'bg-slate-100 text-slate-700 border-slate-300',
};

const STATUS_ICON: Record<AttendanceStatus, React.ComponentType<{ className?: string }>> = {
  present: Check,
  absent: X,
  absent_excused: CheckCircle2,
  late: Clock,
  left_early: LogOut,
};

export function AttendanceManager({ teachingAssignmentId }: { teachingAssignmentId: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<SessionRoster | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  const open = async () => {
    setBusy(true);
    setError(null);
    const res = await openSession({
      teachingAssignmentId,
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      topic: topic || undefined,
    });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    const r = await fetchRoster(res.data.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const sr = r.data as SessionRoster;
    setSession(sr);
    // initialize marks from existing records
    const init: Record<string, AttendanceStatus> = {};
    for (const row of sr.roster) {
      if (row.record) init[row.student.id] = row.record.status;
    }
    setMarks(init);
  };

  const markAll = (status: AttendanceStatus) => {
    if (!session) return;
    const updated: Record<string, AttendanceStatus> = {};
    for (const r of session.roster) updated[r.student.id] = status;
    setMarks(updated);
  };

  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const records = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }));
    if (records.length === 0) {
      setError('Aucune saisie à enregistrer.');
      setBusy(false);
      return;
    }
    const res = await submitAttendance(session.session.id, records);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setFeedback(`${records.length} présence(s) enregistrée(s).`);
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}
      {feedback && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4" /> {feedback}
        </div>
      )}

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Séance</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-xs font-bold text-slate-700">
            Date *
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            Heure début
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            Heure fin
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-bold text-slate-700">
            Sujet (optionnel)
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Pythagore"
              className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
          {session ? 'Recharger la séance' : 'Ouvrir la séance & faire l’appel'}
        </button>
      </section>

      {session && (
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {new Date(session.session.date).toLocaleDateString('fr-FR', { dateStyle: 'full' })}
                {session.session.startTime && ` · ${session.session.startTime} – ${session.session.endTime ?? ''}`}
              </div>
              <div className="mt-0.5 text-sm font-bold text-slate-900">
                Appel · {session.roster.length} élève(s) inscrit(s)
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => markAll('present')}
                className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                Tous présents
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-3 py-1.5 text-xs font-bold text-white shadow disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Enregistrer
              </button>
            </div>
          </header>
          <ul className="divide-y divide-slate-100">
            {session.roster.map((row) => {
              const status = marks[row.student.id] ?? row.record?.status ?? 'present';
              return (
                <li key={row.student.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                    {row.student.firstName[0]?.toUpperCase()}{row.student.lastName[0]?.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">
                      {row.student.lastName.toUpperCase()} {row.student.firstName}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {(['present', 'late', 'absent', 'absent_excused'] as AttendanceStatus[]).map((s) => {
                      const Icon = STATUS_ICON[s];
                      const active = status === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setMarks((m) => ({ ...m, [row.student.id]: s }))}
                          title={STATUS_LABEL[s]}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                            active ? STATUS_TONE[s] : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="h-3 w-3" />
                          {STATUS_LABEL[s].split(' ')[0]}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
