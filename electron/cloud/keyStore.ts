/**
 * API keys of the cloud providers. They never reach the renderer and are never part of
 * emir_code_data.json: saved keys live in their own file (cloud_keys.json in the app's data
 * folder), encrypted with the system's key store through Electron's safeStorage (DPAPI on
 * Windows, Keychain on macOS, libsecret/KWallet on Linux). Where no real key store exists (Linux
 * with safeStorage's "basic_text" backend), a key is kept in memory for this session only.
 * A key in the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_API_KEY) is used when none
 * is saved.
 */
import fs from 'fs';
import path from 'path';
import { CLOUD_PROVIDERS, CloudProviderId, isCloudProvider } from '../../src/lib/providers/modelRef';
import type { CloudKeySource, CloudProviderStatus, CloudStatus } from './types';

export const ENV_KEYS: Record<CloudProviderId, string> = {
  'ollama-cloud': 'OLLAMA_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
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
  keys: Partial<Record<CloudProviderId, { data: string }>>;
}

export class KeyStore {
  private session = new Map<CloudProviderId, string>();
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

  private savedKey(provider: CloudProviderId): string | null {
    this.load();
    const entry = this.saved.keys[provider];
    if (!entry || !this.box.available()) return null;
    try {
      const key = this.box.decrypt(Buffer.from(entry.data, 'base64'));
      return validKeyFormat(key) ? key : null;
    } catch {
      return null;
    }
  }

  private lookup(provider: CloudProviderId): { key: string; source: CloudKeySource } | null {
    const saved = this.savedKey(provider);
    if (saved) return { key: saved, source: 'saved' };
    const session = this.session.get(provider);
    if (session) return { key: session, source: 'session' };
    const env = String(this.env[ENV_KEYS[provider]] || '').trim();
    if (validKeyFormat(env)) return { key: env, source: 'env' };
    return null;
  }

  get(provider: CloudProviderId): string | null {
    return this.lookup(provider)?.key ?? null;
  }

  /** Saves a key: encrypted on disk where the system can, otherwise for this session. */
  set(provider: CloudProviderId, key: string): { persisted: boolean } {
    const value = String(key || '').trim();
    if (!validKeyFormat(value)) throw new Error('invalid key format');
    this.load();
    this.session.delete(provider);
    if (this.box.available()) {
      this.saved.keys[provider] = { data: this.box.encrypt(value).toString('base64') };
      this.write();
      return { persisted: true };
    }
    if (this.saved.keys[provider]) {
      delete this.saved.keys[provider];
      this.write();
    }
    this.session.set(provider, value);
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

  providerStatus(provider: CloudProviderId): CloudProviderStatus {
    const found = this.lookup(provider);
    return found
      ? { provider, configured: true, source: found.source, hint: maskKey(found.key) }
      : { provider, configured: false, source: null };
  }

  status(): CloudStatus {
    const providers = {} as Record<CloudProviderId, CloudProviderStatus>;
    for (const provider of CLOUD_PROVIDERS) providers[provider] = this.providerStatus(provider);
    return { providers, encryption: this.box.available() ? 'os' : 'none' };
  }
}
