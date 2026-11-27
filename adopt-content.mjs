// CLAUDE.md-steering plan (v3.13): content generators for the qwen-mem-lite
// managed block (written into <cwd>/CLAUDE.md and <cwd>/QWEN.md) and the shared
// detail doc in the plugin data directory. Kept separate from the claudemd.mjs
// primitives so the strings are testable without side effects.
//
// CURRENT_SENTINEL_VERSION tags the managed block as `<!-- qwen-mem-lite:begin
// vN -->`. needsRefresh() (claudemd.mjs) compares the version tag AND the block
// body - either differing triggers an in-place refresh (drift = intended content
// change, overwritten rather than treated as a user edit). So a template edit
// propagates on the next SessionStart even WITHOUT a version bump; the tag need
// not be monotonic and, in practice, need not change at all - we keep `v1` across
// content edits (see mem #8846). We deliberately use `v1` (not `v2`) so the
// version digit differs from the sibling code-graph-mcp plugin's
// `<!-- code-graph-mcp:begin v2 -->` block in the same CLAUDE.md; the slug already
// scopes the two independently (claudemd.mjs), so this is a cosmetic
// distinguisher, not a functional one. The pre-v3.13 legacy memory-dir MEMORY.md
// sentinel also carried `v1`, but it lives in a different file and is migrated
// away (claudemd.migrateLegacyMemoryDir), so there is no collision.

export const PLUGIN_SLUG = 'qwen-mem-lite';
export const CURRENT_SENTINEL_VERSION = 'v1';

// The CLI name as written into the user's project tree - deliberately NOT `CLI_INVOKE`
// (audit R7 P2-1). CLI_INVOKE resolves to an absolute, VERSION-PINNED path
// (`node /home/<user>/.claude/plugins/cache/thenewnano/qwen-mem-lite/<version>/cli.mjs`), and
// the managed block lands in <cwd>/CLAUDE.md, which users commonly commit. Embedding the
// resolved path there rewrote the file on every plugin release and gave teammates a $HOME path
// that exists on no other machine. This module's output must be byte-identical across installs;
// the resolved path belongs only on runtime-generated surfaces that never touch the repo (MCP
// `instructions`, hook recovery lines). The detail doc itself lives outside the repository, in
// the data directory, so it no longer creates per-project files at all.
const CLI = 'qwen-mem-lite';

/**
 * The concise managed block injected into <cwd>/CLAUDE.md (between the
 * slug-scoped sentinels - those are added by claudemd.renderBlock, NOT here).
 * Universal: the memory contract is the same for every project, so there is no
 * per-project-type variation. Keep it tight (cheap always-loaded context); the
 * full tables + rules live in the detail doc this block points to.
 */
export function buildClaudeMdBlock({ detailDocRef = '~/.qwen-mem-lite/plugin_claude_mem_lite.md' } = {}) {
  // Intentionally machine-stable: MCP tool names only, NO CLI_INVOKE (that
  // resolves to an absolute path that differs per install - it would make this
  // committed/refreshed block churn across machines). The detail doc holds the
  // full CLI table and, since R7 P2-1, is held to the same standard - see CLI above.
  return `## qwen-mem-lite - persistent memory

PreToolUse hooks already run \`mem_recall\` for past lessons before Read/Edit/Write. The calls worth making proactively:

| When | Call |
|------|------|
| Before Edit/Write | hook already recalled; if an injected \`#NN\` lesson changed what you did, add the bare tag \`(#NN)\` once at the end of the sentence describing that change (citing = adopting; uncited lessons decay; skip ones that did not apply). No other mention of memory ids, saves or the memory store in replies to the user |
| A recalled memory drives an answer or a design choice | check its claim in the code or \`git log\` first: \`#NN\` and \`E#NN\` rows are notes from past sessions, many written automatically, so they can be wrong, and they describe the code as it was. If the code disagrees, trust the code and replace the note: \`mem_save(..., supersedes=[NN])\`, or \`supersedes=["E#NN"]\` for an event (CLI: \`save "<correction>" --supersedes NN,E#NN\`) |
| After fixing a non-trivial bug | \`mem_save(type="bugfix", lesson_learned="<root cause + fix, only what this change's diff shows>", importance=2)\` |
| After a non-obvious architecture decision | \`mem_save(type="decision", lesson_learned="<constraint + tradeoff>")\` |
| Deferring to a future session | \`mem_defer({title, priority:1|2|3, detail})\`; when fixed, add \`closes_deferred=[N]\` to \`mem_save\`. CLI: \`defer update D#N --title "<t>" --detail "<d>" --priority <1-3>\` edits it in place (no drop and re-add); \`save "<fix>" --closes-deferred D#N\` closes it; \`defer drop D#N --reason "<why>"\` drops it |
| Looking up past work / history | \`mem_search "keywords"\` · \`mem_recent\` · \`mem_timeline\` |

Path cost is round-trips, not milliseconds: the PreToolUse hook above already recalls (0 calls) - prefer it. For an explicit query, if these \`mem_*\` tools are deferred behind ToolSearch this session, the Bash CLI \`${CLI}\` is one call vs two (ToolSearch + call); the MCP server instructions carry the absolute path to use when it is not on PATH.

Full tool + CLI tables, citation/decay rules, and save discipline → \`${detailDocRef}\``;
}

/**
 * Full detail doc kept in the plugin's data directory (lib/local-steering.mjs
 * ensureSteeringDetailDoc) and shared by every project. Not auto-loaded by the
 * host - the managed block points to it and the model reads it on demand. A
 * project no longer gets its own copy, so adopting leaves no untracked files.
 */
export function getDetailDoc() {
  return `# qwen-mem-lite plugin contract (full)

> Generated by \`${CLI} adopt\`, refreshed automatically with each version; remove the project block with \`${CLI} unadopt\`.
> The compact trigger table is injected into the session context by SessionStart (in a project that
> ran \`${CLI} adopt\` explicitly it lives in the \`qwen-mem-lite\` managed block of \`CLAUDE.md\`); this
> file is its expanded form. It lives in the plugin's data directory
> (\`~/.qwen-mem-lite/plugin_claude_mem_lite.md\`) and is shared by every project, so a version bump
> never changes a tracked file.

> **Every command below is written \`${CLI} <cmd>\`.** That name is on PATH only when the package was
> installed globally (\`npm i -g qwen-mem-lite\`); otherwise use the equivalent
> \`node <plugin root>/cli.mjs <cmd>\`, whose absolute path is in this session's MCP server
> instructions. The command paths below do not depend on where this file lives.

## Passive recall (the hook already ran; just adopt it)

Before you Read / Edit / Write a file, the PreToolUse hook has already run \`mem_recall\` for it:
- **Read** path: asymmetric-quiet - at most 1 lesson, 120 characters, and only with \`lesson_learned\`.
- **Edit / Write** path: decision-support - at most 3, 240 characters; a high-importance
  bugfix/decision is injected even without a lesson.
- Read→Edit of the same file shares a cooldown (the body is not injected twice), but the first Edit
  after a Read re-surfaces the lesson **ID** in a one-line ack instruction. When you see a line like
  \`#NN [bugfix] ...\`: **if a lesson changed what you did, add a bare tag \`(#NN)\` at the end of the
  sentence describing that change**; do not mention lessons you did not use, and do not list them
  one by one. A pure tool-only turn does not count; keep the ID in working memory and cite it when
  you write back.
- In replies to the user, apart from that \`(#NN)\` tag, do not mention memory ids: do not report ids
  from saves or deferrals (e.g. "saved to project memory, id #1"), and do not discuss the memory
  store itself (e.g. "this matches record #1 in the memory store").
- The system tracks citations per session: a cited lesson rises in the ranking used for search and
  injection; one injected but not cited sinks (a bounded ranking multiplier). One injected
  repeatedly and never cited is lowered to importance 2 by background maintenance (and one with no
  lesson to 1). A rejection written as \`#NN n/a\` does not count as adoption: it ranks like an
  uncited lesson and sinks the same way, so there is no need to write it. Citation is feedback to
  the system, not a compliance ritual; the injection pool tunes itself from it.

## Memory is old notes, not the current code

- \`E#NN\` is an event summary the background writes from a session, and it can be wrong: in the
  2026-09 sandbox measurement, 6 of 43 were factually wrong and 13 partly wrong. \`#NN\` may be a
  note the agent saved deliberately, or a session summary the background compiled; even a
  deliberate save can claim more than that change actually did. Both describe the code at the
  moment they were saved.
- Before you answer "what was done before, and why" from a memory, or make a design decision based
  on one, verify its specific claim in the code or with \`git log -S\` / \`git show\`.
- When code and memory disagree, trust the code and say so in the reply; then replace that memory
  with
  \`mem_save(type=<original type>, title=..., lesson_learned="<the corrected claim from the code>", supersedes=[NN])\`
  (for an event write \`supersedes=["E#NN"]\`); a superseded record is no longer recalled. Correct
  only the point you verified in the code yourself; if you are unsure, do not write it.
- When saving a lesson, write only what this change's diff proves: what was fixed and why it was
  fixed that way. Leave out what was done later or is only planned.

## When to call MCP tools proactively

\`tools/list\` exposes 6 core tools + 3 defer tools by default:
\`mem_search\` / \`mem_recent\` / \`mem_recall\` / \`mem_get\` / \`mem_save\` / \`mem_timeline\` +
\`mem_defer\` / \`mem_defer_list\` / \`mem_defer_drop\`.

### MCP or CLI: choose by round trips, not milliseconds

The real cost is model round trips, not tool execution - a warm MCP call is ~25 ms and a cold CLI
start ~90 ms, both noise next to one reasoning pass (seconds). Choose by round trips:

1. **Passive hook (0 round trips)**: the PreToolUse recall above already ran; it is fastest, so
   prefer adopting it and do not call again.
2. **CLI via Bash (1 round trip)**: in a tool-heavy session \`mem_*\` is deferred behind ToolSearch -
   then one MCP call = ToolSearch + call = **2 round trips**, while one Bash CLI run is **1 round
   trip**. A dispatched subagent usually does not get the \`mem_*\` tools either, so the CLI is its
   only 1-round-trip path. Use the commands in the "CLI quick reference" tables below.
3. **Direct MCP call (1 round trip when loaded)**: if \`mem_*\` is already in context (not deferred),
   call it directly; the warm process is fastest and skips ToolSearch.

In one sentence: let the hook do it when it can; for an explicit lookup, if using \`mem_*\` would
require ToolSearch first, run the CLI instead.

| When | Tool | Key arguments |
|------|------|---------------|
| Before Edit / Write | \`mem_recall\` | \`file="<path>"\` (the hook usually did it) |
| Test failure / error | \`mem_search\` | \`query="<error keywords>", obs_type="bugfix"\` |
| Before a refactor | \`mem_search\` | \`query="<module>", obs_type="refactor"\` |
| Starting a feature | \`mem_search\` | \`query="<feature area>"\` - look for prior art |
| After a non-trivial bugfix | \`mem_save\` | \`type="bugfix", lesson_learned="<root cause + fix>", importance=2\` |
| After a non-obvious architecture decision | \`mem_save\` | \`type="decision", lesson_learned="<constraint + tradeoff>"\` |
| Context mentions #NN | \`mem_get\` | \`ids=[NN]\` |

## Mandatory contract (dogfood; this repository is especially strict)

- **After fixing a non-trivial bug** (not a typo / rename) you **must** call
  \`mem_save(type="bugfix", lesson_learned="<one line of root cause + one line of fix>", importance=2)\`.
  Test: would a future session touching the same file avoid the trap after seeing it? If yes, save it.
- **After a non-obvious architecture decision** (not a rename / code move) call
  \`mem_save(type="decision", lesson_learned="<constraint + why this choice + what was sacrificed>")\`.
  \`decision\` has a much higher hit rate than \`change\` (current telemetry is about 3:1 and drifts -
  measure it with \`${CLI} stats\`, do not assume a fixed multiplier); the direction is stable: one
  good decision is worth several changes. Do not pad: reserve decision for a real tradeoff, not a
  style choice.
- **Deferring to a future session** (not an in-flight todo, not a follow-up in this PR) call
  \`mem_defer({title, priority:1|2|3, detail:"<constraint + why deferred>"})\`.
  Trigger phrases: Chinese "下次/下个会话/不在本轮范围/留给下个会话"; English "next session / defer
  to next round / out of scope for this PR / pick up later".
- When you fix a deferred item you **must** add \`closes_deferred=[N]\` to \`mem_save\` (N is the
  ordinal in the SessionStart \`### Deferred Work\` banner, or the raw id \`["D#42"]\`; mixing is OK),
  so the carry-forward chain closes. If the item needs no fix (flaky / scope shift), use
  \`mem_defer_drop({id, reason})\` instead; reason is required and audited.
- **Do not write \`lesson_learned: 'none'\` just to fill the schema**: if you cannot state a reusable
  lesson, leave it NULL and accept a low-importance observation. Haiku is too eager to fill "none"
  by default - override it on a manual save.

## Maintenance / admin tools (use the CLI)

These tools are hidden from \`tools/list\` (to shrink the startup context). They are still registered
at the MCP layer and can be reached by name with \`tools/call\`, but for a caller such as Claude Code
that only reads \`tools/list\`, use the CLI:

| Scenario | CLI |
|----------|-----|
| Clean up stale memories | \`${CLI} maintain scan\` to preview; the cleanup itself is left to the user-started \`/qwen-mem-lite:update\` |
| Deep optimization (Haiku) | \`${CLI} optimize\` (preview by default; \`--run\` executes, \`--task re-enrich,normalize,cluster-merge,smart-compress\`) |
| Compress old entries | \`${CLI} compress\` (preview by default; \`--execute\` runs, \`--age-days N\`) |
| FTS5 index check / rebuild | \`${CLI} fts-check <check\\|rebuild>\` |
| Browse by tier | \`${CLI} browse [--tier active]\` |
| Export JSON/JSONL | \`${CLI} export [--format jsonl]\` |
| Totals / health | \`${CLI} stats [--days 30]\` |
| Delete / update one | \`${CLI} delete <id>[,<id>]\` · \`${CLI} update <id> [--title ...]\` |

## CLI quick reference (search)

| Command | Purpose |
|---------|---------|
| \`${CLI} search "query"\` | FTS5 full-text search (low-signal \`Modified X\` records excluded by default; add \`--include-noise\` for file-change records) |
| \`${CLI} search "err" --type bugfix\` | Filter by type |
| \`${CLI} recall "file.mjs"\` | Memories tied to a file |
| \`${CLI} recent 5\` | The 5 most recent |
| \`${CLI} get 42,43\` | Expand by ID |
| \`${CLI} timeline --anchor 42\` | Timeline context |

## CLI quick reference (write / record)

Most write tools are hidden from \`tools/list\`, so the CLI is the only path. The table lists the
**hard limits** (going over fails immediately; do not learn by hitting them); full flags in
\`${CLI} help\`.

| Command | Signature (including hard limits) |
|---------|-----------------------------------|
| Save an observation | \`${CLI} save "<text>" --type bugfix\\|decision --lesson "<≤500 chars>" [--importance 1-3] [--closes-deferred N] [--supersedes 12,E#34]\` - \`<text>\` is a **required positional**; \`--lesson\` over 500 fails immediately; \`--supersedes\` replaces an old memory the code has overturned |
| Defer work | \`${CLI} defer add "<title ≤200>" [--priority 1\\|2\\|3] [--detail "<constraint + why deferred>"]\` - a title over 200 moves to \`--detail\` |
| Edit a deferred item | \`${CLI} defer update D#N [--title T] [--detail T] [--priority 1\\|2\\|3]\` - edits in place, id unchanged; do not drop and re-add |
| Drop a deferred item | \`${CLI} defer drop D#N --reason "<why it is not being done>"\` - for a fixed item use \`save ... --closes-deferred D#N\`, not drop |
| Edit one memory | \`${CLI} update <id> [--lesson "<≤500>"] [--title T] [--type T] [--importance 1-3] [--narrative T] [--concepts "a b c"]\` |
| Event log | \`${CLI} activity save --type <bugfix\\|lesson\\|bug\\|discovery\\|refactor\\|feature\\|observation\\|decision> "<title>" [--body T] [--files f1,f2]\` |

\`maintain\` / \`optimize\` / \`compress\` are under "Maintenance / admin tools" above; \`maintain --ops\`
takes \`cleanup,decay,boost,demote_pinned,dedup,purge_stale,vacuum\`; when omitted it defaults to
\`cleanup,decay,boost,demote_pinned\` (order matters: demote_pinned must come after boost);
\`--retain-days\` ∈ [7,365].

## Uninstall / disable

- \`${CLI} unadopt\`: removes the managed block from CLAUDE.md and QWEN.md. A per-project
  detail doc or state sidecar left by an older version is removed too when it is untracked and
  still carries the plugin marker; your own content in those files (outside the sentinel) is left
  alone. The shared data-dir copy of this file stays.
- Disable auto-adopt permanently for this project: \`${CLI} adopt --disable\` (\`--enable\` re-arms it).
- Disable auto-adopt globally: environment variable \`MEM_NO_AUTO_ADOPT=1\`.
- Disable automatic refresh on version drift (keeping your manual edits to the managed block):
  \`QWEN_MEM_NO_TEMPLATE_REFRESH=1\`.
`;
}
