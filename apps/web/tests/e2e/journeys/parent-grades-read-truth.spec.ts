import { expect, test } from '../fixtures/portal-fixtures';

/**
 * S-E03-2 / PF-05 — « une lecture qui échoue n'est jamais un fait du domaine »,
 * côté portail parent.
 *
 * ── CE QUE CE SPEC PROUVE ──────────────────────────────────────────────────
 * Sur une lecture qui RÉUSSIT, `/parent/grades` ne rend AUCUN `role="alert"` :
 * l'état d'erreur honnête introduit par cette tranche est bien réservé à
 * l'échec, et le refactor de `safe()` → `read()` n'a pas transformé le chemin
 * nominal en erreur. Et lorsque la page rend « Aucune note publiée », cette
 * phrase est **gagnée** : elle apparaît sous un `role="status"` (l'`EmptyState`
 * partagé) et jamais sous un `role="alert"`. C'est exactement la distinction
 * que PF-05 rendait impossible : avant cette tranche, un 403/404/500 produisait
 * la même phrase, sous le même rôle ARIA, qu'un bulletin réellement vide.
 *
 * ── CE QUE CE SPEC NE PROUVE PAS, ET POURQUOI ─────────────────────────────
 * Les états d'échec (S1 liste d'enfants, S3 panne, S4 droit d'accès) ne sont
 * PAS couverts ici, et ils ne peuvent pas l'être par Playwright.
 * `/parent/grades` est un **composant serveur** : la lecture part du processus
 * Next vers l'API NestJS, elle ne traverse jamais le navigateur. `page.route()`
 * n'intercepte que les requêtes du navigateur — un stub
 * `**\/api/v1/grades/**` serait ici un test qui ne teste rien, vert quoi qu'il
 * arrive au code. Écrire ce spec-là aurait été livrer une preuve
 * structurellement inexécutable (la leçon « landed ≠ ran »).
 *
 * La preuve des états d'échec est donc portée **hors navigateur**, par la sonde
 * live `scripts/parent-grades-contract-probe.js` (P4) : elle interroge la page
 * rendue et vérifie que le HTML servi contient la copie d'erreur et NE contient
 * PAS « Aucune note publiée ». C'est le seul niveau où l'on peut réellement
 * faire échouer la lecture serveur.
 *
 * ── RE-JOUABILITÉ ─────────────────────────────────────────────────────────
 * Aucune mutation, aucune dépendance à un jeu de données précis : le spec
 * accepte les DEUX issues nominales (des notes, ou un bulletin réellement vide)
 * et n'assert que l'invariant de vérité commun aux deux.
 */
test.describe('Parent · notes — vérité de la lecture @journey', () => {
  test("une lecture réussie ne rend jamais d'état d'erreur", async ({ parentPage }) => {
    await parentPage.goto('/parent/grades');

    expect(parentPage.url(), '/parent/grades ne doit pas rebondir vers /login').not.toContain(
      '/login',
    );

    // La page a fini de rendre : le titre est le marqueur stable des trois
    // issues nominales (données, vide gagné, ou aucun enfant rattaché).
    await expect(parentPage.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();

    // L'INVARIANT : une lecture qui aboutit n'affiche aucun état d'erreur.
    await expect(
      parentPage.getByRole('alert'),
      "aucun role=alert ne doit apparaître quand l'API répond",
    ).toHaveCount(0);
  });

  test('« Aucune note publiée » n\'apparaît que sous un role=status, jamais sous un role=alert', async ({
    parentPage,
  }) => {
    await parentPage.goto('/parent/grades');
    await expect(parentPage.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();

    const emptyClaim = parentPage.getByText(/Aucune note publiée/);
    const claimCount = await emptyClaim.count();

    if (claimCount === 0) {
      // Le jeu de données porte des notes : l'affirmation d'absence n'est pas
      // rendue du tout. Rien à prouver de plus ici.
      test.info().annotations.push({
        type: 'note',
        description: "L'enfant actif a des notes — l'état vide n'est pas atteint sur ce jeu.",
      });
      return;
    }

    // Si la phrase est rendue, elle DOIT être portée par l'EmptyState partagé
    // (role="status"), pas par un ErrorState (role="alert").
    await expect(parentPage.getByRole('status').filter({ hasText: /Aucune note publiée/ })).toHaveCount(
      1,
    );
    await expect(parentPage.getByRole('alert')).toHaveCount(0);
  });
});
