import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CloudModelInfo } from '../../../../electron/preload';
import { useSettingsStore } from '@/stores/settingsStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { CloudProviderId, formatModelRef } from '@/lib/providers/modelRef';
import { defaultVisibleIds, visibleIds } from '@/lib/providers/visibleModels';
import { formatPrice, priceFor } from '@/lib/providers/pricing';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';

type CloudTexts = ReturnType<typeof getTranslations>['cloud'];

/** "1M", "200K" */
export const tokenCount = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`);

/** "In the selector: 3 of 12" for a provider card. */
export function selectorSummary(provider: CloudProviderId, models: CloudModelInfo[], chosen: Record<string, string[]> | undefined, t: CloudTexts): string {
  const own = models.filter((m) => m.provider === provider);
  const shown = own.filter((m) => visibleIds(provider, models, chosen).has(m.id)).length;
  return format(t.selectorModels, { shown, total: own.length });
}

/**
 * The models of one provider with "show in the selector" boxes. The choice is saved at once in
 * settings.cloud.visibleModels; "Recommended" goes back to the default selection.
 */
export const ModelChooser: React.FC<{ provider: CloudProviderId; models: CloudModelInfo[]; t: CloudTexts }> = ({ provider, models, t }) => {
  const { settings, setCloud } = useSettingsStore();
  const cloud = settings.cloud || DEFAULT_SETTINGS.cloud;
  const [query, setQuery] = useState('');
  const own = useMemo(() => models.filter((m) => m.provider === provider), [models, provider]);
  const shown = visibleIds(provider, models, cloud.visibleModels);
  const q = query.trim().toLowerCase();
  const list = q ? own.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(q)) : own;

  const save = (ids: string[] | null) => {
    const next = { ...(cloud.visibleModels || {}) };
    if (ids === null) delete next[provider];
    else next[provider] = ids;
    setCloud({ visibleModels: next });
  };
  const toggle = (id: string) => {
    const set = new Set(shown);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    save(own.filter((m) => set.has(m.id)).map((m) => m.id));
  };

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-2">
      <p className="text-[11px] text-zinc-500 leading-normal">{t.modelsHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[160px]">
          <Search size={12} strokeWidth={1.5} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.modelsFilter}
            aria-label={t.modelsFilter}
            className="w-full h-7 pl-6 pr-2 rounded bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
          />
        </label>
        {(
          [
            [t.modelsRecommended, () => save(null)],
            [t.modelsAll, () => save(own.map((m) => m.id))],
            [t.modelsNone, () => save([])],
          ] as Array<[string, () => void]>
        ).map(([label, action]) => (
          <button key={label} type="button" onClick={action} className="text-[11px] text-zinc-400 hover:text-zinc-100 underline underline-offset-2 cursor-pointer">
            {label}
          </button>
        ))}
      </div>
      <ul className="max-h-56 overflow-y-auto divide-y divide-zinc-800/60">
        {list.map((m) => {
          const ref = formatModelRef(provider, m.id);
          const price = priceFor(ref, cloud.prices).price;
          const recommended = defaultVisibleIds(provider, models).includes(m.id);
          const detail = [
            m.label !== m.id ? m.label : '',
            m.contextWindow ? `${tokenCount(m.contextWindow)} ${t.contextTitle.toLowerCase()}` : '',
            price ? `${formatPrice(price.input)} / ${formatPrice(price.output)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={m.id}>
              <label className="flex items-center gap-2 py-1.5 cursor-pointer">
                <input type="checkbox" checked={shown.has(m.id)} onChange={() => toggle(m.id)} className="accent-accent cursor-pointer shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block font-mono text-xs truncate', shown.has(m.id) ? 'text-zinc-100' : 'text-zinc-400')}>
                    {m.id}
                    {recommended && <span className="ml-1.5 font-sans text-[10px] text-zinc-500">{t.recommendedTag}</span>}
                  </span>
                  {detail && <span className="block text-[11px] text-zinc-500 truncate">{detail}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
