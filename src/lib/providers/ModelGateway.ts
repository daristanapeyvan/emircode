/**
 * ModelGateway.ts — the one way the chat and the agent talk to a model.
 *
 * `chatStream` takes the same parameters as OllamaClient.chatStream and calls back with the same
 * chunks. A local model goes to Ollama as before; a cloud model (Ollama Cloud with an API key,
 * Claude, GPT) goes to the main process, which holds the key, calls the provider and streams the
 * answer back as Ollama chunks over `cloud:event`. Stopping works the same way for both: the
 * signal aborts and the promise rejects with an AbortError.
 */
import { ollamaClient } from '../ollama/OllamaClient';
import type { GenerationOptions, OllamaChatChunk, OllamaChatMessage, OllamaFormat, OllamaThinkValue } from '@/types/ollama';
import type { CloudChatRequest, CloudErrorCode, CloudEvent } from '../../../electron/preload';
import { CloudProviderId, parseModelRef } from './modelRef';

export interface GatewayChatParams {
  /** A local Ollama name or a "provider::model" reference. */
  model: string;
  messages: OllamaChatMessage[];
  options?: GenerationOptions;
  system?: string;
  keep_alive?: string;
  format?: OllamaFormat;
  think?: OllamaThinkValue;
}

/** A failed cloud request, with the code the interface and the agent react to. */
export class CloudRequestError extends Error {
  readonly code: CloudErrorCode;
  readonly provider: CloudProviderId;
  readonly status?: number;
  readonly category?: string;
  constructor(provider: CloudProviderId, code: CloudErrorCode, message: string, extra: { status?: number; category?: string } = {}) {
    super(message);
    this.name = 'CloudRequestError';
    this.provider = provider;
    this.code = code;
    this.status = extra.status;
    this.category = extra.category;
  }
}

export function isCloudRequestError(err: unknown): err is CloudRequestError {
  return !!err && typeof err === 'object' && (err as any).name === 'CloudRequestError' && typeof (err as any).code === 'string';
}

function abortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
  }
}

const listeners = new Map<string, (event: CloudEvent) => void>();
let unsubscribe: (() => void) | null = null;
let subscribedTo: unknown = null;
let counter = 0;

/** One listener for all cloud requests, attached to the bridge the window has now. */
function listen(): void {
  const api = window.electronAPI;
  if (!api?.onCloudEvent || subscribedTo === api) return;
  unsubscribe?.();
  unsubscribe = api.onCloudEvent((event) => listeners.get(event.requestId)?.(event));
  subscribedTo = api;
}

export function buildCloudRequest(provider: CloudProviderId, model: string, params: GatewayChatParams): CloudChatRequest {
  const request: CloudChatRequest = {
    provider,
    model,
    messages: params.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images && m.images.length ? { images: m.images } : {}),
    })),
  };
  if (params.system && params.system.trim()) request.system = params.system;
  if (params.options && Object.keys(params.options).length) {
    const { stop: _stop, ...options } = params.options;
    request.options = options;
  }
  if (params.format) request.format = params.format;
  if (params.think !== undefined) request.think = params.think;
  return request;
}

async function cloudChatStream(
  provider: CloudProviderId,
  model: string,
  params: GatewayChatParams,
  onChunk: (chunk: OllamaChatChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  const api = window.electronAPI;
  if (!api?.cloudChat || !api.onCloudEvent) {
    throw new CloudRequestError(provider, 'network', 'Cloud models are available in the desktop app only.');
  }
  if (signal?.aborted) throw abortError();
  const requestId = `cloud_${Date.now().toString(36)}_${++counter}`;
  const request = buildCloudRequest(provider, model, params);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      listeners.delete(requestId);
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => {
      void api.cloudAbort?.(requestId);
      settle(() => reject(abortError()));
    };
    listeners.set(requestId, (event) => {
      if (event.type === 'chunk') {
        try {
          onChunk(event.chunk as OllamaChatChunk);
        } catch (err) {
          void api.cloudAbort?.(requestId);
          settle(() => reject(err));
        }
      } else if (event.type === 'end') {
        settle(resolve);
      } else {
        const { code, message, status, category } = event.error;
        settle(() => reject(code === 'aborted' ? abortError() : new CloudRequestError(provider, code, message, { status, category })));
      }
    });
    listen();
    signal?.addEventListener('abort', onAbort, { once: true });
    api.cloudChat!(requestId, request).then(
      (started) => {
        if (!started.ok) {
          const { code, message, status } = started.error;
          settle(() => reject(new CloudRequestError(provider, code, message, { status })));
        }
      },
      (err) => settle(() => reject(err))
    );
  });
}

export const modelGateway = {
  chatStream(params: GatewayChatParams, onChunk: (chunk: OllamaChatChunk) => void, signal?: AbortSignal): Promise<void> {
    const ref = parseModelRef(params.model);
    if (ref.provider === 'ollama') return ollamaClient.chatStream({ ...params, model: ref.model }, onChunk, signal);
    return cloudChatStream(ref.provider, ref.model, params, onChunk, signal);
  },
};
