/**
 * visibleModels.ts — which cloud models the model selector lists.
 *
 * Providers can offer dozens of models (OpenAI and OpenRouter list hundreds), so each provider shows
 * a selection: the user's own (Settings › Cloud models › Models in the selector), or a default:
 * Claude's three newest models, OpenAI's five newest chat models, Gemini's four newest (no experiments),
 * Mistral's "-latest" aliases, every Ollama Cloud model, and every model of a server with at most
 * 20 of them. Hidden models stay reachable through the selector's search and the command palette,
 * and the selected model is always listed.
 */
import type { CloudModelInfo } from '../../../electron/preload';
import { CloudProviderId, isCompatProvider } from './modelRef';

const newestFirst = (a: CloudModelInfo, b: CloudModelInfo) => (b.createdAt || 0) - (a.createdAt || 0) || b.id.localeCompare(a.id, undefined, { numeric: true });

/** The default selection of one provider's models (ids). */
export function defaultVisibleIds(provider: CloudProviderId, models: CloudModelInfo[]): string[] {
  const own = models.filter((m) => m.provider === provider);
  if (isCompatProvider(provider)) return own.length <= 20 ? own.map((m) => m.id) : [];
  switch (provider) {
    case 'anthropic':
      return [...own].sort(newestFirst).slice(0, 3).map((m) => m.id);
    case 'openai':
      return [...own].sort(newestFirst).slice(0, 5).map((m) => m.id);
    case 'gemini': {
      // The newest generation is often a plain "-preview"; dated previews and experiments are skipped.
      const stable = own.filter((m) => !/-exp|-preview-\d|-\d{3}$|learnlm|gemma/i.test(m.id));
      const pool = stable.length ? stable : own;
      return [...pool].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })).slice(0, 4).map((m) => m.id);
    }
    case 'mistral': {
      const latest = own.filter((m) => /-latest$/.test(m.id));
      return (latest.length ? latest : [...own].sort(newestFirst).slice(0, 5)).slice(0, 8).map((m) => m.id);
    }
    default:
      return own.map((m) => m.id);
  }
}

/** The ids the selector shows for a provider: the user's choice when there is one, else the default. */
export function visibleIds(provider: CloudProviderId, models: CloudModelInfo[], chosen: Record<string, string[]> | undefined): Set<string> {
  const own = chosen?.[provider];
  return new Set(Array.isArray(own) ? own : defaultVisibleIds(provider, models));
}
