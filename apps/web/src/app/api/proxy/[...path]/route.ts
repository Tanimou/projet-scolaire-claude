import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * Thin proxy route — forwards client-side fetches to the NestJS API with the
 * NextAuth-issued access_token attached. Used by TopbarBell + future polling
 * client components that can't call the server-only `api()` helper.
 *
 * Security: only forwards the user's own bearer token; does not allow
 * arbitrary header injection from the client.
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
