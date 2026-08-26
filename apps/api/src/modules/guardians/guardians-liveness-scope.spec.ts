import { BadRequestException } from '@nestjs/common';
import {
  GUARDIANSHIP_LINK_STATUSES,
  GUARDIANSHIP_SCOPE_LABEL,
  guardianshipLiveWhere,
  guardianshipOnTheBooksWhere,
  isGuardianshipOnTheBooks,
  isLiveGuardianship,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { GuardiansController } from './guardians.controller';

/**
 * S-E03-3c / PF-12 / PF-358 / ADR-074 — LES DEUX CONTRADICTIONS MESURÉES,
 * ROUGE-AVANT / VERT-APRÈS.
 *
 * POURQUOI CE FAUX PRISMA INTERPRÈTE LE `_count` AU LIEU DE L'INSPECTER
 * ---------------------------------------------------------------------
 * Un test qui se contenterait d'assener « l'objet `include` contient un
 * `where` » prouverait une FORME, et la forme est déjà portée par le cliquet
 * (`guardianship-liveness-derivation-gate.spec.ts`). Ce qu'il faut prouver ici
 * est un COMPORTEMENT : « un lien révoqué ne bloque plus la suppression ».
 *
 * Le double applique donc réellement la sémantique Prisma qui nous intéresse —
 * `_count.select.<relation>` vaut `true` (compte TOUT) ou `{ where: { status:
 * { in: [...] } } }` (compte le sous-ensemble) — contre un jeu de lignes
 * fixture. Avant la tranche, le contrôleur passait `true` et le test ci-dessous
 * échoue ; après, il passe une portée et le test passe. Le rouge n'est pas
 * supposé : il a été OBSERVÉ en rendant `guardians.controller.ts` à son état
 * d'avant la tranche.
 */

const TENANT = 't1';
const GUARDIAN = 'guardian-1';

function jwt(): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles: ['admin'] } } as unknown as KeycloakJwtPayload;
}

type Link = { id: string; status: 'pending' | 'active' | 'revoked' };

/** La sémantique Prisma du `_count`, appliquée — pas simulée à moitié. */
function countUnderSpec(links: Link[], spec: unknown): number {
  if (spec === true) return links.length;
  const where = (spec as { where?: { status?: { in?: readonly string[] } } })?.where;
  const allowed = where?.status?.in;
  if (!allowed) return links.length;
  return links.filter((l) => allowed.includes(l.status)).length;
}

function makeController(links: Link[]) {
  const findUnique = jest.fn(({ include }: { include?: Record<string, unknown> }) => {
    const countSpec = (include?._count as { select?: Record<string, unknown> } | undefined)?.select
      ?.guardianships;
    return Promise.resolve({
      id: GUARDIAN,
      tenantId: TENANT,
      _count: { guardianships: countUnderSpec(links, countSpec) },
    });
  });
  const del = jest.fn().mockResolvedValue({ id: GUARDIAN });
  const prisma = { guardian: { findUnique, delete: del } };
  const users = { ensureUser: jest.fn().mockResolvedValue({ id: 'u1', tenantId: TENANT }) };
  const ctx = { forUser: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) };
  const controller = new GuardiansController(prisma as never, users as never, ctx as never);
  return { controller, findUnique, del };
}

describe('S-E03-3c — le garde de suppression compte AU REGISTRE, pas TOUT', () => {
  it('T-1 — un parent dont TOUS les liens sont révoqués PEUT être supprimé (rouge avant la tranche)', async () => {
    // C'EST LE DÉFAUT. Le message d'erreur dit « Révoquez d'abord les
    // rattachements » ; avant la tranche, révoquer ne faisait PAS baisser ce
    // compte, donc l'instruction ne pouvait jamais débloquer la suppression.
    const { controller, del } = makeController([
      { id: 'l1', status: 'revoked' },
      { id: 'l2', status: 'revoked' },
    ]);

    await expect(controller.remove(GUARDIAN, jwt())).resolves.toEqual({ ok: true });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('T-2 — un lien VIVANT bloque toujours la suppression', async () => {
    const { controller, del } = makeController([{ id: 'l1', status: 'active' }]);
    await expect(controller.remove(GUARDIAN, jwt())).rejects.toBeInstanceOf(BadRequestException);
    expect(del).not.toHaveBeenCalled();
  });

  it('T-3 — un lien EN ATTENTE bloque aussi : la décision humaine est encore en vol', async () => {
    // Volontairement plus large que `guardianshipLiveWhere()` : supprimer le
    // parent sous une demande non tranchée la ferait disparaître sans décision.
    const { controller, del } = makeController([{ id: 'l1', status: 'pending' }]);
    await expect(controller.remove(GUARDIAN, jwt())).rejects.toBeInstanceOf(BadRequestException);
    expect(del).not.toHaveBeenCalled();
  });

  it('T-4 — révoquer le SEUL lien vivant débloque la suppression (le remède prescrit fonctionne)', async () => {
    const blocked = makeController([{ id: 'l1', status: 'active' }]);
    await expect(blocked.controller.remove(GUARDIAN, jwt())).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Le même parent, après révocation — l'unique changement est le statut.
    const unblocked = makeController([{ id: 'l1', status: 'revoked' }]);
    await expect(unblocked.controller.remove(GUARDIAN, jwt())).resolves.toEqual({ ok: true });
  });
});

describe('S-E03-3c — le compte et le tableau d’une MÊME charge utile s’accordent', () => {
  it('T-5 — `GET /guardians` ne peut plus annoncer un nombre que sa propre liste contredit', () => {
    // La contradiction mesurée le 2026-08-26 : `_count` NON FILTRÉ au-dessus
    // d'un tableau filtré `{ not: 'revoked' }`, sur le même objet.
    const links: Link[] = [
      { id: 'l1', status: 'active' },
      { id: 'l2', status: 'revoked' },
    ];
    const rowsShown = links.filter(isGuardianshipOnTheBooks);
    const countShown = countUnderSpec(links, { where: guardianshipOnTheBooksWhere() });

    expect(countShown).toBe(rowsShown.length);
    // Et le contre-exemple, pour que le test ne passe pas par coïncidence :
    expect(countUnderSpec(links, true)).not.toBe(rowsShown.length);
  });
});

describe('S-E03-3c — le vocabulaire et les deux portées', () => {
  it('T-6 — AU REGISTRE est VIVANT plus EN ATTENTE, et exclut exactement l’état terminal', () => {
    expect([...guardianshipOnTheBooksWhere().status.in].sort()).toEqual(['active', 'pending']);
    expect(guardianshipLiveWhere().status.in).toEqual(['active']);
  });

  it('T-7 — AU REGISTRE est équivalent à `{ not: "revoked" }` sur l’énum RÉELLE', () => {
    // L'équivalence que la tranche remplace, vérifiée contre le vocabulaire
    // canonique plutôt que crue sur parole.
    const notRevoked = GUARDIANSHIP_LINK_STATUSES.filter((s) => s !== 'revoked');
    expect([...guardianshipOnTheBooksWhere().status.in].sort()).toEqual([...notRevoked].sort());
  });

  it('T-8 — les prédicats en mémoire s’accordent avec les `where` (la moitié process)', () => {
    // Narrower la requête seule déplacerait la contradiction de Postgres vers
    // le processus — la leçon de `dedupKey()` (ADR-068 §3).
    for (const status of GUARDIANSHIP_LINK_STATUSES) {
      expect(isLiveGuardianship({ status })).toBe(guardianshipLiveWhere().status.in.includes(status));
      expect(isGuardianshipOnTheBooks({ status })).toBe(
        guardianshipOnTheBooksWhere().status.in.includes(status),
      );
    }
  });

  it('T-9 — un lien RÉVOQUÉ n’est ni vivant ni au registre', () => {
    expect(isLiveGuardianship({ status: 'revoked' })).toBe(false);
    expect(isGuardianshipOnTheBooks({ status: 'revoked' })).toBe(false);
  });

  it('T-10 — chaque portée porte une étiquette : un nombre sans portée n’est pas honnête', () => {
    expect(GUARDIANSHIP_SCOPE_LABEL.live).toMatch(/actifs/i);
    expect(GUARDIANSHIP_SCOPE_LABEL.onTheBooks).toMatch(/attente/i);
    expect(GUARDIANSHIP_SCOPE_LABEL.allStates).toMatch(/révoqués/i);
  });
});
