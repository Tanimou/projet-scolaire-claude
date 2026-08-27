import { ArrowRight } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { subjectColor } from '../lib/subject-color';

import type { KpiState } from './KpiCard';

export interface SubjectKpiCardProps {
  /** Canonical subject code or free-form name (e.g. 'MATH', 'Mathématiques') */
  subjectCode: string;
  /** Display label (defaults to the resolved subject's canonical name) */
  label: string;
  /** Optional icon, drawn in a translucent circle */
  icon?: ComponentType<{ className?: string }>;
  /** Primary count line (e.g. classes) */
  classCount?: number;
  /** Secondary count line (e.g. students) */
  studentCount?: number;
  /**
   * Ce que les compteurs comptent, en une phrase — leur **portée**.
   *
   * Cette carte était la seule surface KPI du produit à afficher un nombre
   * d'élèves sans aucun moyen de dire *lesquels*. Deux cartes voisines peuvent
   * répondre à deux questions différentes — « l'effectif d'UNE classe » et
   * « les élèves DISTINCTS sur un ENSEMBLE de classes » ne sont pas le même
   * nombre dès qu'un élève suit deux des classes de l'enseignant. Sans la
   * portée, le lecteur ne peut pas savoir laquelle il lit, et deux pages à un
   * clic d'écart se contredisent sans que rien ne le signale.
   *
   * Rendue sous les compteurs, toujours visible, elle **enveloppe** et ne
   * tronque jamais — une portée coupée est une portée FAUSSE. Jamais un
   * tooltip (invisible au doigt, peu fiable pour les technologies
   * d'assistance) : c'est la règle déjà posée sur {@link KpiCard}. Viser ~90
   * caractères pour tenir en 3 lignes sur une carte de 320 px.
   */
  scope?: ReactNode;
  /**
   * État de la mesure. Voir {@link KpiState}. Par défaut `measured`.
   *
   * Quand l'état n'est pas `measured`, **aucun compteur n'est rendu** : un `0`
   * affiché après une lecture ratée n'est pas une valeur par défaut, c'est une
   * affirmation inventée sur une classe (« personne n'y est inscrit »).
   */
  state?: KpiState;
  /** Optional href + label for the drilldown link */
  href?: string;
  hrefLabel?: string;
  className?: string;
}

const STATE_WORD: Record<Exclude<KpiState, 'measured'>, string> = {
  'not-instrumented': 'Non instrumenté',
  unavailable: 'Indisponible',
};

/**
 * SubjectKpiCard — image 6 prescriptive.
 * Gradient subject-coloured KPI card used in Teacher dashboard.
 *
 * ## Lisibilité du chiffre
 *
 * Le texte est posé sur un dégradé de matière. L'encre n'est donc pas « blanc »
 * par convention : elle est **dérivée** par mesure WCAG du stop le plus
 * défavorable du dégradé (`subjectColor().onGradient`). Sur les matières
 * claires — ESP jaune, EPS citron vert, GEO ambre — le blanc tombait autour de
 * 1,5-2:1, deux à trois fois sous le seuil AA ; l'encre ardoise y monte à
 * 7-11:1.
 *
 * Aucune opacité n'est appliquée au texte : `text-white/85` ne rendait pas la
 * carte plus élégante, il retirait ~15 % du contraste du chiffre qui est la
 * raison d'être de la carte.
 */
export function SubjectKpiCard({
  subjectCode,
  label,
  icon: Icon,
  classCount,
  studentCount,
  scope,
  state = 'measured',
  href,
  hrefLabel = 'Voir les classes →',
  className,
}: SubjectKpiCardProps) {
  const color = subjectColor(subjectCode);
  // Narrowing direct sur la condition (et non via un alias booléen) : le mot
  // d'état est résolu une fois, ici, et `null` signifie « il y a un chiffre ».
  const stateWord = state === 'measured' ? null : STATE_WORD[state];
  const measured = stateWord === null;
  const unavailable = state === 'unavailable';
  const onDark = color.onGradient === 'light';

  // Une seule décision d'encre, appliquée partout sur la carte : titre,
  // compteurs, portée, pastille d'icône et lien. Deux encres sur une même carte
  // seraient un second choix à maintenir.
  const inkText = onDark ? 'text-white' : 'text-slate-900';
  const inkPlate = onDark ? 'bg-white/20 text-white' : 'bg-slate-900/10 text-slate-900';
  const inkOutline = onDark ? 'focus-visible:outline-white' : 'focus-visible:outline-slate-900';

  const stats: string[] = [];
  if (measured) {
    if (classCount !== undefined) stats.push(`${classCount} classe${classCount > 1 ? 's' : ''}`);
    if (studentCount !== undefined) stats.push(`${studentCount} élève${studentCount > 1 ? 's' : ''}`);
  }

  const inner = (
    <>
      <div className="flex items-start gap-3">
        {Icon && (
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl backdrop-blur',
              inkPlate,
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate text-base font-bold', inkText)}>{label}</h3>
          {measured ? (
            stats.length > 0 && (
              // `tabular-nums` sans passer en `font-mono` : la ligne est
              // surtout du texte (« 3 classes · 46 élèves »), seuls les
              // chiffres doivent cesser de gigoter d'une carte à l'autre.
              <p className={cn('mt-1 text-xs tabular-nums', inkText)}>
                {stats.join(' · ')}
              </p>
            )
          ) : (
            // Un mot d'état n'est pas un chiffre : ni chiffres tabulaires, ni
            // animation. La couleur ne porte jamais seule l'information
            // (SC 1.4.1) — le mot l'écrit en toutes lettres.
            <p className={cn('mt-1 text-xs font-semibold', inkText)}>{stateWord}</p>
          )}
        </div>
      </div>
      {scope !== undefined && (
        // `break-words`, jamais `truncate` : cf. le docblock de `scope`.
        <p data-slot="kpi-scope" className={cn('mt-2 break-words text-xs leading-snug', inkText)}>
          {scope}
        </p>
      )}
      {href && (
        <span
          className={cn(
            'mt-4 inline-flex items-center gap-1.5 text-xs font-semibold transition-transform group-hover:translate-x-0.5',
            inkText,
          )}
        >
          {hrefLabel.replace(' →', '')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
    </>
  );

  const baseClass = cn(
    'group density-card relative flex flex-col rounded-2xl bg-gradient-to-br shadow-md transition-transform hover:-translate-y-0.5',
    color.gradient,
    inkText,
    // Une mesure absente se voit avant d'être lue — mais l'anneau ne dit jamais
    // rien tout seul, le mot d'état est là pour ça.
    unavailable && 'ring-2 ring-amber-300',
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        // Le survol soulève la carte : ce n'est pas un signal de focus. Sans
        // anneau explicite, un utilisateur au clavier ne sait pas où il est
        // (SC 2.4.7) ; `outline` + `outline-offset` restent visibles même si un
        // parent découpe (SC 2.4.11).
        className={cn(
          baseClass,
          'focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2',
          inkOutline,
        )}
        data-subject={color.code}
        data-state={state}
      >
        {inner}
      </a>
    );
  }
  return (
    <article className={baseClass} data-subject={color.code} data-state={state}>
      {inner}
    </article>
  );
}
