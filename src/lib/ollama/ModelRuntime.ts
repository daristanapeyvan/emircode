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

export interface ModelRuntimeInfo {
  name: string;
  /** Architecture family reported by Ollama, e.g. "qwen3", "qwen2", "gemma2", "llama". */
  family: string;
  /** Parameter count in billions, when known. */
  parameterSizeB: number | null;
  /** Maximum context the model was trained for (model_info.<arch>.context_length). */
  nativeContext: number | null;
  capabilities: string[];
  supportsThinking: boolean;
  supportsTools: boolean;
  /** <= ~4.5B parameters: needs the leanest prompt and tool set. */
  isSmall: boolean;
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
  const parameterSizeB =
    parseParameterSize(show?.details?.parameter_size) ?? parameterSizeFromName(model);
  const family = (show?.details?.family || inferFamilyFromName(model)).toLowerCase();
  const lower = model.toLowerCase();
  const supportsThinking =
    capabilities.includes('thinking') ||
    (capabilities.length === 0 && /qwen3|deepseek-r1|gpt-oss|magistral/.test(lower));
  return {
    name: model,
    family,
    parameterSizeB,
    nativeContext: extractNativeContext(show),
    capabilities,
    supportsThinking,
    supportsTools: capabilities.includes('tools'),
    isSmall: parameterSizeB !== null ? parameterSizeB <= 4.5 : /tinyllama|smollm|phi3:mini|:0\.5b|:1b|:1\.5b|:2b|:3b/.test(lower),
  };
}

/** Cached /api/show lookup. Failures are not cached so a later call can retry. */
export function getModelRuntimeInfo(model: string): Promise<ModelRuntimeInfo> {
  const key = (model || '').trim();
  const cached = runtimeCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
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

export function resolveThinkParam(info: ModelRuntimeInfo, enabled: boolean): OllamaThinkValue | undefined {
  if (!info.supportsThinking) return undefined;
  // gpt-oss cannot switch reasoning off; the lowest effort is the closest equivalent.
  if (/gpt-oss/i.test(info.name)) return enabled ? 'medium' : 'low';
  return enabled;
}

export function resolveRequestProfile(params: {
  info: ModelRuntimeInfo;
  agentOpt?: Partial<AgentOptimizationConfig> | null;
  hardware?: HardwareInfo | null;
}): ResolvedRequestProfile {
  const { info, agentOpt, hardware } = params;
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
