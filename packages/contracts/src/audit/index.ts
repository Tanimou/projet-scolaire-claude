/**
 * Vocabulaire d'audit partagé — barrel de ré-export uniquement.
 *
 * La déclaration vit dans `vocabulary.ts`, la résolution dans `labels.ts`,
 * la résolution des bornes de fenêtre dans `window.ts`. Ce fichier ne déclare
 * rien : il est la seule surface d'export du module (S-E04-4, ADR-037).
 */

export * from './vocabulary';
export * from './labels';
export * from './window';
