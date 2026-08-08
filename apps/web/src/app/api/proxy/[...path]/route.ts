import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { clientProvenanceHeaders } from '@/lib/client-provenance';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * Thin proxy route — forwards client-side fetches to the NestJS API with the
 * NextAuth-issued access_token attached. Used by TopbarBell + future polling
 * client components that can't call the server-only `api()` helper.
 *
 * Security: only forwards the user's own bearer token; does not allow
 * arbitrary header injection from the client.
 *
 * **Second seam (`PF-128`, S-E04-3).** La table de contexte d'`ADR-036` ne
 * nomme que `lib/api-client.ts` comme seam serveur d'`apps/web`. C'est
 * mesurablement faux : cette route en est un second, et c'est **celui que les
 * composants client des portails enseignant et parent empruntent**. Un
 * correctif à un seul seam laisserait chaque écriture auditée déclenchée depuis
 * un composant client sans provenance, définitivement et silencieusement.
 *
 * Ici la requête entrante vient **directement du navigateur** : ses
 * `x-forwarded-for` / `x-real-ip` sont sous contrôle de l'appelant. C'est
 * précisément pourquoi l'extraction est déléguée au helper partagé, qui les lit
 * sous un nombre de sauts épinglé — et pourquoi la ligne de commentaire
 * ci-dessus (« does not allow arbitrary header injection from the client »)
 * devient porteuse : l'enregistrement sortant est **reconstruit** à partir de
 * valeurs analysées, aucun en-tête client n'est repassé tel quel.
 */

async function forward(req: NextRequest, path: string[]) {
  const session = await auth();
  if (!session?.user || !session.accessToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const search = req.nextUrl.search ?? '';
  const url = `${API_URL}/api/${path.join('/')}${search}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    Accept: 'application/json',
  };
  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = await req.text();
  }
  // Appliquée en dernier, sur un enregistrement construit ici : rien de ce que
  // le client a envoyé ne peut atteindre l'API sous un nom `x-pilotage-*`.
  Object.assign(headers, clientProvenanceHeaders(req.headers));
  const upstream = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return forward(req, params.path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return forward(req, params.path);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return forward(req, params.path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const params = await ctx.params;
  return forward(req, params.path);
}
