/**
 * GPT through the OpenAI Chat Completions API (official SDK, streaming). The request is built from
 * an Ollama-shaped request and the answer is translated back into Ollama chunks.
 *
 * - No sampling parameters: reasoning models (o-series, GPT-5) reject them, and the provider's
 *   defaults suit the others.
 * - The agent's answer schema goes as a non-strict `json_schema` response format.
 * - "Think before each step" sets `reasoning_effort` on reasoning models; off leaves their default.
 * - Prompt caching is automatic on OpenAI's side.
 */
import OpenAI from 'openai';
import type { CloudChatRequest, CloudChunk, CloudModelInfo } from './types';
import { CloudFailure } from './errors';
import { flattenSchema } from './schema';
import { StreamClock, bareBase64, contentChunk, imageMediaType } from './messages';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

/** o1, o3, o4-mini, gpt-5, gpt-5-mini …: models that reason and take `reasoning_effort`. */
export function isReasoningModel(id: string): boolean {
  const lower = id.toLowerCase();
  return /^(?:o\d|gpt-5)/.test(lower) && !/chat/.test(lower);
}

/** Chat models of the list: no embeddings, audio, images, speech, moderation or dated snapshots. */
export function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (!/^(?:gpt-|o\d|chatgpt-)/.test(lower)) return false;
  if (/embedding|audio|realtime|transcribe|tts|whisper|dall-e|image|search|moderation|instruct|codex|computer-use|deep-research/.test(lower)) return false;
  // Snapshots such as gpt-4o-2024-08-06 or gpt-4-0613 duplicate their alias.
  if (/-\d{4}-\d{2}-\d{2}$/.test(lower) || /-\d{4}$/.test(lower)) return false;
  return true;
}

/** Context window and vision of a GPT model, from its id (the Models API says nothing about them). */
export function guessOpenAIModel(id: string): Pick<CloudModelInfo, 'contextWindow' | 'maxOutput' | 'vision' | 'thinking'> {
  const lower = id.toLowerCase();
  const reasoning = isReasoningModel(lower);
  let contextWindow = 128_000;
  let maxOutput = 16_384;
  if (/^gpt-5/.test(lower)) {
    contextWindow = 400_000;
    maxOutput = 128_000;
  } else if (/^gpt-4\.1/.test(lower)) {
    contextWindow = 1_047_576;
    maxOutput = 32_768;
  } else if (/^o\d/.test(lower)) {
    contextWindow = 200_000;
    maxOutput = 100_000;
  } else if (/^gpt-3\.5/.test(lower)) {
    contextWindow = 16_385;
    maxOutput = 4_096;
  } else if (/^gpt-4(?:-|$)/.test(lower) && !/turbo|4o/.test(lower)) {
    contextWindow = 8_192;
    maxOutput = 4_096;
  }
  const vision = /^(?:gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1(?!-mini)|o3|o4|chatgpt-4o)/.test(lower);
  return { contextWindow, maxOutput, vision, thinking: reasoning ? 'effort' : false };
}

export function openAIModelInfo(model: { id: string; created?: number }): CloudModelInfo {
  return {
    provider: 'openai',
    id: model.id,
    label: model.id,
    ...guessOpenAIModel(model.id),
    structuredOutput: true,
    ...(model.created ? { createdAt: model.created } : {}),
  };
}

function userContent(text: string, images: string[] | undefined): string | ContentPart[] {
  if (!images || images.length === 0) return text;
  const parts: ContentPart[] = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: `data:${imageMediaType(image)};base64,${bareBase64(image)}` } });
  }
  return parts;
}

export function buildOpenAIParams(request: CloudChatRequest): Params {
  const messages: MessageParam[] = [];
  if (request.system && request.system.trim()) messages.push({ role: 'system', content: request.system.trim() });
  for (const m of request.messages || []) {
    const content = typeof m.content === 'string' ? m.content : '';
    const images = Array.isArray(m.images) ? m.images.filter(Boolean) : [];
    if (!content.trim() && images.length === 0) continue;
    if (m.role === 'system') messages.push({ role: 'system', content });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content });
    else messages.push({ role: 'user', content: userContent(content, images) });
  }
  if (!messages.some((m) => m.role === 'user')) throw new CloudFailure('invalid', 'The conversation has no user message.');

  const params: Params = {
    model: request.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  const requested = Number(request.options?.num_predict);
  if (requested > 0) params.max_completion_tokens = Math.floor(requested);
  if (request.format === 'json') {
    params.response_format = { type: 'json_object' };
  } else if (request.format && typeof request.format === 'object') {
    params.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: flattenSchema(request.format), strict: false } };
  }
  if (request.think && isReasoningModel(request.model)) {
    params.reasoning_effort = typeof request.think === 'string' ? request.think : 'medium';
  }
  return params;
}

/** Turns Chat Completions stream chunks into Ollama chunks and the final counts. */
export class OpenAIStreamTranslator {
  private model: string;
  private finishReason: string | null = null;
  private promptTokens = 0;
  private cachedTokens = 0;
  private completionTokens = 0;
  private refusal = '';
  readonly clock: StreamClock;

  constructor(model: string, now: () => number = Date.now) {
    this.model = model;
    this.clock = new StreamClock(now);
  }

  handle(chunk: any): CloudChunk[] {
    const out: CloudChunk[] = [];
    if (chunk?.model) this.model = String(chunk.model);
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
    const delta = choice?.delta || {};
    // Some OpenAI-compatible servers send their reasoning as reasoning_content.
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
    if (reasoning) {
      this.clock.mark();
      out.push(contentChunk(this.model, '', reasoning));
    }
    if (typeof delta.content === 'string' && delta.content) {
      this.clock.mark();
      out.push(contentChunk(this.model, delta.content));
    }
    if (typeof delta.refusal === 'string' && delta.refusal) this.refusal += delta.refusal;
    if (choice?.finish_reason) this.finishReason = String(choice.finish_reason);
    const usage = chunk?.usage;
    if (usage) {
      this.promptTokens = Number(usage.prompt_tokens) || 0;
      this.completionTokens = Number(usage.completion_tokens) || 0;
      this.cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
    }
    return out;
  }

  finish(): CloudChunk {
    if (this.finishReason === 'content_filter' || this.refusal) {
      throw new CloudFailure('refusal', this.refusal || 'The answer was stopped by the provider\'s content filter.');
    }
    return {
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: this.finishReason === 'length' ? 'length' : 'stop',
      prompt_eval_count: this.promptTokens,
      cached_prompt_count: this.cachedTokens,
      eval_count: this.completionTokens,
      ...this.clock.durations(),
    };
  }
}

export function createOpenAIClient(apiKey: string): OpenAI {
  // A fixed address: an OPENAI_BASE_URL in the environment must not send the key elsewhere.
  return new OpenAI({ apiKey, baseURL: OPENAI_BASE_URL, maxRetries: 2, timeout: 10 * 60 * 1000 });
}

export async function listOpenAIModels(client: OpenAI): Promise<CloudModelInfo[]> {
  const models: CloudModelInfo[] = [];
  for await (const model of client.models.list()) {
    if (isChatModel(model.id)) models.push(openAIModelInfo(model));
  }
  return models.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
}

export async function runOpenAI(
  client: OpenAI,
  request: CloudChatRequest,
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal
): Promise<void> {
  const translator = new OpenAIStreamTranslator(request.model);
  const stream = await client.chat.completions.create(buildOpenAIParams(request), { signal });
  for await (const chunk of stream) {
    for (const piece of translator.handle(chunk)) emit(piece);
  }
  emit(translator.finish());
}
