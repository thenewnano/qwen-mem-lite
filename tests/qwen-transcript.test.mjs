// Qwen Code transcript-normalization pins.
//
// Qwen Code writes its session transcript as JSONL too, but in its own dialect:
// `message.parts` (role `model`) holding {text} / {text, thought} / {functionCall} /
// {functionResponse} entries, where Claude Code writes `message.content` blocks with
// {type: 'text'|'tool_use'|'tool_result'}. Shapes below are copied from a live Qwen Code
// 0.24.4 transcript (~/.qwen/projects/<hash>/chats/<session>.jsonl).
//
// Every transcript scanner in lib/ was written against the Claude shape, so on a Qwen
// session they all answered zero — silently. lib/transcript-scan.mjs normalizes at the one
// point where any scanner gets its entries; these cases pin the normalization itself and
// two real consumers of it (citation extraction, deliberate-persistence counting), because
// a normalizer nobody consumes is the same silence with more code.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTranscriptEntries, _resetTranscriptCache } from '../lib/transcript-scan.mjs';
import { extractCitationsFromTranscript } from '../lib/citation-tracker.mjs';
import { countDeliberatePersistence } from '../lib/persist-reminder.mjs';

let dir;
let transcript;

/** One Qwen transcript line: role follows the host's own spelling (`model`). */
function qwenEntry(type, parts) {
  return JSON.stringify({
    uuid: Math.random().toString(36).slice(2),
    type,
    message: { role: type === 'assistant' ? 'model' : 'user', parts },
  });
}

function write(lines) {
  writeFileSync(transcript, lines.join('\n') + '\n');
  _resetTranscriptCache();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qwen-transcript-'));
  transcript = join(dir, 'session.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  _resetTranscriptCache();
});

describe('Qwen transcript normalization', () => {
  it('maps text parts onto assistant text blocks and drops reasoning parts', () => {
    write([
      qwenEntry('assistant', [
        { text: 'thinking out loud', thought: true },
        { text: 'Applied #42 to the fix.' },
      ]),
    ]);
    const [entry] = readTranscriptEntries(transcript);
    expect(entry.message.role).toBe('assistant');
    const texts = entry.message.content.filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts).toEqual(['Applied #42 to the fix.']);
    expect(entry.message.content.some((b) => b.text === 'thinking out loud')).toBe(false);
  });

  it('maps functionCall onto tool_use with canonical tool names', () => {
    write([
      qwenEntry('assistant', [
        { functionCall: { id: 'call_1', name: 'write_file', args: { file_path: '/tmp/x.mjs' } } },
      ]),
      qwenEntry('user', [
        { functionResponse: { id: 'call_1', name: 'write_file', response: { output: 'created' } } },
      ]),
    ]);
    const [assistant, user] = readTranscriptEntries(transcript);
    expect(assistant.message.content[0]).toEqual({
      type: 'tool_use',
      name: 'Write',
      input: { file_path: '/tmp/x.mjs' },
    });
    expect(user.message.content[0]).toEqual({ type: 'tool_result', content: 'created' });
  });

  it('leaves Claude-shaped entries untouched', () => {
    const claude = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Applied #7.' }] },
    });
    write([claude]);
    const [entry] = readTranscriptEntries(transcript);
    expect(entry.message.content).toEqual([{ type: 'text', text: 'Applied #7.' }]);
    expect(entry.message.role).toBe('assistant');
  });
});

describe('Qwen transcripts reach the scanners that read them', () => {
  it('citations in Qwen assistant text are extracted', () => {
    write([qwenEntry('assistant', [{ text: 'Applied #42 and ruled out #43.' }])]);
    expect([...extractCitationsFromTranscript(transcript)].sort()).toEqual([42, 43]);
  });

  it('a Qwen mem_save call counts as deliberate persistence under its MCP id', () => {
    // Qwen names the server by the extension's own key, so the recorded tool id is
    // mcp__mem-lite__mem_save — not one of the plugin_* spellings Claude Code uses.
    write([
      qwenEntry('assistant', [
        { functionCall: { id: 'c1', name: 'mcp__mem-lite__mem_save', args: { type: 'bugfix' } } },
      ]),
    ]);
    expect(countDeliberatePersistence(transcript)).toBe(1);
  });

  it('a Qwen CLI save through run_shell_command counts as persistence', () => {
    // The CLI fallback is recognised by the Bash branch, so the id has to arrive as `Bash`.
    write([
      qwenEntry('assistant', [
        {
          functionCall: {
            id: 'c2',
            name: 'run_shell_command',
            args: { command: 'node cli.mjs save "lesson" --type lesson' },
          },
        },
      ]),
    ]);
    expect(countDeliberatePersistence(transcript)).toBe(1);
  });
});
