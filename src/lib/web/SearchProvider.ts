/**
 * SearchProvider.ts
 * Emir Code Zero-Trust Search Provider Abstraction & DuckDuckGo Lite Implementation
 *
 * Provides a modular, pluggable SearchProvider interface allowing alternative
 * search engines (DuckDuckGo, SearXNG, Tavily, Brave, etc.) to be plugged in seamlessly.
 * Each search result includes a unique source ID (e.g., 'web-001') for precise document grounding.
 */

export interface SearchResultItem {
  id: string; // Structured source ID, e.g. 'web-001', 'web-002'
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface SearchProviderOptions {
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  search(query: string, options?: SearchProviderOptions): Promise<SearchResultItem[]>;
}

/**
 * Default DuckDuckGo Lite Search Provider.
 * Queries https://lite.duckduckgo.com/lite/ via POST without requiring API keys.
 * Sanitizes URLs, resolves uddg redirects, and assigns structured source IDs.
 */
export class DuckDuckGoProvider implements SearchProvider {
  readonly id = 'duckduckgo';
  readonly name = 'DuckDuckGo Lite';

  private static lastRequestTimestamp = 0;
  private static readonly MIN_REQUEST_INTERVAL_MS = 300;

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - DuckDuckGoProvider.lastRequestTimestamp;
    if (elapsed < DuckDuckGoProvider.MIN_REQUEST_INTERVAL_MS) {
      await new Promise((res) => setTimeout(res, DuckDuckGoProvider.MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    DuckDuckGoProvider.lastRequestTimestamp = Date.now();
  }

  async search(query: string, options: SearchProviderOptions = {}): Promise<SearchResultItem[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      throw new Error('Arama sorgusu boş olamaz.');
    }

    const limit = Math.min(Math.max(options.limit || 5, 1), 10);
    const timeoutMs = options.timeoutMs || 10000;

    await this.throttle();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        body: `q=${encodeURIComponent(trimmed)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Arama servisi hatası: HTTP ${response.status}`);
      }

      const html = await response.text();

      const results: SearchResultItem[] = [];
      const blockRegex =
        /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
      let match: RegExpExecArray | null;
      let counter = 1;

      while ((match = blockRegex.exec(html)) !== null && results.length < limit) {
        let rawUrl = match[1];
        if (rawUrl.includes('uddg=')) {
          try {
            const u = new URL(rawUrl, 'https://lite.duckduckgo.com');
            const uddg = u.searchParams.get('uddg');
            if (uddg) rawUrl = decodeURIComponent(uddg);
          } catch {}
        }

        const title = match[2].replace(/<[^>]+>/g, '').trim();
        const snippet = match[3].replace(/<[^>]+>/g, '').trim();

        let source = '';
        try {
          source = new URL(rawUrl).hostname;
        } catch {}

        const sourceId = `web-${String(counter).padStart(3, '0')}`;
        counter++;

        results.push({
          id: sourceId,
          title: title || 'Arama Sonucu',
          url: rawUrl,
          snippet: snippet || '',
          source: source || 'web',
        });
      }

      return results;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Arama zaman aşımına uğradı veya kullanıcı tarafından durduruldu (${timeoutMs}ms).`);
      }
      throw new Error(`Web arama gerçekleştirilemedi: ${err.message || 'Bilinmeyen hata'}`);
    }
  }
}

/**
 * Global Search Provider Registry
 */
export class SearchProviderRegistry {
  private static providers: Map<string, SearchProvider> = new Map();
  private static activeProviderId: string = 'duckduckgo';

  static {
    // Register default DuckDuckGo provider
    this.register(new DuckDuckGoProvider());
  }

  static register(provider: SearchProvider): void {
    this.providers.set(provider.id, provider);
  }

  static get(id: string): SearchProvider | undefined {
    return this.providers.get(id);
  }

  static getActive(): SearchProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      return this.providers.get('duckduckgo') || new DuckDuckGoProvider();
    }
    return provider;
  }

  static setActive(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Search provider '${id}' bulunamadı.`);
    }
    this.activeProviderId = id;
  }

  static listProviders(): Array<{ id: string; name: string }> {
    return Array.from(this.providers.values()).map((p) => ({ id: p.id, name: p.name }));
  }
}
