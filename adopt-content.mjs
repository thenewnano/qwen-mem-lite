// CLAUDE.md-steering plan (v3.13): content generators for the qwen-mem-lite
// managed block (written into <cwd>/CLAUDE.md AND <cwd>/QWEN.md — claudemd.mjs owns the
// two-layout list and the reasoning) and its companion
// <cwd>/.claude/plugin_qwen_mem_lite.md detail doc. Kept separate from the
// claudemd.mjs primitives so the strings are testable without side effects.
//
// CURRENT_SENTINEL_VERSION tags the managed block as `<!-- qwen-mem-lite:begin
// vN -->`. needsRefresh() (claudemd.mjs) compares the version tag AND the block
// body AND the detail-doc content — ANY of the three differing triggers an
// in-place refresh (drift = intended content change, overwritten rather than
// treated as a user edit). So a template edit propagates on the next SessionStart
// even WITHOUT a version bump; the tag need not be monotonic and, in practice,
// need not change at all — we keep `v1` across content edits (see mem #8846).
// We deliberately use `v1` (not `v2`) so the version digit differs from
// the sibling code-graph-mcp plugin's `<!-- code-graph-mcp:begin v2 -->` block in
// the same CLAUDE.md; the slug already scopes the two independently (claudemd.mjs),
// so this is a cosmetic distinguisher, not a functional one. The pre-v3.13 legacy
// memory-dir MEMORY.md sentinel also carried `v1`, but it lives in a different file
// and is migrated away (claudemd.migrateLegacyMemoryDir), so there is no collision.

export const PLUGIN_SLUG = 'qwen-mem-lite';
// The pre-rename slug (through v6.12.x). adopt-cli.mjs sweeps this slug's managed
// block, detail doc and state sidecar out of an upgraded project before writing the
// new block, so a renamed install does not leave two steering blocks in one file.
export const LEGACY_PLUGIN_SLUG = 'claude-mem-lite';
export const CURRENT_SENTINEL_VERSION = 'v1';

// The CLI name as written into the user's project tree — deliberately NOT `CLI_INVOKE`
// (audit R7 P2-1). CLI_INVOKE resolves to an absolute, VERSION-PINNED path
// (`node /home/<user>/.claude/plugins/cache/thenewnano/qwen-mem-lite/<version>/cli.mjs`), and
// both generators below write files the user may commit: the managed block lands in
// <cwd>/CLAUDE.md and the detail doc in <cwd>/.claude/, which is the standard home for
// project-scoped settings/commands/agents and is commonly tracked. Embedding the resolved
// path there rewrote the file on every plugin release (needsRefresh sees doc drift) and gave
// teammates a $HOME path that exists on no other machine. This module's output must be
// byte-identical across installs; the resolved path belongs only on runtime-generated
// surfaces that never touch the repo (MCP `instructions`, hook recovery lines).
const CLI = 'qwen-mem-lite';

/**
 * The concise managed block injected into <cwd>/CLAUDE.md (between the
 * slug-scoped sentinels — those are added by claudemd.renderBlock, NOT here).
 * Universal: the memory contract is the same for every project, so there is no
 * per-project-type variation. Keep it tight (cheap always-loaded context); the
 * full tables + rules live in the detail doc this block points to.
 */
export function buildClaudeMdBlock() {
  // Intentionally machine-stable: MCP tool names only, NO CLI_INVOKE (that
  // resolves to an absolute path that differs per install — it would make this
  // committed/refreshed block churn across machines). The detail doc holds the
  // full CLI table and, since R7 P2-1, is held to the same standard — see CLI above.
  return `## qwen-mem-lite — persistent memory

PreToolUse hooks already run \`mem_recall\` for past lessons before Read/Edit/Write. The calls worth making proactively:

| When | Call |
|------|------|
| Before Edit/Write | hook already recalled; if a \`#NN\` lesson was injected, cite \`#NN\` next time you produce user-visible text (citing = adopting the feedback; uncited lessons decay) |
| After fixing a non-trivial bug | \`mem_save(type="bugfix", lesson_learned="<root cause + fix>", importance=2)\` |
| After a non-obvious architecture decision | \`mem_save(type="decision", lesson_learned="<constraint + tradeoff>")\` |
| Deferring to a future session | \`mem_defer({title, priority:1|2|3, detail})\`; when fixed, add \`closes_deferred=[N]\` to \`mem_save\` |
| Looking up past work / history | \`mem_search "keywords"\` · \`mem_recent\` · \`mem_timeline\` |

Path cost is round-trips, not milliseconds: the PreToolUse hook above already recalls (0 calls) — prefer it. For an explicit query, if these \`mem_*\` tools are deferred behind ToolSearch (Qwen Code: \`tool_search\`) this session, the Bash CLI \`${CLI}\` is one call vs two (ToolSearch + call); the MCP server instructions carry the absolute path to use when it is not on PATH.

Full tool + CLI tables, citation/decay rules, and save discipline → \`.claude/plugin_qwen_mem_lite.md\` (Claude Code) · \`.qwen/plugin_qwen_mem_lite.md\` (Qwen Code)`;
}

/**
 * Full detail doc rendered into `<cwd>/.claude/plugin_qwen_mem_lite.md` and its
 * `<cwd>/.qwen/plugin_qwen_mem_lite.md` twin (claudemd.mjs writes one per layout).
 * Not auto-loaded by either host — the managed block points to it and the agent
 * reads it on demand. claudemd.writeManaged() prepends the `managed-by` marker;
 * this returns pure content.
 */
export function getDetailDoc() {
  return `# qwen-mem-lite plugin contract (full)

> Generated by \`${CLI} adopt\` and refreshed automatically with each version; remove with \`${CLI} unadopt\`.
> The concise trigger table lives in the \`qwen-mem-lite\` managed block in the project's \`CLAUDE.md\` (Claude Code) / \`QWEN.md\` (Qwen Code); this file is its expansion.
> Design background: docs/CLAUDE-MD-STEERING-PLAN.md.

> **Every command below is written as \`${CLI} <cmd>\`.**
> That name is on PATH only after a global install (\`npm i -g github:thenewnano/qwen-mem-lite\`); otherwise use the equivalent
> \`node <plugin root>/cli.mjs <cmd>\` - the absolute path is in this session's MCP server instructions.
> This file **deliberately does not hardcode an absolute path**: it varies with the install location and version, and this file may be committed to the repo.
> Hardcoding it would rewrite the file on every release and hand teammates a path that exists only on someone else's machine.

## Passive recall (the hook already ran it; you only adopt the result)

The PreToolUse hook has already run \`mem_recall\` for the file before you Read / Edit / Write it:
- **Read** path: asymmetric-quiet - at most 1 lesson, 120 characters, \`lesson_learned\` required.
- **Edit / Write** path: decision-support - at most 3 items, 240 characters; high-importance bugfix/decision entries are injected even without a
  lesson.
- A Read and an Edit on the same file share a cooldown (the body is not injected twice), but the first Edit after a Read re-surfaces the lesson **ID**
  as a one-line ack instruction. When you see a line like \`#NN [bugfix] ...\`: **cite \`#NN\` the next time you produce user-visible text**
  (\`'#NN applied'\` or \`'#NN n/a - <reason>'\`). Pure tool turns do not count; keep the ID in working memory and cite it when you write back.
- Citations are tracked per session: an uncited lesson loses importance after 3 consecutive sessions (floor 0), a cited one gains +1 (cap 3).
  Citing is feedback to the system, not a compliance ritual - the injection pool tunes itself from it.

## When to call the MCP tools proactively

\`tools/list\` exposes 6 core tools + 3 defer tools by default:
\`mem_search\` / \`mem_recent\` / \`mem_recall\` / \`mem_get\` / \`mem_save\` / \`mem_timeline\` +
\`mem_defer\` / \`mem_defer_list\` / \`mem_defer_drop\`.

### MCP or CLI: choose by round-trips, not milliseconds

The real cost is model round-trips, not tool execution - a warm MCP call is ~25 ms and a cold CLI start ~90 ms, both noise next to one reasoning step (seconds). Route by round-trip count:

1. **Passive hook (0 round-trips)**: the PreToolUse recall above already ran. Fastest; adopt its output and do not call again.
2. **CLI via Bash (1 round-trip)**: in tool-heavy sessions \`mem_*\` is deferred behind ToolSearch - one MCP call then costs ToolSearch + call = **2 round-trips**, while one Bash CLI run costs **1**. Spawned sub-agents usually do not get the \`mem_*\` tools either, so the CLI is their only 1-round-trip path. Use the commands in the "CLI quick reference" tables below.
3. **Direct MCP call (1 round-trip when already loaded)**: if \`mem_*\` is in context (not deferred), call it directly - the warm process is fastest and skips ToolSearch.

In one sentence: let the hook do it when it can; for an explicit lookup, if you would need ToolSearch before \`mem_*\` is available, run the CLI instead.

| When | Tool | Key arguments |
|------|------|---------------|
| Before Edit / Write | \`mem_recall\` | \`file="<path>"\` (the hook usually already ran it) |
| Test failure / error | \`mem_search\` | \`query="<error keywords>", obs_type="bugfix"\` |
| Before a refactor | \`mem_search\` | \`query="<module>", obs_type="refactor"\` |
| Starting a new feature | \`mem_search\` | \`query="<feature area>"\` - look for prior art |
| After fixing a non-trivial bug | \`mem_save\` | \`type="bugfix", lesson_learned="<root cause + fix>", importance=2\` |
| After a non-obvious architecture decision | \`mem_save\` | \`type="decision", lesson_learned="<constraint + tradeoff>"\` |
| Context mentions #NN | \`mem_get\` | \`ids=[NN]\` |

## Required contract (dogfood; this repo applies it especially strictly)

- **After a non-trivial bug fix** (not a typo / rename) you **must** call \`mem_save(type="bugfix",
  lesson_learned="<one-line root cause + one-line fix>", importance=2)\`. Test: would a future session touching the same file avoid the trap because of this entry? Yes -> save it.
- **After a non-obvious architecture decision** (not a rename / code move) call \`mem_save(type="decision",
  lesson_learned="<constraint + why this choice + what it costs>")\`. \`decision\` hits far more often than \`change\` (current telemetry is about
  3:1 and drifts - measure it with \`${CLI} stats\`, do not hardcode a multiplier); the direction is stable: one good decision is worth several changes.
  Do not pad: keep \`decision\` for real tradeoffs, not style preferences.
- **Deferring to a future session** (not an in-flight todo, not a follow-up in this PR) call
  \`mem_defer({title, priority:1|2|3, detail:"<constraint + why deferred>"})\`.
  Trigger phrasing includes "next session / defer to next round / out of scope for this PR / pick up later" (equivalent phrasing in other languages counts too).
- When a deferred item is fixed, **add \`closes_deferred=[N]\`** to \`mem_save\` (N is the number in the SessionStart
  \`### Deferred Work\` banner, or the original id \`["D#42"]\`; mixing both is fine) so the carry-forward chain closes.
  If the item needs no fix (flaky / scope shift), use \`mem_defer_drop({id, reason})\` instead; \`reason\` is required and serves as the audit trail.
- **Do not write \`lesson_learned: 'none'\` just to satisfy the schema**: if there is no reusable lesson, leave it NULL and accept a low-importance observation.
  Haiku fills in "none" far too aggressively - override it on manual saves.

## Maintenance / admin tools (via CLI)

These tools are hidden from \`tools/list\` (to shrink the startup context); they stay registered at the MCP layer and can be reached by name with
\`tools/call\`, but callers that only read \`tools/list\` (such as Claude Code) should use the CLI:

| Scenario | CLI |
|----------|-----|
| Purge expired memories | \`${CLI} maintain scan --ops purge_stale\` -> \`maintain execute --ops purge_stale --confirm\` (deleting rows requires \`--confirm\`) |
| Deep optimization (Haiku) | \`${CLI} optimize\` (preview by default; \`--run\` executes, \`--task re-enrich,normalize,cluster-merge,smart-compress\`) |
| Compress old entries | \`${CLI} compress\` (preview by default; \`--execute\` executes, \`--age-days N\`) |
| FTS5 index check / rebuild | \`${CLI} fts-check <check\\|rebuild>\` |
| Browse tier groups | \`${CLI} browse [--tier active]\` |
| Export JSON/JSONL | \`${CLI} export [--format jsonl]\` |
| Totals / health stats | \`${CLI} stats [--days 30]\` |
| Delete / update an entry | \`${CLI} delete <id>[,<id>]\` . \`${CLI} update <id> [--title ...]\` |

## CLI quick reference (reading)

| Command | Purpose |
|---------|---------|
| \`${CLI} search "query"\` | FTS5 full-text search (low-signal rows like \`Modified X\` are excluded by default; add \`--include-noise\` to find file-change records) |
| \`${CLI} search "err" --type bugfix\` | Filter by type |
| \`${CLI} recall "file.mjs"\` | File-related memories |
| \`${CLI} recent 5\` | The 5 most recent entries |
| \`${CLI} get 42,43\` | Expand by ID |
| \`${CLI} timeline --anchor 42\` | Timeline context |

## CLI quick reference (writing / recording)

Most write tools are hidden from \`tools/list\`, so they are CLI-only. The table lists the **hard limits** (exceeding them fails immediately - no need to discover that by hitting them); see \`${CLI} help\` for the full flag set.

| Command | Signature (with hard constraints) |
|---------|-----------------------------------|
| Save an observation | \`${CLI} save "<text>" --type bugfix\\|decision --lesson "<up to 500 chars>" [--importance 1-3] [--closes-deferred N]\` - \`<text>\` is a **required positional argument**; a \`--lesson\` over 500 chars fails immediately |
| Defer work | \`${CLI} defer add "<title up to 200>" [--priority 1\\|2\\|3] [--detail "<constraint + why deferred>"]\` - move a title longer than 200 chars into \`--detail\` |
| Change an entry | \`${CLI} update <id> [--lesson "<up to 500>"] [--title T] [--type T] [--importance 1-3] [--narrative T] [--concepts "a b c"]\` |
| Event log | \`${CLI} activity save --type <bugfix\\|lesson\\|bug\\|discovery\\|refactor\\|feature\\|observation\\|decision> "<title>" [--body T] [--files f1,f2]\` |

\`maintain\` / \`optimize\` / \`compress\` are covered in "Maintenance / admin tools" above; \`maintain --ops\` accepts \`cleanup,decay,boost,demote_pinned,dedup,purge_stale,vacuum\`, defaulting to \`cleanup,decay,boost,demote_pinned\` when omitted (order matters: demote_pinned must come after boost); \`--retain-days\` is in [7,365].

## Uninstall / disable

- \`${CLI} unadopt\`: removes the CLAUDE.md/QWEN.md managed block + \`.claude/plugin_qwen_mem_lite.md\`,
  \`.qwen/plugin_qwen_mem_lite.md\`; your own content in either file (outside the sentinel) is left untouched.
- Disable auto-adopt for this project permanently: \`${CLI} adopt --disable\` (\`--enable\` re-arms it).
- Disable auto-adopt globally: environment variable \`MEM_NO_AUTO_ADOPT=1\`.
- Turn off automatic refresh on version drift (keeps your manual edits to the managed block): \`QWEN_MEM_NO_TEMPLATE_REFRESH=1\`.`;
}
