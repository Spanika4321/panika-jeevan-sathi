'use strict';
/**
 * PANIKA JEEVAN SATHI — SEO Center AI engine: Gemini first, router fallback.
 *
 * Order of attempts (the "router"):
 *
 *   1. Google Gemini      GEMINI_API_KEY            ← primary
 *   2. OpenAI-compatible  OPENAI_API_KEY            ← fallback
 *   3. OpenRouter         OPENROUTER_API_KEY        ← fallback
 *   4. Groq               GROQ_API_KEY              ← fallback
 *   5. deterministic rules (no network, no key)     ← last resort
 *
 * The engine that actually answered is always recorded in the report
 * (`ai.engine`, `ai.remote`, `ai.attempts`). When every remote provider fails
 * the SEO Center says so plainly — it never claims Gemini answered when it did
 * not, and it never invents analysis.
 *
 * Keys are read from the environment and used in request headers only; they are
 * never returned to the browser, never written to a report and never logged.
 */

const DEFAULTS = {
  timeoutMs: 60000,
  maxOutputTokens: 4096,
  temperature: 0.2
};

const GEMINI_MODEL_CHAIN = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash'
];

class AiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.status = extra.status || 0;
    this.retryable = Boolean(extra.retryable);
    this.provider = extra.provider || '';
    // A retired model name must fall through to the next alias of the SAME
    // provider, not abandon the provider after the first 404.
    this.modelMissing = Boolean(extra.modelMissing);
  }
}

function first(...values) {
  for (const value of values) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    if (text) return text;
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the provider list from the environment (no key = not available). */
function providersFromEnv(env = process.env) {
  const providers = [];

  const geminiKey = first(env.GEMINI_API_KEY, env.GOOGLE_AI_API_KEY);
  if (geminiKey) {
    const chain = first(env.GEMINI_MODEL)
      ? [first(env.GEMINI_MODEL), ...GEMINI_MODEL_CHAIN]
      : GEMINI_MODEL_CHAIN.slice();
    providers.push({
      id: 'gemini',
      name: 'Google Gemini',
      key: geminiKey,
      endpoint: first(env.GEMINI_ENDPOINT, 'https://generativelanguage.googleapis.com/v1beta'),
      models: [...new Set(chain)]
    });
  }

  const openaiKey = first(env.OPENAI_API_KEY);
  if (openaiKey) {
    providers.push({
      id: 'openai',
      name: 'OpenAI-compatible',
      key: openaiKey,
      endpoint: first(env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
      models: [first(env.OPENAI_MODEL, 'gpt-4o-mini')],
      style: 'openai'
    });
  }

  const openrouterKey = first(env.OPENROUTER_API_KEY);
  if (openrouterKey) {
    providers.push({
      id: 'openrouter',
      name: 'OpenRouter',
      key: openrouterKey,
      endpoint: 'https://openrouter.ai/api/v1',
      models: [first(env.OPENROUTER_MODEL, 'google/gemini-2.5-flash')],
      style: 'openai'
    });
  }

  const groqKey = first(env.GROQ_API_KEY);
  if (groqKey) {
    providers.push({
      id: 'groq',
      name: 'Groq',
      key: groqKey,
      endpoint: 'https://api.groq.com/openai/v1',
      models: [first(env.GROQ_MODEL, 'llama-3.3-70b-versatile')],
      style: 'openai'
    });
  }

  return providers;
}

function orderFromEnv(env = process.env, providers) {
  const wanted = first(env.SEO_AI_ORDER)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return providers;
  const ordered = [];
  for (const id of wanted) {
    const found = providers.find((p) => p.id === id);
    if (found) ordered.push(found);
  }
  for (const provider of providers) {
    if (!ordered.includes(provider)) ordered.push(provider);
  }
  return ordered;
}

/** Which settings are present — booleans only, safe for the browser. */
function envStatus(env = process.env) {
  const providers = providersFromEnv(env);
  return {
    primary: providers.length ? providers[0].id : null,
    available: providers.map((p) => p.id),
    order: orderFromEnv(env, providers).map((p) => p.id),
    gemini: Boolean(first(env.GEMINI_API_KEY, env.GOOGLE_AI_API_KEY)),
    gemini_model: first(env.GEMINI_MODEL) || (providers.find((p) => p.id === 'gemini') ? GEMINI_MODEL_CHAIN[0] : ''),
    openai: Boolean(first(env.OPENAI_API_KEY)),
    openrouter: Boolean(first(env.OPENROUTER_API_KEY)),
    groq: Boolean(first(env.GROQ_API_KEY)),
    configured: providers.length > 0
  };
}

/* ------------------------------------------------------------ extraction */

/** Pull the first JSON object/array out of a model reply (fences tolerated). */
function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch (_) {
    /* fall through to the bracket scan */
  }

  const openers = ['{', '['];
  for (const opener of openers) {
    const start = candidate.indexOf(opener);
    if (start === -1) continue;
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === opener) depth += 1;
      else if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch (_) {
            break;
          }
        }
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- engine */

function createRouter(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || (() => {});
  const limits = Object.assign({}, DEFAULTS, options.limits || {});
  const providers = orderFromEnv(env, providersFromEnv(env));

  async function callGemini(provider, model, { system, prompt, json, temperature }) {
    const url = `${provider.endpoint.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number.isFinite(temperature) ? temperature : limits.temperature,
        maxOutputTokens: limits.maxOutputTokens
      }
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (json) body.generationConfig.responseMimeType = 'application/json';

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        // Header form keeps the key out of URLs, proxy logs and error messages.
        'x-goog-api-key': provider.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(limits.timeoutMs)
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = null;
    }

    if (!res.ok) {
      const detail = payload && payload.error ? payload.error.message || payload.error.status : text.slice(0, 200);
      const modelMissing =
        res.status === 404 || /is not found for API version|models\/.* is not found/i.test(String(detail));
      throw new AiError(`Gemini ${model} → HTTP ${res.status}: ${detail}`, {
        status: res.status,
        provider: 'gemini',
        retryable: res.status === 429 || res.status >= 500,
        modelMissing
      });
    }

    const parts =
      (payload.candidates && payload.candidates[0] && payload.candidates[0].content &&
        payload.candidates[0].content.parts) ||
      [];
    const reply = parts.map((part) => part.text || '').join('').trim();
    if (!reply) {
      const reason =
        (payload.candidates && payload.candidates[0] && payload.candidates[0].finishReason) || 'empty reply';
      throw new AiError(`Gemini ${model} returned no text (${reason}).`, {
        status: 200,
        provider: 'gemini',
        retryable: true
      });
    }
    return reply;
  }

  async function callOpenAiStyle(provider, model, { system, prompt, json, temperature }) {
    const url = `${provider.endpoint.replace(/\/+$/, '')}/chat/completions`;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number.isFinite(temperature) ? temperature : limits.temperature,
        max_tokens: limits.maxOutputTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: AbortSignal.timeout(limits.timeoutMs)
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = null;
    }

    if (!res.ok) {
      const detail = payload && payload.error ? payload.error.message || payload.error.type : text.slice(0, 200);
      throw new AiError(`${provider.name} ${model} → HTTP ${res.status}: ${detail}`, {
        status: res.status,
        provider: provider.id,
        retryable: res.status === 429 || res.status >= 500,
        modelMissing: res.status === 404
      });
    }

    const reply =
      (payload.choices && payload.choices[0] && payload.choices[0].message &&
        payload.choices[0].message.content) ||
      '';
    if (!String(reply).trim()) {
      throw new AiError(`${provider.name} ${model} returned no text.`, {
        status: 200,
        provider: provider.id,
        retryable: true
      });
    }
    return String(reply).trim();
  }

  async function attempt(provider, model, request) {
    if (provider.id === 'gemini') return callGemini(provider, model, request);
    return callOpenAiStyle(provider, model, request);
  }

  /**
   * Run one prompt through the router.
   *
   * @returns {ok:true, engine, model, text, parsed?, remote:true, attempts}
   *          {ok:false, engine:null, remote:false, attempts} when nothing answered
   */
  async function complete(request) {
    const attempts = [];

    if (!providers.length) {
      return {
        ok: false,
        engine: null,
        model: null,
        remote: false,
        attempts: [{ provider: 'none', ok: false, error: 'no AI provider is configured on this server' }],
        reason: 'NOT_CONFIGURED'
      };
    }

    for (const provider of providers) {
      for (const model of provider.models) {
        try {
          const text = await attempt(provider, model, request);
          attempts.push({ provider: provider.id, model, ok: true });
          const parsed = request.json ? extractJson(text) : null;
          if (request.json && parsed === null) {
            // A reply we cannot parse is not usable: keep routing, and say so.
            attempts.push({
              provider: provider.id,
              model,
              ok: false,
              error: 'the reply was not valid JSON'
            });
            continue;
          }
          return {
            ok: true,
            engine: provider.id,
            engine_name: provider.name,
            model,
            text,
            parsed,
            remote: true,
            attempts,
            fallback_used: provider.id !== 'gemini'
          };
        } catch (err) {
          attempts.push({
            provider: provider.id,
            model,
            ok: false,
            status: err.status || 0,
            error: String(err.message || err).slice(0, 300)
          });
          log(`[seo/ai] ${provider.id}/${model} failed: ${err.message}`);
          // A model that no longer exists → try the next alias, not the next vendor.
          if (err.modelMissing) continue;
          // Anything else (auth, quota, network) → move to the next provider.
          break;
        }
      }
    }

    return {
      ok: false,
      engine: null,
      model: null,
      remote: false,
      attempts,
      reason: 'ALL_PROVIDERS_FAILED'
    };
  }

  /**
   * Explicit connectivity test (admin button only — never on page load, so a
   * dashboard refresh cannot burn quota).
   */
  async function probe() {
    const result = await complete({
      system: 'You are a connectivity probe. Reply with the single word: ready',
      prompt: 'Reply with the single word: ready',
      temperature: 0
    });
    return {
      ok: result.ok,
      engine: result.engine,
      model: result.model,
      remote: result.remote,
      attempts: result.attempts,
      checked_at: new Date().toISOString()
    };
  }

  return {
    kind: 'ai-router',
    providers: providers.map((p) => ({ id: p.id, name: p.name, models: p.models })),
    status: () => envStatus(env),
    complete,
    probe,
    extractJson
  };
}

module.exports = {
  DEFAULTS,
  GEMINI_MODEL_CHAIN,
  AiError,
  providersFromEnv,
  envStatus,
  createRouter,
  extractJson
};
