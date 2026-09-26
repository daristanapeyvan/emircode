/**
 * modelLibraryStore — the online model library of the Models window. The list comes from ollama.com
 * when the Discover tab opens (kept for 12 hours), a model's tags when its page opens, and every tag
 * the user selects is verified against the Ollama registry; a finished download is compared with the
 * registry too. None of it waits for a button. Without a connection the built-in short list is used.
 */
import { create } from 'zustand';
import {
  CategoryId,
  LibraryModel,
  ModelVariant,
  builtinLibrary,
  builtinVariants,
  parseLibraryHtml,
  parseTagsHtml,
  sameDigest,
  splitTag,
} from '@/lib/ollama/library';

const LIBRARY_KEY = 'emir-code.model-library.v1';
const TAGS_KEY = 'emir-code.model-tags.v1';
const LIBRARY_TTL = 12 * 3600 * 1000;
const TAGS_TTL = 12 * 3600 * 1000;
const CHECK_TTL = 30 * 60 * 1000;
const MAX_CACHED_TAGS = 60;
/** Fewer parsed models means the page changed: fall back instead of showing a stub list. */
export const MIN_LIBRARY_MODELS = 20;
/** Registry names the main process accepts ("qwen3", "user/model"); others (hf.co/...) are not checked. */
const CHECKABLE_RE = /^[a-z0-9][a-z0-9._-]{0,79}(?:\/[a-z0-9][a-z0-9._-]{0,79})?$/;

export type LibrarySource = 'online' | 'cache' | 'builtin';

export interface TagCheck {
  status: 'checking' | 'verified' | 'missing' | 'error';
  /** sha256 of the registry manifest (= the digest of the model once downloaded). */
  digest?: string;
  /** Exact download size in bytes. */
  bytes?: number;
  checkedAt: number;
  error?: string;
}

export interface TagsEntry {
  status: 'loading' | 'ready' | 'error';
  variants: ModelVariant[];
  fetchedAt: number;
  /** The variants are the built-in guess (ollama.com could not be reached). */
  builtin?: boolean;
  error?: string;
}

interface LibraryState {
  status: 'idle' | 'loading' | 'ready';
  source: LibrarySource;
  models: LibraryModel[];
  fetchedAt: number | null;
  error: string | null;
  tags: Record<string, TagsEntry>;
  checks: Record<string, TagCheck>;
  /** A downloaded model compared with the registry, by tag. */
  installed: Record<string, 'match' | 'differs'>;
  category: CategoryId;
  openModel: string | null;

  ensureLibrary: (force?: boolean) => Promise<void>;
  ensureTags: (model: string, force?: boolean) => Promise<void>;
  verifyTag: (fullTag: string, force?: boolean) => Promise<TagCheck>;
  compareInstalled: (fullTag: string, localDigest: string) => Promise<'match' | 'differs' | null>;
  checkInstalledModels: (models: Array<{ name: string; digest: string }>) => Promise<void>;
  setCategory: (id: CategoryId) => void;
  openModelPage: (name: string | null) => void;
}

const readJson = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the cache is only a convenience */
  }
};

let libraryRequest: Promise<void> | null = null;
const tagRequests = new Map<string, Promise<void>>();
const checkRequests = new Map<string, Promise<TagCheck>>();

export const useModelLibraryStore = create<LibraryState>((set, get) => ({
  status: 'idle',
  source: 'online',
  models: [],
  fetchedAt: null,
  error: null,
  tags: {},
  checks: {},
  installed: {},
  category: 'recommended',
  openModel: null,

  ensureLibrary: (force = false) => {
    if (libraryRequest) return libraryRequest;
    const { models, fetchedAt, source } = get();
    if (!force && models.length && fetchedAt && source !== 'builtin' && Date.now() - fetchedAt < LIBRARY_TTL) return Promise.resolve();
    const cached = readJson<{ fetchedAt: number; models: LibraryModel[] }>(LIBRARY_KEY);
    if (!force && cached && cached.models?.length >= MIN_LIBRARY_MODELS && Date.now() - cached.fetchedAt < LIBRARY_TTL) {
      set({ models: cached.models, fetchedAt: cached.fetchedAt, source: 'cache', status: 'ready', error: null });
      return Promise.resolve();
    }
    libraryRequest = (async () => {
      set({ status: 'loading' });
      try {
        const api = window.electronAPI?.modelLibrary;
        if (!api) throw new Error('offline');
        const parsed = parseLibraryHtml(await api());
        if (parsed.length < MIN_LIBRARY_MODELS) throw new Error(`ollama.com listesi okunamadı (${parsed.length} model)`);
        const now = Date.now();
        writeJson(LIBRARY_KEY, { fetchedAt: now, models: parsed });
        set({ models: parsed, fetchedAt: now, source: 'online', status: 'ready', error: null });
      } catch (err: any) {
        const message = err?.message || String(err);
        // A stale copy is better than the short built-in list.
        if (cached && cached.models?.length >= MIN_LIBRARY_MODELS) {
          set({ models: cached.models, fetchedAt: cached.fetchedAt, source: 'cache', status: 'ready', error: message });
        } else {
          set({ models: builtinLibrary(), fetchedAt: null, source: 'builtin', status: 'ready', error: message });
        }
      } finally {
        libraryRequest = null;
      }
    })();
    return libraryRequest;
  },

  ensureTags: (model, force = false) => {
    const pending = tagRequests.get(model);
    if (pending) return pending;
    const entry = get().tags[model];
    if (!force && entry?.status === 'ready' && !entry.builtin && Date.now() - entry.fetchedAt < TAGS_TTL) return Promise.resolve();
    const cache = readJson<Record<string, { fetchedAt: number; variants: ModelVariant[] }>>(TAGS_KEY) || {};
    const cached = cache[model];
    if (!force && cached?.variants?.length && Date.now() - cached.fetchedAt < TAGS_TTL) {
      set((s) => ({ tags: { ...s.tags, [model]: { status: 'ready', variants: cached.variants, fetchedAt: cached.fetchedAt } } }));
      return Promise.resolve();
    }
    const request = (async () => {
      set((s) => ({ tags: { ...s.tags, [model]: { status: 'loading', variants: s.tags[model]?.variants || [], fetchedAt: Date.now() } } }));
      try {
        const api = window.electronAPI?.modelTags;
        if (!api) throw new Error('offline');
        const html = await api(model);
        const variants = parseTagsHtml(model, html);
        if (html && variants.length === 0) throw new Error('ollama.com etiket sayfası okunamadı');
        const now = Date.now();
        const next = { ...cache, [model]: { fetchedAt: now, variants } };
        const keep = Object.entries(next).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, MAX_CACHED_TAGS);
        writeJson(TAGS_KEY, Object.fromEntries(keep));
        set((s) => ({ tags: { ...s.tags, [model]: { status: 'ready', variants, fetchedAt: now } } }));
      } catch (err: any) {
        const fallback = cached?.variants?.length ? cached.variants : builtinVariants(model);
        set((s) => ({
          tags: {
            ...s.tags,
            [model]: fallback.length
              ? { status: 'ready', variants: fallback, fetchedAt: cached?.fetchedAt || Date.now(), builtin: !cached, error: err?.message || String(err) }
              : { status: 'error', variants: [], fetchedAt: Date.now(), error: err?.message || String(err) },
          },
        }));
      } finally {
        tagRequests.delete(model);
      }
    })();
    tagRequests.set(model, request);
    return request;
  },

  verifyTag: (fullTag, force = false) => {
    const pending = checkRequests.get(fullTag);
    if (pending) return pending;
    const existing = get().checks[fullTag];
    if (!force && existing && existing.status !== 'error' && existing.status !== 'checking' && Date.now() - existing.checkedAt < CHECK_TTL) {
      return Promise.resolve(existing);
    }
    const request = (async (): Promise<TagCheck> => {
      set((s) => ({ checks: { ...s.checks, [fullTag]: { status: 'checking', checkedAt: Date.now() } } }));
      let check: TagCheck;
      const { model, tag } = splitTag(fullTag);
      try {
        const api = window.electronAPI?.modelManifest;
        if (!api) throw new Error('offline');
        if (!CHECKABLE_RE.test(model)) throw new Error('bu kaynak doğrulanamıyor');
        const res = await api(model, tag);
        check =
          res.status === 'found'
            ? { status: 'verified', digest: res.digest, bytes: res.bytes, checkedAt: Date.now() }
            : res.status === 'missing'
              ? { status: 'missing', checkedAt: Date.now() }
              : { status: 'error', error: res.error, checkedAt: Date.now() };
      } catch (err: any) {
        check = { status: 'error', error: err?.message || String(err), checkedAt: Date.now() };
      }
      set((s) => ({ checks: { ...s.checks, [fullTag]: check } }));
      checkRequests.delete(fullTag);
      return check;
    })();
    checkRequests.set(fullTag, request);
    return request;
  },

  compareInstalled: async (fullTag, localDigest) => {
    const check = await get().verifyTag(fullTag);
    if (check.status !== 'verified' || !check.digest || !localDigest) return null;
    const result = sameDigest(localDigest, check.digest) ? 'match' : 'differs';
    set((s) => ({ installed: { ...s.installed, [fullTag]: result } }));
    return result;
  },

  checkInstalledModels: async (models) => {
    // One at a time: a handful of small requests, never a burst.
    for (const m of models) {
      const name = m.name.includes(':') ? m.name : `${m.name}:latest`;
      if (!CHECKABLE_RE.test(splitTag(name).model)) continue;
      await get().compareInstalled(name, m.digest);
    }
  },

  setCategory: (id) => set({ category: id }),
  openModelPage: (name) => set({ openModel: name }),
}));
