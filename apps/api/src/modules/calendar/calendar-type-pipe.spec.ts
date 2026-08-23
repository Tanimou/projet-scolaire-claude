import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { CalendarEventType } from '@prisma/client';

import { CalendarController } from './calendar.controller';

/**
 * S-E05-17 / AC-4 / ADR-067 §D2 — SITE 2, prouvé EN EXÉCUTANT le pipe.
 *
 * `@Query('type') type?: CalendarEventType` était une annotation EFFACÉE à
 * l'exécution : la chaîne brute atteignait `where.type` et Prisma répondait 500
 * (mesuré sur la pile locale). Le pipe rend 400.
 *
 * LE CAS ABSENT EST LE PLUS IMPORTANT. Les cinq appelants réels de
 * `/api/v1/calendar/events` (admin, teacher x2, parent x2) n'envoient AUCUN
 * `type` — le filtre par type de l'admin est entièrement CÔTÉ CLIENT
 * (`CalendarManager.tsx` filtre un tableau déjà chargé). Une régression sur
 * `type` absent serait donc une panne sur trois portails, pas un détail.
 */

const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

type RouteArg = { index: number; data?: unknown; pipes?: unknown[] };
type Pipe = { transform: (value: unknown, metadata: unknown) => Promise<unknown> };

function pipeForParam(ctor: object, method: string, data: string): Pipe {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, ctor, method) as
    | Record<string, RouteArg>
    | undefined;
  if (!args) throw new Error(`aucune métadonnée de route sur ${method}`);
  const slots = Object.values(args).filter((a) => a.data === data);
  const [slot] = slots;
  if (slots.length !== 1 || slot === undefined) {
    throw new Error(
      `attendu EXACTEMENT un slot de route pour '${data}' sur ${method}, vu ${slots.length} — ` +
        '« je ne peux pas dire » n’est jamais un PASS (DNC-08).',
    );
  }
  const pipes = (slot.pipes ?? []) as Pipe[];
  const [pipe] = pipes;
  if (pipes.length !== 1 || pipe === undefined) {
    throw new Error(
      `le paramètre '${data}' de ${method} porte ${pipes.length} pipe(s) — attendu 1.`,
    );
  }
  return pipe;
}

const TYPE_METADATA = { type: 'query', data: 'type', metatype: String };
const pipe = () => pipeForParam(CalendarController, 'list', 'type');

describe('AC-4 — `?type` est validé contre l’enum Prisma lui-même', () => {
  it('un pipe est monté sur le paramètre `type` lui-même', () => {
    expect(typeof pipe().transform).toBe('function');
  });

  it('l’allowlist est l’enum Prisma ENTIER — 7 valeurs, aucune liste jumelle créée', () => {
    // ADR-067 §D0 : la route accepte exactement l'enum et aucun consommateur
    // inter-paquet n'existe, donc pas de `CALENDAR_EVENT_TYPE` dans les
    // contrats. Le plancher est un garde-fou de dérivation vacante.
    expect(Object.keys(CalendarEventType)).toHaveLength(7);
  });

  it.each(Object.values(CalendarEventType))('accepte la valeur valide `%s`', async (value) => {
    await expect(pipe().transform(value, TYPE_METADATA)).resolves.toBe(value);
  });

  it('refuse une valeur inconnue en 400 — c’était un 500 nu, mesuré', async () => {
    const error = (await pipe()
      .transform('not_a_type', TYPE_METADATA)
      .catch((e: BadRequestException) => e)) as BadRequestException;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
  });

  it('laisse passer `type` ABSENT — le seul cas que tout appelant réel exerce', async () => {
    // `{ optional: true }` ne saute QUE `undefined`/`null`.
    await expect(pipe().transform(undefined, TYPE_METADATA)).resolves.toBeUndefined();
    await expect(pipe().transform(null, TYPE_METADATA)).resolves.toBeNull();
  });

  it('refuse `?type=` (présent mais VIDE) en 400 — changement DÉLIBÉRÉ, il rendait 200', async () => {
    // La chaîne vide n'est pas `nil`, donc `{ optional: true }` ne la saute pas.
    // Aucun appelant ne l'envoie aujourd'hui (le filtre admin est client-side),
    // et ADR-067 §D2 impose que le sentinelle « Tous les types » OMETTE le
    // paramètre le jour où le filtre passera côté serveur. Aucune couche de
    // normalisation n'est ajoutée pour préserver l'ancien 200.
    await expect(pipe().transform('', TYPE_METADATA)).rejects.toBeInstanceOf(BadRequestException);
  });
});
