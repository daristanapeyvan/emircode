/**
 * Google Gemini through the Gemini API (official @google/genai SDK, streaming). The request is built
 * from an Ollama-shaped request and the answer is translated back into Ollama chunks.
 *
 * - Fixed address (generativelanguage.googleapis.com), never Vertex AI, redirects refused.
 * - No sampling parameters: Gemini's defaults are recommended (lower temperatures make newer
 *   models loop).
 * - The agent's answer schema goes as `responseJsonSchema` (merged into one object like for Claude).
 * - Thinking: "Think before each step" shows the model's thought summaries; the effort setting
 *   becomes a thinking level (Gemini 3) or a thinking budget (Gemini 2.5).
 */
import { GoogleGenAI } from '@google/genai';
import type { CloudChatRequest, CloudChunk, CloudEffort, CloudModelInfo } from './types';
import { CloudFailure, classifyCloudError } from './errors';
import { flattenSchema } from './schema';
import { StreamClock, bareBase64, contentChunk, imageMediaType, splitConversation } from './messages';
import { noRedirectFetch } from './openai';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'LANGUAGE']);
const BUDGETS: Record<CloudEffort, number> = { low: 1024, medium: 8192, high: 16384, xhigh: 24576, max: 32768 };

/** Gemini 3 and later take a thinking level; 2.5 takes a token budget. */
export function usesThinkingLevel(model: string): boolean {
  const m = model.toLowerCase().match(/gemini-(\d+)(?:\.(\d+))?/);
  return !!m && Number(m[1]) >= 3;
}

export function isGeminiChatModel(model: any): boolean {
  const id = String(model?.name || '').replace(/^models\//, '').toLowerCase();
  if (!id.startsWith('gemini')) return false;
  if (/embedding|aqa|imagen|tts|live|native-audio|image-generation|-image|robotics|computer-use/.test(id)) return false;
  const actions = Array.isArray(model?.supportedActions) ? model.supportedActions : null;
  return !actions || actions.includes('generateContent');
}

export function geminiModelInfo(model: any): CloudModelInfo {
  const id = String(model?.name || '').replace(/^models\//, '');
  return {
    provider: 'gemini',
    id,
    label: String(model?.displayName || id),
    contextWindow: Number(model?.inputTokenLimit) || 1_048_576,
    maxOutput: Number(model?.outputTokenLimit) || 65_536,
    vision: true,
    thinking: model?.thinking === true || /gemini-(?:2\.5|[3-9])/.test(id) ? 'effort' : false,
    structuredOutput: true,
  };
}

export function buildGeminiParams(request: CloudChatRequest, options: { thinking?: boolean } = {}): { model: string; contents: any[]; config: Record<string, any> } {
  const { system, messages } = splitConversation(request);
  if (messages.length === 0) throw new CloudFailure('invalid', 'The conversation has no user message.');
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.images || []).map((image) => ({ inlineData: { mimeType: imageMediaType(image), data: bareBase64(image) } })),
      ...(m.content.trim() ? [{ text: m.content }] : []),
    ],
  }));
  const config: Record<string, any> = {};
  if (system) config.systemInstruction = system;
  const requested = Number(request.options?.num_predict);
  if (requested > 0) config.maxOutputTokens = Math.floor(requested);
  if (request.format === 'json') {
    config.responseMimeType = 'application/json';
  } else if (request.format && typeof request.format === 'object') {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = flattenSchema(request.format);
  }
  if (options.thinking !== false) {
    const effort = request.effort ?? (typeof request.think === 'string' ? request.think : undefined);
    const thinking: Record<string, any> = {};
    if (effort) {
      if (usesThinkingLevel(request.model)) thinking.thinkingLevel = effort === 'low' ? 'LOW' : effort === 'medium' ? 'MEDIUM' : 'HIGH';
      else thinking.thinkingBudget = BUDGETS[effort];
    }
    if (request.think) thinking.includeThoughts = true;
    if (Object.keys(thinking).length) config.thinkingConfig = thinking;
  }
  return { model: request.model, contents, config };
}

/** Turns streamed GenerateContentResponse chunks into Ollama chunks: thoughts as thinking, the rest as content. */
export class GeminiStreamTranslator {
  private model: string;
  private finishReason: string | null = null;
  private blockReason: string | null = null;
  private promptTokens = 0;
  private cachedTokens = 0;
  private outputTokens = 0;
  private wrote = false;
  readonly clock: StreamClock;

  constructor(model: string, now: () => number = Date.now) {
    this.model = model;
    this.clock = new StreamClock(now);
  }

  get hasOutput(): boolean {
    return this.wrote;
  }

  handle(chunk: any): CloudChunk[] {
    const out: CloudChunk[] = [];
    if (chunk?.modelVersion) this.model = String(chunk.modelVersion);
    if (chunk?.promptFeedback?.blockReason) this.blockReason = String(chunk.promptFeedback.blockReason);
    const candidate = Array.isArray(chunk?.candidates) ? chunk.candidates[0] : null;
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text !== 'string' || !part.text) continue;
      this.clock.mark();
      if (part.thought) {
        out.push(contentChunk(this.model, '', part.text));
      } else {
        this.wrote = true;
        out.push(contentChunk(this.model, part.text));
      }
    }
    if (candidate?.finishReason) this.finishReason = String(candidate.finishReason);
    const usage = chunk?.usageMetadata;
    if (usage) {
      this.promptTokens = Number(usage.promptTokenCount) || this.promptTokens;
      this.cachedTokens = Number(usage.cachedContentTokenCount) || this.cachedTokens;
      const written = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
      if (written) this.outputTokens = written;
    }
    return out;
  }

  finish(): CloudChunk {
    if (this.blockReason || (this.finishReason && BLOCKED.has(this.finishReason))) {
      throw new CloudFailure('refusal', `The answer was blocked by Gemini (${this.blockReason || this.finishReason}).`, {
        category: (this.blockReason || this.finishReason || '').toLowerCase(),
      });
    }
    return {
      model: this.model,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: this.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
      prompt_eval_count: this.promptTokens,
      cached_prompt_count: this.cachedTokens,
      eval_count: this.outputTokens,
      ...this.clock.durations(),
    };
  }
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  // The Gemini API with this key only: no Vertex AI, no project or address from the environment.
  return new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: { baseUrl: GEMINI_BASE_URL, timeout: 10 * 60 * 1000, fetch: noRedirectFetch as any },
  });
}

export async function listGeminiModels(client: GoogleGenAI): Promise<CloudModelInfo[]> {
  const models: CloudModelInfo[] = [];
  const pager = await client.models.list({ config: { pageSize: 100 } });
  for await (const model of pager) {
    if (isGeminiChatModel(model)) models.push(geminiModelInfo(model));
  }
  return models.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

/** Streams one answer; a request rejected for its thinking settings is sent once more without them. */
export async function runGemini(client: GoogleGenAI, request: CloudChatRequest, emit: (chunk: CloudChunk) => void, signal: AbortSignal): Promise<void> {
  let thinking = true;
  for (;;) {
    const { model, contents, config } = buildGeminiParams(request, { thinking });
    const translator = new GeminiStreamTranslator(request.model);
    try {
      const stream = await client.models.generateContentStream({ model, contents, config: { ...config, abortSignal: signal } });
      for await (const chunk of stream) {
        for (const piece of translator.handle(chunk)) emit(piece);
      }
      emit(translator.finish());
      return;
    } catch (err) {
      if (thinking && config.thinkingConfig && !translator.hasOutput && !signal.aborted && classifyCloudError(err).code === 'think_unsupported') {
        thinking = false;
        continue;
      }
      throw err;
    }
  }
}
