import { ArrowLeft, Sparkles, Check, ShieldCheck, Zap } from 'lucide-react';
import Link from 'next/link';

export type PortalAccent = 'admin' | 'teacher' | 'parent' | 'student';

const portals = {
  admin: {
    gradient: 'from-indigo-600 via-blue-600 to-blue-700',
    ring: 'focus-visible:ring-blue-500/40 focus-visible:border-blue-500',
    primaryText: 'text-blue-700',
    primaryHover: 'hover:text-blue-700',
    button: 'bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 hover:shadow-blue-500/40',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    blob1: 'from-indigo-400 to-blue-600',
    blob2: 'from-violet-400 to-purple-600',
    tagline: 'Le tableau de bord de votre établissement.',
    benefits: [
      { Icon: Sparkles, title: 'White-label', body: 'Branding, couleurs, libellés — votre identité, partout.' },
      { Icon: ShieldCheck, title: 'Audit complet', body: 'Chaque action sensible tracée, append-only.' },
      { Icon: Zap, title: 'Configuration éclair', body: 'Hiérarchie complète en moins de 15 minutes.' },
    ],
  },
  teacher: {
    gradient: 'from-teal-400 via-teal-500 to-emerald-600',
    ring: 'focus-visible:ring-teal-500/40 focus-visible:border-teal-500',
    primaryText: 'text-teal-700',
    primaryHover: 'hover:text-teal-700',
    button: 'bg-gradient-to-br from-teal-500 via-teal-600 to-emerald-600 hover:shadow-teal-500/40',
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
    blob1: 'from-teal-400 to-emerald-600',
    blob2: 'from-cyan-400 to-teal-600',
    tagline: 'Le copilote de vos classes.',
    benefits: [
      { Icon: Zap, title: 'Saisie clavier', body: 'Grille de notes optimisée pour la vitesse.' },
      { Icon: Sparkles, title: 'Cahier de texte', body: 'Cours, devoirs et ressources, en un endroit.' },
      { Icon: ShieldCheck, title: 'Élèves à risque', body: 'Détection automatique, recommandations claires.' },
    ],
  },
  parent: {
    gradient: 'from-sky-400 via-blue-500 to-indigo-600',
    ring: 'focus-visible:ring-blue-500/40 focus-visible:border-blue-500',
    primaryText: 'text-blue-700',
    primaryHover: 'hover:text-blue-700',
    button: 'bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600 hover:shadow-blue-500/40',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    blob1: 'from-sky-400 to-blue-600',
    blob2: 'from-indigo-400 to-violet-600',
    tagline: 'Le suivi scolaire qui vous rapproche.',
    benefits: [
      { Icon: Zap, title: 'Temps réel', body: 'Les notes apparaissent dès leur publication.' },
      { Icon: ShieldCheck, title: 'Alertes explicables', body: 'Jamais alarmistes — toujours actionables.' },
      { Icon: Sparkles, title: 'App installable', body: 'PWA mobile, notifications natives.' },
    ],
  },
  // Student portal (E8) — a warm violet→indigo, the learner's own space.
  // Second-person, encouraging copy; never comparative.
  student: {
    gradient: 'from-violet-500 via-indigo-500 to-indigo-700',
    ring: 'focus-visible:ring-violet-500/40 focus-visible:border-violet-500',
    primaryText: 'text-violet-700',
    primaryHover: 'hover:text-violet-700',
    button: 'bg-gradient-to-br from-violet-500 via-indigo-600 to-indigo-700 hover:shadow-violet-500/40',
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
    blob1: 'from-violet-400 to-indigo-600',
    blob2: 'from-indigo-400 to-purple-600',
    tagline: 'Tes notes, ta progression, à toi.',
    benefits: [
      { Icon: Zap, title: 'Tes notes en direct', body: 'Dès qu’un professeur publie, tu la retrouves ici.' },
      { Icon: Sparkles, title: 'Matière par matière', body: 'Une vue claire de chaque matière, rien de comparatif.' },
      { Icon: ShieldCheck, title: 'Ton espace privé', body: 'Seulement tes données — jamais celles des autres.' },
    ],
  },
} as const;

export function AuthSplitLayout({
  portal,
  title,
  subtitle,
  children,
  bottomLinks,
}: {
  portal: PortalAccent;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  bottomLinks: { label: string; href: string }[];
}) {
  const p = portals[portal];

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-2">
      {/* LEFT — Form pane */}
      <div className="relative flex min-h-screen flex-col bg-white px-6 py-8 lg:min-h-0 lg:px-12 lg:py-12">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${p.gradient} text-lg font-bold text-white shadow-lg`}
            >
              P
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">
              Pilotage <span className="font-normal text-slate-500">scolaire</span>
            </span>
          </Link>

          <h1 className="mt-10 text-3xl font-bold tracking-tight text-slate-900 lg:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-slate-600 lg:text-base">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {bottomLinks.length > 0 && (
            <div className="mt-10 border-t border-slate-100 pt-6">
              <div className="text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                Autres portails
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
                {bottomLinks.map((op) => (
                  <Link
                    key={op.href}
                    href={op.href}
                    className="font-medium text-slate-500 transition hover:text-slate-900"
                  >
                    {op.label} →
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-md text-center text-xs text-slate-400">
          © 2026 Pilotage scolaire ·{' '}
          <a href="/legal/privacy" className="hover:text-slate-600">
            Confidentialité
          </a>{' '}
          ·{' '}
          <a href="/legal/terms" className="hover:text-slate-600">
            CGU
          </a>
        </div>
      </div>

      {/* RIGHT — Marketing pane (desktop only) */}
      <div
        className={`relative hidden overflow-hidden bg-gradient-to-br ${p.gradient} lg:flex lg:items-center lg:justify-center`}
      >
        {/* Decorative blobs */}
        <div className={`absolute -left-32 top-16 h-96 w-96 rounded-full bg-gradient-to-br ${p.blob1} opacity-40 blur-[120px]`} />
        <div className={`absolute -bottom-32 right-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br ${p.blob2} opacity-30 blur-[140px]`} />

        {/* Dotted overlay */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.2) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative z-10 max-w-md px-12 text-white">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Pilotage scolaire
          </div>
          <h2 className="mt-6 text-4xl font-bold leading-tight tracking-tight lg:text-5xl">{p.tagline}</h2>
          <p className="mt-5 text-base leading-relaxed text-white/80 lg:text-lg">
            Notes, tendances, alertes explicables, recommandations — pour chaque enfant, en temps réel.
          </p>

          <ul className="mt-10 space-y-5">
            {p.benefits.map((b) => (
              <li key={b.title} className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
                  <b.Icon className="h-5 w-5 text-white" strokeWidth={2} />
                </div>
                <div>
                  <div className="font-bold text-white">{b.title}</div>
                  <div className="mt-0.5 text-sm text-white/80">{b.body}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-12 flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
            <Check className="h-5 w-5 shrink-0 text-emerald-300" strokeWidth={3} />
            <p className="text-sm leading-relaxed text-white/90">
              Conforme RGPD enfants · WCAG 2.2 AA · MFA · Hébergement souverain.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function authButtonClass(portal: PortalAccent) {
  return portals[portal].button;
}
export function authRingClass(portal: PortalAccent) {
  return portals[portal].ring;
}
export function authPrimaryText(portal: PortalAccent) {
  return portals[portal].primaryText;
}
