/**
 * API keys of the cloud providers. They never reach the renderer and are never part of
 * emir_code_data.json: saved keys live in their own file (cloud_keys.json in the app's data
 * folder), encrypted with the system's key store through Electron's safeStorage (DPAPI on
 * Windows, Keychain on macOS, libsecret/KWallet on Linux). Where no real key store exists (Linux
 * with safeStorage's "basic_text" backend), a key is kept in memory for this session only.
 * A key in the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_API_KEY, GEMINI_API_KEY,
 * MISTRAL_API_KEY) is used when none is saved.
 *
 * The key of an OpenAI-compatible server is bound to the server's address: the address is encrypted
 * together with the key, and a key whose address no longer matches is not used. Editing the server
 * list on disk therefore cannot send a saved key somewhere else.
 */
import fs from 'fs';
import path from 'path';
import { BuiltinCloudProviderId, CLOUD_PROVIDERS, CloudProviderId, isBuiltinCloudProvider, isCloudProvider, isCompatProvider } from '../../src/lib/providers/modelRef';
import type { CloudKeySource, CloudProviderStatus, CloudStatus } from './types';

export const ENV_KEYS: Record<BuiltinCloudProviderId, string> = {
  'ollama-cloud': 'OLLAMA_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

/** Encryption with the system's key store; `available` is false when it would not really protect the key. */
export interface SecretBox {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/** safeStorage as a SecretBox. On Linux the "basic_text" backend is a fixed password, not protection. */
export function safeStorageBox(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
  getSelectedStorageBackend?: () => string;
}): SecretBox {
  return {
    available: () => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
          const backend = safeStorage.getSelectedStorageBackend();
          return backend !== 'basic_text' && backend !== 'unknown';
        }
        return true;
      } catch {
        return false;
      }
    },
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}

/** "…a1b2": enough to recognise a key, too little to use it. */
export function maskKey(key: string): string {
  const value = String(key || '').trim();
  return value.length >= 12 ? `…${value.slice(-4)}` : '…';
}

/** A plausible key: one word of printable characters, 8 to 512 long. */
export function validKeyFormat(key: string): boolean {
  return typeof key === 'string' && /^[\x21-\x7e]{8,512}$/.test(key);
}

interface KeyFile {
  version: 1;
  keys: Partial<Record<string, { data: string }>>;
}

/** Built-in providers keep the bare key; OpenAI-compatible servers the key with its address. */
interface Secret {
  key: string;
  /** The server address the key belongs to (OpenAI-compatible servers only). */
  url?: string;
}

function encodeSecret(provider: CloudProviderId, secret: Secret): string {
  return isCompatProvider(provider) ? JSON.stringify({ k: secret.key, u: secret.url || '' }) : secret.key;
}

function decodeSecret(provider: CloudProviderId, text: string): Secret | null {
  if (!isCompatProvider(provider)) return validKeyFormat(text) ? { key: text } : null;
  try {
    const value = JSON.parse(text);
    if (typeof value?.k === 'string' && validKeyFormat(value.k) && typeof value?.u === 'string' && value.u) return { key: value.k, url: value.u };
  } catch {
    // not ours
  }
  return null;
}

export class KeyStore {
  private session = new Map<CloudProviderId, Secret>();
  private saved: KeyFile = { version: 1, keys: {} };
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      if (data && data.version === 1 && data.keys && typeof data.keys === 'object') {
        for (const [provider, entry] of Object.entries(data.keys as Record<string, any>)) {
          if (isCloudProvider(provider) && typeof entry?.data === 'string') this.saved.keys[provider] = { data: entry.data };
        }
      }
    } catch {
      // no file yet, or unreadable: nothing saved
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.saved, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  /** Whether saved keys are encrypted on disk; without it, keys last for this session. */
  canPersist(): boolean {
    return this.box.available();
  }

  private savedSecret(provider: CloudProviderId): Secret | null {
    this.load();
    const entry = this.saved.keys[provider];
    if (!entry || !this.box.available()) return null;
    try {
      return decodeSecret(provider, this.box.decrypt(Buffer.from(entry.data, 'base64')));
    } catch {
      return null;
    }
  }

  /**
   * The key of a provider and where it comes from. An OpenAI-compatible server's key is only
   * returned for the address it was saved with (`boundUrl`).
   */
  private lookup(provider: CloudProviderId, boundUrl?: string): { key: string; source: CloudKeySource } | null {
    const matches = (secret: Secret | null | undefined): secret is Secret =>
      !!secret && (!isCompatProvider(provider) || (!!boundUrl && secret.url === boundUrl));
    const saved = this.savedSecret(provider);
    if (matches(saved)) return { key: saved.key, source: 'saved' };
    const session = this.session.get(provider);
    if (matches(session)) return { key: session.key, source: 'session' };
    if (isBuiltinCloudProvider(provider)) {
      const env = String(this.env[ENV_KEYS[provider]] || '').trim();
      if (validKeyFormat(env)) return { key: env, source: 'env' };
    }
    return null;
  }

  get(provider: CloudProviderId, boundUrl?: string): string | null {
    return this.lookup(provider, boundUrl)?.key ?? null;
  }

  /** Saves a key: encrypted on disk where the system can, otherwise for this session. */
  set(provider: CloudProviderId, key: string, boundUrl?: string): { persisted: boolean } {
    const value = String(key || '').trim();
    if (!validKeyFormat(value)) throw new Error('invalid key format');
    if (isCompatProvider(provider) && !boundUrl) throw new Error('a server key needs its address');
    const secret: Secret = isCompatProvider(provider) ? { key: value, url: boundUrl } : { key: value };
    this.load();
    this.session.delete(provider);
    if (this.box.available()) {
      this.saved.keys[provider] = { data: this.box.encrypt(encodeSecret(provider, secret)).toString('base64') };
      this.write();
      return { persisted: true };
    }
    if (this.saved.keys[provider]) {
      delete this.saved.keys[provider];
      this.write();
    }
    this.session.set(provider, secret);
    return { persisted: false };
  }

  /** Forgets the saved and the session key (a key in the environment stays). */
  remove(provider: CloudProviderId): void {
    this.load();
    this.session.delete(provider);
    if (this.saved.keys[provider]) {
      delete this.saved.keys[provider];
      this.write();
    }
  }

  providerStatus(provider: CloudProviderId, boundUrl?: string): CloudProviderStatus {
    const found = this.lookup(provider, boundUrl);
    return found
      ? { provider, configured: true, source: found.source, hint: maskKey(found.key) }
      : { provider, configured: false, source: null };
  }

  /** Every key this store can hand out (saved, session, environment), to mask them in error texts. */
  knownKeys(): string[] {
    this.load();
    const keys = new Set<string>();
    for (const provider of Object.keys(this.saved.keys)) {
      if (!isCloudProvider(provider)) continue;
      const secret = this.savedSecret(provider);
      if (secret) keys.add(secret.key);
    }
    for (const secret of this.session.values()) keys.add(secret.key);
    for (const name of Object.values(ENV_KEYS)) {
      const env = String(this.env[name] || '').trim();
      if (validKeyFormat(env)) keys.add(env);
    }
    return [...keys];
  }

  /** The built-in providers; CloudService adds the OpenAI-compatible servers. */
  status(): CloudStatus {
    const providers = {} as Record<BuiltinCloudProviderId, CloudProviderStatus>;
    for (const provider of CLOUD_PROVIDERS) providers[provider] = this.providerStatus(provider);
    return { providers, endpoints: [], encryption: this.box.available() ? 'os' : 'none' };
  }
}
