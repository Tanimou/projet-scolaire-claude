# Ledger inbox

Runs **never edit `OPEN.md` directly.** With up to three tracks running concurrently, three runs editing the same lines
of the same file would collide on every merge.

Instead each run appends exactly one file it alone owns:

```
docs/daily-improvement-v3/traceability/inbox/<branch-name>.md
```

Different files cannot conflict in git. `scripts/v3-reconcile-ledger.js`, invoked under a short exclusive lock by
`routine-lock.sh gate`, folds these into `OPEN.md` / `CLOSED-<layer>.md` and deletes them.

## Format

```markdown
## PF-123
status: closed
layer: L0
row: | PF-123 short title | V3-E05 | S-E05-3 | `closed` | test id | evidence |

## PF-124
status: in-progress
row: | PF-124 other title | V3-E05 | S-E05-4 | `in-progress` | — | partial |
```

- `status` ∈ `open` · `in-progress` · `blocked` · `closed` · `closed-by-other-work`
- `layer` ∈ `L0` · `L1` · `L2-4` · `VAL` — **required when closing**
- `row` is the full markdown table row, exactly as it should appear in the ledger

**Closing moves a row** into the archive; nothing is ever deleted. Blocks the reconciler cannot place unambiguously are
left untouched and reported, rather than guessed at.

This directory should normally be empty — a file lingering here means a run wrote it and no gate has reconciled yet.
