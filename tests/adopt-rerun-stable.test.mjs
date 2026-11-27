// The detail doc and the state sidecar now live in the plugin data directory, shared by
// every project. Adopt writes only the managed block, so re-running it leaves the project
// tree untouched and no `.claude`/`.qwen` directory appears.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { writeManaged } from '../claudemd.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mem-adopt-rerun-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CLAUDE_MD = () => join(dir, 'CLAUDE.md');
const LEGACY_DOC = () => join(dir, '.claude', 'plugin_qwen_mem_lite.md');
const LEGACY_STATE = () => join(dir, '.claude', '.plugin_qwen_mem_lite_state.json');
const args = (block = 'block v1') => ({ slug: 'qwen-mem-lite', version: 'v1', block });

describe('writeManaged leaves an unchanged block byte-identical', () => {
  it('a second identical write does not touch the context file', () => {
    writeManaged(dir, args());
    const before = readFileSync(CLAUDE_MD(), 'utf8');
    expect(writeManaged(dir, args()).action).toBe('unchanged');
    expect(readFileSync(CLAUDE_MD(), 'utf8')).toBe(before);
  });

  it('a changed block updates it', () => {
    writeManaged(dir, args());
    const before = readFileSync(CLAUDE_MD(), 'utf8');
    writeManaged(dir, args('block v2'));
    expect(readFileSync(CLAUDE_MD(), 'utf8')).not.toBe(before);
  });

  it('does not create a project detail doc or state sidecar', () => {
    writeManaged(dir, args());
    expect(existsSync(LEGACY_DOC())).toBe(false);
    expect(existsSync(LEGACY_STATE())).toBe(false);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
  });
});

describe('adopt keeps the detail doc in the data dir', () => {
  it('writes the shared doc and leaves the project tree clean', () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-adopt-rerun-home-'));
    try {
      const env = { ...process.env, HOME: home, QWEN_MEM_DIR: join(home, 'data'), MEM_NO_AUTO_ADOPT: '1' };
      delete env.CLAUDE_CONFIG_DIR;
      delete env.CLAUDE_PROJECT_DIR;
      const adopt = () =>
        execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'adopt'], { cwd: dir, env, encoding: 'utf8' });
      adopt();
      expect(adopt(), 'premise: a re-run with nothing to do').toMatch(/→ unchanged$/m);
      expect(existsSync(join(dir, '.claude'))).toBe(false);
      expect(readFileSync(join(home, 'data', 'plugin_claude_mem_lite.md'), 'utf8')).toMatch(
        /plugin contract/,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('refreshes a stale shared doc on the next adopt', () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-adopt-rerun-home-'));
    try {
      const env = { ...process.env, HOME: home, QWEN_MEM_DIR: join(home, 'data'), MEM_NO_AUTO_ADOPT: '1' };
      delete env.CLAUDE_CONFIG_DIR;
      delete env.CLAUDE_PROJECT_DIR;
      const adopt = () =>
        execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'adopt'], { cwd: dir, env, encoding: 'utf8' });
      adopt();
      const doc = join(home, 'data', 'plugin_claude_mem_lite.md');
      writeFileSync(doc, readFileSync(doc, 'utf8') + '\nstale line\n');
      expect(adopt()).toMatch(/→ unchanged$/m);
      expect(readFileSync(doc, 'utf8')).not.toContain('stale line');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('leaves a tracked legacy project detail doc in place', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(LEGACY_DOC(), '<!-- managed-by: qwen-mem-lite -->\nlegacy\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'c'], { cwd: dir });
    const home = mkdtempSync(join(tmpdir(), 'mem-adopt-rerun-home-'));
    try {
      const env = { ...process.env, HOME: home, QWEN_MEM_DIR: join(home, 'data'), MEM_NO_AUTO_ADOPT: '1' };
      delete env.CLAUDE_CONFIG_DIR;
      delete env.CLAUDE_PROJECT_DIR;
      execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'adopt'], { cwd: dir, env, encoding: 'utf8' });
      expect(existsSync(LEGACY_DOC()), 'a committed file is not deleted').toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
