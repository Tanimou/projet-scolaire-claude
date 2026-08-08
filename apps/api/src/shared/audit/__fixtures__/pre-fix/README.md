# Recorded pre-fix sources — `S-E04-1`, AC-7 negative control

**Do not edit these files. Do not reformat them. Do not "fix" a lint or typecheck
complaint in them.** They are not source: they are *evidence*.

Each `*.ts.txt` here is the byte-for-byte content of one of the three pre-fix
audit-provenance copies that `S-E04-1` collapsed, taken from commit **`e218017`**
(the commit `S-E04-1` forked from) with:

```sh
git show e218017:apps/api/src/modules/analytics/analytics.controller.ts \
  > apps/api/src/shared/audit/__fixtures__/pre-fix/analytics.controller.ts.txt
git show e218017:apps/api/src/modules/grades/grades.controller.ts \
  > apps/api/src/shared/audit/__fixtures__/pre-fix/grades.controller.ts.txt
git show e218017:apps/api/src/modules/alerts/alert-provenance.ts \
  > apps/api/src/shared/audit/__fixtures__/pre-fix/alert-provenance.ts.txt
```

`apps/api/src/shared/quality/audit-provenance-gate.spec.ts` runs its real matchers
over these and asserts they FLAGGED all three copies — the assertion that makes
the guard a behavioural one rather than a name match. That spec pins the **sha256
of each file's LF-normalised bytes**, so editing one here is a red test rather than
a silent weakening of the control.

Two mechanical notes, both load-bearing:

- The extension is **`.ts.txt`, not `.ts`**, so the gate's own walk (`*.ts` under
  `apps/api/src`) does not collect them and `tsc`/`ts-jest` do not compile them.
  If they were `.ts`, `G-3` would report them as offenders — fail-closed, but a
  permanently red gate. The spec asserts this directory contributes **zero**
  entries to the walk, so the arrangement cannot rot unnoticed.
- `.gitattributes` pins them to `eol=lf` and the spec normalises `\r\n` before
  hashing, so the digest is identical on a Windows and a Linux checkout.

The previous form of this control read `git show HEAD:<path>`. That was green only
while the slice was uncommitted: once committed, `HEAD` *is* the fixed tree, one of
the three paths no longer exists there at all (`git show` exits 128 and throws),
and the two survivors return the collapsed sources — so the control inverted and
would have been permanently red on `main`. A control that cannot survive its own
commit is how a guard gets deleted.
