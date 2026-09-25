// One parse of a Claude Code transcript, shared by everything that scans it.
//
// Audit 2026-08-22 P2-8. handleStop asked the same .jsonl the same question eight
// different ways — tail assistant text, citations, citations again with mainOnly,
// injected-by-surface, cite-back signals, main-thread text, cite-recall, bugfix shape —
// and every one of them did its own readFileSync + split('\n') + JSON.parse per line.
// Measured on a real 5.7MB transcript: ~25ms per pass, so the repeated work is roughly
// 175ms of a 5s Stop budget, and it scales linearly with a session that runs long.
// Parsing is nearly all of it; iterating an already-parsed array of 2908 entries is
// 0.1ms.
//
// This is a memo, not a rewrite: each scanner keeps its own per-entry logic exactly as
// it was, and only stops re-reading and re-parsing the file to get at it.
import { readFileSync, existsSync, statSync } from 'fs';
import { getHeapStatistics } from 'v8';
import { normalizeToolName } from './tool-names.mjs';

// Parsed entries cost ~3.45× the file size in heap (measured: 5.7MB file → 19.5MB).
export const TRANSCRIPT_ENTRY_HEAP_FACTOR = 3.45;

// Retention cap, kept as the FLOOR of the heap-aware budget below.
//
// Audit 2026-09-02 P2-12: above this cap the memo is declined and every caller parses for
// itself, so `handleStop` — which asks this file twelve questions — degrades to twelve full
// parses at exactly the size where one parse is already expensive. The audit's proposed fix
// was to cache a projected subset of each entry instead. That was NOT taken: the twelve
// scanners read arbitrary fields, so a projection is a hand-maintained field manifest, and
// a scanner reading a field nobody remembered to project sees `undefined` and silently
// answers a narrower question — this repo's most-repeated defect, traded for a path no
// transcript here reaches (112 transcripts on the machine that filed the audit, largest
// 4.9MB, ZERO above the cap; the report's "50MB ≈ 3.8s" is an extrapolation from a 4.37MB
// measurement, not an observation).
//
// What changed instead: the cap is no longer a bare constant. The thing it is protecting is
// the heap, so it is expressed against the heap — a quarter of this process's limit, capped
// at 256MB and floored at the old 24MB. On an ordinary 64-bit Node (~4GB limit) that admits
// transcripts up to ~74MB, i.e. the degenerate case the audit described now takes one parse
// instead of twelve; under a constrained limit (a 512MB CI container) the budget shrinks
// with it and can fall BELOW the old constant, which is the correct direction and is
// precisely what a fixed 24MB could not do. No caller sees any difference in what it gets.
export const TRANSCRIPT_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const TRANSCRIPT_CACHE_HEAP_SHARE = 0.25;
const TRANSCRIPT_CACHE_CEILING_BYTES = 256 * 1024 * 1024;

/**
 * Largest transcript whose parsed form this process is willing to retain.
 *
 * @param {number} [heapLimitBytes] test seam; defaults to this process's V8 limit
 * @returns {number} bytes
 */
export function transcriptCacheBudgetBytes(heapLimitBytes) {
  // "Not supplied" and "supplied but unusable" are different, and collapsing them would
  // make a bad explicit argument silently read the real heap instead of failing safe.
  let limit;
  if (heapLimitBytes === undefined) {
    try {
      limit = getHeapStatistics().heap_size_limit;
    } catch {
      limit = 0;
    }
  } else {
    limit = heapLimitBytes;
  }
  // An unreadable or nonsensical limit must not widen the budget — fall back to the
  // constant, which is the value this cap had before it became heap-derived.
  if (!Number.isFinite(limit) || limit <= 0) return TRANSCRIPT_CACHE_MAX_BYTES;
  const budget = Math.floor((limit * TRANSCRIPT_CACHE_HEAP_SHARE) / TRANSCRIPT_ENTRY_HEAP_FACTOR);
  return Math.min(Math.max(budget, 0), TRANSCRIPT_CACHE_CEILING_BYTES);
}

/**
 * Qwen Code records the same conversation in its own dialect: `message.parts` (role
 * `model`) holding `{text}` / `{text, thought}` / `{functionCall}` /
 * `{functionResponse}` entries, where Claude Code writes `message.content` blocks
 * (`{type: 'text'|'tool_use'|'tool_result'}`). Measured 2026-09-25 on a live Qwen Code
 * 0.24.4 transcript under `~/.qwen/projects/<hash>/chats/<session>.jsonl`.
 *
 * Every scanner below was written against the Claude shape, so without this they all read
 * an empty `content` and answer zero — citation tracking, the unsaved-bugfix nudge and the
 * fast-summary tail all went quiet on that host, with no error anywhere. Normalizing HERE,
 * in the one place any scanner gets its entries, is what keeps twelve scanners unmodified:
 * they keep reading the shape they were written for, tool names arrive in the same
 * vocabulary the rest of the plugin branches on (lib/tool-names.mjs), and a third host
 * costs one case in this function rather than a dozen.
 *
 * `thought` parts are dropped rather than mapped to text: they are the model's reasoning,
 * Claude's transcripts have no equivalent, and promoting them would let a plan count as an
 * answer for the surfaces that ask "did the assistant say anything" — cite-recall's ratio
 * and the unsaved-bugfix counter among them.
 */
function normalizeQwenEntry(entry) {
  const msg = entry?.message;
  if (!msg || !Array.isArray(msg.parts)) return entry;
  const content = [];
  for (const part of msg.parts) {
    if (!part) continue;
    if (typeof part.text === 'string') {
      if (part.thought) continue;
      content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      content.push({
        type: 'tool_use',
        name: normalizeToolName(part.functionCall.name),
        input: part.functionCall.args || {},
      });
    } else if (part.functionResponse) {
      // `response` is `{output: "…"}` in every captured sample; a bare string is accepted
      // too because the scanners test `typeof content === 'string'`.
      const response = part.functionResponse.response;
      content.push({
        type: 'tool_result',
        content: typeof response === 'string' ? response : (response?.output ?? response),
      });
    }
  }
  return { ...entry, message: { ...msg, role: msg.role === 'model' ? 'assistant' : msg.role, content } };
}

let cacheKey = '';
let cacheEntries = null;

/**
 * Parsed transcript records, in file order, unparsable lines dropped.
 *
 * The cache key carries size and mtime: a transcript is append-only and Claude Code is
 * still writing to it while the Stop hook runs, so a later caller in the same process
 * must see the same fresh data it would have read for itself.
 *
 * @param {string|null|undefined} transcriptPath
 * @param {object} [opts]
 * @param {number} [opts.maxBytes] Retention budget. A TEST SEAM — production passes
 *   nothing and gets `transcriptCacheBudgetBytes()`. Exercising the over-budget branch for
 *   real would mean writing a 256MB fixture; the alternative (asserting only the default
 *   budget's value) would leave the branch that actually declines the memo untested.
 *   It is part of the cache KEY, not just the decision: two callers in one process passing
 *   different budgets must not read each other's entry.
 * @returns {object[]} entries (empty array when the path is missing or unreadable)
 */
export function readTranscriptEntries(transcriptPath, { maxBytes } = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let st;
  try {
    st = statSync(transcriptPath);
  } catch {
    return [];
  }
  const budget = Number.isFinite(maxBytes) ? maxBytes : transcriptCacheBudgetBytes();
  const key = `${transcriptPath} ${st.size} ${st.mtimeMs} ${budget}`;
  if (key === cacheKey && cacheEntries) return cacheEntries;

  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(normalizeQwenEntry(JSON.parse(line)));
    } catch {
      /* a partially written tail line */
    }
  }
  if (st.size <= budget) {
    cacheKey = key;
    cacheEntries = entries;
  } else {
    // Drop whatever was held: an oversized transcript should not keep an older, smaller
    // one alive in memory for the rest of the process either.
    cacheKey = '';
    cacheEntries = null;
  }
  return entries;
}

/** Test seam: forget the memo so a fixture rewritten within one mtime tick is re-read. */
export function _resetTranscriptCache() {
  cacheKey = '';
  cacheEntries = null;
}
