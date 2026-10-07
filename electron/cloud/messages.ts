/** Helpers that every cloud adapter needs to turn an Ollama-shaped request into its own. */
import type { CloudChatMessage, CloudChatRequest, CloudChunk } from './types';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** The image type from the first bytes of its base64 data (Ollama images carry no type). */
export function imageMediaType(base64: string): ImageMediaType {
  const head = String(base64 || '').replace(/^data:[^,]*,/, '').slice(0, 16);
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

/** Base64 without a "data:…;base64," prefix. */
export function bareBase64(data: string): string {
  return String(data || '').replace(/^data:[^,]*,/, '');
}

/**
 * The system text and the conversation for APIs that take the system prompt apart and want the
 * conversation to start with the user and end with the user: system messages inside the history
 * join the system text, tool results count as user messages, empty messages and a leading or
 * trailing assistant message are dropped (newer Claude models refuse an assistant message at the
 * end; Emir Code never continues a written answer).
 */
export function splitConversation(request: CloudChatRequest): { system: string; messages: CloudChatMessage[] } {
  const systemParts: string[] = [];
  if (request.system && request.system.trim()) systemParts.push(request.system.trim());
  const messages: CloudChatMessage[] = [];
  for (const m of request.messages || []) {
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'system') {
      if (content.trim()) systemParts.push(content.trim());
      continue;
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const images = Array.isArray(m.images) ? m.images.filter((i) => typeof i === 'string' && i) : [];
    if (!content.trim() && images.length === 0) continue;
    messages.push({ role, content, ...(images.length ? { images } : {}) });
  }
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
  return { system: systemParts.join('\n\n'), messages };
}

/** Measures one answer: the time to the first piece (reading the prompt) and the rest (writing). */
export class StreamClock {
  private readonly started: number;
  private first: number | null = null;
  constructor(private readonly now: () => number = Date.now) {
    this.started = now();
  }
  mark(): void {
    if (this.first === null) this.first = this.now();
  }
  durations(): Pick<CloudChunk, 'total_duration' | 'load_duration' | 'prompt_eval_duration' | 'eval_duration'> {
    const end = this.now();
    const first = this.first ?? end;
    const ms = (n: number) => Math.max(0, Math.round(n * 1e6));
    return {
      total_duration: ms(end - this.started),
      load_duration: 0,
      prompt_eval_duration: ms(first - this.started),
      eval_duration: ms(end - first),
    };
  }
}

export function contentChunk(model: string, content: string, thinking = ''): CloudChunk {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content, ...(thinking ? { thinking } : {}) },
    done: false,
  };
}
