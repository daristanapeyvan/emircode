/**
 * pricing.ts — estimated cost of cloud model answers.
 *
 * Prices are US dollars per million tokens: input, input read from the provider's cache, output.
 * The built-in table covers models whose list price was known when this version was made
 * (PRICES_AS_OF); providers change prices, so every price can be overridden in Settings › Cloud
 * models, and the interface always calls the result an estimate. Not counted: Claude's surcharge
 * for writing the cache, long-context tiers (above 200K tokens) and batch or regional discounts.
 *
 * - Ollama Cloud is a subscription with usage limits, not per-token billing: no cost ("plan").
 * - A local OpenAI-compatible server (LM Studio on this computer) costs nothing ("free").
 * - Anything else without a price: only the token counts are shown ("unknown").
 */
import type { ModelPrice } from '@/types/settings';
import { compatEndpointInfo, isCompatProvider, isOllamaCloudTag, parseModelRef } from './modelRef';

export const PRICES_AS_OF = '2026-10';

type PriceRow = [RegExp, number, number, number];

/** [model id pattern, input, cached input, output] — first match wins, so specific names come first. */
const TABLE: Record<string, PriceRow[]> = {
  anthropic: [
    [/^claude-opus-4-[5-9]/, 5, 0.5, 25],
    [/^claude-opus-4(?:-[01])?(?:-\d{8})?$/, 15, 1.5, 75],
    [/^claude-sonnet-4/, 3, 0.3, 15],
    [/^claude-3-7-sonnet/, 3, 0.3, 15],
    [/^claude-haiku-4-5/, 1, 0.1, 5],
    [/^claude-3-5-haiku/, 0.8, 0.08, 4],
  ],
  openai: [
    [/^gpt-5-nano/, 0.05, 0.005, 0.4],
    [/^gpt-5-mini/, 0.25, 0.025, 2],
    [/^gpt-5(?:-\d{4}-\d{2}-\d{2})?$/, 1.25, 0.125, 10],
    [/^gpt-4\.1-nano/, 0.1, 0.025, 0.4],
    [/^gpt-4\.1-mini/, 0.4, 0.1, 1.6],
    [/^gpt-4\.1(?:-\d{4}-\d{2}-\d{2})?$/, 2, 0.5, 8],
    [/^gpt-4o-mini/, 0.15, 0.075, 0.6],
    [/^gpt-4o(?:-\d{4}-\d{2}-\d{2})?$/, 2.5, 1.25, 10],
    [/^o4-mini/, 1.1, 0.275, 4.4],
    [/^o3-mini/, 1.1, 0.55, 4.4],
    [/^o3(?:-\d{4}-\d{2}-\d{2})?$/, 2, 0.5, 8],
  ],
  gemini: [
    [/^gemini-2\.5-flash-lite/, 0.1, 0.025, 0.4],
    [/^gemini-2\.5-flash(?!-image)/, 0.3, 0.075, 2.5],
    [/^gemini-2\.5-pro/, 1.25, 0.31, 10],
    [/^gemini-3-pro/, 2, 0.2, 12],
  ],
  mistral: [
    [/^mistral-medium/, 0.4, 0.4, 2],
    [/^mistral-small/, 0.1, 0.1, 0.3],
    [/^codestral/, 0.3, 0.3, 0.9],
    [/^magistral-medium/, 2, 2, 5],
    [/^magistral-small/, 0.5, 0.5, 1.5],
    [/^ministral-8b/, 0.1, 0.1, 0.1],
    [/^ministral-3b/, 0.04, 0.04, 0.04],
    [/^open-mistral-nemo/, 0.15, 0.15, 0.15],
  ],
};

export type PriceSource = 'user' | 'builtin' | 'free' | 'plan' | 'unknown';

export interface PriceInfo {
  price: ModelPrice | null;
  source: PriceSource;
}

export function builtinPrice(ref: string): ModelPrice | null {
  const { provider, model } = parseModelRef(ref);
  for (const [pattern, input, cachedInput, output] of TABLE[provider] || []) {
    if (pattern.test(model)) return { input, cachedInput, output };
  }
  return null;
}

const validPrice = (p: ModelPrice | undefined): p is ModelPrice =>
  !!p && Number.isFinite(p.input) && p.input >= 0 && Number.isFinite(p.output) && p.output >= 0;

/** The price of a model: the user's, the built-in one, free (local), plan (Ollama Cloud) or unknown. */
export function priceFor(ref: string, userPrices: Record<string, ModelPrice> | undefined): PriceInfo {
  const { provider, model } = parseModelRef(ref);
  const own = userPrices?.[ref];
  if (validPrice(own)) return { price: own, source: 'user' };
  if (provider === 'ollama') return { price: null, source: isOllamaCloudTag(model) ? 'plan' : 'free' };
  if (provider === 'ollama-cloud') return { price: null, source: 'plan' };
  if (isCompatProvider(provider) && compatEndpointInfo(provider)?.local) return { price: { input: 0, output: 0 }, source: 'free' };
  const builtin = builtinPrice(ref);
  return builtin ? { price: builtin, source: 'builtin' } : { price: null, source: 'unknown' };
}

export interface TokenUsage {
  /** The whole prompt, cached part included. */
  prompt: number;
  /** The part of the prompt read from the provider's cache. */
  cached?: number;
  output: number;
}

/** Estimated cost in US dollars. */
export function estimateCost(usage: TokenUsage, price: ModelPrice): number {
  const prompt = Math.max(0, usage.prompt || 0);
  const cached = Math.min(prompt, Math.max(0, usage.cached || 0));
  const cachedPrice = price.cachedInput ?? price.input;
  return ((prompt - cached) * price.input + cached * cachedPrice + Math.max(0, usage.output || 0) * price.output) / 1_000_000;
}

/** A cost: "$0.0042", "$0.184", "$2.50", "$12.40". */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0';
  if (amount < 0.01) return `$${Number(amount.toPrecision(2))}`;
  if (amount < 1) return `$${amount.toFixed(3).replace(/(\.\d\d)0$/, '$1')}`;
  return `$${amount.toFixed(2)}`;
}

/** A price per million tokens: "$5", "$1.25", "$0.075", "$1.10". */
export function formatPrice(perMillion: number): string {
  if (!Number.isFinite(perMillion) || perMillion < 0) return '—';
  if (Number.isInteger(perMillion)) return `$${perMillion}`;
  const text = perMillion.toFixed(3).replace(/0$/, '');
  return `$${text}`;
}

/** Adds up the usage of several answers. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { prompt: a.prompt + b.prompt, cached: (a.cached || 0) + (b.cached || 0), output: a.output + b.output };
}
