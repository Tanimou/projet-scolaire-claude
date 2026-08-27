/**
 * Fenêtre calendrier canonique (S-E03-8 / PF-40 / ADR-078).
 *
 * Ré-exporté par le barrel racine `@pilotage/contracts`. Il n'y a
 * DÉLIBÉRÉMENT pas d'entrée `exports` par sous-chemin dans
 * `packages/contracts/package.json` : `apps/api` est en
 * `moduleResolution: "Node"` (node10), qui IGNORE la table `exports`, et le
 * dépôt n'a aujourd'hui aucun import de sous-chemin `@pilotage/contracts/*`.
 * Tout le monde importe donc par le spécificateur nu.
 */
export * from './window';
