import { BookOpen, HeartHandshake, Lightbulb, Mail } from 'lucide-react';
import Link from 'next/link';

/**
 * Bottom CTA strip — "Ensemble pour la réussite de {child}" with 3
 * parent-oriented actions (advice, resources, contact). Borrowed from Image 2.
 */
export function SupportStrip({ childFirstName }: { childFirstName: string }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-blue-50 via-white to-violet-50 p-5 ring-1 ring-slate-200/60">
      <div className="flex flex-wrap items-center gap-5">
        {/* Illustration block — pure CSS, no asset */}
        <div
          aria-hidden
          className="relative hidden h-20 w-32 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-100 via-violet-100 to-blue-100 ring-1 ring-blue-200 sm:block"
        >
          <span className="absolute -left-2 -top-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 text-blue-700">
            <HeartHandshake className="h-5 w-5" />
          </span>
          <span className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 text-violet-700">
            <Lightbulb className="h-4 w-4" />
          </span>
        </div>

        {/* Headline + subtitle */}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-slate-900">
            Ensemble pour la réussite de {childFirstName}
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Votre implication fait une vraie différence. Continuez à l&apos;encourager et à
            célébrer chaque progrès.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/parent/recommendations"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
            Conseils pour les parents
          </Link>
          <Link
            href="/parent/documents"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5 text-blue-600" />
            Ressources éducatives
          </Link>
          <Link
            href="/parent/communication"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Mail className="h-3.5 w-3.5" />
            Contacter l&apos;établissement
          </Link>
        </div>
      </div>
    </section>
  );
}
