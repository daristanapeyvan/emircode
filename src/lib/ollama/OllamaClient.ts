import {
  OllamaModel,
  OllamaRunningModel,
  OllamaShowResponse,
  OllamaPullProgress,
  OllamaChatChunk,
  OllamaChatMessage,
  GenerationOptions,
  OllamaFormat,
  OllamaThinkValue,
} from '@/types/ollama';

export class OllamaClient {
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:11434') {
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  setEndpoint(endpoint: string) {
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  async testConnection(customEndpoint?: string): Promise<{ ok: boolean; error?: string }> {
    const base = customEndpoint ? customEndpoint.replace(/\/+$/, '') : this.endpoint;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(id);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      return { ok: true };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { ok: false, error: 'Connection timed out' };
      }
      return { ok: false, error: err.message || 'Failed to reach Ollama endpoint' };
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.endpoint}/api/tags`);
    if (!res.ok) {
      throw new Error(`Failed to list models: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.models || [];
  }

  async showModel(name: string): Promise<OllamaShowResponse> {
    const res = await fetch(`${this.endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `model` is the current field name; `name` is kept for older Ollama servers.
      body: JSON.stringify({ model: name, name }),
    });
    if (!res.ok) {
      throw new Error(`Failed to inspect model: HTTP ${res.status}`);
    }
    return await res.json();
  }

  async listRunning(): Promise<OllamaRunningModel[]> {
    const res = await fetch(`${this.endpoint}/api/ps`);
    if (!res.ok) {
      throw new Error(`Failed to list running models: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.models || [];
  }

  async unloadModel(name: string): Promise<void> {
    const res = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: 0 }),
    });
    if (!res.ok) {
      throw new Error(`Failed to unload model: HTTP ${res.status}`);
    }
  }

  async deleteModel(name: string): Promise<void> {
    const res = await fetch(`${this.endpoint}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(`Failed to delete model: HTTP ${res.status}`);
    }
  }

  async pullModel(
    name: string,
    onProgress: (progress: OllamaPullProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Failed to pull model: HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by fetch response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed: OllamaPullProgress = JSON.parse(line);
          onProgress(parsed);
        } catch {
          // Ignore malformed line
        }
      }
    }
  }

  async chatStream(
    params: {
      model: string;
      messages: OllamaChatMessage[];
      options?: GenerationOptions;
      system?: string;
      keep_alive?: string;
      format?: OllamaFormat;
      think?: OllamaThinkValue;
    },
    onChunk: (chunk: OllamaChatChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const payloadMessages: OllamaChatMessage[] = [];

    // Inject system message if provided
    if (params.system && params.system.trim()) {
      payloadMessages.push({
        role: 'system',
        content: params.system.trim(),
      });
    }

    payloadMessages.push(...params.messages);

    const body: Record<string, any> = {
      model: params.model,
      messages: payloadMessages,
      stream: true,
    };

    if (params.options && Object.keys(params.options).length > 0) {
      body.options = params.options;
    }
    if (params.keep_alive) {
      body.keep_alive = params.keep_alive;
    }
    if (params.format) {
      body.format = params.format;
    }
    if (params.think !== undefined) {
      body.think = params.think;
    }

    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const json = JSON.parse(errText);
        if (json.error) msg = json.error;
      } catch {
        if (errText) msg = errText;
      }
      throw new Error(msg);
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by fetch response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let chunk: (OllamaChatChunk & { error?: string }) | null = null;
      try {
        chunk = JSON.parse(line);
      } catch {
        return; // Ignore malformed line
      }
      if (chunk && typeof chunk.error === 'string' && chunk.error) {
        // Ollama reports mid-stream failures (runner crash, OOM, bad grammar) as {"error": "..."}
        throw new Error(chunk.error);
      }
      if (chunk) onChunk(chunk);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        handleLine(line);
      }
    }
    handleLine(buffer);
  }
}

export const ollamaClient = new OllamaClient();
