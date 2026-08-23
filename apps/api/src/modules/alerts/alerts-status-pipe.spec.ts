import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { ALERT_STATUS } from '@pilotage/contracts';
import type { AlertStatus } from '@prisma/client';

import { AlertsController } from './alerts.controller';

/**
 * S-E05-17 / AC-5 / ADR-067 §D3 — SITE 3, le DÉFAUT DE VÉRITÉ.
 *
 * Ce n'était pas seulement un défaut de validation. `?status=not_a_status`
 * retombait sur `undefined`, donc AUCUN filtre, donc la liste COMPLÈTE rendue en
 * 200 (mesuré) : l'admin lisait des alertes `resolved` et `dismissed` sous un
 * en-tête « Ouvertes ». Un élargissement silencieux d'une projection de LECTURE.
 *
 * G-TRUTH exige la comparaison sur le chemin VALIDE, pas seulement un 400 sur le
 * chemin invalide : ce fichier rejoue l'ANCIENNE logique (le ternaire écrit à la
 * main, reproduit ici comme oracle de référence) contre la NOUVELLE sur la même
 * fixture, et exige les MÊMES lignes pour les quatre statuts valides et pour le
 * cas absent.
 *
 * Note sur le pire cas résiduel, dit plutôt que glissé sous le tapis :
 * `admin/alerts/page.tsx` enveloppe ses quatre `fetch` dans `safe(...)` avec un
 * repli `?? []`, donc un 400 s'y afficherait comme un onglet VIDE, sans
 * bannière. C'est le bon compromis : le défaut d'aujourd'hui est un écran de
 * MAUVAISES données, l'après est au pire un écran SANS données.
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

const STATUS_METADATA = { type: 'query', data: 'status', metatype: String };
const pipe = () => pipeForParam(AlertsController, 'listInstances', 'status');

/* ------------------------------------------------------------------ *
 * La FIXTURE partagée + les deux implémentations comparées
 * ------------------------------------------------------------------ */

const FIXTURE = [
  { id: 'a1', status: 'open' as AlertStatus },
  { id: 'a2', status: 'open' as AlertStatus },
  { id: 'a3', status: 'acknowledged' as AlertStatus },
  { id: 'a4', status: 'resolved' as AlertStatus },
  { id: 'a5', status: 'dismissed' as AlertStatus },
];

/** Le service, réduit à sa seule projection : filtre si `status`, sinon TOUT. */
const listInstances = (status: AlertStatus | undefined) =>
  status === undefined ? FIXTURE : FIXTURE.filter((r) => r.status === status);

/**
 * L'ANCIENNE logique, reproduite VERBATIM depuis le diff — le ternaire écrit à
 * la main, littéral de quatre valeurs compris. C'est l'oracle « avant ».
 */
function legacyResolve(statusRaw: string | undefined): AlertStatus | undefined {
  return statusRaw && ['open', 'acknowledged', 'resolved', 'dismissed'].includes(statusRaw)
    ? (statusRaw as AlertStatus)
    : undefined;
}

/** La NOUVELLE logique : le pipe réel, monté sur le vrai contrôleur. */
async function pipedResolve(statusRaw: string | undefined): Promise<AlertStatus | undefined> {
  return (await pipe().transform(statusRaw, STATUS_METADATA)) as AlertStatus | undefined;
}

/* ------------------------------------------------------------------ */

describe('AC-5 — l’allowlist vient de `@pilotage/contracts`, et elle est LIÉE', () => {
  it('le contrat porte les quatre statuts, et le plancher interdit une dérivation vide', () => {
    expect([...ALERT_STATUS]).toEqual(['open', 'acknowledged', 'resolved', 'dismissed']);
  });

  it('un pipe est monté sur le paramètre `status` lui-même', () => {
    expect(typeof pipe().transform).toBe('function');
  });
});

describe('G-TRUTH — sur le chemin VALIDE, les MÊMES lignes qu’avant', () => {
  it.each([...ALERT_STATUS])(
    '`?status=%s` rend exactement la même projection qu’avant',
    async (statusRaw) => {
      const before = listInstances(legacyResolve(statusRaw));
      const after = listInstances(await pipedResolve(statusRaw));
      expect(after).toEqual(before);
      // …et cette projection est bien un SOUS-ENSEMBLE strict : sans cela, deux
      // listes complètes identiques passeraient ce test sans rien prouver.
      expect(after.length).toBeLessThan(FIXTURE.length);
      expect(after.every((r) => r.status === statusRaw)).toBe(true);
    },
  );

  it('`status` ABSENT rend la liste non filtrée, avant comme après', async () => {
    const before = listInstances(legacyResolve(undefined));
    const after = listInstances(await pipedResolve(undefined));
    expect(after).toEqual(before);
    expect(after).toHaveLength(FIXTURE.length);
  });
});

describe('AC-5 — un statut invalide est 400, plus un ÉLARGISSEMENT silencieux (PF-315)', () => {
  it('l’ancienne logique rendait la liste COMPLÈTE — c’est le défaut, reproduit ici', () => {
    // L'assertion « avant » est ce qui empêche l'assertion « après » d'être
    // vacante : sans elle, un 400 ne se distingue pas d'un no-op.
    expect(legacyResolve('not_a_status')).toBeUndefined();
    expect(listInstances(legacyResolve('not_a_status'))).toHaveLength(FIXTURE.length);
  });

  it('le pipe refuse le même `not_a_status` en 400', async () => {
    const error = (await pipe()
      .transform('not_a_status', STATUS_METADATA)
      .catch((e: BadRequestException) => e)) as BadRequestException;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
  });

  it('refuse aussi `?status=` vide et une casse différente', async () => {
    await expect(pipe().transform('', STATUS_METADATA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe().transform('OPEN', STATUS_METADATA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
