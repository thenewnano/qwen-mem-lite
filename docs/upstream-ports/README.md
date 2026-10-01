# Upstream port ledger

One committed record per pull from `sdsrss/claude-mem-lite` (upstream) into this
fork. Policy: `../../PORTING.md`. Runbook: `SKILL.md`. Template: `TEMPLATE.md`.

Each record lists every upstream sha in the batch with its disposition
(`picked` / `adapted` / `skipped` / `deferred`) and the adaptation commit that
followed it, if any. The newest record's upstream range end is the `last ported
sha` the next port starts from.

## Ports

| date | upstream range | tier(s) | status | record |
|---|---|---|---|---|
| 2026-09-30 | `6e5439c`..`6ff7bb9` (249 commits, v6.12.0-v6.20.0) | 1+2+3 | merged to branch, in review | [2026-09-30-v6.20.0-sync.md](2026-09-30-v6.20.0-sync.md) |
| 2026-10-01 | `6ff7bb9`..`1e4835a2` (62 commits, v6.21.0) | 1+2+3 | merged to branch, in review | [2026-10-01-v6.21.0-sync.md](2026-10-01-v6.21.0-sync.md) |