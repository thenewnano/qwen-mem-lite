// lib/tool-names.mjs — the one place that knows a second host's tool vocabulary.
//
// The pipeline speaks Claude Code's dialect. Skip lists, EDIT_TOOLS, makeEntryDesc,
// detectBashSignificance, `isRead`, the episode heuristics in hook-episode.mjs and
// hook-llm.mjs — every one of those is keyed on 'Edit' / 'Write' / 'Read' / 'Bash'.
//
// Qwen Code sends its own runtime ids instead: `edit`, `write_file`, `read_file`,
// `run_shell_command`. Captured from a live Qwen Code 0.24.4 session (hooks/hooks.json
// is loaded by Qwen verbatim and only the payload differs), not inferred from its docs.
// Left untranslated, a Qwen Read was weighted as an Edit, a Qwen edit matched no skip
// entry, and Bash significance / error-recall / bad-shape telemetry never ran at all.
//
// Translate ONCE, where the payload arrives — hook.mjs, scripts/pre-tool-recall.js,
// scripts/pre-agent-inject.js — and everything downstream keeps the names it was designed
// around. The alternative, teaching each downstream set a second vocabulary, puts the same
// knowledge in a dozen files and drifts on the first one somebody forgets.
//
// Unknown names pass through UNCHANGED: a tool this table has not seen keeps its own name
// rather than being reported as some other tool. Claude Code's names are already canonical,
// so they are identity here and a Claude install is untouched by this module.
//
// scripts/post-tool-use.sh cannot import this — it is a builtin-only ~5 ms pre-filter, and
// the pure-bash charter in hook-launcher.mjs explains why that is not negotiable. Its case
// list therefore spells the same ids out by hand; tests/skip-tools.test.mjs pins the two
// together so the duplication cannot drift silently.

/** Qwen Code runtime tool id → the Claude Code spelling the rest of the pipeline uses. */
const QWEN_TO_CANONICAL = {
  read_file: 'Read',
  write_file: 'Write',
  edit: 'Edit',
  replace: 'Edit', // Qwen's legacy id for edit (its own canonicalToolName() maps it)
  notebook_edit: 'NotebookEdit',
  run_shell_command: 'Bash',
  grep_search: 'Grep',
  glob: 'Glob',
  task_create: 'TaskCreate',
  task_update: 'TaskUpdate',
  task_list: 'TaskList',
  todo_write: 'TodoWrite',
  ask_user_question: 'AskUserQuestion',
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
  agent: 'Agent',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
};

/**
 * Map a host tool id onto the canonical name the rest of the pipeline branches on.
 * Non-strings and unrecognized names come back untouched — this never guesses.
 * @param {string} name
 * @returns {string}
 */
export function normalizeToolName(name) {
  if (typeof name !== 'string') return name;
  return QWEN_TO_CANONICAL[name] ?? name;
}

/**
 * Every id this module knows how to translate. Exported for the tests that keep
 * scripts/post-tool-use.sh's hand-written case list in step with this table.
 */
export const QWEN_TOOL_IDS = Object.keys(QWEN_TO_CANONICAL);
