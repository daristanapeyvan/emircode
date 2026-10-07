/**
 * modelRef.ts — which provider runs a model, and how a model is named in chats, tasks and settings.
 *
 * Local Ollama models keep their plain names ("qwen2.5-coder:7b"). Models of a cloud provider are
 * stored as "<provider>::<model>" ("anthropic::claude-opus-5-5", "ollama-cloud::gpt-oss:120b").
 * No Ollama model name contains "::", so every name saved before cloud providers existed still
 * means a local model. This module is shared by the renderer and the main process (relative
 * imports only).
 */

/** Providers reached through the main process with an API key. */
export type CloudProviderId = 'ollama-cloud' | 'anthropic' | 'openai';
/** Every provider: the local Ollama server and the cloud providers. */
export type ProviderId = 'ollama' | CloudProviderId;

export const CLOUD_PROVIDERS: CloudProviderId[] = ['ollama-cloud', 'anthropic', 'openai'];

const SEPARATOR = '::';

/** Model ids a provider may name: letters, digits and . _ : / @ - (no spaces, no "::"). */
export const CLOUD_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

export interface ModelRef {
  provider: ProviderId;
  /** The provider's own model id ("claude-opus-5-5", "qwen3:8b"). */
  model: string;
}

export function isCloudProvider(value: unknown): value is CloudProviderId {
  return typeof value === 'string' && (CLOUD_PROVIDERS as string[]).includes(value);
}

export function parseModelRef(ref: string): ModelRef {
  const value = String(ref || '').trim();
  const i = value.indexOf(SEPARATOR);
  if (i > 0) {
    const provider = value.slice(0, i);
    const model = value.slice(i + SEPARATOR.length);
    if (isCloudProvider(provider) && model) return { provider, model };
  }
  return { provider: 'ollama', model: value };
}

export function formatModelRef(provider: ProviderId, model: string): string {
  return provider === 'ollama' ? model : `${provider}${SEPARATOR}${model}`;
}

/** True for a model of a cloud provider reached with an API key. */
export function isCloudRef(ref: string): boolean {
  return parseModelRef(ref).provider !== 'ollama';
}

/**
 * An Ollama Cloud model run through the local Ollama after `ollama signin`: its tag ends in
 * "cloud" ("gpt-oss:120b-cloud", "glm-4.6:cloud"). The prompt leaves this computer for ollama.com.
 */
export function isOllamaCloudTag(name: string): boolean {
  const tag = String(name || '').split(':').slice(1).join(':').toLowerCase();
  return tag === 'cloud' || tag.endsWith('-cloud');
}

/** Whether a model runs somewhere other than this computer (any cloud provider or a "-cloud" tag). */
export function runsInCloud(ref: string): boolean {
  const { provider, model } = parseModelRef(ref);
  return provider !== 'ollama' || isOllamaCloudTag(model);
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  ollama: 'Ollama',
  'ollama-cloud': 'Ollama Cloud',
  anthropic: 'Claude',
  openai: 'GPT',
};

/** The company behind the provider, for texts such as "is sent to Anthropic". */
export const PROVIDER_COMPANIES: Record<ProviderId, string> = {
  ollama: 'Ollama',
  'ollama-cloud': 'Ollama (ollama.com)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/** The provider whose cloud runs this model: "ollama-cloud" for a "-cloud" tag of the local Ollama. */
export function cloudOwner(ref: string): ProviderId | null {
  const { provider, model } = parseModelRef(ref);
  if (provider !== 'ollama') return provider;
  return isOllamaCloudTag(model) ? 'ollama-cloud' : null;
}

/** "claude-opus-5-5 · Claude" for cloud models, the plain name for local ones. */
export function modelLabel(ref: string): string {
  const { provider, model } = parseModelRef(ref);
  return provider === 'ollama' ? model : `${model} · ${PROVIDER_NAMES[provider]}`;
}

/** The model id alone, without the provider. */
export function modelShortName(ref: string): string {
  return parseModelRef(ref).model;
}
