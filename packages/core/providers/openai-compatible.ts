// OpenAI-compatible Chat Completions client used for all Meta-model profiles
// (Direct Meta primary, Baseten and Fireworks backups). Plain fetch, no hidden SDK retries:
// every attempt is an explicit, separately budgeted call (MVP plan §8).
//
// Lowest-common-denominator rules (provider plan §3, verified against docs Oct 27):
//   tool_choice "auto" only; images only in user messages; no stop/logit_bias/logprobs/n>1;
//   explicit temperature; structured output via tool-call arguments validated locally.

import { ProviderError, type CapabilityProfile, type ChatProvider, type ChatRequest, type ChatResult, type ToolCall } from './types.ts';

export type CompatibleProfile = {
  id: 'meta-direct' | 'baseten' | 'fireworks';
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

const CAPABILITY: CapabilityProfile = {
  tools: true,
  images: true,
  imagesInToolMessages: false,
  toolChoiceValues: ['auto'],
  structuredOutput: false,
};

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly isMetaModel = true;
  readonly capability = CAPABILITY;
  readonly label: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #reasoningEffort?: string;

  constructor(profile: CompatibleProfile, fetchImpl: typeof fetch = fetch) {
    if (!profile.apiKey) throw new Error(`${profile.id}: API key is not configured`);
    this.id = profile.id; this.model = profile.model; this.label = profile.label;
    this.#baseUrl = profile.baseUrl.replace(/\/$/, ''); this.#apiKey = profile.apiKey; this.#fetch = fetchImpl; this.#reasoningEffort = profile.reasoningEffort;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    for (const m of req.messages) {
      if (m.role === 'tool' && typeof m.content !== 'string') throw new ProviderError('invalid_response', 'images are not allowed in tool messages', false);
    }
    const body = {
      model: this.model,
      messages: req.messages,
      tools: req.tools,
      tool_choice: 'auto',
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
      ...(this.#reasoningEffort ? { reasoning_effort: this.#reasoningEffort } : {}),
    };
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 90_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      const err = e as Error;
      if (req.signal?.aborted) throw new ProviderError('aborted', 'request aborted', true);
      if (err.name === 'TimeoutError' || timeout.aborted) throw new ProviderError('timeout', 'provider timeout', true);
      // A connection failure may still have reached the provider; treat spend as unknown.
      throw new ProviderError('network', err.message, true);
    }
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id');
    const text = await res.text();
    if (!res.ok) {
      // 4xx before processing are not billed; 5xx may or may not be. Be conservative for 5xx.
      throw new ProviderError('http', `HTTP ${res.status}: ${text.slice(0, 300)}`, res.status >= 500, res.status);
    }
    let json: {
      model?: string;
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    try { json = JSON.parse(text); } catch { throw new ProviderError('invalid_response', 'response is not JSON', true); }
    const choice = json.choices?.[0];
    if (!choice?.message) throw new ProviderError('invalid_response', 'response has no message', true);
    const toolCalls = (choice.message.tool_calls ?? []).filter((t) => t?.type === 'function' && t.function?.name);
    return {
      message: { role: 'assistant', content: choice.message.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      usage: json.usage ? {
        inputTokens: json.usage.prompt_tokens ?? 0,
        cachedInputTokens: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: json.usage.completion_tokens ?? 0,
      } : null,
      finishReason: choice.finish_reason ?? 'unknown',
      requestId,
      model: json.model ?? this.model,
    };
  }
}

/** Build the primary/backup profiles from the environment. Missing keys leave a profile disabled. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider[] {
  const out: OpenAICompatibleProvider[] = [];
  if (env.META_API_KEY) out.push(new OpenAICompatibleProvider({
    id: 'meta-direct', label: 'Meta (direct API)', baseUrl: env.META_BASE_URL ?? 'https://api.meta.ai/v1', model: env.META_MODEL ?? 'muse-spark-1.3', apiKey: env.META_API_KEY,
    reasoningEffort: (env.META_REASONING_EFFORT as CompatibleProfile['reasoningEffort']) ?? 'low',
  }));
  if (env.BASETEN_API_KEY) out.push(new OpenAICompatibleProvider({
    id: 'baseten', label: 'Baseten', baseUrl: 'https://inference.baseten.co/v1', model: env.BASETEN_MODEL ?? 'meta-models/muse-spark-open-1026', apiKey: env.BASETEN_API_KEY,
  }));
  if (env.FIREWORKS_API_KEY) out.push(new OpenAICompatibleProvider({
    id: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/muse-spark-open', apiKey: env.FIREWORKS_API_KEY,
  }));
  return out;
}
