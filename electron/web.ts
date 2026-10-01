/**
 * Web search and page reading for the chat and the agent, run in the main process.
 *
 * - Only http and https; local names, private and reserved addresses are refused. The address a
 *   request really connects to is checked at connection time (a DNS lookup hook), so a name cannot
 *   pass the check and then resolve to a private address for the connection itself.
 * - Redirects are followed by hand (at most 3) and every target is checked again.
 * - Bodies are read as a stream (decompressed) and cut at a byte limit; nothing larger is buffered.
 * - Errors carry a translation key of the `main` texts, so the main process shows them in the
 *   interface language.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable, Transform } from 'node:stream';

export class WebError extends Error {
  constructor(
    public key: string,
    public params: Record<string, string | number> = {},
    /** The reason behind a wrapping error (a refused redirect target). */
    public inner?: WebError
  ) {
    super(key);
    this.name = 'WebError';
  }
}

// ---------------------------------------------------------------------------
// Address checks
// ---------------------------------------------------------------------------

function ipv4Private(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Expands an IPv6 address to its eight 16-bit groups (with an embedded IPv4 tail). */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    text = text.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  if (tail === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array(Math.max(0, tail === undefined ? 0 : missing)).fill('0'), ...t].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => !isNaN(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for loopback, private, link-local, reserved and multicast addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const clean = (ip || '').trim().replace(/^\[|\]$/g, '');
  const kind = net.isIP(clean);
  if (kind === 4) return ipv4Private(clean.split('.').map(Number));
  if (kind !== 6) return true;
  const g = ipv6Groups(clean);
  if (!g) return true;
  const embeddedV4 = (hi: number, lo: number) => ipv4Private([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embeddedV4(g[6], g[7]); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return embeddedV4(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embeddedV4(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

const LOCAL_NAMES = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|.*\.lan)$/i;

/** The checks that need no network: scheme, local names and literal private addresses. */
export function checkUrlShape(value: string): { ok: true; url: URL } | { ok: false; error: WebError } {
  let url: URL;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return { ok: false, error: new WebError('invalidUrl') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: new WebError('protocolNotAllowed', { protocol: url.protocol }) };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || LOCAL_NAMES.test(host) || (net.isIP(host) && isPrivateAddress(host))) {
    return { ok: false, error: new WebError('localAddressBlocked', { host }) };
  }
  if (url.username || url.password) return { ok: false, error: new WebError('invalidUrl') };
  return { ok: true, url };
}

/**
 * DNS lookup for outgoing connections: every address the name resolves to must be public, and the
 * connection uses one of exactly these addresses.
 */
function guardedLookup(hostname: string, options: any, callback: (...args: any[]) => void): void {
  dns.lookup(hostname, { all: true, family: options?.family || 0 }, (err, addresses) => {
    if (err) return callback(err);
    const list = (addresses as dns.LookupAddress[]) || [];
    if (list.length === 0) return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) {
      return callback(Object.assign(new WebError('resolvesToPrivate', { host: hostname, address: bad.address }), { code: 'EPRIVATE' }));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// ---------------------------------------------------------------------------
// One request, streamed and bounded
// ---------------------------------------------------------------------------

export interface BoundedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** Decompressed bytes received, up to the limit. */
  bytes: number;
  truncated: boolean;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decoderFor(encoding: string | undefined): Transform | null {
  switch ((encoding || '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

export function requestOnce(target: URL, options: RequestOptions): Promise<BoundedResponse> {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const req = transport.request(
      target,
      {
        method: options.method || 'GET',
        lookup: guardedLookup as any,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          ...(options.headers || {}),
          ...(options.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(options.body)) } : {}),
        },
      },
      (res) => {
        const decoder = decoderFor(res.headers['content-encoding'] as string | undefined);
        const stream: Readable = decoder ? res.pipe(decoder) : res;
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        const done = () =>
          finish(() => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks), bytes, truncated }));
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const room = options.maxBytes - bytes;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, Math.max(0, room)));
            bytes += Math.max(0, room);
            truncated = true;
            res.destroy();
            decoder?.destroy();
            done();
            return;
          }
          chunks.push(chunk);
          bytes += chunk.length;
        });
        stream.on('end', done);
        stream.on('error', (err) => (truncated ? done() : finish(() => reject(err))));
        res.on('error', (err) => (truncated ? done() : finish(() => reject(err))));
      }
    );

    const onAbort = () => {
      req.destroy(new WebError('webStopped'));
    };
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT_EMIR' })), options.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', (err) => finish(() => reject(err)));
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** Turns low-level failures into the translated errors of this module. */
function explain(err: any, kind: 'search' | 'fetch', timeoutMs: number): WebError {
  if (err instanceof WebError) return err;
  if (err?.code === 'ETIMEDOUT_EMIR') return new WebError(kind === 'search' ? 'searchTimedOut' : 'fetchTimedOut', { ms: timeoutMs });
  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') return new WebError('dnsFailed', { error: err.code });
  return new WebError(kind === 'search' ? 'searchFailed' : 'fetchFailed', { error: String(err?.code || err?.message || err) });
}

// ---------------------------------------------------------------------------
// Text of a page
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Readable text of an HTML page: scripts, styles and navigation removed, headings and lists kept. */
export function htmlToText(html: string, untitled: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : '';
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
      .replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, '\n\n## $1\n\n')
      .replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n')
      .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<p[^>]*>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n* ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return { title: title || untitled, text };
}

/** The character set of a response: the Content-Type header, else a <meta charset>, else UTF-8. */
function charsetOf(headers: http.IncomingHttpHeaders, body: Buffer): string {
  const fromHeader = String(headers['content-type'] || '').match(/charset=["']?([\w-]+)/i)?.[1];
  const fromMeta = body.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const label = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  try {
    new TextDecoder(label);
    return label;
  } catch {
    return 'utf-8';
  }
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface SearchItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/** Result rows of DuckDuckGo's HTML-only page. */
export function parseDuckDuckGoLite(html: string, limit: number, untitled: string): { items: SearchItem[]; recognized: boolean } {
  const items: SearchItem[] = [];
  const row =
    /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  let rows = 0;
  while ((match = row.exec(html)) !== null && items.length < limit) {
    rows++;
    let href = decodeEntities(match[1]);
    if (href.includes('uddg=')) {
      try {
        const redirect = new URL(href, 'https://lite.duckduckgo.com').searchParams.get('uddg');
        if (redirect) href = redirect;
      } catch {
        // keep the link as it is
      }
    }
    const check = checkUrlShape(href);
    if (!check.ok) continue;
    items.push({
      id: `web-${String(items.length + 1).padStart(3, '0')}`,
      title: decodeEntities(match[2].replace(/<[^>]+>/g, '')).trim() || untitled,
      url: check.url.href,
      snippet: decodeEntities(match[3].replace(/<[^>]+>/g, '')).trim(),
      source: check.url.hostname,
    });
  }
  // The page is understood when it has result rows or says there are none; anything else (a new
  // layout, a bot check) is reported instead of pretending that nothing was found.
  const recognized = rows > 0 || /class=['"]result-link['"]/.test(html) || /no\s+(?:more\s+)?results|sonuç\s+bulunamadı/i.test(html);
  return { items, recognized };
}

export async function searchWeb(
  query: string,
  options: { limit?: number; timeoutMs?: number; signal?: AbortSignal; untitled: string }
): Promise<SearchItem[]> {
  const text = String(query || '').trim();
  if (!text) throw new WebError('searchTextEmpty');
  const limit = Math.min(Math.max(options.limit || 5, 1), 10);
  const timeoutMs = options.timeoutMs || 10000;
  let res: BoundedResponse;
  try {
    res = await requestOnce(new URL('https://lite.duckduckgo.com/lite/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(text)}`,
      maxBytes: 2 * 1024 * 1024,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    throw explain(err, 'search', timeoutMs);
  }
  if (res.status < 200 || res.status >= 300) throw new WebError('searchHttpError', { status: res.status });
  const html = new TextDecoder(charsetOf(res.headers, res.body)).decode(res.body);
  const { items, recognized } = parseDuckDuckGoLite(html, limit, options.untitled);
  if (!recognized) throw new WebError('searchPageChanged');
  return items;
}

export interface PageResult {
  title: string;
  url: string;
  content: string;
  status: number;
  sizeBytes: number;
  truncated: boolean;
}

const TEXT_TYPES = /^(?:text\/|application\/(?:xhtml\+xml|xml|json|ld\+json|javascript|rss\+xml|atom\+xml))/i;

export async function fetchPage(
  address: string,
  options: { maxBytes?: number; timeoutMs?: number; signal?: AbortSignal; untitled: string; truncatedNote: string }
): Promise<PageResult> {
  const first = checkUrlShape(address);
  if (!first.ok) throw first.error;
  const maxBytes = options.maxBytes || 512 * 1024;
  const timeoutMs = options.timeoutMs || 10000;
  let current = first.url;

  for (let redirects = 0; ; redirects++) {
    let res: BoundedResponse;
    try {
      res = await requestOnce(current, { maxBytes, timeoutMs, signal: options.signal });
    } catch (err) {
      throw explain(err, 'fetch', timeoutMs);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (redirects >= 3) throw new WebError('tooManyRedirects');
      const location = res.headers.location;
      if (!location) throw new WebError('redirectWithoutTarget');
      const next = checkUrlShape(new URL(String(location), current).href);
      if (!next.ok) throw new WebError('redirectBlocked', {}, next.error);
      current = next.url;
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new WebError('httpStatus', { status: res.status });
    const type = String(res.headers['content-type'] || 'text/html').split(';')[0].trim();
    if (!TEXT_TYPES.test(type)) throw new WebError('unsupportedContent', { type });
    let raw = new TextDecoder(charsetOf(res.headers, res.body)).decode(res.body);
    const isHtml = /html|xml/i.test(type) || /<html|<body|<div|<p[\s>]/i.test(raw.slice(0, 4096));
    const page = isHtml ? htmlToText(raw, options.untitled) : { title: options.untitled, text: raw.trim() };
    raw = '';
    return {
      title: page.title,
      url: current.href,
      content: res.truncated ? `${page.text}\n\n${options.truncatedNote}` : page.text,
      status: res.status,
      sizeBytes: res.bytes,
      truncated: res.truncated,
    };
  }
}
