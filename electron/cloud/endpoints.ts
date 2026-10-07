/**
 * OpenAI-compatible servers the user adds (OpenRouter, Groq, Together, DeepSeek, LM Studio, vLLM,
 * llama.cpp …). Their definitions live in the main process (cloud_endpoints.json, no secrets), so
 * the renderer can only name a server by its id and never point a key at another address.
 *
 * Address rules:
 * - https always; http only for this computer (localhost, 127.0.0.0/8, ::1) and, when the user
 *   marks the server as "on my local network", for private addresses (192.168.x.x, 10.x.x.x …).
 *   A public address over http is refused: the key and every prompt would travel in clear text.
 * - No user name or password in the address, no query or fragment.
 * - The key is saved bound to the address (KeyStore), and redirects are not followed.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { isPrivateAddress } from '../web';
import { COMPAT_ID_RE, CompatEndpointInfo } from '../../src/lib/providers/modelRef';

export interface CompatEndpoint {
  id: string;
  name: string;
  /** Normalized: scheme, host, optional port and path, no trailing slash ("https://openrouter.ai/api/v1"). */
  baseURL: string;
  /** On this computer, or a private address the user marked as being on the local network. */
  local: boolean;
  createdAt: number;
}

export type EndpointUrlError = 'invalid' | 'https_required' | 'credentials' | 'not_private' | 'query';

export const MAX_ENDPOINTS = 20;
const NAME_MAX = 40;

const LOOPBACK_NAMES = /^(?:localhost|.*\.localhost)$/i;
const LAN_NAMES = /^(?:[a-z0-9-]+|.*\.local|.*\.lan|.*\.home\.arpa|.*\.internal)$/i;

function isLoopback(host: string): boolean {
  if (LOOPBACK_NAMES.test(host)) return true;
  if (net.isIPv4(host)) return host.startsWith('127.');
  if (net.isIPv6(host)) return host === '::1' || /^0*:(?:0*:){0,6}0*1$/.test(host) || host === '0:0:0:0:0:0:0:1';
  return false;
}

/** A private (LAN) address or a local network name ("nas.local", "gpu-box"). */
function isLanHost(host: string): boolean {
  if (net.isIP(host)) return isPrivateAddress(host);
  return LAN_NAMES.test(host);
}

/**
 * Checks and normalizes the address of a server. `localServer`: the user said it is on the local
 * network (allows http for private addresses; a public address cannot be "local").
 */
export function checkEndpointUrl(
  input: string,
  localServer = false
): { ok: true; baseURL: string; host: string; local: boolean } | { ok: false; error: EndpointUrlError } {
  let url: URL;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'invalid' };
  if (url.username || url.password) return { ok: false, error: 'credentials' };
  if (url.search || url.hash) return { ok: false, error: 'query' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, error: 'invalid' };
  const loopback = isLoopback(host);
  const lan = !loopback && isLanHost(host);
  if (localServer && !loopback && !lan) return { ok: false, error: 'not_private' };
  if (url.protocol === 'http:' && !loopback && !(localServer && lan)) return { ok: false, error: 'https_required' };
  const pathname = url.pathname.replace(/\/+$/, '');
  return {
    ok: true,
    baseURL: `${url.protocol}//${url.host.toLowerCase()}${pathname}`,
    host: url.host.toLowerCase(),
    local: loopback || (localServer && lan),
  };
}

/** "My LM Studio!" -> "my-lm-studio", unique among `taken`. */
export function endpointIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'server';
  let id = base;
  for (let n = 2; used.has(id) || !COMPAT_ID_RE.test(id); n++) id = `${base.slice(0, 20)}-${n}`;
  return id;
}

export function cleanEndpointName(name: unknown): string {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, NAME_MAX);
}

export function endpointInfo(endpoint: CompatEndpoint): CompatEndpointInfo {
  return { id: endpoint.id, name: endpoint.name, host: new URL(endpoint.baseURL).host, local: endpoint.local };
}

interface EndpointFile {
  version: 1;
  endpoints: CompatEndpoint[];
}

/** The definitions on disk. They hold no secret; the keys are in KeyStore, bound to `baseURL`. */
export class EndpointStore {
  private list: CompatEndpoint[] = [];
  private loaded = false;

  constructor(private readonly file: string | null) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as EndpointFile;
      if (data?.version !== 1 || !Array.isArray(data.endpoints)) return;
      for (const e of data.endpoints) {
        // Anything edited by hand must still pass the address rules.
        if (!e || typeof e.id !== 'string' || !COMPAT_ID_RE.test(e.id) || this.list.some((x) => x.id === e.id)) continue;
        const checked = checkEndpointUrl(String(e.baseURL || ''), !!e.local);
        if (!checked.ok) continue;
        this.list.push({ id: e.id, name: cleanEndpointName(e.name) || e.id, baseURL: checked.baseURL, local: checked.local, createdAt: Number(e.createdAt) || 0 });
        if (this.list.length >= MAX_ENDPOINTS) break;
      }
    } catch {
      // none yet
    }
  }

  private write(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const data: EndpointFile = { version: 1, endpoints: this.list };
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  all(): CompatEndpoint[] {
    this.load();
    return [...this.list];
  }

  get(id: string): CompatEndpoint | undefined {
    this.load();
    return this.list.find((e) => e.id === id);
  }

  add(endpoint: Omit<CompatEndpoint, 'id' | 'createdAt'>): CompatEndpoint {
    this.load();
    if (this.list.length >= MAX_ENDPOINTS) throw new Error('too many servers');
    const entry: CompatEndpoint = { ...endpoint, id: endpointIdFor(endpoint.name, this.list.map((e) => e.id)), createdAt: Date.now() };
    this.list.push(entry);
    this.write();
    return entry;
  }

  remove(id: string): boolean {
    this.load();
    const before = this.list.length;
    this.list = this.list.filter((e) => e.id !== id);
    if (this.list.length !== before) this.write();
    return this.list.length !== before;
  }
}
