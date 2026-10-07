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
 * - Settings › Cloud models › Effort becomes `output_config.effort`, at the nearest level the model
 *   offers (the Models API lists them).
 * - Experimental native tool mode: the agent's actions go as tools (see nativeTools.ts); thinking is
 *   then off, because a tool-use history without the signed thinking blocks would be refused.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CloudChatRequest, CloudChunk, CloudEffort, CloudModelInfo } from './types';
import { CLOUD_EFFORTS } from './types';
import { CloudFailure, classifyCloudError } from './errors';
import { ActionToolCollector, actionTools, toAnthropicToolMessages } from './nativeTools';
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
  /** Effort levels the model takes; undefined = not known (the setting is sent as it is). */
  efforts?: CloudEffort[];
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
    efforts: hasTree && caps.effort ? (supported(caps.effort) ? CLOUD_EFFORTS.filter((level) => supported(caps.effort[level])) : []) : guess.efforts,
  };
}

/**
 * The level to send: the wanted one when the model has it, else the nearest lower one it has (or
 * the lowest). Undefined when the model takes no effort setting.
 */
export function pickEffort(wanted: CloudEffort | undefined, available: CloudEffort[] | undefined): CloudEffort | undefined {
  if (!wanted) return undefined;
  if (!available) return wanted;
  if (available.length === 0) return undefined;
  if (available.includes(wanted)) return wanted;
  const rank = CLOUD_EFFORTS.indexOf(wanted);
  const lower = available.filter((level) => CLOUD_EFFORTS.indexOf(level) < rank);
  return lower.length ? lower[lower.length - 1] : available[0];
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
    ...(caps.efforts ? { efforts: caps.efforts } : {}),
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
  options: { fallbacks?: boolean; effort?: boolean } = {}
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

  const tools = request.nativeTools ? actionTools(request.format) : null;
  if (tools) {
    params.messages = toAnthropicToolMessages(params.messages, tools.map((t) => t.name));
    params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as any }));
    params.tool_choice = { type: 'any', disable_parallel_tool_use: true };
  }

  if (request.think && !tools) {
    if (caps.adaptiveThinking) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
    } else if (caps.budgetThinking && maxTokens >= 2048) {
      params.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.min(32000, Math.floor(maxTokens / 2))) };
    }
  }

  const outputConfig: NonNullable<Params['output_config']> = {};
  if (request.format && typeof request.format === 'object' && caps.structuredOutput && !tools) {
    outputConfig.format = { type: 'json_schema', schema: flattenSchema(request.format) };
  }
  const effort = options.effort === false ? undefined : pickEffort(request.effort, caps.efforts);
  if (effort) outputConfig.effort = effort;
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;

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
  /** Native tool mode: the tool call, and the text held back as its thought. */
  readonly toolCall = new ActionToolCollector();
  private readonly bufferText: boolean;

  constructor(model: string, now: () => number = Date.now, options: { nativeTools?: boolean } = {}) {
    this.model = model;
    this.clock = new StreamClock(now);
    this.bufferText = !!options.nativeTools;
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
      case 'content_block_start': {
        const block = event.content_block || {};
        if (block.type === 'tool_use' && block.name) {
          this.clock.mark();
          this.wrote = true;
          this.toolCall.start(String(block.name));
        }
        return [];
      }
      case 'content_block_delta': {
        const delta = event.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          this.clock.mark();
          this.wrote = true;
          if (this.bufferText) {
            this.toolCall.addText(String(delta.text));
            return [];
          }
          return [contentChunk(this.model, String(delta.text))];
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          this.toolCall.addArguments(delta.partial_json);
          return [];
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

  /** The tool call as the agent's JSON action (native tool mode) and the last chunk, or the refusal as a CloudFailure. */
  finish(): CloudChunk[] {
    if (this.stopReason === 'refusal') {
      throw new CloudFailure('refusal', 'The request was declined by the provider.', { category: this.stopCategory });
    }
    const out: CloudChunk[] = [];
    const action = this.toolCall.actionText() ?? (this.bufferText ? this.toolCall.bufferedText : '');
    if (action) out.push(contentChunk(this.model, action));
    out.push({
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: DONE_REASONS[this.stopReason || ''] || 'stop',
      prompt_eval_count: this.inputTokens + this.cacheRead + this.cacheWrite,
      cached_prompt_count: this.cacheRead,
      eval_count: this.outputTokens,
      ...this.clock.durations(),
    });
    return out;
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

/**
 * Streams one answer. A request the server rejects because of the fallback field, or because of the
 * effort level, is sent once more without it (as long as nothing was written yet).
 */
export async function runAnthropic(
  client: Anthropic,
  request: CloudChatRequest,
  caps: AnthropicCaps,
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal
): Promise<void> {
  let fallbacks = true;
  let effort = true;
  const native = !!request.nativeTools && !!actionTools(request.format);
  for (;;) {
    const params = buildAnthropicParams(request, caps, { fallbacks, effort });
    const translator = new AnthropicStreamTranslator(request.model, Date.now, { nativeTools: native });
    try {
      const stream = await client.beta.messages.create(params, { signal });
      for await (const event of stream) {
        for (const chunk of translator.handle(event)) emit(chunk);
      }
      for (const chunk of translator.finish()) emit(chunk);
      return;
    } catch (err: any) {
      const retryable = !translator.hasOutput && !signal.aborted && err?.status === 400;
      if (retryable && params.fallbacks && /fallback/i.test(String(err?.message || ''))) {
        fallbacks = false;
        continue;
      }
      if (retryable && params.output_config?.effort && classifyCloudError(err).code === 'think_unsupported') {
        effort = false;
        continue;
      }
      throw err;
    }
  }
}
