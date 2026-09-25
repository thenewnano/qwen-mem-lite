// The generic OpenAI-compatible provider leg.
//
// Before it existed, "OpenAI-compatible" meant OpenRouter and nothing else: the
// transport hardcoded `https://openrouter.ai/api/v1/chat/completions` and
// `OPENROUTER_API_KEY`, so the widest provider contract in the industry — vLLM,
// Ollama, LM Studio, LiteLLM, Azure OpenAI, DashScope, DeepSeek, Groq, OpenAI
// itself — was reachable only by routing through one middleman. This leg speaks
// the same dialect to any endpoint, and reads the same OPENAI_API_KEY /
// OPENAI_BASE_URL / OPENAI_MODEL trio that Qwen Code (this fork's host) already
// standardises on, so the host's own env configures these background calls.
//
// Two properties are worth more than the rest and are pinned below by name:
// KEYLESS operation (a local server has no key to send, and a bare `Bearer ` is
// rejected by several of them) and the CLAUDE_MEM_LLM_PROVIDER pin (under Qwen
// Code, settings.json's `env` block injects ANTHROPIC_API_KEY into every session,
// so without the pin this leg is unreachable no matter what else is set).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../schema.mjs', () => ({
  DB_DIR: '/tmp/openai-compat-test',
}));

vi.mock('../utils.mjs', () => ({
  debugLog: vi.fn(),
  debugCatch: vi.fn(),
  parseJsonFromLLM: vi.fn((raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }),
}));

import { execFileSync } from 'child_process';
import {
  detectMode,
  detectModeFromEnv,
  resolveOpenAIModel,
  callHaiku,
  _resetMode,
} from '../haiku-client.mjs';

/** A fetch mock returning a successful chat-completions reply. */
function okFetch(text = 'answer') {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  });
}

/** Env for detectModeFromEnv, with the two keys every case must decide about. */
const env = (over = {}) => ({ ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', ...over });

describe('detectModeFromEnv — the generic leg', () => {
  it('selects the leg from OPENAI_API_KEY alone', () => {
    expect(detectModeFromEnv(env({ OPENAI_API_KEY: 'sk-oai' }))).toBe('openai');
  });

  it('selects the leg from OPENAI_BASE_URL alone — the keyless local server', () => {
    // Ollama / vLLM / LM Studio serve without a credential; the base URL is the
    // entire configuration. Requiring a key here would make the most common local
    // setup unusable.
    expect(detectModeFromEnv(env({ OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1' }))).toBe('openai');
  });

  it('treats a whitespace-only base URL as unset', () => {
    expect(detectModeFromEnv(env({ OPENAI_BASE_URL: '   ' }))).toBe('cli');
  });

  it('keeps the documented precedence: anthropic > openrouter > openai > cli', () => {
    const both = env({ OPENAI_API_KEY: 'sk-oai', OPENROUTER_API_KEY: 'sk-or' });
    expect(detectModeFromEnv(both)).toBe('openrouter');
    expect(detectModeFromEnv({ ...both, ANTHROPIC_API_KEY: 'sk-ant' })).toBe('api');
    expect(detectModeFromEnv(env())).toBe('cli');
  });
});

describe('CLAUDE_MEM_LLM_PROVIDER — the escape hatch', () => {
  it('pins the generic leg even when ANTHROPIC_API_KEY is present', () => {
    // The reason this exists: Qwen Code's settings.json env block injects
    // ANTHROPIC_API_KEY into every session, so key-presence order would otherwise
    // win and an OpenAI-compatible backend could never be selected.
    const e = env({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_BASE_URL: 'http://127.0.0.1:8000/v1' });
    expect(detectModeFromEnv(e)).toBe('api');
    expect(detectModeFromEnv({ ...e, CLAUDE_MEM_LLM_PROVIDER: 'openai' })).toBe('openai');
  });

  it('accepts any of the four legs, case- and whitespace-insensitively', () => {
    const e = env({ ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oai' });
    expect(detectModeFromEnv({ ...e, CLAUDE_MEM_LLM_PROVIDER: '  Api ' })).toBe('api');
    expect(detectModeFromEnv({ ...e, CLAUDE_MEM_LLM_PROVIDER: 'OPENAI' })).toBe('openai');
    expect(detectModeFromEnv({ ...e, CLAUDE_MEM_LLM_PROVIDER: 'cli' })).toBe('cli');
  });

  it('ignores a pin whose leg has no credentials, rather than obeying it into a dead leg', () => {
    // Obeying would send every call to a provider that cannot answer; detection
    // (here: the Anthropic key) is what keeps summaries flowing.
    expect(detectModeFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant', CLAUDE_MEM_LLM_PROVIDER: 'openai' }))).toBe(
      'api',
    );
  });

  it('ignores an unknown pin instead of guessing', () => {
    expect(detectModeFromEnv(env({ OPENAI_API_KEY: 'sk-oai', CLAUDE_MEM_LLM_PROVIDER: 'gpt' }))).toBe(
      'openai',
    );
  });

  it('is honoured by the memoized detectMode the workers actually call', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant');
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai');
    vi.stubEnv('CLAUDE_MEM_LLM_PROVIDER', 'openai');
    _resetMode();
    expect(detectMode()).toBe('openai');
  });
});

describe('resolveOpenAIModel', () => {
  it('falls back to real api.openai.com ids per tier when nothing is configured', () => {
    expect(resolveOpenAIModel('haiku')).toBe('gpt-4o-mini');
    expect(resolveOpenAIModel('sonnet')).toBe('gpt-4o');
  });

  it('OPENAI_MODEL overrides every tier', () => {
    vi.stubEnv('OPENAI_MODEL', 'qwen3.5-plus');
    expect(resolveOpenAIModel('haiku')).toBe('qwen3.5-plus');
    expect(resolveOpenAIModel('sonnet')).toBe('qwen3.5-plus');
  });

  it('a per-tier var beats OPENAI_MODEL, which is how tiering survives', () => {
    vi.stubEnv('OPENAI_MODEL', 'base-model');
    vi.stubEnv('OPENAI_MODEL_HAIKU', 'small-local');
    vi.stubEnv('OPENAI_MODEL_SONNET', 'big-local');
    expect(resolveOpenAIModel('haiku')).toBe('small-local');
    expect(resolveOpenAIModel('sonnet')).toBe('big-local');
  });

  it('treats blank values as unset and maps an unknown tier to the haiku default', () => {
    vi.stubEnv('OPENAI_MODEL', '   ');
    vi.stubEnv('OPENAI_MODEL_SONNET', '');
    expect(resolveOpenAIModel('sonnet')).toBe('gpt-4o');
    expect(resolveOpenAIModel('bogus')).toBe('gpt-4o-mini');
  });
});

describe('callHaiku on the generic leg — request shape', () => {
  beforeEach(() => {
    // Hermetic: the dev shell may export any of these (Qwen Code users do).
    for (const v of [
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'ANTHROPIC_BASE_URL',
      'OPENAI_BASE_URL',
      'OPENAI_MODEL',
      'OPENAI_MODEL_HAIKU',
      'OPENAI_MODEL_SONNET',
      'CLAUDE_MEM_LLM_PROVIDER',
    ]) {
      vi.stubEnv(v, '');
    }
    for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) vi.stubEnv(v, '');
    vi.mocked(execFileSync).mockReset();
    _resetMode();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('POSTs to <OPENAI_BASE_URL>/chat/completions with Bearer auth and the model id', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-key');
    vi.stubEnv('OPENAI_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    vi.stubEnv('OPENAI_MODEL', 'qwen3.5-plus');
    _resetMode();
    const fetchMock = okFetch('local answer');
    vi.stubGlobal('fetch', fetchMock);

    const result = await callHaiku('test prompt');

    expect(result).toEqual({ text: 'local answer' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-oai-key' }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('qwen3.5-plus');
  });

  it('carries the same env the HOST uses, so no second config is needed', async () => {
    // The fork's whole point: OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL are
    // Qwen Code's own names. A user who pointed Qwen at a backend has already
    // pointed this plugin at it.
    vi.stubEnv('OPENAI_API_KEY', 'sk-qwen');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    vi.stubEnv('OPENAI_MODEL', 'qwen3.5-plus');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku('x');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('defaults the base URL to api.openai.com/v1 when only a key is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-key');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku('x');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-4o-mini');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1///');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku('x');

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('sends NO Authorization header when keyless — not a bare `Bearer `', async () => {
    // Ollama and friends either ignore auth or reject a malformed header; sending
    // `Bearer ` with nothing after it is the failure mode this avoids.
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1');
    vi.stubEnv('OPENAI_MODEL', 'llama3.2');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await callHaiku('keyless prompt');

    expect(result).toEqual({ text: 'answer' });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    expect(Object.keys(headers)).not.toContain('Authorization');
  });

  it('sends the system prompt as a system-role message, with no cache_control', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku({ system: 'INSTR', user: 'DATA' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'INSTR' },
      { role: 'user', content: 'DATA' },
    ]);
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });

  it('does NOT send OpenRouter attribution headers to a generic gateway', async () => {
    // A gateway is not obliged to ignore unknown headers; one rejection would fail
    // every call on the leg.
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku('x');

    expect(fetchMock.mock.calls[0][1].headers['X-Title']).toBeUndefined();
  });

  it('honours the CLAUDE_MEM_MODEL tier through the same transport', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai');
    vi.stubEnv('CLAUDE_MEM_MODEL', 'sonnet');
    _resetMode();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    await callHaiku('x');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-4o');
  });

  it('degrades to the claude CLI when the endpoint answers an HTTP error', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1');
    _resetMode();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    vi.mocked(execFileSync).mockReturnValue('cli answer');

    const result = await callHaiku('x');

    expect(result).toEqual({ text: 'cli answer' });
  });

  it('never throws when the endpoint is unreachable', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1/v1');
    _resetMode();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    vi.mocked(execFileSync).mockReturnValue('cli answer');

    await expect(callHaiku('x')).resolves.toEqual({ text: 'cli answer' });
  });
});
