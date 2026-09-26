import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  Check,
  Code2,
  Download,
  Eye,
  Feather,
  Layers,
  LayoutGrid,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  Wrench,
  X,
} from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelLibraryStore } from '@/stores/modelLibraryStore';
import { getTranslations, resolveLanguage } from '@/lib/localization/i18n';
import {
  CategoryId,
  LIBRARY_CATEGORIES,
  LibraryModel,
  MODEL_NAME_RE,
  MODEL_TAG_RE,
  OTHER_GROUP,
  RECOMMENDED_MODELS,
  SizeGroup,
  VariantOption,
  categoriesOf,
  groupVariants,
  hardwareFit,
  isCommonQuant,
  isLocal,
  memoryNeedGb,
  modelsFor,
  pickSize,
  quantTier,
  sameDigest,
  sizeToBillions,
  splitTag,
} from '@/lib/ollama/library';
import { Button } from '../common/Button';
import { confirmDialog } from '@/lib/ui/dialogs';
import { IconButton } from '../common/IconButton';
import { Segmented, inputClass } from '../agent/wizard/wizardUi';
import { cn } from '@/lib/utils/cn';

type Lang = 'tr' | 'en';
type LibText = ReturnType<typeof getTranslations>['library'];

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  star: Star,
  code: Code2,
  wrench: Wrench,
  brain: Brain,
  eye: Eye,
  feather: Feather,
  message: MessageSquare,
  layers: Layers,
  grid: LayoutGrid,
};

/** Decimal gigabytes, as ollama.com shows sizes: 5225374496 → "5,2 GB". */
const gb = (bytes: number, lang: Lang, digits = 1) =>
  `${new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: bytes < 1e9 ? 2 : digits }).format(bytes / 1e9)} GB`;

/** "May 28, 2025 1:19 AM UTC" (as ollama.com gives it) → "28 Mayıs 2025" in the interface language. */
const localDate = (text: string, lang: Lang) => {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const sizeLabel = (size: string, t: LibText) => (size === OTHER_GROUP ? t.otherSize : size.toUpperCase());

function ago(time: number | null, t: LibText): string {
  if (!time) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return fill(t.minutesAgo, { n: minutes });
  return fill(t.hoursAgo, { n: Math.floor(minutes / 60) });
}

function useLibraryContext() {
  const language = useSettingsStore((s) => s.settings.language);
  const hardware = useSettingsStore((s) => s.hardware);
  const lang: Lang = resolveLanguage(language);
  const t = getTranslations(language).library;
  const ramGb = hardware?.ram.totalGb || 16;
  const vramMb = hardware?.gpu?.vramMb;
  const hw = useMemo(() => ({ ramGb, vramGb: vramMb ? vramMb / 1024 : undefined }), [ramGb, vramMb]);
  return { lang, t, hw };
}

/** Is any tag of this model downloaded? */
const installedTagsOf = (name: string, installed: Array<{ name: string }>) =>
  installed.filter((m) => m.name === name || m.name.startsWith(`${name}:`)).map((m) => (m.name.includes(':') ? m.name : `${m.name}:latest`));

export const DiscoverTab: React.FC = () => {
  const { ensureLibrary, openModel } = useModelLibraryStore();
  // The list comes from ollama.com on its own (cached for 12 hours).
  useEffect(() => {
    void ensureLibrary();
  }, [ensureLibrary]);
  return <div className="h-[min(62vh,560px)] flex flex-col text-xs">{openModel ? <ModelPage name={openModel} /> : <LibraryCatalog />}</div>;
};

// ---------------------------------------------------------------------------
// Catalog: categories on the left, the models of the category as cards
// ---------------------------------------------------------------------------

const LibraryCatalog: React.FC = () => {
  const { lang, t } = useLibraryContext();
  const { models, status, source, fetchedAt, error, category, setCategory, openModelPage, ensureLibrary } = useModelLibraryStore();
  const installedModels = useModelStore((s) => s.installedModels);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => modelsFor(models, category, query), [models, category, query]);
  const counts = useMemo(() => {
    const result: Partial<Record<CategoryId, number>> = {};
    for (const m of models.filter(isLocal)) for (const id of categoriesOf(m)) result[id] = (result[id] || 0) + 1;
    return result;
  }, [models]);
  const loading = status === 'loading' || status === 'idle';
  // A fresh saved copy is normal; only the built-in list or a failed refresh is worth a warning.
  const warn = source === 'builtin' || (source === 'cache' && !!error);

  return (
    <>
      <div className="flex items-center gap-3 pb-3">
        <label className="relative flex-1 max-w-xs">
          <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} className={cn(inputClass, 'pl-8')} />
        </label>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500 min-w-0">
          {loading && models.length === 0 ? (
            <>
              <Loader2 size={12} className="animate-spin shrink-0" />
              <span className="truncate">{t.loading}</span>
            </>
          ) : (
            <>
              {loading && <Loader2 size={12} className="animate-spin shrink-0" />}
              <span className={cn('truncate', warn && 'text-amber-400/90')}>
                {source === 'builtin'
                  ? t.sourceOffline
                  : source === 'cache' && error
                    ? fill(t.sourceStale, { time: ago(fetchedAt, t) })
                    : fill(t.sourceOnline, { count: models.filter(isLocal).length, time: ago(fetchedAt, t) })}
              </span>
              {warn && !loading && (
                <IconButton label={t.retry} icon={<RefreshCw size={12} strokeWidth={1.5} />} size="sm" onClick={() => void ensureLibrary(true)} />
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col sm:flex-row min-h-0 border-t border-zinc-800/60">
        <nav
          aria-label={t.categories}
          className="flex sm:flex-col gap-0.5 py-2 pr-2 overflow-x-auto sm:overflow-y-auto shrink-0 sm:w-52 border-b sm:border-b-0 sm:border-r border-zinc-800/40 select-none"
        >
          {LIBRARY_CATEGORIES.map((c) => {
            const active = !query.trim() && c.id === category;
            const Icon = CATEGORY_ICONS[c.icon] || LayoutGrid;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  setQuery('');
                  setCategory(c.id);
                }}
                className={cn(
                  'shrink-0 sm:w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors cursor-pointer text-left whitespace-nowrap',
                  active ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                )}
              >
                <span className={active ? 'text-zinc-200' : 'text-zinc-500'}>
                  <Icon size={14} strokeWidth={1.5} />
                </span>
                <span className="flex-1">{c.title[lang]}</span>
                {counts[c.id] ? <span className="text-[11px] text-zinc-600 tabular-nums">{counts[c.id]}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto py-3 sm:pl-4 space-y-4">
          {visible.length === 0 ? (
            <p className="text-xs text-zinc-500 py-10 text-center">{loading ? t.loading : t.noResults}</p>
          ) : (
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
              {visible.map((m) => (
                <ModelCard key={m.name} model={m} lang={lang} t={t} installed={installedTagsOf(m.name, installedModels).length > 0} onOpen={() => openModelPage(m.name)} />
              ))}
            </div>
          )}
          <CustomTagRow t={t} />
        </div>
      </div>
    </>
  );
};

const ModelCard: React.FC<{ model: LibraryModel; lang: Lang; t: LibText; installed: boolean; onOpen: () => void }> = ({ model, lang, t, installed, onOpen }) => {
  const note = RECOMMENDED_MODELS.find((r) => r.name === model.name)?.note[lang];
  const billions = model.sizes.map((s) => sizeToBillions(s)).filter((n): n is number => n !== null);
  const range =
    model.sizes.length > 1
      ? fill(t.sizeRange, { from: model.sizes[0].toUpperCase(), to: model.sizes[model.sizes.length - 1].toUpperCase() })
      : model.sizes[0]?.toUpperCase() || '';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-md border border-zinc-800/80 bg-zinc-900 hover:bg-zinc-800/50 hover:border-zinc-700 px-3.5 py-3 flex flex-col gap-1.5 transition-colors cursor-pointer"
    >
      <span className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-zinc-100 truncate">{model.name}</span>
        {installed && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <Check size={11} strokeWidth={2} />
            {t.installed}
          </span>
        )}
      </span>
      <span className="text-xs text-zinc-500 leading-snug line-clamp-2">{note || model.description}</span>
      <span className="flex items-center gap-2 text-[11px] text-zinc-500 mt-auto pt-1 font-mono">
        {range && <span title={billions.length ? model.sizes.join(' · ') : undefined}>{range}</span>}
        {model.capabilities.length > 0 && <span className="truncate">{model.capabilities.join(' · ')}</span>}
        {model.pullsLabel && <span className="ml-auto shrink-0">{fill(t.pulls, { n: model.pullsLabel })}</span>}
      </span>
    </button>
  );
};

/** Any model or tag not in the list: verified in the registry, then downloaded. */
const CustomTagRow: React.FC<{ t: LibText }> = ({ t }) => {
  const { pullModel } = useModelStore();
  const verifyTag = useModelLibraryStore((s) => s.verifyTag);
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'error'; message?: string }>({ kind: 'idle' });
  const submit = async () => {
    const raw = value.trim();
    if (!raw) return;
    const full = raw.includes(':') ? raw : `${raw}:latest`;
    const { model, tag } = splitTag(full);
    if (!MODEL_NAME_RE.test(model.split('/').pop() || '') || !MODEL_TAG_RE.test(tag)) {
      setState({ kind: 'error', message: fill(t.customMissing, { tag: raw }) });
      return;
    }
    setState({ kind: 'checking', message: fill(t.customChecking, { tag: full }) });
    const check = await verifyTag(full);
    if (check.status === 'missing') {
      setState({ kind: 'error', message: fill(t.customMissing, { tag: full }) });
      return;
    }
    setState({ kind: 'idle' });
    setValue('');
    try {
      await pullModel(full);
    } catch (err: any) {
      setState({ kind: 'error', message: fill(t.downloadError, { error: err?.message || String(err) }) });
    }
  };
  return (
    <div className="pt-3 border-t border-zinc-800/40 space-y-1.5">
      <p className="text-[11px] text-zinc-500">{t.customTitle}</p>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (state.kind === 'error') setState({ kind: 'idle' });
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={t.customPlaceholder}
          className={cn(inputClass, 'flex-1 font-mono')}
        />
        <Button variant="secondary" size="sm" disabled={!value.trim() || state.kind === 'checking'} icon={<Download size={13} strokeWidth={1.5} />} onClick={() => void submit()}>
          {t.download}
        </Button>
      </div>
      {state.message && <p className={cn('text-[11px]', state.kind === 'error' ? 'text-red-400' : 'text-zinc-500')}>{state.message}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Model page: size, quantization, fit for this computer, verification, download
// ---------------------------------------------------------------------------

const ModelPage: React.FC<{ name: string }> = ({ name }) => {
  const { lang, t, hw } = useLibraryContext();
  const { models, tags, ensureTags, openModelPage } = useModelLibraryStore();
  const model = models.find((m) => m.name === name);
  const entry = tags[name];
  const groups = useMemo(() => groupVariants(name, entry?.variants || []), [name, entry?.variants]);
  const [size, setSize] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  // The tags come from ollama.com as soon as the page opens.
  useEffect(() => {
    void ensureTags(name);
  }, [name, ensureTags]);

  // Preselect the size that runs comfortably here, and its default download.
  useEffect(() => {
    if (!groups.length) return;
    if (!size || !groups.some((g) => g.size === size)) setSize(pickSize(groups, hw));
  }, [groups, size, hw]);
  const group = groups.find((g) => g.size === size) || null;
  useEffect(() => {
    if (!group) return;
    if (!selectedTag || !group.options.some((o) => o.variant.tag === selectedTag)) {
      setSelectedTag((group.options.find((o) => o.isDefault) || group.options[0]).variant.tag);
      setShowOthers(false);
    }
  }, [group, selectedTag]);
  const option = group?.options.find((o) => o.variant.tag === selectedTag) || null;
  const note = RECOMMENDED_MODELS.find((r) => r.name === name)?.note[lang];

  return (
    <>
      <div className="flex items-start gap-2 pb-3 border-b border-zinc-800/60">
        <IconButton label={t.back} icon={<ArrowLeft size={16} strokeWidth={1.5} />} size="sm" onClick={() => openModelPage(null)} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">{name}</h3>
          {model?.pullsLabel && (
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {fill(t.pulls, { n: model.pullsLabel })}
              {model.updated ? ` · ${localDate(model.updated, lang)}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-5 pr-1">
        <div className="space-y-2">
          {note && <p className="text-xs text-zinc-300 leading-relaxed">{note}</p>}
          {model?.description && <p className="text-xs text-zinc-400 leading-relaxed">{model.description}</p>}
          {model && model.capabilities.length > 0 && (
            <p className="text-[11px] text-zinc-500 font-mono">{model.capabilities.join(' · ')}</p>
          )}
        </div>

        {entry?.status === 'loading' && groups.length === 0 && (
          <p className="flex items-center gap-2 text-[11px] text-zinc-500">
            <Loader2 size={12} className="animate-spin" />
            {t.tagsLoading}
          </p>
        )}
        {entry?.builtin && <p className="text-[11px] text-amber-400/90">{t.tagsOffline}</p>}
        {entry?.status === 'error' && groups.length === 0 && <p className="text-[11px] text-red-400">{entry.error}</p>}

        {groups.length > 0 && size && (
          <section className="space-y-2">
            <h4 className="text-xs font-medium text-zinc-400">{t.size}</h4>
            <SizePicker groups={groups} size={size} onChange={setSize} t={t} />
          </section>
        )}

        {group && (
          <section className="space-y-2">
            <h4 className="text-xs font-medium text-zinc-400">{t.quantization}</h4>
            <VariantList group={group} selected={selectedTag} onSelect={setSelectedTag} showOthers={showOthers} onToggleOthers={() => setShowOthers((v) => !v)} lang={lang} t={t} hw={hw} />
          </section>
        )}

        {option && <VariantDetails option={option} lang={lang} t={t} hw={hw} />}
      </div>

      {option && <DownloadBar option={option} lang={lang} t={t} hw={hw} />}
    </>
  );
};

const SizePicker: React.FC<{ groups: SizeGroup[]; size: string; onChange: (size: string) => void; t: LibText }> = ({ groups, size, onChange, t }) => {
  const installedModels = useModelStore((s) => s.installedModels);
  const installed = (g: SizeGroup) =>
    g.options.some((o) => installedModels.some((m) => sameDigest(m.digest, o.variant.digest) || m.name === o.variant.tag));
  return (
    <div className="flex flex-wrap">
      <Segmented
        value={size}
        onChange={onChange}
        ariaLabel={t.size}
        options={groups.map((g) => ({ value: g.size, label: `${sizeLabel(g.size, t)}${installed(g) ? ' ✓' : ''}` }))}
      />
    </div>
  );
};

/** Plain quantizations of the size first; other versions (instruct, thinking, MoE variants) folded. */
const VariantList: React.FC<{
  group: SizeGroup;
  selected: string | null;
  onSelect: (tag: string) => void;
  showOthers: boolean;
  onToggleOthers: () => void;
  lang: Lang;
  t: LibText;
  hw: { ramGb: number; vramGb?: number };
}> = ({ group, selected, onSelect, showOthers, onToggleOthers, lang, t, hw }) => {
  // The default and the common quantizations of its build ("7b-instruct-q8_0" for qwen2.5-coder:7b).
  const common = group.options.filter((o) => o.isDefault || (o.family === group.family && isCommonQuant(o.quant)));
  const plain = common.length ? common : group.options;
  const others = group.options.filter((o) => !plain.includes(o));
  const selectedIsOther = others.some((o) => o.variant.tag === selected);
  const rows = showOthers || selectedIsOther ? [...plain, ...others] : plain;
  return (
    <div role="radiogroup" aria-label={t.quantization} className="rounded-md border border-zinc-800/80 divide-y divide-zinc-800/60 overflow-hidden">
      {rows.map((o) => (
        <VariantRow
          key={o.variant.tag}
          option={o}
          main={plain.includes(o)}
          checked={o.variant.tag === selected}
          onSelect={() => onSelect(o.variant.tag)}
          lang={lang}
          t={t}
          hw={hw}
        />
      ))}
      {others.length > 0 && !selectedIsOther && (
        <button type="button" onClick={onToggleOthers} className="w-full px-3 py-2 text-left text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-colors cursor-pointer">
          {showOthers ? t.hideVersions : fill(t.otherVersions, { n: others.length })}
        </button>
      )}
    </div>
  );
};

const TIER_TEXT = (t: LibText): Record<string, string> => ({
  tiny: t.tierTiny,
  small: t.tierSmall,
  balanced: t.tierBalanced,
  better: t.tierBetter,
  'near-lossless': t.tierNearLossless,
  full: t.tierFull,
});

const FitText: React.FC<{ fit: ReturnType<typeof hardwareFit>; t: LibText }> = ({ fit, t }) =>
  fit === 'unknown' ? null : (
    <span className={cn(fit === 'comfortable' ? 'text-emerald-400/90' : fit === 'tight' ? 'text-amber-400/90' : 'text-red-400/90')}>
      {fit === 'comfortable' ? t.fitComfortable : fit === 'tight' ? t.fitTight : t.fitTooLarge}
    </span>
  );

const VariantRow: React.FC<{
  option: VariantOption;
  /** A main choice is named by its quantization; other versions by their full suffix. */
  main: boolean;
  checked: boolean;
  onSelect: () => void;
  lang: Lang;
  t: LibText;
  hw: { ramGb: number; vramGb?: number };
}> = ({ option, main, checked, onSelect, lang, t, hw }) => {
  const installedModels = useModelStore((s) => s.installedModels);
  const v = option.variant;
  const installed = installedModels.some((m) => m.name === v.tag || (v.digest && sameDigest(m.digest, v.digest)));
  const quant = option.quant ? option.quant.toUpperCase() : '';
  const title = option.isDefault
    ? `${quant || t.defaultLabel}${quant ? ` · ${t.defaultLabel}` : ''}`
    : main && quant
      ? quant
      : v.suffix || v.name;
  const tier = quantTier(option.quant);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer', checked ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30')}
    >
      <span className={cn('w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center', checked ? 'border-zinc-300' : 'border-zinc-600')}>
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-zinc-200" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-100 truncate">{title}</span>
          {installed && (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 shrink-0">
              <Check size={11} strokeWidth={2} />
              {t.installed}
            </span>
          )}
        </span>
        <span className="block text-[11px] text-zinc-500 truncate">
          <span className="font-mono">{v.tag}</span>
          {tier ? ` · ${TIER_TEXT(t)[tier]}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] space-y-0.5">
        <span className="block text-zinc-300 tabular-nums">{v.bytes ? gb(v.bytes, lang) : v.sizeLabel}</span>
        <span className="block">
          <FitText fit={hardwareFit(v.bytes, hw)} t={t} />
        </span>
      </span>
    </button>
  );
};

const inputLabel = (input: string, t: LibText) =>
  input
    .split(/,\s*/)
    .map((p) => ({ text: t.inputText, image: t.inputImage, audio: t.inputAudio }[p.trim().toLowerCase()] || p))
    .join(', ');

const VariantDetails: React.FC<{ option: VariantOption; lang: Lang; t: LibText; hw: { ramGb: number; vramGb?: number } }> = ({ option, lang, t, hw }) => {
  const v = option.variant;
  const check = useModelLibraryStore((s) => s.checks[v.tag]);
  const verifyTag = useModelLibraryStore((s) => s.verifyTag);
  // Every selected tag is verified in the registry on its own.
  useEffect(() => {
    void verifyTag(v.tag);
  }, [v.tag, verifyTag]);
  const bytes = check?.bytes || v.bytes;
  const numberFormat = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 1 });
  return (
    <section className="rounded-md border border-zinc-800/80 divide-y divide-zinc-800/60">
      {v.context && <InfoRow label={t.context} value={v.context} />}
      {v.input && <InfoRow label={t.input} value={inputLabel(v.input, t)} />}
      {bytes ? (
        <InfoRow
          label={t.thisComputer}
          value={
            <span className="flex flex-col items-end gap-0.5">
              <span>{fill(t.memoryLine, { need: numberFormat.format(memoryNeedGb(bytes)), ram: numberFormat.format(hw.ramGb) })}</span>
              <FitText fit={hardwareFit(bytes, hw)} t={t} />
            </span>
          }
        />
      ) : null}
      <InfoRow
        label={t.verification}
        value={
          !check || check.status === 'checking' ? (
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <Loader2 size={12} className="animate-spin" />
              {t.verifying}
            </span>
          ) : check.status === 'verified' ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400/90">
              <ShieldCheck size={13} strokeWidth={1.5} />
              {fill(t.verified, { size: gb(check.bytes || 0, lang, 2) })}
            </span>
          ) : check.status === 'missing' ? (
            <span className="inline-flex items-center gap-1.5 text-red-400">
              <ShieldAlert size={13} strokeWidth={1.5} />
              {t.missing}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-400/90">
              <ShieldAlert size={13} strokeWidth={1.5} />
              {fill(t.verifyError, { error: check.error || '?' })}
            </span>
          )
        }
      />
    </section>
  );
};

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 px-3 py-2.5">
    <span className="text-xs text-zinc-400 shrink-0">{label}</span>
    <span className="text-xs text-zinc-200 text-right min-w-0">{value}</span>
  </div>
);

const DownloadBar: React.FC<{ option: VariantOption; lang: Lang; t: LibText; hw: { ramGb: number; vramGb?: number } }> = ({ option, lang, t, hw }) => {
  const v = option.variant;
  const { downloads, installedModels, pullModel, cancelPull } = useModelStore();
  const { checks, installed: compared, compareInstalled } = useModelLibraryStore();
  const [error, setError] = useState<string | null>(null);
  const check = checks[v.tag];
  const download = downloads[v.tag];
  const local = installedModels.find((m) => m.name === v.tag) || installedModels.find((m) => v.digest && sameDigest(m.digest, v.digest));
  const bytes = check?.bytes || v.bytes;
  const comparison = compared[v.tag];

  // A downloaded tag is compared with the registry on its own (after a download, or when the page opens).
  useEffect(() => {
    if (local && !comparison) void compareInstalled(v.tag, local.digest);
  }, [local, comparison, compareInstalled, v.tag]);
  useEffect(() => setError(null), [v.tag]);

  const start = async () => {
    setError(null);
    if (bytes && hardwareFit(bytes, hw) === 'too-large') {
      const need = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 1 }).format(memoryNeedGb(bytes));
      if (!(await confirmDialog({ title: t.tooLargeTitle, message: fill(t.tooLargeConfirm, { tag: v.tag, need }), confirmLabel: t.download }))) return;
    }
    try {
      await pullModel(v.tag);
      const after = useModelStore.getState().installedModels.find((m) => m.name === v.tag);
      if (after) await compareInstalled(v.tag, after.digest);
    } catch (err: any) {
      setError(fill(t.downloadError, { error: err?.message || String(err) }));
    }
  };

  return (
    <div className="pt-3 border-t border-zinc-800/60 flex items-center gap-3 min-h-[44px]">
      <div className="flex-1 min-w-0 text-[11px]">
        {download ? (
          <div className="space-y-1">
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-zinc-400 h-full transition-all duration-200" style={{ width: `${download.percentage}%` }} />
            </div>
            <p className="text-zinc-500 truncate">
              {download.percentage}% · {download.status}
              {download.speed ? ` · ${download.speed}` : ''}
            </p>
          </div>
        ) : error ? (
          <p className="text-red-400">{error}</p>
        ) : local && comparison === 'match' ? (
          <p className="inline-flex items-center gap-1.5 text-emerald-400/90">
            <ShieldCheck size={13} strokeWidth={1.5} />
            {t.installedMatch}
          </p>
        ) : local && comparison === 'differs' ? (
          <p className="text-amber-400/90">{t.installedDiffers}</p>
        ) : null}
      </div>
      {download ? (
        <Button variant="secondary" size="sm" icon={<X size={13} strokeWidth={1.5} />} onClick={() => cancelPull(v.tag)}>
          {t.cancel}
        </Button>
      ) : local && comparison !== 'differs' ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400/90 px-2">
          <Check size={14} strokeWidth={2} />
          {t.installed}
        </span>
      ) : (
        <Button
          variant="primary"
          size="sm"
          disabled={check?.status === 'missing' || check?.status === 'checking'}
          icon={<Download size={13} strokeWidth={1.5} />}
          onClick={() => void start()}
        >
          {bytes ? fill(t.downloadSize, { size: gb(bytes, lang) }) : t.download}
        </Button>
      )}
    </div>
  );
};
