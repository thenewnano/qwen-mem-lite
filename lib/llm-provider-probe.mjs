// lib/llm-provider-probe.mjs — "is the configured LLM provider actually usable?"
//
// Every keyed-provider dispatcher in haiku-client.mjs degrades to `claude -p`
// when the API call fails, and says so with one debugLog('WARN') that no surface
// reads. That is the right RUNTIME behaviour — a memory hook must never block on
// a provider outage — but it means a permanently broken provider is invisible.
//
// Observed 2026-08-19 on the dev box: OPENROUTER_API_KEY set, every call failing
// at the socket (a local firewall denied the node binary's egress), doctor
// reporting 21/21 green with no mention of the provider. Cost of the silence:
// 13.5s per background LLM call instead of 1.4s, for weeks.
//
// Scope: TRANSPORT only. A rejected key answers HTTP 401 — loud, and it costs a
// real request plus shipping the key to learn. Unreachability is the silent
// class, and one socket open/close answers it.

import net from 'node:net';
import { detectModeFromEnv } from '../haiku-client.mjs';
import { httpConnectProxyFor, connectProbeViaProxy, redactProxyUrl } from './proxy-fetch.mjs';

const PROVIDER_HOST = { api: 'api.anthropic.com', openrouter: 'openrouter.ai', openai: 'api.openai.com' };

/**
 * Base-URL override in force for a leg, if any: ANTHROPIC_BASE_URL for the
 * direct API, OPENAI_BASE_URL for the generic OpenAI-compatible leg (both are
 * honoured by the transport that serves them). Probing the public host while an
 * override is set would certify a deployment against a hop the product never
 * uses - the same false-green shape the proxy seam below exists to avoid.
 * @param {'api'|'openrouter'|'openai'} mode
 * @returns {string} the trimmed override, '' when unset
 */
function baseUrlOverride(mode) {
  if (mode === 'api') return (process.env.ANTHROPIC_BASE_URL || '').trim();
  if (mode === 'openai') return (process.env.OPENAI_BASE_URL || '').trim();
  return '';
}

/**
 * Host and port the keyed provider actually serves from.
 * @param {'api'|'openrouter'|'openai'} mode
 * @returns {{host: string, port: number}}
 */
function providerEndpoint(mode) {
  const base = baseUrlOverride(mode);
  if (base) {
    try {
      const u = new URL(base);
      return { host: u.hostname, port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80 };
    } catch {
      /* malformed base URL - fall through and probe the default host */
    }
  }
  return { host: PROVIDER_HOST[mode], port: 443 };
}

/**
 * Open and immediately close a TCP connection. No TLS, no request, no key.
 * @param {string} host
 * @param {{port?: number, timeout?: number}} [opts]
 * @returns {Promise<{reachable: boolean, error?: string}>} never rejects
 */
export function tcpReachable(host, { port = 443, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeout, () => {
      socket.destroy();
      done({ reachable: false, error: 'timeout' });
    });
    socket.on('connect', () => {
      socket.destroy();
      done({ reachable: true });
    });
    socket.on('error', (e) => {
      socket.destroy();
      done({ reachable: false, error: e.code || e.message });
    });
  });
}

/**
 * One doctor line about the LLM provider.
 *
 * Mode detection is IMPORTED (haiku-client's detectModeFromEnv), not re-derived.
 * It used to be a copy here, with a comment warning that the precedence order
 * must not drift — and then it drifted: the copy knew three legs and silently
 * reported 'cli' for an OpenAI-compatible setup that the transport had already
 * moved to the generic leg. detectModeFromEnv is the pure half of that module's
 * detection (no memoization), which is exactly what a diagnostic needs: an
 * answer for the current env, where detectMode caches one for a worker's life.
 *
 * Two seams, not one: the proxied and direct paths ask different questions of
 * different endpoints, so a single injected probe would have to switch on its
 * own arguments — the shape that hides which path a test actually exercised.
 *
 * @param {{_probe?: Function, _proxyProbe?: Function}} [seams]
 * @returns {Promise<{mode: string, level: 'ok'|'warn', message: string}>}
 */
export async function llmProviderStatus({ _probe = tcpReachable, _proxyProbe = connectProbeViaProxy } = {}) {
  const mode = detectModeFromEnv(process.env);

  if (mode === 'cli') {
    return {
      mode,
      level: 'ok',
      message: 'LLM provider: claude CLI (no ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY set)',
    };
  }

  const { host, port } = providerEndpoint(mode);
  // "key set" is the wrong noun for the generic leg: a keyless local server is
  // configured by its base URL alone, and reporting a missing key there would
  // send the user hunting for a credential that was never the point.
  const credential = mode === 'openai' && !process.env.OPENAI_API_KEY ? 'endpoint set (no key)' : 'key set';
  const proxy = httpConnectProxyFor(`https://${host}/`);
  // Report the hop actually exercised. When a proxy is configured the request
  // path is node → proxy → host, so probing the host directly would answer a
  // question the product never asks — and on a machine where only the proxy is
  // permitted, it would answer it wrong.
  // Redacted: HTTP(S)_PROXY legitimately carries user:pass@ and this string is
  // printed and serialized into `doctor --json`. (pre-tag review)
  const via = proxy ? `via proxy ${redactProxyUrl(proxy)}` : 'direct';

  let result;
  try {
    // Through a proxy the question is "does a tunnel open", not "is the port
    // occupied": a plain TCP connect passes against a SOCKS-only listener or a
    // proxy that forbids CONNECT, and doctor would then certify a dead
    // provider. (pre-tag review)
    result = proxy ? await _proxyProbe(proxy, host, { timeout: 4000 }) : await _probe(host, { port });
  } catch (e) {
    result = { reachable: false, error: e?.message || String(e) };
  }

  if (result?.reachable) {
    return {
      mode,
      level: 'ok',
      message: `LLM provider: ${mode} ${credential}, ${host} reachable (${via})`,
    };
  }
  return {
    mode,
    level: 'warn',
    // Name the consequence, not just the probe: "unreachable" alone reads as
    // cosmetic, and the actual cost (every background call silently falling back
    // to a ~10x slower path) is the reason anyone should care.
    message:
      `LLM provider: ${mode} ${credential} but unreachable ${via} (${result?.error || 'unknown'}) — ` +
      'every background LLM call fails and silently falls back to the claude CLI (~10x slower); ' +
      'check egress/proxy for this node binary',
  };
}
