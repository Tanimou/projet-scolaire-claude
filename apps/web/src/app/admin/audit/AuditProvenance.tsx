/**
 * Provenance client d'une entrée d'audit — **l'unique rendu** de ces deux
 * champs (`S-E04-3`, `ADR-036 D4`, `ux.md` §7).
 *
 * Module neutre, **jamais `'use client'`** : il est consommé par `AuditTable`
 * et `AuditDetailDrawer` (client) et doit rester appelable côté serveur. Voir
 * `audit-labels.ts` pour la règle et l'incident qui l'a produite (`PF-14`).
 *
 * ## Deux états, pas trois
 *
 * `ux.md` §7 en spécifiait trois, le troisième étant « provenance non
 * attribuable (requête relayée) ». Sous le design retenu par `S-E04-3`, cet
 * état est **inatteignable par construction** : l'API n'enregistre jamais
 * l'adresse d'un relais — quand elle ne peut rien établir, elle écrit `null`
 * (`D4`). Livrer un état impossible, c'est livrer une catégorie que le prochain
 * lecteur croira réelle. Il est donc supprimé, et la table de `ux.md` est
 * corrigée en conséquence plutôt que laissée en place.
 *
 * ## Les deux champs sont indépendants
 *
 * `ipAddress` nul avec un `userAgent` réel (ou l'inverse) est un état **normal**
 * — c'est même le cas attendu en local, où aucun relais L7 ne se trouve devant
 * Next et où aucune adresse client n'est donc transmissible. Chaque champ se
 * rend séparément ; jamais l'un derrière la condition de l'autre.
 *
 * ## Pourquoi pas de tiret cadratin
 *
 * Le `—` que ce composant remplace était ambigu entre « rien », « non
 * enregistré » et « sans objet ». C'est précisément l'ambiguïté que cette
 * tranche existe pour retirer : une case vide se lit comme un oubli d'affichage,
 * pas comme une propriété de la trace.
 *
 * ## Contraste (WCAG 2.2 AA — SC 1.4.3)
 *
 * `text-slate-400` sur blanc mesure **2,51:1** et échoue le seuil de 4,5:1 : il
 * est banni de cette surface. Les valeurs utilisent `text-slate-600` (7,57:1),
 * l'état d'absence `text-slate-500` (4,76:1). Aucune teinte d'alerte : une
 * provenance non enregistrée n'est pas une erreur, et la colorer comme telle
 * apprend à l'auditeur à l'ignorer. Chaque état porte une icône **et** des mots
 * (SC 1.4.1) ; les icônes sont `aria-hidden`, le texte porte le sens.
 */

import { CircleDashed, MapPin, Monitor } from 'lucide-react';

import { PROVENANCE_UNAVAILABLE, humanizeUserAgent } from './audit-labels';

export interface AuditProvenanceProps {
  ip: string | null;
  ua: string | null;
  /** `cell` : deux lignes compactes dans le tableau. `block` : bloc du tiroir. */
  variant?: 'cell' | 'block';
}

export function AuditProvenance({ ip, ua, variant = 'cell' }: AuditProvenanceProps) {
  const uaLabel = humanizeUserAgent(ua);

  if (!ip && !ua) {
    return (
      <p
        className={`inline-flex items-start gap-1.5 italic text-slate-500 ${
          variant === 'cell' ? 'mt-1 text-xs' : 'text-xs'
        }`}
      >
        <CircleDashed className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>{PROVENANCE_UNAVAILABLE}</span>
      </p>
    );
  }

  return (
    <div className={variant === 'cell' ? 'mt-1 space-y-0.5' : 'space-y-1'}>
      {ip ? (
        <p className="flex items-start gap-1.5 text-xs text-slate-600">
          <MapPin className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {/* `break-all` et jamais `truncate` : une IPv6 atteint 39 caractères
              et une adresse silencieusement rognée est une adresse fausse. */}
          <span className="break-all font-mono">{ip}</span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs italic text-slate-500">
          <CircleDashed className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>{PROVENANCE_UNAVAILABLE}</span>
        </p>
      )}
      {ua && (
        <p className="flex items-start gap-1.5 text-xs text-slate-600">
          <Monitor className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {/* Libellé court quand il est sûr, chaîne brute sinon — jamais une
              supposition présentée comme un fait. */}
          <span className={uaLabel ? '' : 'break-all font-mono'} title={uaLabel ? ua : undefined}>
            {uaLabel ?? ua}
          </span>
        </p>
      )}
    </div>
  );
}
