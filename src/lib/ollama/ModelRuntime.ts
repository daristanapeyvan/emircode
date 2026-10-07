/**
 * ModelRuntime.ts
 * Resolves per-model runtime facts from Ollama (/api/show) and turns the user's hardware
 * profile into concrete request options (num_ctx, num_predict, sampling, think).
 *
 * Why this exists: Ollama does NOT run a model with its native context window by default.
 * Without an explicit num_ctx every request gets a small default window (4096 tokens on
 * current versions) and the start of long prompts is silently dropped, so the model loses
 * its instructions mid-task. Sending the same num_ctx for every request of a model (chat and
 * agent alike) also avoids expensive model reloads between requests.
 */
import { ollamaClient } from './OllamaClient';
import { GenerationOptions, OllamaShowResponse, OllamaThinkValue } from '@/types/ollama';
import { HardwareInfo } from '@/types/hardware';
import { AgentOptimizationConfig, HardwareOptimizationProfile } from '@/types/settings';
import type { CloudModelInfo } from '../../../electron/preload';
import { ProviderId, compatEndpointInfo, formatModelRef, isCompatProvider, isOllamaCloudTag, parseModelRef } from '../providers/modelRef';

export interface ModelRuntimeInfo {
  name: string;
  /** Who runs the model: the local Ollama or a cloud provider. */
  provider: ProviderId;
  /**
   * Runs outside this computer: a cloud provider, or an Ollama Cloud model through the local Ollama.
   * The context window then follows Settings › Cloud models, not this computer's memory.
   */
  remote: boolean;
  /** Architecture family reported by Ollama, e.g. "qwen3", "qwen2", "gemma2", "llama". */
  family: string;
  /** Parameter count in billions, when known. */
  parameterSizeB: number | null;
  /** Maximum context the model was trained for (model_info.<arch>.context_length). */
  nativeContext: number | null;
  capabilities: string[];
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  /** Longest answer the model can write, when the provider says. */
  maxOutput: number | null;
  /** <= ~4.5B parameters: needs the leanest prompt and tool set. */
  isSmall: boolean;
  /**
   * How much the agent can hand the model at once: "small" (<= ~4.5B, leanest prompt and tools),
   * "medium" (a typical local model) or "large" (>= 24B, or any model running in the cloud: more
   * steps, bigger reads, several files per step, a longer kept history).
   */
  tier: ModelTier;
}

export type ModelTier = 'small' | 'medium' | 'large';

/** Local models from this size up get the large-model agent settings. */
export const LARGE_MODEL_MIN_B = 24;

export function modelTier(info: { remote: boolean; isSmall: boolean; parameterSizeB: number | null }): ModelTier {
  if (info.remote) return 'large';
  if (info.isSmall) return 'small';
  return info.parameterSizeB !== null && info.parameterSizeB >= LARGE_MODEL_MIN_B ? 'large' : 'medium';
}

export interface ResolvedRequestProfile {
  numCtx: number;
  numPredict: number;
  think: OllamaThinkValue | undefined;
  sampling: GenerationOptions;
}

const runtimeCache = new Map<string, Promise<ModelRuntimeInfo>>();

const MIN_CONTEXT = 4096;
const MIN_PREDICT = 1024;
/** Context window of cloud models on Automatic: plenty for the agent, and every step stays affordable. */
export const CLOUD_DEFAULT_CONTEXT = 65536;
/** Output budget of one agent step on a cloud model (raised automatically when an answer is cut off). */
export const CLOUD_DEFAULT_PREDICT = 16384;

/** Cloud models listed by the providers, by "provider::model" reference (filled by the model store). */
const cloudModels = new Map<string, CloudModelInfo>();

export function registerCloudModels(models: CloudModelInfo[]): void {
  for (const m of models) cloudModels.set(formatModelRef(m.provider, m.id), m);
}

export function knownCloudModel(ref: string): CloudModelInfo | undefined {
  return cloudModels.get(ref);
}

/** "7.6B" -> 7.6, "567M" -> 0.567 */
export function parseParameterSize(value?: string | null): number | null {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return null;
  const unit = (m[2] || 'B').toUpperCase();
  if (unit === 'T') return num * 1000;
  if (unit === 'M') return num / 1000;
  if (unit === 'K') return num / 1_000_000;
  return num;
}

/** Reads the size from a tag such as "qwen2.5-coder:7b", "gemma2:2b", "qwen3:30b-a3b", "smollm2:135m". */
export function parameterSizeFromName(model: string): number | null {
  const lower = (model || '').toLowerCase();
  const m = lower.match(/[:\-_](\d+(?:\.\d+)?)([bm])(?![a-z0-9])/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return null;
  return m[2] === 'm' ? num / 1000 : num;
}

function inferFamilyFromName(model: string): string {
  const lower = (model || '').toLowerCase();
  const known = ['qwen3', 'qwen2.5', 'qwen2', 'gemma3', 'gemma2', 'gemma', 'llama3', 'llama', 'mistral', 'deepseek', 'phi', 'granite', 'gpt-oss'];
  for (const k of known) {
    if (lower.includes(k)) return k === 'qwen2.5' ? 'qwen2' : k;
  }
  return lower.split(/[:/]/)[0] || 'unknown';
}

function extractNativeContext(show: OllamaShowResponse | null): number | null {
  const info = show?.model_info;
  if (!info) return null;
  for (const key of Object.keys(info)) {
    if (key.endsWith('.context_length')) {
      const value = Number(info[key]);
      if (isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

export function buildRuntimeInfo(model: string, show: OllamaShowResponse | null): ModelRuntimeInfo {
  const capabilities = Array.isArray(show?.capabilities) ? show!.capabilities!.map(String) : [];
  const remote = isOllamaCloudTag(model) || !!show?.remote_host || !!show?.remote_model;
  const parameterSizeB =
    parseParameterSize(show?.details?.parameter_size) ?? parameterSizeFromName(model);
  const family = (show?.details?.family || inferFamilyFromName(model)).toLowerCase();
  const lower = model.toLowerCase();
  const supportsThinking =
    capabilities.includes('thinking') ||
    (capabilities.length === 0 && /qwen3|deepseek-r1|gpt-oss|magistral/.test(lower));
  const isSmall = remote ? false : parameterSizeB !== null ? parameterSizeB <= 4.5 : /tinyllama|smollm|phi3:mini|:0\.5b|:1b|:1\.5b|:2b|:3b/.test(lower);
  return {
    name: model,
    provider: 'ollama',
    remote,
    family,
    parameterSizeB,
    nativeContext: extractNativeContext(show),
    capabilities,
    supportsThinking,
    supportsTools: capabilities.includes('tools'),
    supportsVision: capabilities.includes('vision'),
    maxOutput: null,
    isSmall,
    tier: modelTier({ remote, isSmall, parameterSizeB }),
  };
}

/**
 * Runtime facts of a model of a cloud provider ("anthropic::claude-opus-5-5"), from the provider's
 * model list or, for Ollama Cloud, from its /api/show. Cloud models are never treated as small; a
 * model of a local OpenAI-compatible server (LM Studio on this computer) is a local model like any
 * other: its size decides its tier and this computer's settings its context window.
 */
export function buildCloudRuntimeInfo(ref: string, info: CloudModelInfo | null | undefined, show?: OllamaShowResponse | null): ModelRuntimeInfo {
  const { provider, model } = parseModelRef(ref);
  const capabilities = Array.isArray(show?.capabilities) ? show!.capabilities!.map(String) : [];
  const fromShow = show ? buildRuntimeInfo(model, show) : null;
  const thinking = info?.thinking ?? null;
  const supportsThinking = capabilities.includes('thinking') || (thinking !== null ? !!thinking : provider === 'anthropic' || /gpt-oss|deepseek|qwen3|kimi-k2-thinking/i.test(model));
  const vision = capabilities.includes('vision') || (info?.vision ?? provider === 'anthropic');
  const localServer = isCompatProvider(provider) && !!compatEndpointInfo(provider)?.local;
  const parameterSizeB = parseParameterSize(info?.parameterSize) ?? fromShow?.parameterSizeB ?? (localServer ? parameterSizeFromName(model) : null);
  const isSmall = localServer && parameterSizeB !== null && parameterSizeB <= 4.5;
  return {
    name: ref,
    provider,
    remote: !localServer,
    family: (info?.family || fromShow?.family || provider).toLowerCase(),
    parameterSizeB,
    nativeContext: info?.contextWindow || fromShow?.nativeContext || null,
    capabilities: capabilities.length ? capabilities : ['completion', ...(vision ? ['vision'] : []), ...(supportsThinking ? ['thinking'] : [])],
    supportsThinking,
    supportsTools: true,
    supportsVision: vision,
    maxOutput: info?.maxOutput || null,
    isSmall,
    tier: localServer ? modelTier({ remote: false, isSmall, parameterSizeB }) : 'large',
  };
}

/** What a cloud model is, asked once from the main process (Ollama Cloud: /api/show, Claude: the Models API). */
async function describeCloudModel(ref: string): Promise<ModelRuntimeInfo> {
  const known = cloudModels.get(ref);
  const { provider, model } = parseModelRef(ref);
  if (provider === 'ollama') return buildRuntimeInfo(model, null);
  if (known && (provider !== 'ollama-cloud' || known.contextWindow)) return buildCloudRuntimeInfo(ref, known);
  try {
    const res = await window.electronAPI?.cloudDescribe?.(provider, model);
    if (res?.ok) {
      const info = { ...res.info, ...(known ? { label: known.label } : {}) };
      cloudModels.set(ref, info);
      return buildCloudRuntimeInfo(ref, info, res.show);
    }
  } catch {
    // the defaults below
  }
  return buildCloudRuntimeInfo(ref, known);
}

/** Cached /api/show lookup. Failures are not cached so a later call can retry. */
export function getModelRuntimeInfo(model: string): Promise<ModelRuntimeInfo> {
  const key = (model || '').trim();
  const cached = runtimeCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    if (parseModelRef(key).provider !== 'ollama') {
      const info = await describeCloudModel(key);
      // Like a failed /api/show: guessed facts are not kept, a later call asks again.
      if (!cloudModels.has(key)) runtimeCache.delete(key);
      return info;
    }
    let show: OllamaShowResponse | null = null;
    try {
      show = await ollamaClient.showModel(key);
    } catch {
      show = null;
    }
    if (!show) runtimeCache.delete(key);
    return buildRuntimeInfo(key, show);
  })();
  runtimeCache.set(key, pending);
  return pending;
}

export function defaultContextForHardware(
  profile: HardwareOptimizationProfile | undefined,
  hardware: HardwareInfo | null | undefined
): number {
  if (profile === 'low') return 8192;
  if (profile === 'balanced') return 16384;
  if (profile === 'high') return 32768;
  const ramGb = hardware?.ram?.totalGb ?? 16;
  const vramGb = hardware?.gpu?.vramMb ? hardware.gpu.vramMb / 1024 : 0;
  if (vramGb >= 16 || ramGb >= 48) return 32768;
  if (vramGb >= 8 || ramGb >= 24) return 16384;
  if (ramGb >= 12) return 12288;
  return 8192;
}

export function resolveContextLength(params: {
  configured?: number;
  profile?: HardwareOptimizationProfile;
  hardware?: HardwareInfo | null;
  nativeContext?: number | null;
}): number {
  let target =
    params.configured && params.configured > 0
      ? params.configured
      : defaultContextForHardware(params.profile, params.hardware);
  if (params.nativeContext && params.nativeContext > 0) {
    target = Math.min(target, params.nativeContext);
  }
  return Math.max(Math.min(MIN_CONTEXT, params.nativeContext || MIN_CONTEXT), Math.round(target));
}

/**
 * Sampling for tool-calling steps. Greedy-like settings (temperature 0.1) make small models
 * fall into endless repetition; the Qwen team explicitly warns against it. `attempt` > 0 is
 * used after a degenerate/looping output to push the model off the repeated path.
 */
export function buildAgentSamplingOptions(info: ModelRuntimeInfo, attempt = 0): GenerationOptions {
  const isQwen3 = info.family.startsWith('qwen3') || /qwen3/i.test(info.name);
  const opts: GenerationOptions = isQwen3
    ? { temperature: 0.6, top_p: 0.85, top_k: 20, min_p: 0 }
    : { temperature: 0.35, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.05 };
  if (attempt > 0) {
    opts.temperature = Math.min(0.95, (opts.temperature ?? 0.4) + 0.2 * attempt);
    opts.repeat_penalty = 1.15;
    opts.presence_penalty = 0.6;
  }
  return opts;
}

/**
 * Context window of a cloud model: Settings › Cloud models (Automatic: 64K tokens), never more than
 * the model takes. Larger windows mean fewer shortened histories but more tokens in every step.
 */
export function resolveCloudContextLength(configured: number | undefined, nativeContext: number | null | undefined): number {
  let target = configured && configured > 0 ? configured : CLOUD_DEFAULT_CONTEXT;
  if (nativeContext && nativeContext > 0) target = Math.min(target, nativeContext);
  return Math.max(Math.min(8192, nativeContext || 8192), Math.round(target));
}

export function resolveThinkParam(info: ModelRuntimeInfo, enabled: boolean): OllamaThinkValue | undefined {
  if (!info.supportsThinking) return undefined;
  // Claude, GPT, Gemini, Mistral and compatible servers: the main process turns this into adaptive
  // thinking, a reasoning effort or thought summaries.
  if (info.provider !== 'ollama' && info.provider !== 'ollama-cloud') return enabled;
  // gpt-oss cannot switch reasoning off; the lowest effort is the closest equivalent.
  if (/gpt-oss/i.test(info.name)) return enabled ? 'medium' : 'low';
  return enabled;
}

export function resolveRequestProfile(params: {
  info: ModelRuntimeInfo;
  agentOpt?: Partial<AgentOptimizationConfig> | null;
  hardware?: HardwareInfo | null;
  /** Settings › Cloud models › Context window (0 = automatic). */
  cloudContextLength?: number;
}): ResolvedRequestProfile {
  const { info, agentOpt, hardware } = params;
  if (info.remote) {
    const numCtx = resolveCloudContextLength(params.cloudContextLength, info.nativeContext);
    const ceiling = Math.min(info.maxOutput && info.maxOutput > 0 ? info.maxOutput : CLOUD_DEFAULT_PREDICT, CLOUD_DEFAULT_PREDICT);
    return {
      numCtx,
      numPredict: Math.max(MIN_PREDICT, Math.min(ceiling, Math.floor(numCtx / 2))),
      think: resolveThinkParam(info, !!agentOpt?.agentThinking),
      sampling: buildAgentSamplingOptions(info),
    };
  }
  const numCtx = resolveContextLength({
    configured: agentOpt?.contextLength,
    profile: agentOpt?.hardwareProfile,
    hardware,
    nativeContext: info.nativeContext,
  });
  const requested = agentOpt?.maxTokens && agentOpt.maxTokens > 0 ? agentOpt.maxTokens : 4096;
  // Never let a single answer claim more than half of the window; the prompt needs the rest.
  const numPredict = Math.max(MIN_PREDICT, Math.min(requested, Math.floor(numCtx / 2)));
  return {
    numCtx,
    numPredict,
    think: resolveThinkParam(info, !!agentOpt?.agentThinking),
    sampling: buildAgentSamplingOptions(info),
  };
}

/**
 * Rough token estimate used for context budgeting. Calibrated at runtime by the agent
 * (prompt_eval_count from Ollama reports the full prompt size); 3.2 chars/token is a
 * deliberately conservative default for mixed code / Turkish / English text.
 */
export function estimateTokens(text: string, charsPerToken = 3.2): number {
  if (!text) return 0;
  return Math.ceil(text.length / Math.max(1.5, charsPerToken));
}
