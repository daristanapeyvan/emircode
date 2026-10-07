/**
 * Ollama Cloud through ollama.com's own API with an API key (no local Ollama needed). The API is
 * Ollama's: the request goes as it is and the answer already comes as Ollama chunks. Only
 * https://ollama.com is reached, and a redirect counts as an error, so the key goes nowhere else.
 *
 * (Cloud models can also run through the local Ollama after `ollama signin`; those are ordinary
 * local models with a "-cloud" tag and never pass through here.)
 */
import type { CloudChatRequest, CloudChunk, CloudModelInfo } from './types';
import { HttpStatusError } from './errors';

export const OLLAMA_CLOUD_URL = 'https://ollama.com';

type Fetch = typeof fetch;

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function failure(res: Response): Promise<HttpStatusError> {
  let message = `HTTP ${res.status}`;
  try {
    const text = (await res.text()).slice(0, 2000);
    try {
      const json = JSON.parse(text);
      message = String(json?.error?.message || json?.error || text || message);
    } catch {
      if (text.trim()) message = text.trim();
    }
  } catch {
    // keep the status
  }
  return new HttpStatusError(res.status, message);
}

async function request(fetchImpl: Fetch, apiKey: string, path: string, init: RequestInit): Promise<Response> {
  const res = await fetchImpl(`${OLLAMA_CLOUD_URL}${path}`, { ...init, headers: headers(apiKey), redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) throw new HttpStatusError(res.status, 'Unexpected redirect from ollama.com.');
  if (!res.ok) throw await failure(res);
  return res;
}

export function buildOllamaCloudBody(req: CloudChatRequest): Record<string, unknown> {
  const messages: Array<{ role: string; content: string; images?: string[] }> = [];
  if (req.system && req.system.trim()) messages.push({ role: 'system', content: req.system.trim() });
  for (const m of req.messages || []) {
    messages.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      ...(Array.isArray(m.images) && m.images.length ? { images: m.images } : {}),
    });
  }
  const body: Record<string, unknown> = { model: req.model, messages, stream: true };
  if (req.options && Object.keys(req.options).length) body.options = req.options;
  if (req.format) body.format = req.format;
  if (req.think !== undefined) body.think = req.think;
  return body;
}

/** Reads an NDJSON stream line by line; `{"error": …}` in the stream is an error. */
export async function readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: any) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string) => {
    if (!line.trim()) return;
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (value && typeof value.error === 'string' && value.error) throw new HttpStatusError(500, value.error);
    onLine(value);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) handle(line);
  }
  handle(buffer + decoder.decode());
}

export async function runOllamaCloud(
  apiKey: string,
  req: CloudChatRequest,
  emit: (chunk: CloudChunk) => void,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch
): Promise<void> {
  const res = await request(fetchImpl, apiKey, '/api/chat', { method: 'POST', body: JSON.stringify(buildOllamaCloudBody(req)), signal });
  if (!res.body) throw new HttpStatusError(500, 'Empty response from ollama.com.');
  await readNdjson(res.body as ReadableStream<Uint8Array>, (chunk) => emit(chunk as CloudChunk));
}

export function ollamaCloudModelInfo(model: any): CloudModelInfo {
  const id = String(model?.model || model?.name || '');
  const details = model?.details || {};
  const modified = Date.parse(String(model?.modified_at || ''));
  return {
    provider: 'ollama-cloud',
    id,
    label: id,
    thinking: /gpt-oss|deepseek|qwen3|kimi-k2-thinking|glm|magistral/i.test(id) ? 'ollama' : false,
    vision: /vl|vision|gemma3|qwen3-vl|llava/i.test(id),
    ...(details.parameter_size ? { parameterSize: String(details.parameter_size) } : {}),
    ...(details.family ? { family: String(details.family) } : {}),
    ...(Number.isFinite(modified) ? { createdAt: Math.floor(modified / 1000) } : {}),
  };
}

export async function listOllamaCloudModels(apiKey: string, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<CloudModelInfo[]> {
  const res = await request(fetchImpl, apiKey, '/api/tags', { method: 'GET', signal });
  const data: any = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map(ollamaCloudModelInfo).filter((m: CloudModelInfo) => m.id).sort((a: CloudModelInfo, b: CloudModelInfo) => a.id.localeCompare(b.id));
}

/** /api/show of a cloud model: capabilities and the native context window. */
export async function showOllamaCloudModel(apiKey: string, model: string, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<any> {
  const res = await request(fetchImpl, apiKey, '/api/show', { method: 'POST', body: JSON.stringify({ model }), signal });
  return await res.json();
}
