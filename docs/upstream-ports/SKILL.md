---
name: upstream-port
description: "Use when: porting commits from upstream (sdsrss/claude-mem-lite) into this Qwen Code + Claude Code fork. Runs triage, worktree cherry-picks, fork adaptations as separate commits, the gates, and writes a port record."
---

# Skill: port upstream into the fork

Policy lives in `PORTING.md` (read it first). This file is the runbook. A port is a
batch of upstream commits applied to this fork's `main`, each either `picked`,
`adapted`, `skipped`, or `deferred`, with one committed ledger record per batch.

## Before you start

- `git remote -v` shows `origin` = the fork (push target) and `upstream` =
  `sdsrss/claude-mem-lite` (fetch only). If not, fix it before porting.
- Read `PORTING.md` sections 2 (invariants), 3 (tiers), 4 (adaptation-commit rule).
- Know the last ported upstream sha: the newest record in `docs/upstream-ports/`,
  or `6e5439c` if none.

## Step 1 - fetch and scope

```bash
git fetch upstream
LAST=$(# last ported sha, or 6e5439c)
git log --reverse --format='%h|%s' "$LAST"..upstream/main
git log --oneline main --not upstream/main        # what is uniquely ours
git diff --stat "$LAST"..upstream/main            # blast radius
```

## Step 2 - triage every commit into a tier

Classify each candidate using `PORTING.md` section 3. For anything ambiguous,
preview the diff (`git show <sha>`) before deciding; do not tier from the subject
alone when the subject is vague. Produce a table: sha, subject, tier, disposition.

Default dispositions:

- Tier 1 -> `picked`, adapt only if a fork invariant is touched.
- Tier 2 -> `adapted` (plan the adaptation before picking).
- Tier 3 -> follow the per-item condition in `PORTING.md` section 3.
- Everything else -> `skipped` with a reason, except dependency/CVE fixes.

## Step 3 - open a worktree

```bash
git worktree add .worktrees/port-<slug> -b port/<slug> main
cd .worktrees/port-<slug>
```

## Step 4 - apply each commit

For each `picked`/`adapted` commit, in upstream order:

1. `git cherry-pick <sha>`.
2. If it conflicts: resolve per `PORTING.md` section 5 (identity files -> ours;
   logic -> upstream's logic then re-apply fork identity). Finish the pick:
   `git cherry-pick --continue`.
3. If it needs a fork change (invariant 1-6), make it now and commit it on top:

   ```
   port(<area>): adapt <upstream-sha> for the fork

   <which invariant, what changed>
   ```

   Never amend the cherry-picked commit to carry the adaptation.

If a pick turns out larger than triage implied, stop and re-tier it; do not
half-adapt.

## Step 5 - gate

```bash
TMPDIR="$HOME/.cache/tmp" npx vitest run
npm run test:coverage
npm run format:check && npx eslint .
npm run validate:manifests
```

Fix causes, never `--no-verify`. A port with a red gate is not done.

## Step 6 - record the port

Copy `docs/upstream-ports/TEMPLATE.md` to
`docs/upstream-ports/<YYYY-MM-DD>-<slug>.md` and fill one row per upstream sha.
Add the row to the table in `docs/upstream-ports/README.md`. Commit the record
with the port.

## Step 7 - land and clean up

```bash
git checkout main
git merge --ff-only port/<slug>     # or open a PR if the port is large
git worktree remove .worktrees/port-<slug>
git branch -d port/<slug>
```

## Rules of thumb

- One adaptation commit per upstream commit it adapts; one record per batch.
- Never push to `upstream`. Never rewrite upstream's commits.
- Translate Chinese to English; keep the rebrand; keep both hosts working.
- When unsure whether a change is host-specific, grep both `lib/tool-names.mjs`
  and the host path helpers before deciding to skip.