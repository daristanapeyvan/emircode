import React, { useState } from 'react';
import { Button } from '../../common/Button';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { formatModelRef, providerName } from '@/lib/providers/modelRef';
import { visibleIds } from '@/lib/providers/visibleModels';
import { PRICES_AS_OF, PriceSource, builtinPrice, formatPrice, priceFor } from '@/lib/providers/pricing';
import { DEFAULT_SETTINGS, ModelPrice } from '@/types/settings';
import { cn } from '@/lib/utils/cn';

type CloudTexts = ReturnType<typeof getTranslations>['cloud'];

const SOURCE_STYLE: Record<PriceSource, string> = {
  user: 'text-zinc-200',
  builtin: 'text-zinc-400',
  unknown: 'text-amber-400/90',
  plan: 'text-zinc-500',
  free: 'text-emerald-400/90',
};

const sourceText = (source: PriceSource, t: CloudTexts) =>
  source === 'user' ? t.priceUser : source === 'builtin' ? t.priceBuiltin : source === 'plan' ? t.pricePlan : source === 'free' ? t.priceFree : t.priceUnknown;

const numberInput = 'w-16 h-7 px-1.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right focus:outline-none focus:border-zinc-600';

/** One model's price, editable in place. */
const PriceRow: React.FC<{ refName: string; t: CloudTexts }> = ({ refName, t }) => {
  const { settings, setCloud } = useSettingsStore();
  const cloud = settings.cloud || DEFAULT_SETTINGS.cloud;
  const info = priceFor(refName, cloud.prices);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ input: '', cachedInput: '', output: '' });
  const editable = info.source !== 'plan' && info.source !== 'free';

  const start = () => {
    const p = info.price;
    setDraft({ input: p ? String(p.input) : '', cachedInput: p?.cachedInput !== undefined ? String(p.cachedInput) : '', output: p ? String(p.output) : '' });
    setEditing(true);
  };
  const save = () => {
    const input = Number(draft.input.replace(',', '.'));
    const output = Number(draft.output.replace(',', '.'));
    const cached = draft.cachedInput.trim() === '' ? undefined : Number(draft.cachedInput.replace(',', '.'));
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0 || (cached !== undefined && (!Number.isFinite(cached) || cached < 0))) return;
    const price: ModelPrice = { input, output, ...(cached !== undefined ? { cachedInput: cached } : {}) };
    setCloud({ prices: { ...(cloud.prices || {}), [refName]: price } });
    setEditing(false);
  };
  const reset = () => {
    const next = { ...(cloud.prices || {}) };
    delete next[refName];
    setCloud({ prices: next });
    setEditing(false);
  };

  const [provider, ...rest] = refName.split('::');
  const p = info.price;
  return (
    <tr className="border-t border-zinc-800/60 align-middle">
      <td className="py-1.5 pr-2 min-w-0">
        <span className="block font-mono text-xs text-zinc-200 truncate max-w-[220px]" title={refName}>
          {rest.join('::')}
        </span>
        <span className="block text-[10px] text-zinc-500">{providerName(provider as any)}</span>
      </td>
      {editing ? (
        <>
          {(['input', 'cachedInput', 'output'] as const).map((field) => (
            <td key={field} className="py-1.5 px-1 text-right">
              <input
                inputMode="decimal"
                value={draft[field]}
                onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                aria-label={field === 'input' ? t.priceInput : field === 'output' ? t.priceOutput : t.priceCached}
                className={numberInput}
              />
            </td>
          ))}
          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
            <Button size="sm" variant="primary" onClick={save}>
              {t.priceSave}
            </Button>
            {builtinPrice(refName) && (
              <Button size="sm" variant="ghost" onClick={reset}>
                {t.priceReset}
              </Button>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="py-1.5 px-1 text-right text-xs text-zinc-300 tabular-nums">{p ? formatPrice(p.input) : '—'}</td>
          <td className="py-1.5 px-1 text-right text-xs text-zinc-400 tabular-nums">{p ? formatPrice(p.cachedInput ?? p.input) : '—'}</td>
          <td className="py-1.5 px-1 text-right text-xs text-zinc-300 tabular-nums">{p ? formatPrice(p.output) : '—'}</td>
          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
            <span className={cn('text-[10px] mr-2', SOURCE_STYLE[info.source])}>{sourceText(info.source, t)}</span>
            {editable && (
              <button type="button" onClick={start} className="text-[11px] text-zinc-400 hover:text-zinc-100 underline underline-offset-2 cursor-pointer">
                {t.priceEdit}
              </button>
            )}
          </td>
        </>
      )}
    </tr>
  );
};

/** Settings › Cloud models › Prices: the models in the selector with their estimated prices. */
export const PricesSection: React.FC<{ t: CloudTexts }> = ({ t }) => {
  const { cloudModels } = useModelStore();
  const { settings } = useSettingsStore();
  const cloud = settings.cloud || DEFAULT_SETTINGS.cloud;
  const providers = Array.from(new Set(cloudModels.map((m) => m.provider)));
  const refs = providers.flatMap((provider) => {
    const shown = visibleIds(provider, cloudModels, cloud.visibleModels);
    return cloudModels
      .filter((m) => m.provider === provider && shown.has(m.id))
      .map((m) => formatModelRef(provider, m.id))
      // Ollama Cloud (a plan) and local servers (free) have no price to set.
      .filter((ref) => !['plan', 'free'].includes(priceFor(ref, cloud.prices).source));
  });
  return (
    <div className="py-3.5 border-b border-zinc-800/60 space-y-2">
      <div className="space-y-0.5">
        <label className="text-xs font-medium text-zinc-200 block">{t.pricesTitle}</label>
        <p className="text-[11px] text-zinc-500 leading-normal">{format(t.pricesDesc, { date: PRICES_AS_OF })}</p>
      </div>
      {refs.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{t.priceNoModels}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="font-medium pb-1">{t.priceModel}</th>
                <th className="font-medium pb-1 px-1 text-right">{t.priceInput}</th>
                <th className="font-medium pb-1 px-1 text-right">{t.priceCached}</th>
                <th className="font-medium pb-1 px-1 text-right">{t.priceOutput}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {refs.map((ref) => (
                <PriceRow key={ref} refName={ref} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
