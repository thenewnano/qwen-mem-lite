// Consistency test: ensures scripts/post-tool-use.sh skip patterns match skip-tools.mjs.
//
// Three lists encode the same decision, in two languages:
//   1. skip-tools.mjs::SKIP_TOOLS — the Node source of truth (Claude Code spellings).
//   2. post-tool-use.sh's first case arm — a literal copy of (1), hand-kept because a
//      builtins-only ~5ms pre-filter cannot import a module.
//   3. post-tool-use.sh's second case arm — the same skips under Qwen Code's runtime ids,
//      which is DERIVED: exactly the ids that lib/tool-names.mjs normalizes into (1).
//
// (3) is checked as a relation rather than a copy on purpose — a hand-kept third copy
// would drift from lib/tool-names.mjs silently, which is the failure this file exists to
// prevent. Adding a Qwen id to the map that lands on a skipped tool reds here until the
// shell arm lists it, and adding a skip to SKIP_TOOLS reds until both arms carry it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SKIP_TOOLS, SKIP_PREFIXES } from '../skip-tools.mjs';
import { normalizeToolName, QWEN_TOOL_IDS } from '../lib/tool-names.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bashScript = readFileSync(join(__dirname, '..', 'scripts', 'post-tool-use.sh'), 'utf-8');

/** Split one `case "$tool" in` arm's pattern list into its `|`-separated names. */
function parseCaseArm(script, anchorComment) {
  const at = script.indexOf(anchorComment);
  if (at === -1) return null;
  // Drop comment-only lines before hunting for the arm's closing `)`: the anchors are
  // comments, and one of them ends in a parenthesis of its own.
  const rest = script.slice(at).replace(/^[ \t]*#[^\n]*$/gm, '');
  const end = rest.search(/\)\s*\n/);
  const body = end === -1 ? rest : rest.slice(0, end);
  const cleaned = body.replace(/\\\n/g, '').replace(/\s+/g, '');
  return cleaned.split('|').filter(Boolean);
}

/**
 * Parse the bash pre-filter's three skip surfaces.
 *
 * - `readTools`: the Read fast path above the case block, which every read id takes
 *   (it records the path for episode context and exits before Node).
 * - `claudeArmTools`: the Claude arm, a literal copy of SKIP_TOOLS minus `Read`.
 * - `qwenTools`: the derived arm, Qwen Code runtime ids.
 */
function parseBashSkipTools(script) {
  const readTools = new Set();
  const readIf = script.match(/if \[\[ "\$tool" == "Read"([^\]]*)\]\]/);
  if (readIf) {
    readTools.add('Read');
    for (const m of (readIf[1] || '').matchAll(/"\$tool" == "([^"]+)"/g)) {
      readTools.add(m[1]);
    }
  }

  const claudeArmTools = new Set(parseCaseArm(script, '# Exact matches') || []);
  const qwenTools = new Set(parseCaseArm(script, '# The same skips under Qwen Code') || []);

  const prefixes = [];
  const prefixMatch = script.match(/# Prefix filters\n\s*(.*?)\)/);
  if (prefixMatch) {
    for (const pattern of prefixMatch[1]
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean)) {
      // Convert bash glob "foo*" to prefix "foo"
      if (pattern.endsWith('*')) prefixes.push(pattern.slice(0, -1));
    }
  }

  return { readTools, claudeArmTools, qwenTools, prefixes };
}

describe('skip-tools consistency', () => {
  const {
    readTools: bashReadTools,
    claudeArmTools: bashClaudeArmTools,
    qwenTools: bashQwenTools,
    prefixes: bashPrefixes,
  } = parseBashSkipTools(bashScript);

  it('bash Claude arm matches SKIP_TOOLS set', () => {
    const nodeTools = new Set(SKIP_TOOLS);
    // `Read` sits on the fast path above the case block, not in the arm.
    const bashTools = new Set([...bashClaudeArmTools, 'Read']);
    const missingInBash = [...nodeTools].filter((t) => !bashTools.has(t));
    const extraInBash = [...bashTools].filter((t) => !nodeTools.has(t));

    expect(
      missingInBash,
      `Tools in skip-tools.mjs but not in post-tool-use.sh: ${missingInBash.join(', ')}`,
    ).toEqual([]);
    expect(
      extraInBash,
      `Tools in post-tool-use.sh but not in skip-tools.mjs: ${extraInBash.join(', ')}`,
    ).toEqual([]);
  });

  it('bash Qwen arm is exactly the Qwen ids that normalize into SKIP_TOOLS', () => {
    // Ids on the Read fast path above the case block are covered by the test below, not
    // by this arm — otherwise every read would be listed twice.
    const derived = QWEN_TOOL_IDS.filter(
      (id) => SKIP_TOOLS.has(normalizeToolName(id)) && !bashReadTools.has(id),
    );
    expect([...bashQwenTools].sort(), 'Qwen arm in post-tool-use.sh must mirror lib/tool-names.mjs').toEqual(
      derived.sort(),
    );
  });

  it('the Read fast path carries every Qwen id that normalizes to Read', () => {
    const derived = QWEN_TOOL_IDS.filter((id) => normalizeToolName(id) === 'Read');
    expect(derived, 'lib/tool-names.mjs must map Qwen’s read id').toContain('read_file');
    for (const id of derived) {
      expect(bashReadTools, `post-tool-use.sh must fast-path ${id} as a read`).toContain(id);
    }
  });

  it('bash prefix patterns match SKIP_PREFIXES', () => {
    const nodePrefixes = [...SKIP_PREFIXES].sort();
    const sortedBashPrefixes = [...bashPrefixes].sort();

    expect(
      sortedBashPrefixes,
      'Prefix patterns in post-tool-use.sh must match SKIP_PREFIXES in skip-tools.mjs',
    ).toEqual(nodePrefixes);
  });

  it('SKIP_TOOLS is non-empty', () => {
    expect(SKIP_TOOLS.size).toBeGreaterThan(0);
  });

  it('SKIP_PREFIXES is non-empty', () => {
    expect(SKIP_PREFIXES.length).toBeGreaterThan(0);
  });

  it('hook.mjs imports from skip-tools.mjs (not inline definition)', () => {
    const hookSource = readFileSync(join(__dirname, '..', 'hook.mjs'), 'utf-8');
    expect(hookSource).toContain("from './skip-tools.mjs'");
    // Should NOT have an inline SKIP_TOOLS definition
    expect(hookSource).not.toMatch(/^const SKIP_TOOLS\s*=\s*new Set\(/m);
  });
});
