import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { NOTIFICATION_KIND } from '@pilotage/contracts';
import type { NotificationKind } from '@prisma/client';

import { NotificationPreferencesController } from './preferences.controller';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_DESCRIPTION,
  NOTIFICATION_KIND_LABEL,
  WITHHELD_NOTIFICATION_KINDS,
  NotificationPreferencesService,
} from './preferences.service';

/**
 * S-E05-17 / AC-1..AC-3 / ADR-067 §D1 — SITE 1, prouvé EN EXÉCUTANT le pipe.
 *
 * Un 400 tout seul ne distingue pas un refus de PIPE d'un refus de SERVICE, et
 * c'est la phase pipe qui est la revendication. Ce fichier lit donc les
 * métadonnées de route pour trouver le pipe monté sur LE paramètre `kind`, le
 * fait tourner, et vérifie qu'aucun faux Prisma et aucun `ensureUser` n'a bougé.
 *
 * PORTÉE HONNÊTE : Nest ordonne guards -> pipes -> handler, et
 * `PermissionsGuard` lit la base AVANT tout pipe. La revendication est donc
 * « avant le corps du handler et avant `ensureUser` », jamais « avant toute
 * lecture SQL ».
 */

const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

type RouteArg = { index: number; data?: unknown; pipes?: unknown[] };
type Pipe = { transform: (value: unknown, metadata: unknown) => Promise<unknown> };

/** Le pipe monté sur LE paramètre de route nommé `data`, jamais « un pipe quelque part ». */
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
      `le paramètre '${data}' de ${method} porte ${pipes.length} pipe(s) — attendu 1. ` +
        'Un 400 sans pipe monté SUR CE paramètre ne prouverait pas la phase pipe.',
    );
  }
  return pipe;
}

const KIND_METADATA = { type: 'param', data: 'kind', metatype: String };

/** Faux Prisma / faux UserSync qui COMPTENT — la preuve du « rien n’a bougé ». */
function makeFakes() {
  const calls: string[] = [];
  const row = {
    kind: 'alert' as NotificationKind,
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    cadence: 'instant' as const,
  };
  const prisma = {
    notificationPreference: {
      findUnique: async () => {
        calls.push('prisma.findUnique');
        return null;
      },
      upsert: async () => {
        calls.push('prisma.upsert');
        return row;
      },
    },
  };
  const users = {
    ensureUser: async () => {
      calls.push('ensureUser');
      return { id: 'user-1', tenantId: 'tenant-1' };
    },
  };
  const service = new NotificationPreferencesService(
    prisma as unknown as ConstructorParameters<typeof NotificationPreferencesService>[0],
  );
  const controller = new NotificationPreferencesController(
    service,
    users as unknown as ConstructorParameters<typeof NotificationPreferencesController>[1],
  );
  return { calls, controller };
}

describe('AC-3 — l’allowlist existe exactement UNE fois', () => {
  it('`NOTIFICATION_KINDS` EST `NOTIFICATION_KIND` — une liste, pas deux', () => {
    // Identité référentielle, pas égalité de contenu : deux tableaux au même
    // contenu seraient déjà la dérive de listes jumelles que cette tranche ferme.
    expect(NOTIFICATION_KINDS).toBe(NOTIFICATION_KIND as ReadonlyArray<NotificationKind>);
  });

  it('épingle le 8-uplet ORDONNÉ — l’ordre est celui de la page Réglages, pas un ensemble', () => {
    // Une assertion par `Set` passerait pendant que l'UI se réordonne en
    // silence : `listForUser` mappe sur cette liste.
    expect([...NOTIFICATION_KINDS]).toEqual([
      'announcement',
      'alert',
      'grade_published',
      'enrollment_status',
      'lesson_published',
      'system',
      'message',
      'weekly_digest',
    ]);
  });

  it('n’est pas VIDE et n’est pas `undefined` — le piège du `dist` périmé, avec un fil de détente', () => {
    // `@pilotage/contracts` résout ses TYPES depuis `src` et son RUNTIME depuis
    // `dist`. Un `dist` périmé rendrait `NOTIFICATION_KIND` `undefined`, et
    // `new ParseEnumPipe(undefined)` jette à la CONSTRUCTION de la route : panne
    // de démarrage sur quatre portails, typecheck vert. Cette assertion est le
    // fil de détente exécuté que le commentaire seul ne fournissait pas.
    expect(Array.isArray(NOTIFICATION_KINDS)).toBe(true);
    expect(NOTIFICATION_KINDS.length).toBe(8);
  });

  it('les cartes libellé/description restent EXHAUSTIVES sur l’enum Prisma (9), non rétrécies', () => {
    expect(Object.keys(NOTIFICATION_KIND_LABEL)).toHaveLength(9);
    expect(Object.keys(NOTIFICATION_KIND_DESCRIPTION)).toHaveLength(9);
  });

  it('la SOUSTRACTION dérivée vaut exactement `remediation` — une 10e valeur Prisma force une décision', () => {
    // C'est le contre-sens de `ReadonlyArray<NotificationKind>`, qui ne prouve
    // que l'inclusion contrat -> Prisma. Une valeur Prisma ajoutée puis oubliée
    // apparaît ici et rend ce test ROUGE : exposer, ou retenir sciemment.
    expect([...WITHHELD_NOTIFICATION_KINDS]).toEqual(['remediation']);
  });
});

describe('AC-1 — le refus a lieu en PHASE PIPE, sur LE paramètre `kind`', () => {
  const pipe = () => pipeForParam(NotificationPreferencesController, 'update', 'kind');

  it('un pipe est monté sur le paramètre `kind` lui-même', () => {
    expect(pipe()).toBeDefined();
    expect(typeof pipe().transform).toBe('function');
  });

  it('refuse `not_a_kind` en 400 — c’était un 500 nu, mesuré sur la pile locale', async () => {
    await expect(pipe().transform('not_a_kind', KIND_METADATA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const error = await pipe()
      .transform('not_a_kind', KIND_METADATA)
      .catch((e: BadRequestException) => e);
    expect((error as BadRequestException).getStatus()).toBe(400);
  });

  it('ni Prisma ni `ensureUser` n’ont bougé sur le chemin refusé — un 400 seul ne le prouverait pas', async () => {
    const { calls } = makeFakes();
    await expect(pipe().transform('not_a_kind', KIND_METADATA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(calls).toEqual([]);
  });

  it('CONTRÔLE POSITIF : sur un kind valide, les mêmes faux ENREGISTRENT bien', async () => {
    // Sans lui, « zéro appel » est vrai d'un espion cassé aussi bien que d'un
    // refus en phase pipe.
    const { calls, controller } = makeFakes();
    const kind = (await pipe().transform('alert', KIND_METADATA)) as NotificationKind;
    await controller.update(kind, {}, {} as never);
    expect(calls).toContain('ensureUser');
    expect(calls).toContain('prisma.upsert');
  });
});

describe('AC-1 — le message est FRANÇAIS, terminal, et ne fuit rien', () => {
  const pipe = () => pipeForParam(NotificationPreferencesController, 'update', 'kind');
  const messageFor = async (value: string) => {
    const error = (await pipe()
      .transform(value, KIND_METADATA)
      .catch((e: BadRequestException) => e)) as BadRequestException;
    return (error.getResponse() as { message: string }).message;
  };

  it('rend la phrase française exacte, pas le défaut anglais du pipe', async () => {
    // `api-client.ts` restitue les corps d'`ApiError` TELS QUELS et
    // `PreferencesPanel.tsx` les rend bruts dans une bannière `role="alert"`
    // suivie de « réessayez » — conseil FAUX pour un 400 sur enum inconnu.
    expect(await messageFor('not_a_kind')).toBe('Type de notification inconnu.');
  });

  it('n’ÉCHOTE pas la valeur reçue — pas d’entrée non validée dans une région `role="alert"`', async () => {
    expect(await messageFor('<script>x</script>')).not.toContain('script');
  });

  it('n’ÉNUMÈRE pas les valeurs valides — le pipe n’est pas un oracle', async () => {
    const message = await messageFor('not_a_kind');
    for (const kind of NOTIFICATION_KINDS) expect(message).not.toContain(kind);
  });
});

describe('AC-2 — l’ensemble accepté est l’ensemble EXPOSÉ, pas l’enum Prisma (PF-314)', () => {
  const pipe = () => pipeForParam(NotificationPreferencesController, 'update', 'kind');

  it('refuse `remediation` en 400 — il rendait 200 et écrivait une ligne invisible', async () => {
    // `listForUser` mappe sur `NOTIFICATION_KINDS`, donc GET /preferences ne
    // renvoie JAMAIS `remediation` : la ligne écrite n'était ni visible ni
    // annulable par l'utilisateur.
    expect(NOTIFICATION_KIND_LABEL.remediation).toBeDefined();
    await expect(pipe().transform('remediation', KIND_METADATA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([...NOTIFICATION_KINDS])('accepte le kind exposé `%s`', async (kind) => {
    await expect(pipe().transform(kind, KIND_METADATA)).resolves.toBe(kind);
  });

  it('refuse aussi la chaîne VIDE et une casse différente — aucune indulgence implicite', async () => {
    await expect(pipe().transform('', KIND_METADATA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe().transform('ALERT', KIND_METADATA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
