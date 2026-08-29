import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Prisma } from '@prisma/client';

import { isOneActiveYearViolation } from '../../modules/school-structure/academic-years.controller';

/**
 * S-E03-12 — LE CLIQUET de « au plus UNE année scolaire `active` par école ».
 *
 * CE QUE CETTE TRANCHE FERME
 * --------------------------
 * `PF-328` (moitié MULTIPLICITÉ) et, par elle, le résidu (ii) de `PF-04` :
 * « with no at-most-one-active-year invariant, two active years remain
 * POSSIBLE, and the resolver now picks one DETERMINISTICALLY rather than
 * CORRECTLY ». La migration `20260829120000_academic_year_one_active_per_school`
 * pose un index unique PARTIEL, donc après elle il n'y a plus rien parmi quoi
 * choisir.
 *
 * LE NOMBRE QUI PORTE LE CLIQUET — MESURÉ, PAS SUPPOSÉ
 * -----------------------------------------------------
 * Contre le Postgres du CONTENEUR (`docker exec`, jamais `localhost:5432` qui
 * est une autre base) : la divergence `PF-329` entre l'année lue par le
 * portail parent (axe INSCRIPTION) et celle lue par tous les autres portails
 * (axe ÉCOLE `active`) vaut **0 enfant sur 2464** aujourd'hui. Sous contrôle
 * négatif — injection d'une seconde année `active` postérieure dans l'école
 * peuplée, puis ROLLBACK — la même requête rend **2463 sur 2463**.
 *
 * La divergence ne monte donc pas progressivement : elle bascule d'un coup sur
 * TOUTE la population dès qu'une seconde année `active` existe. C'est ce qui
 * fait de cet index un correctif de vérité et pas une coquetterie de schéma,
 * et c'est ce que ce cliquet protège.
 *
 * CE QUE CE CLIQUET NE PRÉTEND PAS
 * ---------------------------------
 * Il ne ferme PAS la moitié CONTENANCE de `PF-328` (« rien n'exige que l'année
 * active contienne aujourd'hui »), qui échoue réellement sur les données et
 * demande une décision de donnée. Il ne ferme PAS `PF-329`, dont le mécanisme
 * à deux axes vit toujours dans `analytics.service.ts`. Il rend seulement ce
 * mécanisme INDÉCLENCHABLE par cette voie-là.
 *
 * POURQUOI UN PRÉDICAT UNIVERSEL SUR UN ENSEMBLE FERMÉ, ET AUCUN PLANCHER
 * -----------------------------------------------------------------------
 * Ce cliquet n'appuie sur AUCUN compte. Un plancher chiffré adossé à une
 * classe que la roadmap fait décroître est précisément le défaut relevé au
 * run 95 : il verrouille le nombre que le travail suivant doit faire baisser.
 * On affirme donc des faits d'existence et de forme sur un ensemble nommé et
 * fermé — le répertoire des migrations et deux fichiers cités — jamais « au
 * moins N occurrences de quelque chose ».
 */

const REPO = resolve(__dirname, '../../../../..');
const MIGRATIONS = join(REPO, 'apps/api/prisma/migrations');
const MIGRATION_NAME = '20260829120000_academic_year_one_active_per_school';
const INDEX_NAME = 'academic_year_one_active_per_school';
const CONTROLLER = join(REPO, 'apps/api/src/modules/school-structure/academic-years.controller.ts');
const BASELINE = join(REPO, 'scripts/restore-drill-baseline.json');

/** Lecture NOMMÉE : un fichier absent doit FAIRE ÉCHOUER, jamais rendre ''. */
function readNamed(label: string, path: string): string {
  if (!existsSync(path)) {
    throw new Error(`one-active-academic-year-gate: ${label} is MISSING at ${path}`);
  }
  return readFileSync(path, 'utf8');
}

/** Normalise les espaces pour que la mise en forme SQL ne casse pas le test. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * Retire les commentaires `--` avant toute recherche de DDL.
 *
 * Ce n'est pas une précaution théorique : la première version de ce cliquet a
 * échoué sur SA PROPRE migration, parce que le bloc d'en-tête y DOCUMENTE le
 * retour arrière (`DROP INDEX IF EXISTS …`) comme l'exige G-MIGRATION. Un
 * commentaire qui explique comment défaire n'est pas un défaire. Chercher de la
 * DDL dans du texte non filtré confond « ce que le fichier dit » avec « ce que
 * le fichier fait ».
 */
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, '');

describe('S-E03-12 — one active academic year per school (PF-328 multiplicity / PF-04 (ii))', () => {
  describe('the invariant is a DATABASE fact, and stays one', () => {
    it('the migration exists and creates the PARTIAL unique index', () => {
      const sql = flat(readNamed('the migration', join(MIGRATIONS, MIGRATION_NAME, 'migration.sql')));

      // Unique, sur school_id, et PARTIEL sur status='active'. Les trois
      // moitiés comptent : sans `unique` il n'interdit rien ; sans le `WHERE`
      // il interdirait aussi deux années CLOSES, que `seed-demo.ts` crée.
      expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*academic_year_one_active_per_school/i);
      expect(sql).toMatch(/ON academic_year \(school_id\)/i);
      expect(sql).toMatch(/WHERE status = 'active'/i);
    });

    it('NO migration in the whole ledger drops it — the ratchet is one-way', () => {
      const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      // Ensemble FERMÉ et NOMMÉ : toutes les migrations du dépôt, pas un
      // échantillon. Témoin d'anti-vacuité juste en dessous.
      expect(dirs).toContain(MIGRATION_NAME);

      const droppers = dirs.filter((name) => {
        const file = join(MIGRATIONS, name, 'migration.sql');
        if (!existsSync(file)) return false;
        return new RegExp(`DROP\\s+INDEX[^;]*${INDEX_NAME}`, 'i').test(
          stripSqlComments(readFileSync(file, 'utf8')),
        );
      });

      expect(droppers).toEqual([]);
    });

    it('ANTI-VACUITY: the dropper scan catches a REAL drop and ignores a DOCUMENTED one', () => {
      // Le test ci-dessus rend `[]` aussi bien parce que rien ne supprime
      // l'index que parce que le scan est aveugle. Ce témoin distingue les
      // deux sur des FIXTURES, sans toucher au dépôt.
      const scan = (sql: string) =>
        new RegExp(`DROP\\s+INDEX[^;]*${INDEX_NAME}`, 'i').test(stripSqlComments(sql));

      // (a) une vraie suppression DOIT être vue.
      expect(scan(`DROP INDEX IF EXISTS ${INDEX_NAME};\n`)).toBe(true);

      // (b) la même ligne EN COMMENTAIRE ne doit PAS l'être. Ce cas n'est pas
      // hypothétique : G-MIGRATION EXIGE que chaque migration documente son
      // retour arrière, donc le fichier de cette tranche contient cette ligne
      // en commentaire — et la première version de ce cliquet s'est accusée
      // elle-même à cause d'elle.
      expect(scan(`-- Retour arriere : DROP INDEX IF EXISTS ${INDEX_NAME};\n`)).toBe(false);

      // (c) et le filtre ne doit pas devenir un trou : du SQL réel APRÈS un
      // commentaire sur la même ligne reste vu.
      expect(scan(`-- note\nDROP INDEX ${INDEX_NAME}; -- enfin\n`)).toBe(true);
    });

    it('the migration is recorded in the restore-drill baseline (PF-80 class)', () => {
      const baseline = JSON.parse(readNamed('the restore-drill baseline', BASELINE));
      expect(baseline.ledger.migrations).toContain(MIGRATION_NAME);
    });
  });

  describe('the 409 mapping FIRES — it is keyed on the measured shape', () => {
    const knownError = (code: string, meta: unknown) =>
      new Prisma.PrismaClientKnownRequestError('boom', {
        code,
        clientVersion: 'test',
        meta: meta as Record<string, unknown>,
      });

    it('accepts the shape Prisma ACTUALLY reports for this index', () => {
      // Mesuré run 101 contre un vrai PostgreSQL :
      //   code P2002, meta = { modelName: 'AcademicYear', target: ['school_id'] }
      expect(
        isOneActiveYearViolation(knownError('P2002', { modelName: 'AcademicYear', target: ['school_id'] })),
      ).toBe(true);
    });

    it('does NOT steal the 409 of the (school_id, name) unique index', () => {
      // `academic_year_school_id_name_key` rend une cible à DEUX éléments et a
      // déjà son propre message (« une année de ce nom existe déjà »).
      expect(isOneActiveYearViolation(knownError('P2002', { target: ['school_id', 'name'] }))).toBe(false);
    });

    it('ignores unrelated Prisma errors and non-Prisma throws', () => {
      expect(isOneActiveYearViolation(knownError('P2025', { target: ['school_id'] }))).toBe(false);
      expect(isOneActiveYearViolation(new Error('network down'))).toBe(false);
      expect(isOneActiveYearViolation(undefined)).toBe(false);
    });

    it('is NOT keyed on the index NAME — that spelling never fires', () => {
      // Le piège que cette tranche a failli poser : `meta.target` ne porte
      // JAMAIS le nom de l'index. Si un futur remaniement rebranche le
      // prédicat sur le nom, ce test le dit.
      expect(isOneActiveYearViolation(knownError('P2002', { target: INDEX_NAME }))).toBe(false);
      expect(readNamed('the controller', CONTROLLER)).toMatch(/target\.length === 1/);
    });
  });

  describe('both write paths are actually guarded', () => {
    it('create and update both run inside guardOneActiveYear', () => {
      const src = readNamed('the controller', CONTROLLER);
      // Deux transactions d'écriture, deux enveloppes. Un ajout futur d'un
      // troisième écrivain non gardé rendrait un 500 au lieu d'un 409 : c'est
      // ce que ce compte fixe (et fermé — il y a exactement deux écrivains)
      // rend visible.
      const guarded = src.match(/guardOneActiveYear\(\(\) =>/g) ?? [];
      expect(guarded).toHaveLength(2);
      expect(src).toMatch(/throw new ConflictException\(/);
    });
  });
});
