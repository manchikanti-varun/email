// AI provider client. Wraps outbound LLM calls with timeout, retries,
// structured-JSON parsing, and cost tracking. Uses Node's global fetch (Node
// 18+/24). NEVER throws on "AI disabled" — callers check isEnabled() first.
//
// Supported providers (config.ai.provider):
//   'openai' | 'openai-compatible'  -> Chat Completions API (JSON mode)
//   'anthropic'                     -> Messages API
//   ''                              -> no LLM; heuristic planner is used
//
// The provider only ever receives the compact context the agent builds — no
// raw contact lists, no credentials. See guardrails.redactForPrompt.
import { agentLogger } from './logger.js';

export class AiProvider {
  constructor(aiConfig) {
    this.cfg = aiConfig || {};
  }

  isEnabled() {
    return !!this.cfg.enabled;
  }

  // True when a real LLM is configured. When enabled but no provider/key, the
  // agent falls back to deterministic heuristic planning.
  hasModel() {
    return this.isEnabled() && !!this.cfg.provider && !!this.cfg.apiKey && !!this.cfg.model;
  }

  /**
   * Request a single JSON object from the model.
   * @param {object} p
   * @param {string} p.system - system prompt
   * @param {Array<{role:string,content:string}>} p.messages
   * @returns {Promise<{ ok:boolean, json:object|null, raw:string, usage:object, latencyMs:number, estimatedCost:number, model:string, error?:string }>}
   */
  async completeJson({ system, messages }) {
    const started = Date.now();
    if (!this.hasModel()) {
      return { ok: false, json: null, raw: '', usage: {}, latencyMs: 0, estimatedCost: 0, model: 'heuristic', error: 'no_model' };
    }

    const maxRetries = Math.max(0, this.cfg.maxRetries ?? 2);
    let lastErr = 'unknown';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this._callOnce({ system, messages });
        const latencyMs = Date.now() - started;
        const estimatedCost = this._estimateCost(res.usage);
        const json = safeParseJson(res.text);
        agentLogger.info('llm_call', {
          provider: this.cfg.provider, model: this.cfg.model, attempt,
          latencyMs, estimatedCost, parsed: !!json,
        });
        return {
          ok: !!json, json, raw: res.text, usage: res.usage,
          latencyMs, estimatedCost, model: this.cfg.model,
          error: json ? undefined : 'unparseable_json',
        };
      } catch (e) {
        lastErr = e.message || String(e);
        agentLogger.warn('llm_retry', { attempt, error: lastErr });
        // Exponential-ish backoff, but keep it short.
        if (attempt < maxRetries) await sleep(250 * (attempt + 1));
      }
    }
    return {
      ok: false, json: null, raw: '', usage: {},
      latencyMs: Date.now() - started, estimatedCost: 0,
      model: this.cfg.model, error: lastErr,
    };
  }

  async _callOnce({ system, messages }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs || 20000);
    try {
      if (this.cfg.provider === 'anthropic') return await this._anthropic({ system, messages, signal: controller.signal });
      return await this._openai({ system, messages, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async _openai({ system, messages, signal }) {
    const base = this.cfg.baseUrl || 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok) throw new Error(`openai_http_${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    return { text, usage };
  }

  async _anthropic({ system, messages, signal }) {
    const base = this.cfg.baseUrl || 'https://api.anthropic.com/v1';
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: 1024,
        temperature: 0,
        system: system + '\n\nRespond ONLY with a single valid JSON object.',
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    const usage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
    return { text, usage };
  }

  _estimateCost(usage = {}) {
    const inK = (usage.inputTokens || 0) / 1000;
    const outK = (usage.outputTokens || 0) / 1000;
    const cost = inK * (this.cfg.costPer1kInput || 0) + outK * (this.cfg.costPer1kOutput || 0);
    return Math.round(cost * 1e6) / 1e6;
  }
}

function safeParseJson(text) {
  if (!text) return null;
  // Direct parse first; then try to extract the first {...} block.
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
