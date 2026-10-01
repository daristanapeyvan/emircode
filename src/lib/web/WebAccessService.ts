/**
 * WebAccessService.ts
 * Web search and page reading for the chat and the agent. The requests themselves run in the main
 * process (electron/web.ts: address checks at connection time, bounded downloads, redirects checked
 * one by one); this is the interface side of that bridge.
 *
 * Every request carries an id, so stopping a run (its AbortSignal) stops exactly its own request in
 * the main process, and turning web access off stops all of them.
 */

export interface WebSearchResult {
  /** Source id for citations, e.g. 'web-001'. */
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebFetchResult {
  title: string;
  url: string;
  content: string;
  status: number;
  sizeBytes: number;
  truncated?: boolean;
}

export interface WebRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface WebSearchOptions extends WebRequestOptions {
  limit?: number;
}

export interface WebFetchOptions extends WebRequestOptions {
  maxBytes?: number;
}

let requestCounter = 0;

function bridge(): any {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  if (!api?.webSearch || !api?.webFetch) throw new Error('Web access is only available in the desktop app.');
  return api;
}

/** "Error invoking remote method 'web:search': Error: text" -> "text" */
export function ipcErrorMessage(err: unknown): string {
  return String((err as any)?.message || err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

async function withRequest<T>(signal: AbortSignal | undefined, run: (requestId: string) => Promise<T>): Promise<T> {
  const api = bridge();
  const requestId = `req_${Date.now().toString(36)}_${++requestCounter}`;
  const onAbort = () => {
    api.webAbort?.(requestId).catch?.(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await run(requestId);
  } catch (err) {
    throw new Error(ipcErrorMessage(err));
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export class WebAccessService {
  static async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const trimmed = (query || '').trim();
    return withRequest(options.signal, (requestId) =>
      bridge().webSearch(trimmed, { limit: options.limit ?? 5, timeoutMs: options.timeoutMs ?? 10000, requestId })
    );
  }

  static async fetchUrl(url: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
    return withRequest(options.signal, (requestId) =>
      bridge().webFetch(String(url || '').trim(), {
        maxBytes: options.maxBytes ?? 512 * 1024,
        timeoutMs: options.timeoutMs ?? 10000,
        requestId,
      })
    );
  }

  /** Stops every web request in flight (web access was turned off). */
  static abortAll(): void {
    const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
    api?.webAbortAll?.().catch?.(() => {});
  }
}
