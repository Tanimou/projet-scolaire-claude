#!/usr/bin/env node
/**
 * `scripts/grade-zero-value-probe.js` — S-E03-2b / `PF-05` / `PF-339`
 * =====================================================================
 *
 * SETTLES, BY EXECUTION AGAINST LIVE POSTGRES, a claim the register carried as
 * a **P1** for four runs:
 *
 *   > `PF-339` — `if (!g.value) continue` deletes a legitimate grade of ZERO
 *   > from every A-backed surface, including the north-star dashboard.
 *
 * The claim is **FALSE as written**, and it is false for a reason worth keeping
 * in the tree rather than in a paragraph: `Grade.value` is `Decimal? @db.Decimal(5,2)`,
 * so Prisma returns a `Prisma.Decimal` **object**, and every object is truthy.
 * `!Decimal(0)` is `false`, so the zero was KEPT.
 *
 * WHY THE SLICE STILL CHANGED THE CODE
 * ------------------------------------
 * The zero survived by ACCIDENT, not by intent. The safety rested entirely on
 * an invariant nothing in the code stated — that the value reaches the loop
 * un-converted. `analytics.service.ts` itself already does `Number(g.value)` at
 * two other sites (l. 834, l. 1297). Route a numerified value through one of
 * those loops and `!0` deletes the zero silently. That is the `PF-11` /
 * `ADR-068 §1.1` shape: *the only thing keeping the code correct was an
 * invariant nothing in the code stated.* This probe pins BOTH polarities so the
 * distinction cannot decay back into folklore.
 *
 * WHAT IT ASSERTS  (all five must pass; any failure ⇒ `PROBE: FAIL`)
 * -----------------------------------------------------------------
 *   P0  POSITIVE CONTROL — it really talked to a live database, and that
 *       database really holds grades. Without this a green run proves nothing
 *       (`landed: true ≠ ran: true`, run 77; the false-green of run 81).
 *   P1  A real row set to `0` comes back as a `Decimal` OBJECT, and `!value`
 *       is `false` ⇒ the OLD predicate KEEPS the zero ⇒ `PF-339` is FALSIFIED.
 *   P2  The same row through `Number()` is `0`, and `!0` is `true` ⇒ the OLD
 *       predicate DROPS the zero the moment anything numerifies it ⇒ the
 *       LATENT hazard is real, which is why the predicate was made explicit.
 *   P3  The NEW predicate (`=== null || === undefined`) keeps the zero in BOTH
 *       representations and still drops a genuine NULL. This is the
 *       anti-vacuity control: a predicate that kept everything would fail here.
 *   P4  NEGATIVE CONTROL — the transaction rolled back; the three rows carry
 *       their original values afterwards. The probe mutates nothing.
 *
 * HOW TO RUN (the stack must be up; `pilotage_postgres` publishes no host port,
 * so this MUST run inside a container — `localhost:5432` is the *other*,
 * native-Windows database and would be the wrong target):
 *
 *   docker cp scripts/grade-zero-value-probe.js pilotage_api:/app/grade-zero-value-probe.js
 *   docker exec -w /app pilotage_api node grade-zero-value-probe.js
 *
 * Exit 0 on `PROBE: PASS`, 1 on `PROBE: FAIL`, 2 when the fixture is too thin
 * to decide anything (fewer than three grades) — which is NOT a pass.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** Thrown to roll the probe's transaction back; never escapes `main`. */
class Rollback extends Error {}

const results = [];
function check(id, label, ok, detail) {
  results.push({ id, label, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${id}  ${label}\n          ${detail}`);
}

async function main() {
  console.log('grade-zero-value-probe — PF-339 / PF-05 (S-E03-2b)\n');

  // ---- P0 positive control: a live database, holding real grades -----------
  const [{ db, host }] = await prisma.$queryRaw`
    SELECT current_database()::text AS db, inet_server_addr()::text AS host`;
  const total = await prisma.grade.count();
  check(
    'P0',
    'positive control — live database reached, and it holds grades',
    total >= 3,
    `database=${db} server=${host ?? 'local-socket'} grade rows=${total}`,
  );
  if (total < 3) {
    console.log('\nPROBE: INCONCLUSIVE — fewer than 3 grade rows; nothing was decided.');
    await prisma.$disconnect();
    process.exit(2);
  }

  const seeds = await prisma.grade.findMany({
    take: 3,
    orderBy: { id: 'asc' },
    select: { id: true, value: true },
  });
  const [zeroRow, gradedRow, nullRow] = seeds;
  const originals = new Map(seeds.map((r) => [r.id, r.value === null ? null : String(r.value)]));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.grade.update({ where: { id: zeroRow.id }, data: { value: 0 } });
      await tx.grade.update({ where: { id: gradedRow.id }, data: { value: 12 } });
      await tx.grade.update({ where: { id: nullRow.id }, data: { value: null } });

      // Read back through the SAME shape `analytics.service.ts` uses.
      const rows = await tx.grade.findMany({
        where: { id: { in: seeds.map((r) => r.id) } },
        orderBy: { id: 'asc' },
        select: { id: true, value: true },
      });
      const by = new Map(rows.map((r) => [r.id, r.value]));
      const zero = by.get(zeroRow.id);
      const twelve = by.get(gradedRow.id);
      const nul = by.get(nullRow.id);

      // ---- P1 the OLD predicate on the RAW value ---------------------------
      check(
        'P1',
        'PF-339 FALSIFIED — `!g.value` KEEPS a Decimal zero',
        typeof zero === 'object' && zero !== null && !zero === false,
        `value=0 -> ctor=${zero && zero.constructor.name} typeof=${typeof zero} ` +
          `raw=${String(zero)} !value=${!zero} (false ⇒ kept)`,
      );

      // ---- P2 the OLD predicate once anything numerifies -------------------
      const asNumber = Number(zero);
      check(
        'P2',
        'LATENT hazard REAL — `!Number(g.value)` DROPS the same zero',
        asNumber === 0 && !asNumber === true,
        `Number(value)=${asNumber} !Number(value)=${!asNumber} (true ⇒ dropped silently)`,
      );

      // ---- P3 the NEW predicate, both representations + anti-vacuity -------
      const keep = (v) => !(v === null || v === undefined);
      const decision = {
        decimalZero: keep(zero),
        numberZero: keep(asNumber),
        twelve: keep(twelve),
        nullValue: keep(nul),
      };
      check(
        'P3',
        'NEW predicate keeps 0 in BOTH representations and still drops NULL',
        decision.decimalZero && decision.numberZero && decision.twelve && !decision.nullValue,
        `Decimal(0)=${decision.decimalZero} Number(0)=${decision.numberZero} ` +
          `12=${decision.twelve} NULL=${decision.nullValue} (NULL must be false — ` +
          'a predicate that kept everything would fail here)',
      );

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // ---- P4 negative control: nothing persisted -----------------------------
  const after = await prisma.grade.findMany({
    where: { id: { in: seeds.map((r) => r.id) } },
    orderBy: { id: 'asc' },
    select: { id: true, value: true },
  });
  const drifted = after.filter(
    (r) => (r.value === null ? null : String(r.value)) !== originals.get(r.id),
  );
  check(
    'P4',
    'negative control — transaction rolled back, no row mutated',
    drifted.length === 0,
    drifted.length === 0
      ? `3/3 rows carry their original values (${after.map((r) => String(r.value)).join(', ')})`
      : `MUTATED: ${drifted.map((r) => `${r.id}=${String(r.value)}`).join(', ')}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nPROBE: ${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length}/${results.length}`,
  );
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('PROBE: FAIL — ' + e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
