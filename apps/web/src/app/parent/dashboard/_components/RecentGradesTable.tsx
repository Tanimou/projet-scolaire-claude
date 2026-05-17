'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { formatDateShort, formatGrade, subjectColor } from '@pilotage/ui';

export interface GradeRow {
  id: string;
  date: string;
  subjectName: string;
  subjectColor: string | null;
  title: string;
  kind: string;
  value: number | null;
  max: number;
  classAverage: number | null;
  coefficient: number;
  comment: string | null;
}

const KIND_LABELS: Record<string, string> = {
  written_test: 'Contrôle',
  homework: 'DM',
  oral_test: 'Oral',
  oral: 'Oral',
  project: 'Projet',
  practical: 'TP',
  quiz: 'Quiz',
  participation: 'Particip.',
};

const PAGE_SIZE = 5;

export function RecentGradesTable({
  rows,
  seeAllHref,
}: {
  rows: GradeRow[];
  seeAllHref: string;
}) {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIdx, startIdx + PAGE_SIZE);
  const endIdx = startIdx + pageRows.length;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Dernières notes et évaluations</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {total === 0
              ? 'Aucune note publiée pour le moment'
              : `Affichage de ${startIdx + 1} à ${endIdx} sur ${total} notes récentes`}
          </p>
        </div>
        <Link
          href={seeAllHref}
          className="text-[11px] font-bold text-blue-700 hover:underline"
        >
          Voir toutes les notes →
        </Link>
      </header>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucune note publiée pour le moment.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Matière</th>
                  <th className="px-3 py-2.5">Évaluation</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-right">Note</th>
                  <th className="px-3 py-2.5 text-right">/</th>
                  <th className="px-3 py-2.5 text-right">Moy. classe</th>
                  <th className="px-3 py-2.5 text-right">Coef.</th>
                  <th className="px-3 py-2.5">Appréciation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((g) => {
                  const color = subjectColor(g.subjectName);
                  return (
                    <tr key={g.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {formatDateShort(g.date)}
                      </td>
                      <td className="px-3 py-2.5 text-sm font-bold text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: g.subjectColor ?? color.primary }}
                            aria-hidden
                          />
                          {g.subjectName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-slate-700">{g.title}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">
                        {KIND_LABELS[g.kind] ?? g.kind}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                        {formatGrade(g.value)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-400">/ {g.max}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">
                        {formatGrade(g.classAverage)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-600">
                        {g.coefficient}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {g.comment ? (
                          <span className="line-clamp-1" title={g.comment}>
                            {g.comment}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav
              aria-label="Pagination des notes"
              className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3"
            >
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Page précédente"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  aria-current={n === page ? 'page' : undefined}
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-mono text-xs tabular-nums transition ${
                    n === page
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Page suivante"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
