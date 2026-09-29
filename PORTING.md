# Porting upstream (`sdsrss/claude-mem-lite`) into this fork

Status: active. Adopted 2026-09-29.
Audience: maintainer agents (Qwen Code / Claude Code) working in this checkout.

Companions:
- `docs/upstream-ports/SKILL.md` - the step-by-step porting skill.
- `docs/upstream-ports/` - the per-port ledger (one committed record per pull).
- `HANDOVER.md` - untracked local notes; background on the fork (do not commit).

## 1. Repos and remotes

| remote | url | role |
|---|---|---|
| `origin` | https://github.com/thenewnano/qwen-mem-lite | this fork. **Push target.** `main` tracks it. |
| `upstream` | https://github.com/sdsrss/claude-mem-lite | the true upstream. **Fetch only.** |

- Fetch with `git fetch upstream`.
- **Never `git push upstream`.**
- The fork descends from upstream's `main`; all ports land on this fork's `main`.

## 2. Fork invariants (what every ported commit must keep)

A port that violates any of these is incomplete:

1. **Rebrand.** Product name `qwen-mem-lite`; owner `thenewnano`. Never reintroduce upstream's `claude-mem-lite` / `sdsrss` identity into install, update, cache, or manifest surfaces.
2. **Dual host.** One tree runs on **Qwen Code and Claude Code**. Host differences are translated at the payload boundary (`lib/tool-names.mjs`, `claudemd.mjs` `LAYOUTS`, `lib/transcript-scan.mjs`), never forked per host.
3. **English only.** Upstream occasionally adds Chinese; translate it to English in the port. (`README.zh-CN.md` is a deliberate shipped translation, not a port target.)
4. **Env prefix.** New variables are `QWEN_MEM_*`. When porting a var upstream named `CLAUDE_MEM_*`, read `QWEN_MEM_*` first and fall back to `CLAUDE_MEM_*` (log once) so existing installs keep working. Do not add new `CLAUDE_MEM_*`-only vars.
5. **Never inherit the Claude-only release surfaces.** Upstream's release tarball is the Claude-only build; this fork updates from its own signed releases. Do not port changes that repoint install/update at upstream.
6. **No em-dashes in authored text.** A PostToolUse hook (azure-lm) rewrites em/en dashes to `-` in any file the Edit/Write tool touches. Write `-` from the start.

## 3. Tier verdict (recorded 2026-09-29)

| tier | content | verdict |
|---|---|---|
| 1 | portable core logic: security scrubbers, ordering tie-breaks, summary parsing, citation semantics, error-recall, import scrubbing, session-id shape, bash file-targets | **bring in all** |
| 2 | features: `/verify` chain, bash capture/recall, episode summarizer filter, metrics, search provenance flag, `context --chars`, last-session fallback | **bring and adapt all** |
| 3 | host-coupled | **conditional, per item below** |

Tier 3 conditions:

- **Hook 10,000-char cap** (`dd6d948`, `3c60192`): confirm Qwen Code's actual hook-injection cap first, then bring a version that works for that cap (it may be a different number, or not needed).
- **Env names** (`207dc38`, `4993558`): rename to `QWEN_MEM_*` with a `CLAUDE_MEM_*` fallback (invariant 4).
- **Plugin-root quoting** (`f0cf027`, `7a81507`, `e0b8927`): bring only if the same fix applies to **both** hosts' plugin roots; adapt so it does, otherwise skip.
- **Pre-commit green-stamp** (`b631522`, `65a77bb`, `4a6015c`, `4314b1c`): bring only if usable in this repo's own test/hook setup; skip if it depends on upstream's runner.

Outside these tiers, skip unless it is a dependency/CVE fix (e.g. `46ec110`).

## 4. The adaptation-commit rule

The core structural rule. For each upstream commit:

1. `git cherry-pick <sha>` first, unchanged. If it applies cleanly and needs no fork change, it is done.
2. If it needs a fork-specific change (rebrand, English, dual-host, env prefix, host path), commit that change as a **separate commit on top of the cherry-pick**. Do not amend or squash it into the upstream commit.
3. Name the upstream sha it adapts:

```
port(<area>): adapt <upstream-sha> for the fork

<what changed and why: which invariant>
```

This keeps upstream's commit intact and reviewable, and makes every fork deviation a single, greppable, revertible commit.

**"Adaptation" means any change made to satisfy a fork invariant.** Merge-conflict resolution is NOT an adaptation commit: it belongs to the cherry-pick (or merge) itself, which still lands as one commit.

## 5. Conflict handling

When a cherry-pick or merge conflicts:

- **Fork-identity files** - resolve **ours** (keep the fork): `package.json` `name`/`bin`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CLAUDE.md` `**Version**`, `README*.md`, `llms.txt`, `install.mjs` / `hook-update.mjs` release+update surfaces, `lib/plugin-key.mjs`.
- **Logic files** - understand both sides before choosing; prefer upstream's logic, then re-apply fork identity on top. If that re-application is a fork deviation (not conflict resolution), it is a separate adaptation commit.
- Never resolve by discarding a whole side blindly; read the conflict.

## 6. Worktree workflow

`.worktrees/` is gitignored. Port on a dedicated branch in a worktree so `main` stays clean:

```bash
git fetch upstream
git worktree add .worktrees/port-<slug> -b port/<slug> main
cd .worktrees/port-<slug>
# cherry-pick / adapt per sections 4-5, gate per section 8
cd -
# after the port branch is merged into main:
git worktree remove .worktrees/port-<slug>
```

## 7. Triage

```bash
git fetch upstream
git log --oneline upstream/main --not main                      # candidate commits
git log --reverse --format='%h|%s' main..upstream/main          # oldest first
git diff --stat main...upstream/main                            # blast radius
git merge-tree --write-tree --name-only main upstream/main      # read-only conflict preview
```

Record the **last ported upstream sha** in the ledger so the next port starts at `last..upstream/main`. Nothing has been ported yet; the shared base is `6e5439c` (v6.11.0), so the full 249-commit range (up to v6.19.4) is open.

## 8. Gates

A port is not done until these pass in the worktree:

```bash
TMPDIR="$HOME/.cache/tmp" npx vitest run   # full suite
npm run test:coverage                      # CI parity (thresholds)
npm run format:check && npx eslint .
npm run validate:manifests                 # claude plugin validate --strict
```

Local `/tmp` is RAM-backed; always set `TMPDIR="$HOME/.cache/tmp"`. The pre-commit hook is the real gate (~60s); never pass `--no-verify`. Stage first, then commit with no pathspec.

## 9. Ledger

Each port writes one record under `docs/upstream-ports/`, copied from `docs/upstream-ports/TEMPLATE.md` and committed alongside the code. The record lists every upstream sha with its disposition: `picked` (as-is), `adapted` (plus the adaptation commit sha), `skipped` (with reason), or `deferred`. Update the index in `docs/upstream-ports/README.md`.

## 10. Do not port

- The "repair the vX pre-ship / delta review findings" chains, unless porting their parent feature.
- Reverts `c609a42`, `ea4d795`.
- `release/*`, docs-only, test-only commits (re-derive docs/tests for the fork instead).
- Any change that repoints install/update/release at upstream.
- Contributor content carrying non-English or upstream-branded text unchanged.