/**
 * The cloud providers in the main process: keys, model lists and streamed answers. The renderer
 * sends an Ollama-shaped request with an id (`cloud:chat`) and gets the answer back as `cloud:event`
 * messages (chunks, then `end` or `error`); `cloud:abort` stops it. The renderer never sees a key
 * and never chooses an address: each built-in provider has one fixed host, and an OpenAI-compatible
 * server is named by its id, its address and key staying here (bound together).
 */
import type { IpcMain, WebContents } from 'electron';
import {
  BuiltinCloudProviderId,
  CLOUD_MODEL_ID_RE,
  CloudProviderId,
  compatEndpointId,
  compatProviderId,
  isCloudProvider,
  isCompatProvider,
  registerCompatEndpoints,
} from '../../src/lib/providers/modelRef';
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
  CompatEndpointStatus,
} from './types';
import { CLOUD_EFFORTS } from './types';
import { CloudFailure, classifyCloudError } from './errors';
import { KeyStore, validKeyFormat } from './keyStore';
import { AnthropicCaps, anthropicCapsFromModel, anthropicModelInfo, createAnthropicClient, guessAnthropicCaps, listAnthropicModels, runAnthropic } from './anthropic';
import { MISTRAL_BASE_URL, createOpenAIClient, listCompatModels, listMistralModels, listOpenAIModels, mistralModelInfo, openAIModelInfo, runOpenAI, compatModelInfo } from './openai';
import { listOllamaCloudModels, ollamaCloudModelInfo, runOllamaCloud, showOllamaCloudModel } from './ollamaCloud';
import { createGeminiClient, geminiModelInfo, listGeminiModels, runGemini } from './gemini';
import { CompatEndpoint, EndpointStore, MAX_ENDPOINTS, checkEndpointUrl, cleanEndpointName, endpointInfo } from './endpoints';

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
/** A local OpenAI-compatible server without a key still needs some bearer value. */
const NO_KEY = 'no-key-needed';

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
  if (CLOUD_EFFORTS.includes(raw.effort)) request.effort = raw.effort;
  if (raw.summaries === true) request.summaries = true;
  if (raw.nativeTools === true) request.nativeTools = true;
  return { ok: true, request };
}

export class CloudService {
  private active = new Map<string, AbortController>();
  /** Claude capabilities by model id (from the Models API, or guessed). */
  private anthropicCaps = new Map<string, AnthropicCaps>();
  /** The last model lists of the OpenAI-compatible servers (they carry the context windows some servers report). */
  private compatModels = new Map<string, CloudModelInfo[]>();

  constructor(
    private readonly keys: KeyStore,
    private readonly endpoints: EndpointStore = new EndpointStore(null)
  ) {
    registerCompatEndpoints(this.endpoints.all().map(endpointInfo));
  }

  private endpointStatus(endpoint: CompatEndpoint): CompatEndpointStatus {
    const provider = compatProviderId(endpoint.id);
    const key = this.keys.providerStatus(provider, endpoint.baseURL);
    return {
      ...endpointInfo(endpoint),
      provider,
      baseURL: endpoint.baseURL,
      configured: key.configured,
      source: key.source,
      ...(key.hint ? { hint: key.hint } : {}),
    };
  }

  status(): CloudStatus {
    const all = this.endpoints.all();
    registerCompatEndpoints(all.map(endpointInfo));
    return { ...this.keys.status(), endpoints: all.map((e) => this.endpointStatus(e)) };
  }

  /** Masks every key this service knows, plus `extra`, in an error text. */
  private classify(err: unknown, extra?: string | null): CloudError {
    return classifyCloudError(err, [extra, ...this.keys.knownKeys()]);
  }

  private endpointOf(provider: CloudProviderId): CompatEndpoint {
    const endpoint = this.endpoints.get(compatEndpointId(provider) || '');
    if (!endpoint) throw new CloudFailure('not_found', 'This server is no longer in Settings › Cloud models.');
    return endpoint;
  }

  private requireKey(provider: CloudProviderId, key?: string): string {
    if (key) return key;
    if (isCompatProvider(provider)) {
      const endpoint = this.endpointOf(provider);
      return this.keys.get(provider, endpoint.baseURL) || NO_KEY;
    }
    const value = this.keys.get(provider);
    if (!value) throw new CloudFailure('no_key', 'No API key is set for this provider.');
    return value;
  }

  private async fetchModels(provider: CloudProviderId, key: string, endpoint?: CompatEndpoint): Promise<CloudModelInfo[]> {
    if (isCompatProvider(provider)) {
      const target = endpoint || this.endpointOf(provider);
      const models = await listCompatModels(createOpenAIClient(key, target.baseURL), provider);
      this.compatModels.set(provider, models);
      return models;
    }
    switch (provider as BuiltinCloudProviderId) {
      case 'anthropic':
        return listAnthropicModels(createAnthropicClient(key));
      case 'openai':
        return listOpenAIModels(createOpenAIClient(key));
      case 'mistral':
        return listMistralModels(createOpenAIClient(key, MISTRAL_BASE_URL));
      case 'gemini':
        return listGeminiModels(createGeminiClient(key));
      default:
        return listOllamaCloudModels(key, AbortSignal.timeout(20000));
    }
  }

  async listModels(provider: unknown): Promise<CloudResult<{ models: CloudModelInfo[] }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    let key: string | null = null;
    try {
      key = this.requireKey(provider);
      const models = await this.fetchModels(provider, key);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: this.classify(err, key) };
    }
  }

  /** Checks a key by listing the provider's models with it; saves it only when that works. */
  async setKey(provider: unknown, key: unknown): Promise<CloudResult<{ status: CloudStatus; persisted: boolean; models: CloudModelInfo[] }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    const value = typeof key === 'string' ? key.trim() : '';
    if (!validKeyFormat(value)) return fail('invalid', 'This does not look like an API key.');
    try {
      const endpoint = isCompatProvider(provider) ? this.endpointOf(provider) : undefined;
      const models = await this.fetchModels(provider, value, endpoint);
      const { persisted } = this.keys.set(provider, value, endpoint?.baseURL);
      if (provider === 'anthropic') this.anthropicCaps.clear();
      return { ok: true, status: this.status(), persisted, models };
    } catch (err) {
      return { ok: false, error: this.classify(err, value) };
    }
  }

  removeKey(provider: unknown): CloudStatus {
    if (isCloudProvider(provider)) this.keys.remove(provider);
    return this.status();
  }

  /**
   * Adds an OpenAI-compatible server: checks the address rules, lists its models (with the key, if
   * one is given) and only then saves the server and its key, bound to this address.
   */
  async addEndpoint(input: unknown): Promise<CloudResult<{ status: CloudStatus; endpoint: CompatEndpointStatus; models: CloudModelInfo[]; persisted: boolean }>> {
    const raw = (input || {}) as Record<string, unknown>;
    const name = cleanEndpointName(raw.name);
    if (!name) return fail('invalid', 'The server needs a name.');
    if (this.endpoints.all().length >= MAX_ENDPOINTS) return fail('invalid', `At most ${MAX_ENDPOINTS} servers can be added.`);
    const checked = checkEndpointUrl(String(raw.baseURL || ''), raw.localServer === true);
    if (!checked.ok) return fail('invalid', `address:${checked.error}`);
    if (this.endpoints.all().some((e) => e.baseURL === checked.baseURL)) return fail('invalid', 'address:duplicate');
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (key && !validKeyFormat(key)) return fail('invalid', 'This does not look like an API key.');
    const draft: CompatEndpoint = { id: '__draft__', name, baseURL: checked.baseURL, local: checked.local, createdAt: 0 };
    try {
      const models = await listCompatModels(createOpenAIClient(key || NO_KEY, draft.baseURL), compatProviderId('draft'));
      const endpoint = this.endpoints.add({ name, baseURL: checked.baseURL, local: checked.local });
      const provider = compatProviderId(endpoint.id);
      const own = models.map((m) => ({ ...m, provider }));
      this.compatModels.set(provider, own);
      const persisted = key ? this.keys.set(provider, key, endpoint.baseURL).persisted : true;
      const status = this.status();
      return { ok: true, status, endpoint: this.endpointStatus(endpoint), models: own, persisted };
    } catch (err) {
      return { ok: false, error: this.classify(err, key) };
    }
  }

  removeEndpoint(id: unknown): CloudStatus {
    if (typeof id === 'string' && this.endpoints.get(id)) {
      const provider = compatProviderId(id);
      this.keys.remove(provider);
      this.compatModels.delete(provider);
      this.endpoints.remove(id);
    }
    return this.status();
  }

  /** What the agent needs to know about one model: context window, output limit, vision, thinking. */
  async describe(provider: unknown, model: unknown): Promise<CloudResult<{ info: CloudModelInfo; show?: any }>> {
    if (!isCloudProvider(provider)) return fail('invalid', 'Unknown provider.');
    if (typeof model !== 'string' || !CLOUD_MODEL_ID_RE.test(model)) return fail('invalid', 'Invalid model name.');
    let key: string | null = null;
    try {
      if (provider === 'openai') return { ok: true, info: openAIModelInfo({ id: model }) };
      key = this.requireKey(provider);
      if (isCompatProvider(provider)) {
        const list = this.compatModels.get(provider) || (await this.fetchModels(provider, key));
        return { ok: true, info: list.find((m) => m.id === model) || compatModelInfo(provider, { id: model }) };
      }
      if (provider === 'anthropic') {
        const entry = await createAnthropicClient(key).models.retrieve(model);
        this.anthropicCaps.set(model, anthropicCapsFromModel(entry));
        return { ok: true, info: anthropicModelInfo(entry) };
      }
      if (provider === 'gemini') {
        const entry = await createGeminiClient(key).models.get({ model });
        return { ok: true, info: geminiModelInfo(entry) };
      }
      if (provider === 'mistral') {
        const entry = await createOpenAIClient(key, MISTRAL_BASE_URL).models.retrieve(model);
        return { ok: true, info: mistralModelInfo(entry) };
      }
      const show = await showOllamaCloudModel(key, model, AbortSignal.timeout(20000));
      return { ok: true, info: ollamaCloudModelInfo({ model, details: show?.details }), show };
    } catch (err) {
      return { ok: false, error: this.classify(err, key) };
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

  private async run(request: CloudChatRequest, key: string, emit: (chunk: CloudChunk) => void, signal: AbortSignal): Promise<void> {
    if (isCompatProvider(request.provider)) {
      const endpoint = this.endpointOf(request.provider);
      // A compatible server gets no native tools and no reasoning settings it may not know.
      return runOpenAI(createOpenAIClient(key, endpoint.baseURL), { ...request, nativeTools: false }, emit, signal, 'compat');
    }
    switch (request.provider as BuiltinCloudProviderId) {
      case 'anthropic':
        return runAnthropic(createAnthropicClient(key), request, await this.capsFor(key, request.model), emit, signal);
      case 'openai':
        return runOpenAI(createOpenAIClient(key), request, emit, signal, 'openai');
      case 'mistral':
        return runOpenAI(createOpenAIClient(key, MISTRAL_BASE_URL), { ...request, nativeTools: false }, emit, signal, 'mistral');
      case 'gemini':
        return runGemini(createGeminiClient(key), request, emit, signal);
      default:
        return runOllamaCloud(key, request, emit, signal);
    }
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
      let key: string | null = null;
      try {
        key = this.requireKey(checked.request.provider);
        await this.run(checked.request, key, (chunk) => send({ requestId, type: 'chunk', chunk }), controller.signal);
        send({ requestId, type: 'end' });
      } catch (err) {
        const error = controller.signal.aborted ? { code: 'aborted' as const, message: 'Stopped.' } : this.classify(err, key);
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
  ipcMain.handle('cloud:addEndpoint', (_event, input: unknown) => service.addEndpoint(input));
  ipcMain.handle('cloud:removeEndpoint', (_event, id: unknown) => service.removeEndpoint(id));
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

export { KeyStore, safeStorageBox, maskKey } from './keyStore';
export { EndpointStore } from './endpoints';
