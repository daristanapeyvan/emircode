/**
 * The cloud providers in the main process: keys, model lists and streamed answers. The renderer
 * sends an Ollama-shaped request with an id (`cloud:chat`) and gets the answer back as `cloud:event`
 * messages (chunks, then `end` or `error`); `cloud:abort` stops it. The renderer never sees a key
 * and never chooses an address: each provider has one fixed host.
 */
import type { IpcMain, WebContents } from 'electron';
import { CloudProviderId, CLOUD_MODEL_ID_RE, isCloudProvider } from '../../src/lib/providers/modelRef';
import type {
  CloudChatMessage,
  CloudChatRequest,
  CloudChunk,
  CloudError,
  CloudEvent,
  CloudGenerationOptions,
  CloudModelInfo,
  CloudResult,
  CloudStatus,
} from './types';
import { CloudFailure, classifyCloudError } from './errors';
import { KeyStore, validKeyFormat } from './keyStore';
import { AnthropicCaps, anthropicCapsFromModel, anthropicModelInfo, createAnthropicClient, guessAnthropicCaps, listAnthropicModels, runAnthropic } from './anthropic';
import { createOpenAIClient, listOpenAIModels, openAIModelInfo, runOpenAI } from './openai';
import { listOllamaCloudModels, ollamaCloudModelInfo, runOllamaCloud, showOllamaCloudModel } from './ollamaCloud';

/** Upper bound of one request (images included), so a broken renderer cannot exhaust memory. */
const MAX_REQUEST_CHARS = 48 * 1024 * 1024;
const MAX_MESSAGES = 4000;
const THINK_VALUES = new Set<unknown>([true, false, 'low', 'medium', 'high']);
const OPTION_KEYS: Array<keyof CloudGenerationOptions> = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'repeat_penalty',
  'repeat_last_n',
  'presence_penalty',
  'seed',
  'num_predict',
  'num_ctx',
];

const fail = (code: CloudError['code'], message: string): { ok: false; error: CloudError } => ({ ok: false, error: { code, message } });

/** A checked copy of a request from the renderer, or why it is refused. */
export function validateChatRequest(input: unknown): CloudResult<{ request: CloudChatRequest }> {
  const raw = (input || {}) as Record<string, any>;
  if (!isCloudProvider(raw.provider)) return fail('invalid', 'Unknown provider.');
  if (typeof raw.model !== 'string' || !CLOUD_MODEL_ID_RE.test(raw.model)) return fail('invalid', 'Invalid model name.');
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > MAX_MESSAGES) return fail('invalid', 'Invalid messages.');
  let size = typeof raw.system === 'string' ? raw.system.length : 0;
  const messages: CloudChatMessage[] = [];
  for (const m of raw.messages) {
    if (!m || !['system', 'user', 'assistant', 'tool'].includes(m.role) || typeof m.content !== 'string') return fail('invalid', 'Invalid message.');
    const images = Array.isArray(m.images) ? m.images.filter((i: unknown): i is string => typeof i === 'string') : [];
    size += m.content.length + images.reduce((sum: number, i: string) => sum + i.length, 0);
    messages.push({ role: m.role, content: m.content, ...(images.length ? { images } : {}) });
  }
  if (size > MAX_REQUEST_CHARS) return fail('invalid', 'The request is too large.');
  const options: CloudGenerationOptions = {};
  if (raw.options && typeof raw.options === 'object') {
    for (const key of OPTION_KEYS) {
      const value = raw.options[key];
      if (typeof value === 'number' && Number.isFinite(value)) (options as any)[key] = value;
    }
  }
  const request: CloudChatRequest = { provider: raw.provider, model: raw.model, messages };
  if (typeof raw.system === 'string' && raw.system) request.system = raw.system;
  if (Object.keys(options).length) request.options = options;
  if (raw.format === 'json' || (raw.format && typeof raw.format === 'object' && !Array.isArray(raw.format))) request.format = raw.format;
  if (raw.think !== undefined && THINK_VALUES.has(raw.think)) request.think = raw.think;
  return { ok: true, request };
}

export class CloudService {
  private active = new Map<string, AbortController>();
  /** Claude capabilities by model id (from the Models API, or guessed). */
  private anthropicCaps = new Map<string, AnthropicCaps>();

  constructor(private readonly keys: KeyStore) {}

  status(): CloudStatus {
    return this.keys.status();
  }

  private requireKey(provider: CloudProviderId, key?: string): string {
    const value = key ?? this.keys.get(provider);
    if (!value) throw new CloudFailure('no_key', 'No API key is set for this provider.');
    return value;
  }

  private async fetchModels(provider: CloudProviderId, key: string): Promise<CloudModelInfo[]> {
    if (provider === 'anthropic') return listAnthropicModels(createAnthropicClient(key));
    if (provider === 'openai') return listOpenAIModels(createOpenAIClient(key));
    return listOllamaCloudModels(key, AbortSignal.timeout(20000));
  }

  async listModels(provider: unknown): Promise<CloudResult<{ models: CloudModelInfo[] }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    try {
      const models = await this.fetchModels(provider, this.requireKey(provider));
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: classifyCloudError(err) };
    }
  }

  /** Checks a key by listing the provider's models with it; saves it only when that works. */
  async setKey(provider: unknown, key: unknown): Promise<CloudResult<{ status: CloudStatus; persisted: boolean; models: CloudModelInfo[] }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    const value = typeof key === 'string' ? key.trim() : '';
    if (!validKeyFormat(value)) return fail('invalid', 'This does not look like an API key.');
    try {
      const models = await this.fetchModels(provider, value);
      const { persisted } = this.keys.set(provider, value);
      if (provider === 'anthropic') this.anthropicCaps.clear();
      return { ok: true, status: this.keys.status(), persisted, models };
    } catch (err) {
      return { ok: false, error: classifyCloudError(err) };
    }
  }

  removeKey(provider: unknown): CloudStatus {
    if (isCloudProvider(provider)) this.keys.remove(provider);
    return this.keys.status();
  }

  /** What the agent needs to know about one model: context window, output limit, vision, thinking. */
  async describe(provider: unknown, model: unknown): Promise<CloudResult<{ info: CloudModelInfo; show?: any }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    if (typeof model !== 'string' || !CLOUD_MODEL_ID_RE.test(model)) return fail('invalid', 'Invalid model name.');
    try {
      if (provider === 'openai') return { ok: true, info: openAIModelInfo({ id: model }) };
      const key = this.requireKey(provider);
      if (provider === 'anthropic') {
        const entry = await createAnthropicClient(key).models.retrieve(model);
        this.anthropicCaps.set(model, anthropicCapsFromModel(entry));
        return { ok: true, info: anthropicModelInfo(entry) };
      }
      const show = await showOllamaCloudModel(key, model, AbortSignal.timeout(20000));
      return { ok: true, info: ollamaCloudModelInfo({ model, details: show?.details }), show };
    } catch (err) {
      return { ok: false, error: classifyCloudError(err) };
    }
  }

  private async capsFor(key: string, model: string): Promise<AnthropicCaps> {
    const known = this.anthropicCaps.get(model);
    if (known) return known;
    let caps: AnthropicCaps;
    try {
      caps = anthropicCapsFromModel(await createAnthropicClient(key).models.retrieve(model, {}, { timeout: 8000, maxRetries: 0 }));
    } catch {
      caps = guessAnthropicCaps(model);
    }
    this.anthropicCaps.set(model, caps);
    return caps;
  }

  private async run(request: CloudChatRequest, emit: (chunk: CloudChunk) => void, signal: AbortSignal): Promise<void> {
    const key = this.requireKey(request.provider);
    if (request.provider === 'anthropic') {
      const caps = await this.capsFor(key, request.model);
      return runAnthropic(createAnthropicClient(key), request, caps, emit, signal);
    }
    if (request.provider === 'openai') return runOpenAI(createOpenAIClient(key), request, emit, signal);
    return runOllamaCloud(key, request, emit, signal);
  }

  /** Starts a streamed answer; everything after the start arrives through `send`. */
  chat(requestId: unknown, input: unknown, send: (event: CloudEvent) => void): CloudResult {
    if (typeof requestId !== 'string' || !/^[\w-]{1,80}$/.test(requestId)) return fail('invalid', 'Invalid request id.');
    if (this.active.has(requestId)) return fail('invalid', 'Duplicate request id.');
    const checked = validateChatRequest(input);
    if (!checked.ok) return checked;
    const controller = new AbortController();
    this.active.set(requestId, controller);
    void (async () => {
      try {
        await this.run(checked.request, (chunk) => send({ requestId, type: 'chunk', chunk }), controller.signal);
        send({ requestId, type: 'end' });
      } catch (err) {
        const error = controller.signal.aborted ? { code: 'aborted' as const, message: 'Stopped.' } : classifyCloudError(err);
        send({ requestId, type: 'error', error });
      } finally {
        this.active.delete(requestId);
      }
    })();
    return { ok: true };
  }

  abort(requestId: unknown): boolean {
    if (typeof requestId !== 'string') return false;
    const controller = this.active.get(requestId);
    controller?.abort();
    return !!controller;
  }

  abortAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }
}

export function registerCloudIpc(ipcMain: IpcMain, service: CloudService): void {
  ipcMain.handle('cloud:status', () => service.status());
  ipcMain.handle('cloud:setKey', (_event, { provider, key }: { provider: unknown; key: unknown }) => service.setKey(provider, key));
  ipcMain.handle('cloud:removeKey', (_event, provider: unknown) => service.removeKey(provider));
  ipcMain.handle('cloud:listModels', (_event, provider: unknown) => service.listModels(provider));
  ipcMain.handle('cloud:describe', (_event, { provider, model }: { provider: unknown; model: unknown }) => service.describe(provider, model));
  ipcMain.handle('cloud:abort', (_event, requestId: unknown) => service.abort(requestId));
  ipcMain.handle('cloud:chat', (event, { requestId, request }: { requestId: unknown; request: unknown }) => {
    const sender: WebContents = event.sender;
    return service.chat(requestId, request, (message) => {
      // A closed or reloaded window stops its requests instead of paying for answers nobody reads.
      if (sender.isDestroyed()) service.abort(message.requestId);
      else sender.send('cloud:event', message);
    });
  });
}

export { KeyStore } from './keyStore';
export { safeStorageBox } from './keyStore';
