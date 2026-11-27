---
name: adopt
description: "Use when: user asks to put the qwen-mem-lite steering block into the current project's CLAUDE.md (for example to share it with the team), or to (re)install it there. Writes a sentinel-wrapped managed block into <cwd>/CLAUDE.md and <cwd>/QWEN.md, removes the auto-written local copy (CLAUDE.local.md or .claude/rules/qwen-mem-lite.md), and migrates away any legacy memory-dir sentinel. The full detail doc stays in the plugin data directory, shared by every project, so no .claude/.qwen files are added. Auto-adopt never adds the block to CLAUDE.md itself; it only keeps an existing one in sync. Run /unadopt to remove."
---

# /adopt

Install the qwen-mem-lite **steering block** into the current project's
`CLAUDE.md` and `QWEN.md` (the canonical home for project instructions — Claude Code loads it
into every session, in a message after the system prompt). It does not go
in the project's memory-dir `MEMORY.md`: that index belongs to the user's own
memories.

This normally runs on demand. Auto-adopt keeps a local copy on every SessionStart: in a git
repository the block goes to `CLAUDE.local.md` at the repository root, excluded from git
through `.git/info/exclude`. Next to an `AGENTS.md` that file would switch off, and where it
cannot be written (outside git, for example), it adds the text to each session's context
instead; with `QWEN_MEM_RULES_STEERING=1` it keeps the block in `.claude/rules/qwen-mem-lite.md`
next to an `AGENTS.md`, excluded the same way. Run `/adopt` when you want the block in
`CLAUDE.md`/`QWEN.md` - a file that is normally committed, so your team gets it too. It removes the local
copy so the text does not load twice. A project that carries the block is kept in sync on every
SessionStart, and a `CLAUDE.md` holding nothing but the block gets the `AGENTS.md` import
described below.
A session started where the host already loads the current block from a directory above the
repository root writes no local copy and adds nothing. A project file committed as a link out of
the repository is refused rather than written through.

## What it writes

1. **`<cwd>/CLAUDE.md`** - a concise `<!-- qwen-mem-lite:begin v1 -->…<!-- :end -->`
   managed block (trigger table → `mem_recall` / `mem_save` / `mem_defer`).
   Slug-scoped: only this block, and the import below in a file adopt created, are
   managed; the rest of your `CLAUDE.md` is preserved verbatim. Auto-refreshes when
   the shipped content drifts. Claude Code stops reading `AGENTS.md` once a `CLAUDE.md`
   exists, so a `CLAUDE.md` adopt creates next to an `AGENTS.md` (or `.claude/AGENTS.md`)
   starts with a marker comment and `@AGENTS.md`, which keeps it loading. An `AGENTS.md`
   above the directory or tracked below it cannot be imported; the output names it with
   the setting that keeps it.
2. **`<cwd>/QWEN.md`** - the same block. Qwen Code loads `QWEN.md` and ignores
   `CLAUDE.md`, so both files are written.
3. **`~/.qwen-mem-lite/plugin_claude_mem_lite.md`** - the full contract (tool
   tables, CLI cheatsheet, citation/decay + save discipline), shared by every
   project and read on demand when the block points to it. It is not written
   into the project; a per-project detail doc or state sidecar left by an older
   version is removed on the next adopt when it is untracked and still carries
   the plugin marker.

It also **migrates** this project's legacy memory-dir sentinel away (strips the
`qwen-mem-lite:*` block from `MEMORY.md` and deletes the old memory-dir detail
doc). Other plugins' blocks (e.g. `code-graph-mcp:*`) and your own prose survive.

## Flags

- `--force` - also force-clean a legacy memory-dir block lacking a state sidecar
- `--dry-run` - print intended writes without touching disk
- `--all` - legacy-cleanup sweep: strip the old memory-dir sentinel across **every**
  project at once. (It does NOT write CLAUDE.md blocks for other projects - their
  real paths can't be recovered from the encoded memdir slug; those adopt
  per-project on each one's next SessionStart.)
- `--status` - show this project's adoption + count of memdirs awaiting migration
- `--disable` / `--enable` - per-project opt-out of automatic SessionStart adopt
  (`--enable` also lets the plugin write a removed local block again; beside an `AGENTS.md`
  that `CLAUDE.local.md` would switch off, only with `QWEN_MEM_RULES_STEERING=1`)

## Removal & opt-out

- `/unadopt` removes the CLAUDE.md/QWEN.md block (your prose stays) and the
  local block; a legacy per-project detail doc is cleaned when untracked. The
  next session writes a local file if the plugin never
  created one in this repository; one it created before is not written back (the
  text is injected instead) until `node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" adopt --enable`. Beside an
  `AGENTS.md` that `CLAUDE.local.md` would switch off, no file is written unless
  `QWEN_MEM_RULES_STEERING=1`.
- `node "${CLAUDE_PLUGIN_ROOT}/cli.mjs" adopt --disable` permanently stops auto-adopt for this project
  (also for sessions started in its subdirectories) and removes the local block; a
  `CLAUDE.md` block stays until `/unadopt`.
- `MEM_NO_AUTO_ADOPT=1` disables auto-adopt globally; blocks already written stay.
- `QWEN_MEM_NO_TEMPLATE_REFRESH=1` freezes the block against drift-refresh
  (keeps your hand-edits to the managed block).

## Conservative layer still active

Adoption does NOT remove the hook-based injection (SessionStart context,
UserPromptSubmit related-memory). Those remain as fallback. Post-adopt the MCP
`WHEN TO USE` section + the `File Lessons` / `Key Context` sections auto-trim,
since the CLAUDE.md block already carries the triggers.

## Restart caveat for the MCP-instructions trim

The CLAUDE.md block + hook-layer trim apply on the **next SessionStart**. The MCP
server builds its instructions once at boot, so the MCP-instructions trim
(`WHEN TO USE` / `Decision rules`) only takes effect after Claude Code restarts
(or re-attaches the mem-lite MCP server). A `/exit` + fresh session is enough.
Same caveat applies in reverse for `/unadopt`.

!node ${CLAUDE_PLUGIN_ROOT}/cli.mjs adopt $ARGUMENTS
