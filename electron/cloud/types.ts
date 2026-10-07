/**
 * Types shared by the main process (electron/cloud) and the renderer (through electron/preload.ts).
 * A cloud chat request has the shape of an Ollama /api/chat request, and the stream comes back as
 * Ollama chunks, so the chat and the agent handle every provider the same way.
 */
import type { BuiltinCloudProviderId, CloudProviderId, CompatEndpointInfo } from '../../src/lib/providers/modelRef';

export type { BuiltinCloudProviderId, CloudProviderId, CompatEndpointInfo };

export interface CloudChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Base64 images without the data: prefix, as Ollama takes them. */
  images?: string[];
}

/** The Ollama generation options a cloud request may carry (only some reach each provider). */
export interface CloudGenerationOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  repeat_last_n?: number;
  presence_penalty?: number;
  seed?: number;
  num_predict?: number;
  num_ctx?: number;
  stop?: string[];
}

export type CloudThinkValue = boolean | 'low' | 'medium' | 'high';

/**
 * How hard a model works on an answer (Settings › Cloud models › Effort): Claude's
 * `output_config.effort`, OpenAI's reasoning effort, Gemini's thinking level. Each provider gets the
 * nearest level the model supports; a model without such a setting ignores it.
 */
export type CloudEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const CLOUD_EFFORTS: CloudEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface CloudChatRequest {
  provider: CloudProviderId;
  /** The provider's model id ("claude-opus-5-5"), without the "provider::" prefix. */
  model: string;
  system?: string;
  messages: CloudChatMessage[];
  options?: CloudGenerationOptions;
  /** Ollama `format`: "json" or a JSON Schema the answer must follow. */
  format?: 'json' | Record<string, unknown>;
  think?: CloudThinkValue;
  /** Settings › Cloud models › Effort; absent = the provider's default. */
  effort?: CloudEffort;
  /** OpenAI reasoning models: ask for a readable summary of the reasoning (shown as thinking). */
  summaries?: boolean;
  /**
   * Experimental (Settings › Cloud models): the agent's actions go to Claude and GPT as the
   * provider's own tools instead of a JSON answer schema. The answer still comes back as the same
   * JSON action text, so the agent works the same way.
   */
  nativeTools?: boolean;
}

/** One piece of the answer, in the shape of an Ollama /api/chat chunk. */
export interface CloudChunk {
  model: string;
  created_at: string;
  message?: { role: 'assistant'; content: string; thinking?: string };
  done: boolean;
  /** "stop" or "length" (the output limit was reached). */
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  /** The whole prompt in tokens, cached parts included. */
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  /** Prompt tokens served from the provider's cache. */
  cached_prompt_count?: number;
}

export type CloudErrorCode =
  | 'no_key'
  | 'auth'
  | 'quota'
  | 'usage_limit'
  | 'plan_required'
  | 'rate_limit'
  | 'overloaded'
  | 'not_found'
  | 'format_unsupported'
  | 'think_unsupported'
  | 'context_length'
  | 'refusal'
  | 'network'
  | 'bad_request'
  | 'aborted'
  | 'invalid'
  | 'unknown';

export interface CloudError {
  code: CloudErrorCode;
  /** The provider's own message (English), for the details. */
  message: string;
  status?: number;
  /** Refusals: the provider's category ("cyber", "bio", …), when it gives one. */
  category?: string;
  /** Usage limits and rate limits: when it resets, as the provider says it ("in 2 hours", a date). */
  resetsAt?: string;
}

export type CloudEvent =
  | { requestId: string; type: 'chunk'; chunk: CloudChunk }
  | { requestId: string; type: 'end' }
  | { requestId: string; type: 'error'; error: CloudError };

/** A model a cloud provider offers to this account. */
export interface CloudModelInfo {
  provider: CloudProviderId;
  id: string;
  /** Display name ("Claude Opus 5.5"), or the id. */
  label: string;
  /** Input context window in tokens, when the provider says or it is known. */
  contextWindow?: number;
  /** Maximum output tokens of one answer. */
  maxOutput?: number;
  vision?: boolean;
  /** How the model reasons before answering, when it can. */
  thinking?: 'adaptive' | 'budget' | 'effort' | 'ollama' | false;
  structuredOutput?: boolean;
  /** Ollama Cloud: "120B", the architecture family. */
  parameterSize?: string;
  family?: string;
  /** Effort levels the model takes (Claude), when the provider says. */
  efforts?: CloudEffort[];
  /** Seconds since 1970, for sorting. */
  createdAt?: number;
}

export type CloudKeySource = 'saved' | 'session' | 'env';

export interface CloudProviderStatus {
  provider: CloudProviderId;
  configured: boolean;
  source: CloudKeySource | null;
  /** The last characters of the key ("…a1b2"); the key itself never leaves the main process. */
  hint?: string;
}

/** An OpenAI-compatible server the user added, as the renderer sees it (the key never leaves the main process). */
export interface CompatEndpointStatus extends CompatEndpointInfo {
  provider: CloudProviderId;
  /** The address the key is bound to ("https://openrouter.ai/api/v1"). */
  baseURL: string;
  /** Whether a key is saved for it (local servers often need none). */
  configured: boolean;
  source: CloudKeySource | null;
  hint?: string;
}

export interface CloudStatus {
  providers: Record<BuiltinCloudProviderId, CloudProviderStatus>;
  /** OpenAI-compatible servers, in the order they were added. */
  endpoints: CompatEndpointStatus[];
  /** Whether saved keys are encrypted with the system's key store ("none": kept for this session only). */
  encryption: 'os' | 'none';
}

export type CloudResult<T extends object = {}> = ({ ok: true } & T) | { ok: false; error: CloudError };
