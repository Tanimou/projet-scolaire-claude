import { buildManifestPayload } from '@pilotage/contracts';
import { NextResponse } from 'next/server';

/**
 * Manifeste de release du web (S-E02-10 / PF-68, risque R-05).
 *
 * L'image du web porte un `GIT_SHA` gravé au build depuis `S-E02-6`, mais rien ne
 * pouvait le lire : la gate n'interrogeait que l'API. Or c'est l'artefact web que
 * les utilisateurs voient — une dérive y est exactement le mode de panne de
 * `PF-62` (sept semaines pendant lesquelles le code audité n'était pas le code
 * qui tournait, sans que rien ne le signale).
 *
 * Le chemin est `/version/web` et non `/version` : cette dernière route est
 * réservée à l'API par nginx (`location = /version`), et le web est le
 * `location /` fourre-tout. Le champ `app` rend la confusion de routage
 * détectable dans les deux sens.
 *
 * `force-dynamic` est obligatoire : pré-rendu au build, le manifeste figerait le
 * SHA du build de page au lieu de lire l'environnement du conteneur — il
 * décrirait un artefact au lieu de l'artefact qui tourne.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(buildManifestPayload('web'), {
    // Un manifeste mis en cache décrirait l'artefact précédent, soit exactement
    // l'erreur que ce contrôle existe pour détecter.
    headers: { 'Cache-Control': 'no-store' },
  });
}
