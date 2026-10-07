/**
 * Claude through the Anthropic Messages API (official SDK, streaming). The request is built from an
 * Ollama-shaped request and the answer is translated back into Ollama chunks.
 *
 * - No sampling parameters: current Claude models reject temperature/top_p/top_k.
 * - The system prompt and the append-only history of the agent are cached (`cache_control`), so a
 *   step only pays the full price for what is new since the previous step.
 * - "Think before each step" becomes adaptive thinking with a readable summary; models without it
 *   get a thinking budget. Off means the model's own default.
 * - Models whose safety classifiers may decline a request get the server-side fallback
 *   (`fallbacks: "default"`), which reruns a declined request on the model Anthropic recommends.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CloudChatRequest, CloudChunk, CloudModelInfo } from './types';
import { CloudFailure } from './errors';
import { flattenSchema } from './schema';
import { StreamClock, bareBase64, contentChunk, imageMediaType, splitConversation } from './messages';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models that take `fallbacks: "default"`. */
export const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
const DEFAULT_MAX_TOKENS = 16384;

type Params = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

export interface AnthropicCaps {
  adaptiveThinking: boolean;
  budgetThinking: boolean;
  structuredOutput: boolean;
  vision: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

const supported = (node: any): boolean => !!node && node.supported === true;

/** Capabilities from a Models API entry (`max_input_tokens`, `max_tokens`, `capabilities`). */
export function anthropicCapsFromModel(model: any): AnthropicCaps {
  const caps = model?.capabilities || {};
  const guess = guessAnthropicCaps(String(model?.id || ''));
  const hasTree = caps && typeof caps === 'object' && Object.keys(caps).length > 0;
  return {
    adaptiveThinking: hasTree ? supported(caps.thinking?.types?.adaptive) : guess.adaptiveThinking,
    budgetThinking: hasTree ? supported(caps.thinking?.types?.enabled) : guess.budgetThinking,
    structuredOutput: hasTree ? supported(caps.structured_outputs) : guess.structuredOutput,
    vision: hasTree ? supported(caps.image_input) : guess.vision,
    contextWindow: Number(model?.max_input_tokens) || guess.contextWindow,
    maxOutput: Number(model?.max_tokens) || guess.maxOutput,
  };
}

/** What a Claude model can do, from its id, when the Models API gave nothing. */
export function guessAnthropicCaps(id: string): AnthropicCaps {
  const lower = id.toLowerCase();
  const adaptive = /claude-(?:opus|sonnet|fable|mythos)-(?:4-[6-9]|[5-9])/.test(lower);
  const claude4 = /claude-(?:opus|sonnet|haiku)-4/.test(lower);
  const large = /claude-(?:opus|sonnet|fable|mythos)-(?:4-[6-9]|[5-9])/.test(lower);
  return {
    adaptiveThinking: adaptive,
    budgetThinking: !adaptive && claude4,
    structuredOutput: adaptive || /claude-(?:haiku-4-5|opus-4-5|opus-4-1)/.test(lower),
    vision: true,
    contextWindow: large ? 1_000_000 : 200_000,
    maxOutput: large ? 128_000 : 64_000,
  };
}

export function anthropicModelInfo(model: any): CloudModelInfo {
  const caps = anthropicCapsFromModel(model);
  const created = Date.parse(String(model?.created_at || ''));
  return {
    provider: 'anthropic',
    id: String(model?.id || ''),
    label: String(model?.display_name || model?.id || ''),
    contextWindow: caps.contextWindow,
    maxOutput: caps.maxOutput,
    vision: caps.vision,
    thinking: caps.adaptiveThinking ? 'adaptive' : caps.budgetThinking ? 'budget' : false,
    structuredOutput: caps.structuredOutput,
    ...(Number.isFinite(created) ? { createdAt: Math.floor(created / 1000) } : {}),
  };
}

function userContent(text: string, images: string[] | undefined): string | ContentBlock[] {
  if (!images || images.length === 0) return text;
  const blocks: ContentBlock[] = images.map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: imageMediaType(image), data: bareBase64(image) },
  }));
  if (text.trim()) blocks.push({ type: 'text', text });
  return blocks;
}

export function buildAnthropicParams(
  request: CloudChatRequest,
  caps: AnthropicCaps,
  options: { fallbacks?: boolean } = {}
): Params {
  const { system, messages } = splitConversation(request);
  if (messages.length === 0) throw new CloudFailure('invalid', 'The conversation has no user message.');
  const limit = caps.maxOutput && caps.maxOutput > 0 ? caps.maxOutput : DEFAULT_MAX_TOKENS;
  const requested = Number(request.options?.num_predict);
  const maxTokens = Math.max(1, Math.min(limit, requested > 0 ? Math.floor(requested) : DEFAULT_MAX_TOKENS));

  const params: Params = {
    model: request.model,
    max_tokens: maxTokens,
    stream: true,
    messages: messages.map((m) =>
      m.role === 'assistant' ? { role: 'assistant', content: m.content } : { role: 'user', content: userContent(m.content, m.images) }
    ),
    cache_control: { type: 'ephemeral' },
  };
  if (system) params.system = system;

  if (request.think) {
    if (caps.adaptiveThinking) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
    } else if (caps.budgetThinking && maxTokens >= 2048) {
      params.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.min(32000, Math.floor(maxTokens / 2))) };
    }
  }

  if (request.format && typeof request.format === 'object' && caps.structuredOutput) {
    params.output_config = { format: { type: 'json_schema', schema: flattenSchema(request.format) } };
  }

  if (options.fallbacks && FALLBACK_MODELS.has(request.model)) {
    params.fallbacks = 'default';
    params.betas = [FALLBACK_BETA];
  }
  return params;
}

const DONE_REASONS: Record<string, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  pause_turn: 'stop',
  tool_use: 'stop',
};

/** Turns the Messages API stream events into Ollama chunks and the final counts. */
export class AnthropicStreamTranslator {
  private model: string;
  private inputTokens = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private outputTokens = 0;
  private stopReason: string | null = null;
  private stopCategory: string | undefined;
  private wrote = false;
  readonly clock: StreamClock;

  constructor(model: string, now: () => number = Date.now) {
    this.model = model;
    this.clock = new StreamClock(now);
  }

  /** Whether any text has been passed on (a retry is then no longer possible). */
  get hasOutput(): boolean {
    return this.wrote;
  }

  handle(event: any): CloudChunk[] {
    switch (event?.type) {
      case 'message_start': {
        const usage = event.message?.usage || {};
        if (event.message?.model) this.model = String(event.message.model);
        this.inputTokens = Number(usage.input_tokens) || 0;
        this.cacheRead = Number(usage.cache_read_input_tokens) || 0;
        this.cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
        this.outputTokens = Number(usage.output_tokens) || 0;
        return [];
      }
      case 'content_block_delta': {
        const delta = event.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          this.clock.mark();
          this.wrote = true;
          return [contentChunk(this.model, String(delta.text))];
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
          this.clock.mark();
          return [contentChunk(this.model, '', String(delta.thinking))];
        }
        return [];
      }
      case 'message_delta': {
        if (event.delta?.stop_reason) this.stopReason = String(event.delta.stop_reason);
        const details = event.delta?.stop_details;
        if (details && typeof details.category === 'string') this.stopCategory = details.category;
        const usage = event.usage || {};
        if (Number(usage.output_tokens) > 0) this.outputTokens = Number(usage.output_tokens);
        if (Number(usage.input_tokens) > 0) this.inputTokens = Number(usage.input_tokens);
        if (Number(usage.cache_read_input_tokens) > 0) this.cacheRead = Number(usage.cache_read_input_tokens);
        if (Number(usage.cache_creation_input_tokens) > 0) this.cacheWrite = Number(usage.cache_creation_input_tokens);
        return [];
      }
      default:
        return [];
    }
  }

  /** The last chunk, or the refusal as a CloudFailure. */
  finish(): CloudChunk {
    if (this.stopReason === 'refusal') {
      throw new CloudFailure('refusal', 'The request was declined by the provider.', { category: this.stopCategory });
    }
    return {
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: DONE_REASONS[this.stopReason || ''] || 'stop',
      prompt_eval_count: this.inputTokens + this.cacheRead + this.cacheWrite,
      cached_prompt_count: this.cacheRead,
      eval_count: this.outputTokens,
      ...this.clock.durations(),
    };
  }
}

export function createAnthropicClient(apiKey: string): Anthropic {
  // A fixed address: an ANTHROPIC_BASE_URL in the environment must not send the key elsewhere.
  return new Anthropic({ apiKey, authToken: null, baseURL: ANTHROPIC_BASE_URL, maxRetries: 2, timeout: 10 * 60 * 1000 });
}

export async function listAnthropicModels(client: Anthropic): Promise<CloudModelInfo[]> {
  const models: CloudModelInfo[] = [];
  for await (const model of client.models.list({ limit: 100 })) {
    models.push(anthropicModelInfo(model));
  }
  return models.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Streams one answer. A request the server rejects because of the fallback field is sent once more without it. */
export async function runAnthropic(
  client: Anthropic,
  request: CloudChatRequest,
  caps: AnthropicCaps,
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal
): Promise<void> {
  let fallbacks = true;
  for (;;) {
    const params = buildAnthropicParams(request, caps, { fallbacks });
    const translator = new AnthropicStreamTranslator(request.model);
    try {
      const stream = await client.beta.messages.create(params, { signal });
      for await (const event of stream) {
        for (const chunk of translator.handle(event)) emit(chunk);
      }
      emit(translator.finish());
      return;
    } catch (err: any) {
      const usedFallbacks = !!params.fallbacks;
      if (usedFallbacks && !translator.hasOutput && err?.status === 400 && /fallback/i.test(String(err?.message || ''))) {
        fallbacks = false;
        continue;
      }
      throw err;
    }
  }
}
