// Qwen Code host-vocabulary pins.
//
// Qwen Code loads this plugin's hooks/hooks.json verbatim and substitutes
// ${CLAUDE_PLUGIN_ROOT}; only the payload differs — it sends its own runtime tool ids
// (`write_file`, `read_file`, `edit`, `run_shell_command`) where Claude Code sent
// `Write`/`Read`/`Edit`/`Bash`. Captured from a live Qwen Code 0.24.4 session.
//
// Left untranslated, the whole pipeline took the wrong branch on that host: a Read was
// weighted as an Edit, an edit matched no skip entry, and Bash significance,
// error-recall and the subagent injection were dead. lib/tool-names.mjs is the single
// translation point; these cases pin the mapping, pin that the translated names land on
// sets that exist, and pin the entry points that must apply it.
//
// The behavioural case is pre-tool-recall's cooldown `mode`: it is written 'read' for a
// read tool and 'edit' otherwise, and it was the first thing to be observably wrong
// (`read_file` recorded 'edit') — a cheap end-to-end proof that the payload reached the
// script and was translated, without an LLM, a network call, or a host.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { normalizeToolName, QWEN_TOOL_IDS } from '../lib/tool-names.mjs';
import { SKIP_TOOLS } from '../skip-tools.mjs';
import { EDIT_TOOLS } from '../utils.mjs';
import { initSchema } from '../schema.mjs';
import { insertSession, SUBPROCESS_TIMEOUT_MS } from './test-helpers.mjs';

const REPO = join(import.meta.dirname, '..');
const PRE_RECALL = join(REPO, 'scripts', 'pre-tool-recall.js');

function runScript(script, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script], {
      env: { ...process.env, QWEN_MEM_HOOK_RUNNING: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    child.on('error', reject);
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
    setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: ${script}`));
    }, SUBPROCESS_TIMEOUT_MS);
  });
}

describe('normalizeToolName', () => {
  it('maps the ids a live Qwen Code session sends onto the canonical vocabulary', () => {
    expect(normalizeToolName('read_file')).toBe('Read');
    expect(normalizeToolName('write_file')).toBe('Write');
    expect(normalizeToolName('edit')).toBe('Edit');
    expect(normalizeToolName('notebook_edit')).toBe('NotebookEdit');
    expect(normalizeToolName('run_shell_command')).toBe('Bash');
    expect(normalizeToolName('grep_search')).toBe('Grep');
    expect(normalizeToolName('glob')).toBe('Glob');
    expect(normalizeToolName('agent')).toBe('Agent');
  });

  it('treats Claude Code names as identity', () => {
    for (const name of ['Edit', 'Write', 'Read', 'Bash', 'NotebookEdit', 'Grep', 'Glob']) {
      expect(normalizeToolName(name)).toBe(name);
    }
  });

  it('passes unknown and non-string names through untouched', () => {
    expect(normalizeToolName('mcp__mem-lite__mem_search')).toBe('mcp__mem-lite__mem_search');
    expect(normalizeToolName('monitor')).toBe('monitor');
    expect(normalizeToolName(null)).toBe(null);
    expect(normalizeToolName(undefined)).toBe(undefined);
    expect(normalizeToolName(42)).toBe(42);
  });

  it('never maps a tool onto a name no downstream set knows', () => {
    // A mapping whose target is not a name the pipeline branches on is decoration: the
    // edit/read/bash decisions would keep taking their default branch while looking
    // translated. Every target below must be a real member of a real set.
    const known = new Set([
      ...EDIT_TOOLS,
      ...SKIP_TOOLS,
      'Read',
      'Bash',
      'Grep',
      'Agent',
      'Task',
      'WebFetch',
      'WebSearch',
    ]);
    for (const id of QWEN_TOOL_IDS) {
      expect(known, `no downstream set knows ${id} → ${normalizeToolName(id)}`).toContain(
        normalizeToolName(id),
      );
    }
  });
});

describe('Qwen payloads reach the hook entry points translated', () => {
  let tmpRoot;
  let projectDir;

  beforeEach(() => {
    tmpRoot = join(
      tmpdir(),
      `qwen-tool-names-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    projectDir = join(tmpRoot, 'parent', 'qwenproj');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'target.mjs'), 'export const x = 1;\n');

    const db = new Database(join(tmpRoot, 'qwen-mem-lite.db'));
    db.pragma('foreign_keys = OFF');
    initSchema(db);
    insertSession(db, { id: 'sess-qwen', project: 'parent--qwenproj', memoryId: 'mem-qwen' });
    db.close();
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  const cooldownFor = (sessionId) =>
    JSON.parse(readFileSync(join(tmpRoot, 'runtime', `pre-recall-cooldown-${sessionId}.json`), 'utf8'));

  it('records a Qwen read_file as a READ, not an edit', async () => {
    await runScript(
      PRE_RECALL,
      {
        tool_name: 'read_file',
        session_id: 'qwen-read',
        tool_input: { file_path: join(projectDir, 'target.mjs') },
      },
      { QWEN_MEM_DIR: tmpRoot, CLAUDE_PROJECT_DIR: projectDir },
    );
    expect(cooldownFor('qwen-read')[join(projectDir, 'target.mjs')].mode).toBe('read');
  });

  it('records a Qwen write_file as an edit', async () => {
    await runScript(
      PRE_RECALL,
      {
        tool_name: 'write_file',
        session_id: 'qwen-write',
        tool_input: { file_path: join(projectDir, 'target.mjs') },
      },
      { QWEN_MEM_DIR: tmpRoot, CLAUDE_PROJECT_DIR: projectDir },
    );
    expect(cooldownFor('qwen-write')[join(projectDir, 'target.mjs')].mode).toBe('edit');
  });

  it('does not file a Qwen edit as an unknown tool', async () => {
    // Before the mapping, the upstream-shape probe in pre-tool-recall.js logged
    // `pre-recall:unknown-tool` for every path-less payload from this host.
    await runScript(
      PRE_RECALL,
      {
        tool_name: 'edit',
        session_id: 'qwen-edit',
        tool_input: { file_path: join(projectDir, 'target.mjs') },
      },
      { QWEN_MEM_DIR: tmpRoot, CLAUDE_PROJECT_DIR: projectDir },
    );
    const errors = join(tmpRoot, 'runtime', 'hook-errors');
    let logged = '';
    try {
      logged = readFileSync(join(errors, `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8');
    } catch {
      /* no hook errors at all is the expected shape */
    }
    expect(logged).not.toContain('unknown-tool');
  });
});

describe('entry points apply the translation', () => {
  const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

  it('hook.mjs normalizes both tool-name handlers', () => {
    const src = read('hook.mjs');
    expect(src).toContain("from './lib/tool-names.mjs'");
    // PostToolUse builds the episode entry from the normalized name…
    expect(src).toMatch(/const toolName = normalizeToolName\(tool_name\);/);
    // …and PostToolUseFailure re-checks its Bash gate through the same map.
    expect(src).toMatch(/if \(normalizeToolName\(tool_name\) !== 'Bash'\) return;/);
  });

  it('scripts/pre-tool-recall.js normalizes before its whitelist and read checks', () => {
    const src = read('scripts/pre-tool-recall.js');
    expect(src).toContain("from '../lib/tool-names.mjs'");
    expect(src).toMatch(/toolName = normalizeToolName\(event\.tool_name \|\| null\);/);
    expect(src).toMatch(/toolName = normalizeToolName\(toolName\);/);
  });

  it('scripts/pre-agent-inject.js accepts the Qwen dispatch id', () => {
    expect(read('scripts/pre-agent-inject.js')).toMatch(/hook\.tool_name !== 'agent'/);
    const hooks = JSON.parse(read('hooks/hooks.json'));
    const agentEntry = hooks.hooks.PreToolUse.find((e) =>
      e.hooks.some((h) => (h.command || '').includes('pre-agent-inject')),
    );
    expect(agentEntry.matcher).toContain('agent');
  });
});
