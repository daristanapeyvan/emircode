/**
 * WebAccessService.ts
 * Emir Code Zero-Trust Web Access & Search Subsystem
 *
 * Provides SSRF-protected, rate-limited, size-bounded internet search (via pluggable SearchProvider)
 * and URL fetching for Local LLMs in Chat and Coding Agent modes.
 */

import {
  SearchResultItem,
  SearchProvider,
  SearchProviderRegistry,
  SearchProviderOptions,
} from './SearchProvider';

export interface WebSearchResult extends SearchResultItem {}

export interface WebFetchResult {
  title: string;
  url: string;
  content: string;
  status: number;
  sizeBytes: number;
}

export interface WebSearchOptions extends SearchProviderOptions {}

export interface WebFetchOptions {
  maxBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class WebAccessService {
  private static readonly DEFAULT_TIMEOUT_MS = 10000;
  private static readonly DEFAULT_MAX_BYTES = 512 * 1024; // 512 KB
  private static readonly DEFAULT_MAX_RESULTS = 5;
  private static readonly MAX_REDIRECTS = 3;

  // Rate Limiting: Minimum 300ms between external network requests
  private static lastRequestTimestamp = 0;
  private static readonly MIN_REQUEST_INTERVAL_MS = 300;

  // In-flight request tracking for immediate cancellation on toggle OFF
  private static activeControllers: Set<AbortController> = new Set();

  /**
   * Registers an active AbortController for in-flight request tracking.
   * Returns an unregister cleanup function.
   */
  static registerActiveRequest(controller: AbortController): () => void {
    this.activeControllers.add(controller);
    return () => {
      this.activeControllers.delete(controller);
    };
  }

  /**
   * Immediately aborts all currently active network requests.
   * Called when user toggles Web Access OFF mid-operation.
   */
  static abortAllActiveRequests(reason: string = 'Kullanıcı Web Erişimini kapattı.'): void {
    for (const controller of this.activeControllers) {
      try {
        controller.abort(reason);
      } catch {}
    }
    this.activeControllers.clear();
  }

  /**
   * Evaluates whether an IPv4 or IPv6 address belongs to private/loopback/reserved spaces.
   */
  static isPrivateIp(ip: string): boolean {
    if (!ip) return true;
    const clean = ip.trim().toLowerCase();

    // Loopback IPv6
    if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1') return true;

    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (clean.startsWith('::ffff:')) {
      const v4 = clean.replace('::ffff:', '');
      return this.isPrivateIp(v4);
    }

    // Unique Local Address (fc00::/7) and Link-Local (fe80::/10)
    if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
      return true;
    }

    // Standard IPv4 checks
    const parts = clean.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
      const [a, b] = parts;
      if (a === 0) return true; // 0.0.0.0/8
      if (a === 127) return true; // Loopback 127.0.0.0/8
      if (a === 10) return true; // Private RFC1918 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // Private RFC1918 172.16.0.0/12
      if (a === 192 && b === 168) return true; // Private RFC1918 192.168.0.0/16
      if (a === 169 && b === 254) return true; // Link-local 169.254.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-grade NAT 100.64.0.0/10
      if (a >= 224) return true; // Multicast & Reserved
      return false;
    }

    return false;
  }

  /**
   * Strict SSRF Validator:
   * Rejects non-HTTP(S) schemes, localhost, internal network domains, and private IPs.
   * Performs multi-IP DNS resolution ({ all: true }) checking ALL A and AAAA records to defend against DNS rebinding.
   */
  static async validateUrl(urlStr: string): Promise<{ valid: boolean; reason?: string; parsedUrl?: URL; verifiedIps?: string[] }> {
    if (!urlStr || typeof urlStr !== 'string') {
      return { valid: false, reason: 'URL belirtilmedi veya geçersiz format.' };
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr.trim());
    } catch {
      return { valid: false, reason: 'Geçersiz URL formatı.' };
    }

    // 1. Protocol Validation
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Güvenlik Kuralı: Yalnızca HTTP ve HTTPS protokollerine izin verilir ('${parsed.protocol}' engellendi).`,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Localhost & Reserved Hostname Patterns
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    ) {
      return {
        valid: false,
        reason: `SSRF Güvenlik Kuralı: Yerel ağ ve 'localhost' adreslerine erişim kesinlikle yasaktır (${hostname}).`,
      };
    }

    // 3. Direct IP Address Validation
    if (this.isPrivateIp(hostname)) {
      return {
        valid: false,
        reason: `SSRF Güvenlik Kuralı: Özel/dahili IP adreslerine erişim engellendi (${hostname}).`,
      };
    }

    // 4. Multi-IP DNS Lookup Validation (when running in Node.js / Electron main process)
    // Resolves ALL A and AAAA records ({ all: true }) to prevent DNS rebinding attacks.
    const verifiedIps: string[] = [];
    if (typeof window === 'undefined' || !(window as any).electronAPI) {
      try {
        const dnsMod = 'dns';
        const dns = await import(/* @vite-ignore */ dnsMod);
        const records = await dns.promises.lookup(hostname, { all: true });

        if (!records || records.length === 0) {
          return { valid: false, reason: 'Alan adı çözümlenemedi (DNS kaydı bulunamadı).' };
        }

        for (const entry of records) {
          const addr = entry.address;
          if (this.isPrivateIp(addr)) {
            return {
              valid: false,
              reason: `SSRF Güvenlik Kuralı: Alan adı dahili/özel bir IP adresine çözümlendi (${addr}).`,
            };
          }
          verifiedIps.push(addr);
        }
      } catch (err: any) {
        return { valid: false, reason: `Alan adı çözümlenemedi: ${err.message || 'DNS hatası'}` };
      }
    }

    return { valid: true, parsedUrl: parsed, verifiedIps };
  }

  /**
   * Converts HTML text into clean, readable text / markdown.
   */
  static cleanHtmlToText(html: string): { title: string; text: string } {
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    let processed = html;
    // Strip scripts, styles, noscript, svg, nav, footer, iframes
    processed = processed.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    processed = processed.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    processed = processed.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    processed = processed.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
    processed = processed.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
    processed = processed.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    processed = processed.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ');

    // Convert headers to markdown
    processed = processed.replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, '\n\n## $1\n\n');
    processed = processed.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n');

    // Convert links
    processed = processed.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

    // Convert code blocks
    processed = processed.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    processed = processed.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

    // Convert paragraphs & line breaks
    processed = processed.replace(/<p[^>]*>/gi, '\n\n');
    processed = processed.replace(/<br\s*\/?>/gi, '\n');
    processed = processed.replace(/<li[^>]*>/gi, '\n* ');

    // Strip remaining HTML tags
    processed = processed.replace(/<[^>]+>/g, ' ');

    // Decode basic HTML entities
    processed = processed
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Normalize whitespace
    processed = processed.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

    return { title: title || 'Belge', text: processed };
  }

  /**
   * Applies client-side rate limiting to prevent spamming search / fetch endpoints.
   */
  private static async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    if (elapsed < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise((res) => setTimeout(res, this.MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestTimestamp = Date.now();
  }

  /**
   * Pluggable Web Search:
   * Delegates search to active SearchProvider (default: DuckDuckGo Lite).
   * In renderer, passes call through Electron IPC to execute in the secure main process authority.
   * Performs SSRF checks on resulting URLs and assigns structured source IDs ('web-001').
   */
  static async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) {
      throw new Error('Arama sorgusu boş olamaz.');
    }

    const limit = Math.min(Math.max(options.limit || this.DEFAULT_MAX_RESULTS, 1), 10);
    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;

    // Route through Electron IPC if available in renderer
    if (typeof window !== 'undefined' && (window as any).electronAPI?.webSearch) {
      return (window as any).electronAPI.webSearch(trimmed, { limit, timeoutMs });
    }

    await this.throttle();

    const controller = new AbortController();
    const unregister = this.registerActiveRequest(controller);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const provider: SearchProvider = SearchProviderRegistry.getActive();
      const rawResults = await provider.search(trimmed, {
        limit,
        timeoutMs,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Verify each result URL against SSRF
      const safeResults: WebSearchResult[] = [];
      let counter = 1;

      for (const item of rawResults) {
        if (safeResults.length >= limit) break;
        const check = await this.validateUrl(item.url);
        if (!check.valid) continue;

        safeResults.push({
          ...item,
          id: item.id || `web-${String(counter).padStart(3, '0')}`,
        });
        counter++;
      }

      return safeResults;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Arama zaman aşımına uğradı veya kullanıcı tarafından durduruldu (${timeoutMs}ms).`);
      }
      throw err;
    } finally {
      unregister();
    }
  }

  /**
   * Fetches the web page content of a specified URL with SSRF validation, size limiting,
   * manual redirect inspection, and clean HTML-to-text extraction.
   */
  static async fetchUrl(urlStr: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
    const validation = await this.validateUrl(urlStr);
    if (!validation.valid || !validation.parsedUrl) {
      throw new Error(validation.reason || 'Geçersiz veya yasaklı URL.');
    }

    const maxBytes = options.maxBytes || this.DEFAULT_MAX_BYTES;
    const timeoutMs = options.timeoutMs || this.DEFAULT_TIMEOUT_MS;

    // Route through Electron IPC if available in renderer
    if (typeof window !== 'undefined' && (window as any).electronAPI?.webFetch) {
      return (window as any).electronAPI.webFetch(urlStr, { maxBytes, timeoutMs });
    }

    await this.throttle();

    let currentUrl = validation.parsedUrl.href;
    let redirectCount = 0;

    while (redirectCount <= this.MAX_REDIRECTS) {
      const controller = new AbortController();
      const unregister = this.registerActiveRequest(controller);
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      try {
        const response = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EmirCode/1.4',
            Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'manual', // Manually validate each redirect step against SSRF
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle Redirects: Re-verify target from scratch
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          if (redirectCount > this.MAX_REDIRECTS) {
            throw new Error(`Yönlendirme sınırı (${this.MAX_REDIRECTS}) aşıldı.`);
          }

          const location = response.headers.get('location');
          if (!location) {
            throw new Error('Yönlendirme başlığı (Location) bulunamadı.');
          }

          const nextUrl = new URL(location, currentUrl).href;
          const redirectValidation = await this.validateUrl(nextUrl);
          if (!redirectValidation.valid) {
            throw new Error(`Yönlendirme engellendi: ${redirectValidation.reason}`);
          }

          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Bounded Stream Reader to prevent memory bloat
        let receivedBytes = 0;
        let rawContent = '';

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8', { fatal: false });

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            receivedBytes += value.byteLength;
            rawContent += decoder.decode(value, { stream: true });

            if (receivedBytes > maxBytes) {
              await reader.cancel();
              rawContent += '\n\n[İçerik boyutu sınırına ulaşıldığı için kalan kısım kırpıldı]';
              break;
            }
          }
        } else {
          rawContent = await response.text();
          receivedBytes = Buffer.byteLength(rawContent, 'utf-8');
          if (receivedBytes > maxBytes) {
            rawContent = rawContent.slice(0, maxBytes) + '\n\n[İçerik kırpıldı]';
          }
        }

        const { title, text } = this.cleanHtmlToText(rawContent);

        return {
          title,
          url: currentUrl,
          content: text,
          status: response.status,
          sizeBytes: receivedBytes,
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error(`Web isteği zaman aşımına uğradı veya kullanıcı tarafından durduruldu (${timeoutMs}ms).`);
        }
        throw err;
      } finally {
        unregister();
      }
    }

    throw new Error('Maksimum yönlendirme sınırına ulaşıldı.');
  }
}
