import {
  ArrowRight,
  Check,
  Bell,
  ShieldCheck,
  GraduationCap,
  Users,
  Lock,
  Globe2,
  Clock,
  Sparkles,
  TrendingUp,
  Zap,
  BarChart3,
  Calendar,
  MessageSquare,
  Award,
  Quote,
  Star,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

import { HomeTopNav } from './_components/HomeTopNav';

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <HomeTopNav />
      <Hero />
      <Stats />
      <Portals />
      <HowItWorks />
      <Features />
      <SocialProof />
      <Security />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ============================================================ */
/*                            HERO                               */
/* ============================================================ */
function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-white to-white">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(60%_50%_at_50%_30%,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(15 23 42 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.07) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      {/* Colorful glow blobs */}
      <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-blue-400/20 blur-[120px]" />
      <div className="absolute top-20 right-1/4 h-96 w-96 rounded-full bg-violet-400/20 blur-[120px]" />
      <div className="absolute top-60 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-400/15 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-6 pb-28 pt-20 lg:px-10 lg:pb-36 lg:pt-28">
        <div className="grid items-center gap-14 lg:grid-cols-12">
          <div className="space-y-7 lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold tracking-wide text-blue-700 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Nouvelle plateforme · Rentrée 2026
            </span>
            <h1 className="text-5xl font-bold leading-[1.02] tracking-tight text-slate-900 lg:text-7xl">
              Le suivi scolaire qui{' '}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 bg-clip-text text-transparent">
                  rapproche
                </span>
                <svg
                  className="absolute -bottom-2 left-0 w-full"
                  viewBox="0 0 300 12"
                  fill="none"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 8 C 80 2, 200 2, 298 8"
                    stroke="url(#underline)"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="underline" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgb(79 70 229)" />
                      <stop offset="50%" stopColor="rgb(37 99 235)" />
                      <stop offset="100%" stopColor="rgb(14 165 233)" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              <br />
              école et famille.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-600 lg:text-xl">
              Notes, tendances, alertes <strong className="font-semibold text-slate-900">explicables</strong>,
              recommandations d&apos;action — pour chaque enfant, en temps réel. Conçu pour les parents pressés, les
              professeurs exigeants et les administrations rigoureuses.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/parent/register"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl hover:shadow-blue-500/40"
              >
                Créer un compte famille
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#comment"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                Voir une démo
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100">
                  <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />
                </span>
                Conforme RGPD
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100">
                  <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />
                </span>
                WCAG 2.2 AA
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100">
                  <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />
                </span>
                Hébergement souverain
              </span>
            </div>
          </div>

          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}

function PhoneMockup() {
  return (
    <div className="relative lg:col-span-5">
      <div className="absolute -left-8 -top-8 h-44 w-44 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 opacity-25 blur-3xl" />
      <div className="absolute -bottom-12 -right-8 h-56 w-56 rounded-full bg-gradient-to-br from-violet-400 to-pink-400 opacity-25 blur-3xl" />

      <div className="absolute -left-4 top-32 hidden rotate-[-6deg] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur lg:block">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white">
            <TrendingUp className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Progression</div>
            <div className="font-mono text-sm font-bold tabular-nums text-emerald-700">+0.6 pts</div>
          </div>
        </div>
      </div>
      <div className="absolute -right-2 bottom-24 hidden rotate-[6deg] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur lg:block">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Alerte</div>
            <div className="text-sm font-bold text-slate-900">Maths · suivi</div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-[320px] rounded-[44px] bg-slate-900 p-3 shadow-2xl shadow-blue-900/40">
        <div className="overflow-hidden rounded-[36px] bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-xs font-bold text-white">
                L
              </span>
              <span className="font-semibold text-slate-900">
                Léa Martin <span className="text-slate-400">▾</span>
              </span>
            </div>
            <div className="relative">
              <Bell className="h-5 w-5 text-slate-500" />
              <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                2
              </span>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-5 text-white">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Moyenne globale</div>
              <div className="mt-1 flex items-end gap-2">
                <div className="font-mono text-4xl font-bold tabular-nums">13.4</div>
                <div className="pb-1.5 text-base opacity-70">/ 20</div>
                <div className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold backdrop-blur">
                  ↑ +0.6
                </div>
              </div>
              <div className="mt-1 text-xs opacity-80">vs trimestre précédent</div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100">
                  <Bell className="h-4 w-4 text-amber-700" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-900">2 alertes ouvertes</div>
                  <div className="mt-0.5 text-xs text-slate-600">Maths sous seuil · Anglais en baisse</div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Par matière</div>
              <div className="grid grid-cols-3 gap-2">
                <MiniSubject name="Maths" score="8.5" tone="warn" />
                <MiniSubject name="Français" score="14.0" tone="ok" />
                <MiniSubject name="Hist." score="15.0" tone="good" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniSubject({ name, score, tone }: { name: string; score: string; tone: 'warn' | 'good' | 'ok' }) {
  const styles = {
    warn: { card: 'border-amber-200 bg-amber-50', text: 'text-amber-700', label: 'baisse' },
    good: { card: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700', label: 'hausse' },
    ok: { card: 'border-slate-200 bg-white', text: 'text-slate-500', label: 'stable' },
  }[tone];
  return (
    <div className={`rounded-xl border p-2.5 ${styles.card}`}>
      <div className="text-[10px] font-semibold text-slate-600">{name}</div>
      <div className="font-mono text-base font-bold tabular-nums text-slate-900">{score}</div>
      <div className={`text-[10px] font-semibold ${styles.text}`}>{styles.label}</div>
    </div>
  );
}

/* ============================================================ */
/*                           STATS                               */
/* ============================================================ */
function Stats() {
  return (
    <section className="relative border-y border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="grid grid-cols-2 gap-y-8 lg:grid-cols-4">
          <Stat value="< 2s" label="Chargement dashboard parent" />
          <Stat value="99,5 %" label="Objectif de disponibilité" />
          <Stat value="WCAG 2.2 AA" label="Accessibilité de chaque écran" />
          <Stat value="0" label="Comparaison nominative entre élèves" />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="bg-gradient-to-br from-slate-900 to-slate-700 bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent lg:text-4xl">
        {value}
      </div>
      <div className="mt-1.5 text-xs font-medium text-slate-600 lg:text-sm">{label}</div>
    </div>
  );
}

/* ============================================================ */
/*                       THREE PORTALS                           */
/* ============================================================ */
function Portals() {
  return (
    <section id="produit" className="relative">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Trois espaces, un seul objectif
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 lg:text-5xl">
            Chaque acteur trouve son portail.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Les données circulent en temps réel; l&apos;expérience est adaptée à chaque rôle.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <PortalCard
            href="/admin/login"
            gradient="from-indigo-500 via-blue-600 to-blue-700"
            ringClass="ring-blue-100"
            bgIcon="from-indigo-50 to-blue-50"
            textColor="text-blue-700"
            label="Portail admin"
            title="Administrateur"
            description="Configurez l'établissement, validez les inscriptions, customisez les règles d'alerte et l'identité visuelle."
            features={['Hiérarchie complète', 'White-label & custom fields', 'Audit append-only']}
            Icon={Lock}
          />
          <PortalCard
            href="/teacher/login"
            gradient="from-teal-400 via-teal-500 to-emerald-600"
            ringClass="ring-teal-100"
            bgIcon="from-teal-50 to-emerald-50"
            textColor="text-teal-700"
            label="Portail enseignant"
            title="Professeur"
            description="Planifiez vos évaluations, saisissez vos notes, gérez présences et cahier de texte — sans friction."
            features={['Grille de saisie clavier', 'Cahier de texte & ressources', 'Élèves à risque automatiques']}
            Icon={GraduationCap}
          />
          <PortalCard
            href="/parent/login"
            gradient="from-sky-400 via-blue-500 to-indigo-600"
            ringClass="ring-sky-100"
            bgIcon="from-sky-50 to-blue-50"
            textColor="text-sky-700"
            label="Portail famille"
            title="Parent"
            description="Suivez l'évolution scolaire de votre enfant. Recevez des alertes claires avec une action recommandée."
            features={['Dashboard mobile temps réel', 'Alertes explicables, jamais alarmistes', 'App installable (PWA)']}
            Icon={Users}
          />
        </div>
      </div>
    </section>
  );
}

function PortalCard({
  href,
  gradient,
  ringClass,
  bgIcon,
  textColor,
  label,
  title,
  description,
  features,
  Icon,
}: {
  href: string;
  gradient: string;
  ringClass: string;
  bgIcon: string;
  textColor: string;
  label: string;
  title: string;
  description: string;
  features: string[];
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-sm ring-1 transition hover:-translate-y-1 hover:shadow-2xl ${ringClass}`}
    >
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${gradient}`} />
      <div className={`absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br ${gradient} opacity-[0.08]`} />

      <div className="relative flex items-center gap-3">
        <div className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${bgIcon} ring-1 ring-slate-200`}>
          <Icon className={`h-7 w-7 ${textColor}`} />
        </div>
        <div>
          <div className={`text-[11px] font-bold uppercase tracking-wider ${textColor}`}>{label}</div>
          <div className="mt-0.5 text-2xl font-bold text-slate-900">{title}</div>
        </div>
      </div>

      <p className="relative mt-5 text-sm leading-relaxed text-slate-600">{description}</p>

      <ul className="relative mt-6 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient}`}>
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
            {f}
          </li>
        ))}
      </ul>

      <div className={`relative mt-8 inline-flex items-center gap-1.5 text-sm font-bold transition-all group-hover:gap-2.5 ${textColor}`}>
        Accéder au portail
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}

/* ============================================================ */
/*                       HOW IT WORKS                            */
/* ============================================================ */
function HowItWorks() {
  return (
    <section id="comment" className="relative overflow-hidden bg-slate-950 text-white">
      <div
        className="absolute inset-0 opacity-30 [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-300">Comment ça marche</div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight lg:text-5xl">
            Trois rôles. Un seul flux. Aucune confusion.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Une donnée saisie une fois circule en temps réel jusqu&apos;aux bonnes personnes.
          </p>
        </div>

        <div className="relative mt-16">
          <div className="absolute left-0 right-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" />

          <div className="grid gap-8 md:grid-cols-3">
            <Step
              num="01"
              gradient="from-indigo-400 to-blue-500"
              actor="Admin"
              title="L'établissement se configure."
              body="Hiérarchie scolaire, matières, coefficients, calendrier, branding, règles d'alerte — en quelques minutes."
              Icon={Lock}
            />
            <Step
              num="02"
              gradient="from-teal-400 to-emerald-500"
              actor="Professeur"
              title="Les notes sont saisies et publiées."
              body="Grille clavier-friendly, brouillon, publication, révision historisée. Présences et cahier de texte intégrés."
              Icon={GraduationCap}
            />
            <Step
              num="03"
              gradient="from-sky-400 to-blue-500"
              actor="Parent"
              title="L'information arrive, en clair."
              body="Moyennes, tendances, alertes — avec une recommandation d'action concrète. Pas de jargon, pas de panique."
              Icon={Users}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({
  num,
  gradient,
  actor,
  title,
  body,
  Icon,
}: {
  num: string;
  gradient: string;
  actor: string;
  title: string;
  body: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="relative">
      <div className={`relative z-10 grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br ${gradient} shadow-xl shadow-blue-900/40`}>
        <Icon className="h-10 w-10 text-white" strokeWidth={1.7} />
      </div>
      <div className="mt-6">
        <div className="font-mono text-xs font-medium tabular-nums text-blue-300">
          {num} · {actor}
        </div>
        <h3 className="mt-2 text-xl font-bold text-white">{title}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-slate-400">{body}</p>
      </div>
    </div>
  );
}

/* ============================================================ */
/*                         FEATURES                              */
/* ============================================================ */
function Features() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Pourquoi Pilotage scolaire</div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 lg:text-5xl">
            Plus qu&apos;un carnet de notes — un copilote.
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            Icon={Zap}
            gradient="from-amber-400 to-orange-500"
            title="Alertes explicables"
            body="Chaque alerte cite la règle, les variables, et propose une action concrète. Jamais d'IA opaque sur les données d'enfants."
          />
          <FeatureCard
            Icon={BarChart3}
            gradient="from-violet-400 to-purple-600"
            title="Tendances en temps réel"
            body="Dès qu'une note est publiée, les moyennes pondérées et les tendances par matière se recalculent en secondes."
          />
          <FeatureCard
            Icon={Calendar}
            gradient="from-sky-400 to-blue-600"
            title="Cahier de texte intégré"
            body="Cours, devoirs, ressources, emploi du temps drag-drop — accessibles aux parents et exportables en .ics."
          />
          <FeatureCard
            Icon={ShieldCheck}
            gradient="from-emerald-400 to-teal-600"
            title="RGPD enfants by design"
            body="Minimisation des données, audit append-only, aucune comparaison nominative, MFA pour admins et profs."
          />
          <FeatureCard
            Icon={MessageSquare}
            gradient="from-pink-400 to-rose-600"
            title="Communications ciblées"
            body="Annonces par audience, notifications par préférence, digest configurable — sans fatigue de notifications."
          />
          <FeatureCard
            Icon={Sparkles}
            gradient="from-indigo-400 to-blue-600"
            title="100 % customizable"
            body="White-label, custom fields, custom rôles, custom règles d'alerte, templates bulletins — sans toucher au code."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  Icon,
  gradient,
  title,
  body,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  gradient: string;
  title: string;
  body: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-lg">
      <div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${gradient} opacity-[0.07] transition-opacity group-hover:opacity-[0.12]`} />
      <div className={`relative grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md`}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <h3 className="relative mt-4 text-base font-bold text-slate-900">{title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

/* ============================================================ */
/*                       SOCIAL PROOF                            */
/* ============================================================ */
function SocialProof() {
  return (
    <section className="border-y border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Pensé avec les écoles</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 lg:text-4xl">
              Conçu en dialogue avec direction, profs, et parents.
            </h2>
            <p className="mt-4 text-slate-600">
              Le cahier des charges a été construit avec des établissements pilotes. Chaque écran a été testé par des
              parents non-techniques avant d&apos;être validé.
            </p>
          </div>
          <div className="lg:col-span-7">
            <div className="relative rounded-3xl bg-white p-8 shadow-xl ring-1 ring-slate-200 lg:p-10">
              <Quote className="absolute -top-4 left-6 h-8 w-8 rounded-full bg-blue-600 p-1.5 text-white shadow-lg" />
              <div className="flex gap-0.5 text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-5 w-5 fill-current" />
                ))}
              </div>
              <p className="mt-4 text-lg italic leading-relaxed text-slate-800">
                « Pour la première fois, je ne découvre pas les difficultés de mon enfant en fin de trimestre. Je suis
                alertée en amont, avec une explication claire et une action concrète à essayer. »
              </p>
              <div className="mt-6 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-blue-600 font-bold text-white">
                  C
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Claire R.</div>
                  <div className="text-sm text-slate-500">Parente — école pilote</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ */
/*                          SECURITY                             */
/* ============================================================ */
function Security() {
  return (
    <section id="securite" className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white">
      <div className="absolute -left-32 top-32 h-96 w-96 rounded-full bg-blue-500/20 blur-[120px]" />
      <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-violet-500/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-10 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Sécurité & confidentialité
            </div>
            <h2 className="mt-4 text-4xl font-bold tracking-tight lg:text-5xl">
              Les données scolaires d&apos;un enfant méritent un soin particulier.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              Authentification à deux facteurs pour les professeurs et administrateurs. Chiffrement en transit et au
              repos. Audit append-only. Aucune comparaison nominative entre élèves.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white">
                <Award className="h-3.5 w-3.5 text-amber-300" />
                OWASP ASVS niveau 2
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white">
                <Award className="h-3.5 w-3.5 text-amber-300" />
                WCAG 2.2 AA
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white">
                <Award className="h-3.5 w-3.5 text-amber-300" />
                ISO 27001 ready
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Pillar Icon={Lock} title="MFA obligatoire" subtitle="Admin & enseignants" gradient="from-amber-400 to-orange-500" />
            <Pillar Icon={Globe2} title="Hébergement souverain" subtitle="UE par défaut" gradient="from-sky-400 to-blue-600" />
            <Pillar Icon={ShieldCheck} title="RGPD enfants" subtitle="Minimisation des données" gradient="from-emerald-400 to-teal-600" />
            <Pillar Icon={Clock} title="Audit append-only" subtitle="Traçabilité complète" gradient="from-violet-400 to-purple-600" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pillar({
  Icon,
  title,
  subtitle,
  gradient,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  subtitle: string;
  gradient: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:bg-white/10">
      <div className={`absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br ${gradient} opacity-20 blur-2xl transition-opacity group-hover:opacity-40`} />
      <div className={`relative grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>
        <Icon className="h-5 w-5 text-white" strokeWidth={1.9} />
      </div>
      <div className="relative mt-4 font-bold text-white">{title}</div>
      <div className="relative mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}

/* ============================================================ */
/*                       FINAL CTA                               */
/* ============================================================ */
function FinalCta() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-8 py-14 text-center shadow-2xl lg:px-16 lg:py-20">
          <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-violet-400/30 blur-3xl" />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.15) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          />
          <h2 className="relative text-4xl font-bold tracking-tight text-white lg:text-5xl">
            Prêt à rapprocher école et famille ?
          </h2>
          <p className="relative mx-auto mt-4 max-w-2xl text-lg text-blue-100">
            Créez votre compte famille en moins d&apos;une minute, ou demandez l&apos;accès professionnel pour votre
            établissement.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/parent/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-blue-700 shadow-lg transition hover:bg-blue-50"
            >
              Créer un compte famille
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/admin/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              Espace professionnel
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ */
/*                           FOOTER                              */
/* ============================================================ */
function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-blue-600 to-blue-700 text-base font-bold text-white shadow-lg shadow-blue-500/30">
                P
              </span>
              <span className="text-base font-bold text-slate-900">Pilotage scolaire</span>
            </Link>
            <p className="mt-4 max-w-sm text-sm text-slate-600">
              Le suivi scolaire qui rapproche école et famille. Conçu pour donner aux parents la visibilité dont ils ont
              besoin, sans surcharger les professeurs.
            </p>
          </div>
          <FooterCol
            title="Produit"
            links={[
              ['Fonctionnalités', '#produit'],
              ['Comment ça marche', '#comment'],
              ['Sécurité', '#securite'],
              ['Tarifs', '/pricing'],
            ]}
          />
          <FooterCol
            title="Portails"
            links={[
              ['Famille', '/parent/login'],
              ['Professeur', '/teacher/login'],
              ['Administrateur', '/admin/login'],
            ]}
          />
          <FooterCol
            title="Légal"
            links={[
              ['Confidentialité', '/legal/privacy'],
              ['CGU', '/legal/terms'],
              ['Cookies', '/legal/cookies'],
              ['Contact', '/contact'],
            ]}
          />
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 md:flex-row">
          <span>© 2026 Pilotage scolaire. Tous droits réservés.</span>
          <span>Conçu et hébergé en Europe · Made in France</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-slate-900">{title}</div>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-sm text-slate-600 transition hover:text-slate-900">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
