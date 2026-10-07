/**
 * GPT through the OpenAI API (official SDK, streaming), and the same Chat Completions code for
 * Mistral and the OpenAI-compatible servers the user adds. The request is built from an
 * Ollama-shaped request and the answer is translated back into Ollama chunks.
 *
 * - Reasoning models of OpenAI (o-series, GPT-5) go through the Responses API: it takes the effort
 *   setting and returns readable summaries of the reasoning (shown like a model's thinking).
 *   Other models, Mistral and compatible servers use Chat Completions.
 * - No sampling parameters for OpenAI: reasoning models reject them, and the provider's defaults
 *   suit the others. Compatible servers get the temperature the request carries.
 * - The agent's answer schema goes as a non-strict `json_schema` response format.
 * - Every client has a fixed address and does not follow redirects, so a key goes nowhere else.
 */
import OpenAI from 'openai';
import type { CloudChatRequest, CloudChunk, CloudEffort, CloudModelInfo, CloudProviderId } from './types';
import { CloudFailure, classifyCloudError } from './errors';
import { flattenSchema } from './schema';
import { StreamClock, bareBase64, contentChunk, imageMediaType } from './messages';
import { ActionToolCollector, actionTools, toOpenAIToolMessages } from './nativeTools';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

/** How a Chat Completions endpoint is spoken to. */
export type ChatDialect = 'openai' | 'mistral' | 'compat';

type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;
type ResponsesParams = OpenAI.Responses.ResponseCreateParamsStreaming;
type ResponsesInput = OpenAI.Responses.ResponseInputItem;

/** o1, o3, o4-mini, gpt-5, gpt-5-mini …: models that reason and take a reasoning effort. */
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

/** A Mistral model from its Models API entry (it tells the context window and vision). */
export function mistralModelInfo(model: any): CloudModelInfo {
  const id = String(model?.id || '');
  const caps = model?.capabilities || {};
  return {
    provider: 'mistral',
    id,
    label: String(model?.name || id),
    contextWindow: Number(model?.max_context_length) || 128_000,
    vision: !!caps.vision,
    thinking: /magistral/i.test(id) ? 'effort' : false,
    structuredOutput: true,
    ...(Number(model?.created) ? { createdAt: Number(model.created) } : {}),
  };
}

/** Chat models of Mistral's list: no embeddings, OCR, moderation, transcription or deprecated ones. */
export function isMistralChatModel(model: any): boolean {
  const id = String(model?.id || '').toLowerCase();
  if (!id || /embed|ocr|moderation|voxtral|transcri/.test(id)) return false;
  if (model?.deprecation) return false;
  if (model?.capabilities && model.capabilities.completion_chat === false) return false;
  return true;
}

/**
 * A model of an OpenAI-compatible server. Servers that say so give the context window
 * (OpenRouter: context_length, vLLM: max_model_len, LM Studio: max_context_length).
 */
export function compatModelInfo(provider: CloudProviderId, model: any): CloudModelInfo {
  const id = String(model?.id || '');
  const context =
    Number(model?.context_length) || Number(model?.max_model_len) || Number(model?.max_context_length) || Number(model?.context_window) || undefined;
  const maxOutput = Number(model?.top_provider?.max_completion_tokens) || undefined;
  const modalities = model?.architecture?.input_modalities;
  return {
    provider,
    id,
    label: String(model?.name || id),
    ...(context ? { contextWindow: context } : {}),
    ...(maxOutput ? { maxOutput } : {}),
    vision: Array.isArray(modalities) ? modalities.includes('image') : /vision|vl\b|-vl-|llava|gpt-4o|gemma-3/i.test(id),
    thinking: /reason|think|r1\b|qwq|magistral|gpt-oss|o\d-|deepseek-r/i.test(id) ? 'effort' : false,
    structuredOutput: true,
    ...(Number(model?.created) ? { createdAt: Number(model.created) } : {}),
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

/** OpenAI's reasoning effort: the setting, or the "think" level, or nothing (the model's default). */
export function openAIEffort(request: CloudChatRequest): CloudEffort | undefined {
  if (request.effort) return request.effort;
  if (typeof request.think === 'string') return request.think;
  return request.think ? 'medium' : undefined;
}

function chatMessages(request: CloudChatRequest): MessageParam[] {
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
  return messages;
}

export function buildOpenAIParams(request: CloudChatRequest, dialect: ChatDialect = 'openai'): Params {
  const params: Params = {
    model: request.model,
    messages: chatMessages(request),
    stream: true,
  };
  // Mistral counts usage in its last chunk by itself and rejects unknown fields.
  if (dialect !== 'mistral') params.stream_options = { include_usage: true };
  const requested = Number(request.options?.num_predict);
  if (requested > 0) {
    if (dialect === 'openai') params.max_completion_tokens = Math.floor(requested);
    else params.max_tokens = Math.floor(requested);
  }
  if (dialect === 'compat' && typeof request.options?.temperature === 'number') params.temperature = request.options.temperature;

  const tools = request.nativeTools && dialect === 'openai' ? actionTools(request.format) : null;
  if (tools) {
    params.messages = toOpenAIToolMessages(params.messages, tools.map((t) => t.name));
    params.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema, strict: false } }));
    params.tool_choice = 'required';
    params.parallel_tool_calls = false;
  } else if (request.format === 'json') {
    params.response_format = { type: 'json_object' };
  } else if (request.format && typeof request.format === 'object') {
    params.response_format = { type: 'json_schema', json_schema: { name: 'response', schema: flattenSchema(request.format), strict: false } };
  }
  const effort = openAIEffort(request);
  if (effort && dialect === 'openai' && isReasoningModel(request.model)) {
    params.reasoning_effort = effort as OpenAI.ReasoningEffort;
  }
  return params;
}

/** Text and reasoning of a delta: a string, or (Mistral's Magistral) a list of typed chunks. */
function deltaParts(content: unknown): { text: string; thinking: string } {
  if (typeof content === 'string') return { text: content, thinking: '' };
  if (!Array.isArray(content)) return { text: '', thinking: '' };
  let text = '';
  let thinking = '';
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') text += part.text;
    else if (part?.type === 'thinking') {
      const inner = Array.isArray(part.thinking) ? part.thinking : [];
      for (const t of inner) if (typeof t?.text === 'string') thinking += t.text;
      if (typeof part.thinking === 'string') thinking += part.thinking;
    }
  }
  return { text, thinking };
}

/** Turns Chat Completions stream chunks into Ollama chunks and the final counts. */
export class OpenAIStreamTranslator {
  private model: string;
  private finishReason: string | null = null;
  private promptTokens = 0;
  private cachedTokens = 0;
  private completionTokens = 0;
  private refusal = '';
  private wrote = false;
  /** Native tool mode: the arguments of the tool call, put together. */
  readonly toolCall = new ActionToolCollector();
  readonly clock: StreamClock;
  /** Native tool mode: text is held back and becomes the thought of the tool call. */
  private readonly bufferText: boolean;

  constructor(model: string, now: () => number = Date.now, options: { nativeTools?: boolean } = {}) {
    this.model = model;
    this.clock = new StreamClock(now);
    this.bufferText = !!options.nativeTools;
  }

  get hasOutput(): boolean {
    return this.wrote;
  }

  handle(chunk: any): CloudChunk[] {
    const out: CloudChunk[] = [];
    if (chunk?.model) this.model = String(chunk.model);
    const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
    const delta = choice?.delta || {};
    // Some OpenAI-compatible servers send their reasoning as reasoning_content.
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
    const parts = deltaParts(delta.content);
    if (reasoning || parts.thinking) {
      this.clock.mark();
      out.push(contentChunk(this.model, '', reasoning + parts.thinking));
    }
    if (parts.text) {
      this.clock.mark();
      this.wrote = true;
      if (this.bufferText) this.toolCall.addText(parts.text);
      else out.push(contentChunk(this.model, parts.text));
    }
    if (Array.isArray(delta.tool_calls)) {
      this.clock.mark();
      this.wrote = true;
      for (const call of delta.tool_calls) {
        if (call?.function?.name) this.toolCall.start(String(call.function.name));
        if (typeof call?.function?.arguments === 'string') this.toolCall.addArguments(call.function.arguments);
      }
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

  /** The tool call as the agent's JSON action (native tool mode), then the last chunk. */
  finish(): CloudChunk[] {
    if (this.finishReason === 'content_filter' || this.refusal) {
      throw new CloudFailure('refusal', this.refusal || "The answer was stopped by the provider's content filter.");
    }
    const out: CloudChunk[] = [];
    const action = this.toolCall.actionText() ?? (this.bufferText ? this.toolCall.bufferedText : '');
    if (action) out.push(contentChunk(this.model, action));
    out.push({
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: this.finishReason === 'length' ? 'length' : 'stop',
      prompt_eval_count: this.promptTokens,
      cached_prompt_count: this.cachedTokens,
      eval_count: this.completionTokens,
      ...this.clock.durations(),
    });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Responses API (OpenAI reasoning models)
// ---------------------------------------------------------------------------

function responsesInput(request: CloudChatRequest): ResponsesInput[] {
  const input: ResponsesInput[] = [];
  for (const m of request.messages || []) {
    const content = typeof m.content === 'string' ? m.content : '';
    const images = Array.isArray(m.images) ? m.images.filter(Boolean) : [];
    if (!content.trim() && images.length === 0) continue;
    if (m.role === 'assistant') {
      input.push({ role: 'assistant', content });
    } else if (m.role === 'system') {
      input.push({ role: 'developer', content });
    } else if (images.length === 0) {
      input.push({ role: 'user', content });
    } else {
      const parts: OpenAI.Responses.ResponseInputContent[] = [];
      if (content.trim()) parts.push({ type: 'input_text', text: content });
      for (const image of images) {
        parts.push({ type: 'input_image', detail: 'auto', image_url: `data:${imageMediaType(image)};base64,${bareBase64(image)}` });
      }
      input.push({ role: 'user', content: parts });
    }
  }
  if (!input.some((m: any) => m.role === 'user')) throw new CloudFailure('invalid', 'The conversation has no user message.');
  return input;
}

/** A Responses API request for a reasoning model; nothing is stored on OpenAI's side (`store: false`). */
export function buildResponsesParams(request: CloudChatRequest, options: { effort?: boolean; summaries?: boolean } = {}): ResponsesParams {
  const params: ResponsesParams = {
    model: request.model,
    input: responsesInput(request),
    stream: true,
    store: false,
  };
  if (request.system && request.system.trim()) params.instructions = request.system.trim();
  const requested = Number(request.options?.num_predict);
  if (requested > 0) params.max_output_tokens = Math.floor(requested);
  const effort = options.effort === false ? undefined : openAIEffort(request);
  const summaries = options.summaries ?? !!request.summaries;
  if (effort || summaries) {
    params.reasoning = {
      ...(effort ? { effort: effort as OpenAI.ReasoningEffort } : {}),
      ...(summaries ? { summary: 'auto' as const } : {}),
    };
  }
  if (request.format === 'json') {
    params.text = { format: { type: 'json_object' } };
  } else if (request.format && typeof request.format === 'object') {
    params.text = { format: { type: 'json_schema', name: 'response', schema: flattenSchema(request.format), strict: false } };
  }
  return params;
}

/** Turns Responses API stream events into Ollama chunks: output text as content, reasoning summaries as thinking. */
export class ResponsesStreamTranslator {
  private model: string;
  private inputTokens = 0;
  private cachedTokens = 0;
  private outputTokens = 0;
  private status: string | null = null;
  private incomplete: string | null = null;
  private refusal = '';
  private failure: string | null = null;
  private wrote = false;
  private summaryParts = 0;
  readonly clock: StreamClock;

  constructor(model: string, now: () => number = Date.now) {
    this.model = model;
    this.clock = new StreamClock(now);
  }

  get hasOutput(): boolean {
    return this.wrote;
  }

  private usage(response: any): void {
    if (response?.model) this.model = String(response.model);
    const usage = response?.usage;
    if (!usage) return;
    this.inputTokens = Number(usage.input_tokens) || 0;
    this.cachedTokens = Number(usage.input_tokens_details?.cached_tokens) || 0;
    this.outputTokens = Number(usage.output_tokens) || 0;
  }

  handle(event: any): CloudChunk[] {
    switch (event?.type) {
      case 'response.created':
      case 'response.in_progress':
        if (event.response?.model) this.model = String(event.response.model);
        return [];
      case 'response.output_text.delta':
        if (!event.delta) return [];
        this.clock.mark();
        this.wrote = true;
        return [contentChunk(this.model, String(event.delta))];
      case 'response.reasoning_summary_part.added':
        // Summary parts are separate paragraphs.
        this.summaryParts++;
        return this.summaryParts > 1 ? [contentChunk(this.model, '', '\n\n')] : [];
      case 'response.reasoning_summary_text.delta':
        if (!event.delta) return [];
        this.clock.mark();
        return [contentChunk(this.model, '', String(event.delta))];
      case 'response.refusal.delta':
        if (event.delta) this.refusal += String(event.delta);
        return [];
      case 'response.completed':
        this.status = 'completed';
        this.usage(event.response);
        return [];
      case 'response.incomplete':
        this.status = 'incomplete';
        this.incomplete = String(event.response?.incomplete_details?.reason || '');
        this.usage(event.response);
        return [];
      case 'response.failed':
        this.status = 'failed';
        this.failure = String(event.response?.error?.message || 'The response failed.');
        this.usage(event.response);
        return [];
      case 'error':
        this.failure = String(event.message || event.error?.message || 'The response failed.');
        return [];
      default:
        return [];
    }
  }

  finish(): CloudChunk {
    if (this.refusal || this.incomplete === 'content_filter') {
      throw new CloudFailure('refusal', this.refusal || "The answer was stopped by the provider's content filter.");
    }
    if (this.failure) throw new CloudFailure('unknown', this.failure);
    return {
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: this.incomplete === 'max_output_tokens' ? 'length' : 'stop',
      prompt_eval_count: this.inputTokens,
      cached_prompt_count: this.cachedTokens,
      eval_count: this.outputTokens,
      ...this.clock.durations(),
    };
  }
}

// ---------------------------------------------------------------------------
// Clients, model lists, running
// ---------------------------------------------------------------------------

/** fetch that refuses redirects: a key is only ever sent to the address it belongs to. */
export const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...(init || {}), redirect: 'error' });

export function createOpenAIClient(apiKey: string, baseURL: string = OPENAI_BASE_URL): OpenAI {
  // A fixed address: an OPENAI_BASE_URL in the environment must not send the key elsewhere. Other
  // servers get none of OpenAI's organization or project headers from the environment either.
  const foreign = baseURL !== OPENAI_BASE_URL;
  return new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
    fetch: noRedirectFetch,
    ...(foreign ? { organization: null, project: null, adminAPIKey: null, webhookSecret: null } : {}),
  });
}

export async function listOpenAIModels(client: OpenAI): Promise<CloudModelInfo[]> {
  const models: CloudModelInfo[] = [];
  for await (const model of client.models.list()) {
    if (isChatModel(model.id)) models.push(openAIModelInfo(model));
  }
  return models.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
}

export async function listMistralModels(client: OpenAI): Promise<CloudModelInfo[]> {
  const seen = new Set<string>();
  const models: CloudModelInfo[] = [];
  for await (const model of client.models.list()) {
    if (!isMistralChatModel(model) || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(mistralModelInfo(model));
  }
  return models.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
}

export async function listCompatModels(client: OpenAI, provider: CloudProviderId): Promise<CloudModelInfo[]> {
  const models: CloudModelInfo[] = [];
  for await (const model of client.models.list()) {
    const id = String((model as any)?.id || '');
    if (!id || /embed|whisper|tts|rerank|moderation/i.test(id)) continue;
    models.push(compatModelInfo(provider, model));
    if (models.length >= 1000) break;
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** Uses the Responses API: an OpenAI reasoning model, unless the agent's actions go as native tools. */
export function usesResponsesApi(request: CloudChatRequest, dialect: ChatDialect): boolean {
  return dialect === 'openai' && isReasoningModel(request.model) && !(request.nativeTools && actionTools(request.format));
}

async function streamChat(client: OpenAI, request: CloudChatRequest, dialect: ChatDialect, emit: (chunk: CloudChunk) => void, signal: AbortSignal) {
  const native = !!request.nativeTools && dialect === 'openai' && !!actionTools(request.format);
  const translator = new OpenAIStreamTranslator(request.model, Date.now, { nativeTools: native });
  try {
    const stream = await client.chat.completions.create(buildOpenAIParams(request, dialect), { signal });
    for await (const chunk of stream) {
      for (const piece of translator.handle(chunk)) emit(piece);
    }
    for (const piece of translator.finish()) emit(piece);
  } catch (err) {
    throw Object.assign(err as object, { emitted: translator.hasOutput });
  }
}

async function streamResponses(
  client: OpenAI,
  request: CloudChatRequest,
  options: { effort?: boolean; summaries?: boolean },
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal
) {
  const translator = new ResponsesStreamTranslator(request.model);
  try {
    const stream = await client.responses.create(buildResponsesParams(request, options), { signal });
    for await (const event of stream) {
      for (const piece of translator.handle(event)) emit(piece);
    }
    emit(translator.finish());
  } catch (err) {
    throw Object.assign(err as object, { emitted: translator.hasOutput });
  }
}

/**
 * Streams one answer. A request rejected for its reasoning settings (an effort level the model
 * lacks, summaries the organization may not use) is sent once more without them, as long as
 * nothing was written yet.
 */
export async function runOpenAI(
  client: OpenAI,
  request: CloudChatRequest,
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal,
  dialect: ChatDialect = 'openai'
): Promise<void> {
  const rejectedReasoning = (err: any) => !err?.emitted && !signal.aborted && classifyCloudError(err).code === 'think_unsupported';
  if (usesResponsesApi(request, dialect)) {
    try {
      return await streamResponses(client, request, {}, emit, signal);
    } catch (err: any) {
      if (!rejectedReasoning(err) || (!request.effort && !request.summaries)) throw err;
      return streamResponses(client, request, { effort: false, summaries: false }, emit, signal);
    }
  }
  try {
    return await streamChat(client, request, dialect, emit, signal);
  } catch (err: any) {
    if (!rejectedReasoning(err) || !request.effort) throw err;
    return streamChat(client, { ...request, effort: undefined, think: undefined }, dialect, emit, signal);
  }
}
