/**
 * Marqueur de vocabulaire — « Format hérité » / « Code non répertorié ».
 *
 * **Module neutre, jamais `'use client'`** (PF-14 / S-E04-2) : il est rendu
 * depuis `page.tsx` (serveur, pour les options de facette) *et* depuis
 * `AuditTable` / `AuditDetailDrawer` (client).
 *
 * Ce qu'il n'est pas :
 *  - **Pas une alerte.** Ces lignes sont plus anciennes que le vocabulaire, pas
 *    suspectes : ardoise neutre, aucun ambre, aucun `AlertTriangle`, aucune
 *    animation. Une surface de gouvernance rapporte, elle ne bouge pas.
 *  - **Pas un remplacement.** La valeur brute et le libellé restent visibles à
 *    côté ; le marqueur ne re-libelle rien, ne masque rien, ne range rien dans
 *    un seau générique (DNC-08).
 *  - **Pas interactif.** Un `<span>` avec du texte visible — pas d'infobulle
 *    `title` (invisible au toucher, peu fiable pour les lecteurs d'écran), pas
 *    de bouton. Aucune obligation de cible 24 × 24 px n'entre donc en jeu.
 *
 * Contrastes mesurés : `slate-600` sur `slate-100` = **6.92:1** (AA ✓).
 * Ne pas substituer `slate-500` (4.35:1, échoue) ni `slate-400` (2.51:1).
 */

import { Braces, FileClock } from 'lucide-react';

import type { AuditVocabularyKind } from './audit-labels';
import { auditVocabularyMarker } from './audit-labels';

export function VocabularyMarker({
  vocabulary,
  className = '',
}: {
  vocabulary: AuditVocabularyKind;
  className?: string;
}) {
  const marker = auditVocabularyMarker(vocabulary);
  if (!marker) return null;
  const Icon = vocabulary === 'legacy' ? FileClock : Braces;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 ${className}`}
    >
      {/* L'icône est décorative : c'est le texte qui porte le sens (SC 1.4.1). */}
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {marker}
    </span>
  );
}
