<!-- qwen-mem-lite:begin v1 -->
## qwen-mem-lite - persistent memory

PreToolUse hooks already run `mem_recall` for past lessons before Read/Edit/Write. The calls worth making proactively:

| When | Call |
|------|------|
| Before Edit/Write | hook already recalled; if an injected `#NN` lesson changed what you did, add the bare tag `(#NN)` once at the end of the sentence describing that change (citing = adopting; uncited lessons decay; skip ones that did not apply). No other mention of memory ids, saves or the memory store in replies to the user |
| A recalled memory drives an answer or a design choice | check its claim in the code or `git log` first: `#NN` and `E#NN` rows are notes from past sessions, many written automatically, so they can be wrong, and they describe the code as it was. If the code disagrees, trust the code and replace the note: `mem_save(..., supersedes=[NN])`, or `supersedes=["E#NN"]` for an event |
| After fixing a non-trivial bug | `mem_save(type="bugfix", lesson_learned="<root cause + fix, only what this change's diff shows>", importance=2)` |
| After a non-obvious architecture decision | `mem_save(type="decision", lesson_learned="<constraint + tradeoff>")` |
| Deferring to a future session | `mem_defer({title, priority:1|2|3, detail})`; when fixed, add `closes_deferred=[N]` to `mem_save` |
| Looking up past work / history | `mem_search "keywords"` · `mem_recent` · `mem_timeline` |

Path cost is round-trips, not milliseconds: the PreToolUse hook above already recalls (0 calls) - prefer it. For an explicit query, if these `mem_*` tools are deferred behind ToolSearch this session, the Bash CLI `qwen-mem-lite` is one call vs two (ToolSearch + call); the MCP server instructions carry the absolute path to use when it is not on PATH.

Full tool + CLI tables, citation/decay rules, and save discipline → `.claude/plugin_claude_mem_lite.md`
<!-- qwen-mem-lite:end -->

## Working in this repo (Qwen Code)

The tracked root `.mcp.json` is the Claude Code plugin chain — leave it alone. Qwen overlays MCP servers in the order `user < project .mcp.json < workspace .qwen/settings.json < CLI`, and `${CLAUDE_PLUGIN_ROOT}` is hydrated only for extension-provided configs, so inside this checkout the project-scope `mem-lite` shadows the extension's entry and reports as disconnected.

Fix the session with a gitignored local override — `.qwen/settings.json`:

```json
{
  "mcpServers": {
    "mem-lite": {
      "command": "node",
      "args": ["./scripts/launch.mjs"]
    }
  }
}
```

then run `qwen mcp approve mem-lite` (approval is hash-bound to the config — re-run after every edit). Workspace scope outranks `.mcp.json` and the extension, so the session runs the live checkout; `qwen mcp list` verifies.
