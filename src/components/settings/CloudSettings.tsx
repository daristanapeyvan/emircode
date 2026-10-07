import React, { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, ExternalLink, FlaskConical, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Select } from '@/components/common/Select';
import { Toggle } from '@/components/common/Toggle';
import { Button } from '../common/Button';
import { SettingsRow } from './SettingsRow';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { useUIStore } from '@/stores/uiStore';
import { useModelLibraryStore } from '@/stores/modelLibraryStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { confirmDialog } from '@/lib/ui/dialogs';
import { cloudErrorText } from '@/lib/providers/errorText';
import { CloudRequestError } from '@/lib/providers/ModelGateway';
import { BuiltinCloudProviderId, providerName } from '@/lib/providers/modelRef';
import { CloudEffortSetting, DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';
import { ModelChooser, selectorSummary } from './cloud/ModelChooser';
import { ServersSection } from './cloud/ServersSection';
import { PricesSection } from './cloud/PricesSection';

type CloudTexts = ReturnType<typeof getTranslations>['cloud'];

const KEY_PAGES: Record<BuiltinCloudProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  mistral: 'https://console.mistral.ai/api-keys',
  'ollama-cloud': 'https://ollama.com/settings/keys',
};
const ENV_NAMES: Record<BuiltinCloudProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
};
const ORDER: BuiltinCloudProviderId[] = ['anthropic', 'openai', 'gemini', 'mistral', 'ollama-cloud'];
const CONTEXT_OPTIONS = [32768, 65536, 131072, 200000, 400000, 1000000];
const BUDGET_OPTIONS = [0.25, 0.5, 1, 2, 5, 10, 20, 50];
const EFFORTS: CloudEffortSetting[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

const PROVIDER_TEXT: Record<BuiltinCloudProviderId, [keyof CloudTexts, keyof CloudTexts]> = {
  anthropic: ['providerAnthropic', 'descAnthropic'],
  openai: ['providerOpenAI', 'descOpenAI'],
  gemini: ['providerGemini', 'descGemini'],
  mistral: ['providerMistral', 'descMistral'],
  'ollama-cloud': ['providerOllamaCloud', 'descOllamaCloud'],
};

const effortLabel = (level: CloudEffortSetting, t: CloudTexts) =>
  ({ auto: t.effortAuto, low: t.effortLow, medium: t.effortMedium, high: t.effortHigh, xhigh: t.effortXhigh, max: t.effortMax })[level];

/** A heading between the groups of the page. */
const GroupTitle: React.FC<{ children: React.ReactNode; icon?: React.ReactNode }> = ({ children, icon }) => (
  <h3 className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
    {icon}
    {children}
  </h3>
);

/** One provider: its key (entered, never shown again), where it is kept and how many models it offers. */
const ProviderCard: React.FC<{ provider: BuiltinCloudProviderId; t: CloudTexts }> = ({ provider, t }) => {
  const { cloudStatus, cloudModels, cloudErrors, applyCloudStatus, refreshCloud, cloudLoading } = useModelStore();
  const { settings } = useSettingsStore();
  const status = cloudStatus?.providers[provider];
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const count = cloudModels.filter((m) => m.provider === provider).length;
  const listError = cloudErrors[provider];
  const showInput = !status?.configured || editing;

  const save = async () => {
    const api = window.electronAPI;
    const key = value.trim();
    if (!api?.cloudSetKey || !key) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.cloudSetKey(provider, key);
      if (res.ok) {
        applyCloudStatus(res.status, provider, res.models);
        setValue('');
        setEditing(false);
        setMessage({ kind: 'ok', text: format(t.keyCheckedModels, { count: res.models.length }) });
      } else {
        const err = new CloudRequestError(provider, res.error.code, res.error.message, { status: res.error.status });
        const text = res.error.code === 'auth' ? format(t.keyRejected, { provider: providerName(provider) }) : cloudErrorText(err, '', t) || res.error.message;
        setMessage({ kind: 'error', text });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const api = window.electronAPI;
    if (!api?.cloudRemoveKey) return;
    const ok = await confirmDialog({
      title: t.removeConfirmTitle,
      message: format(t.removeConfirm, { provider: providerName(provider) }),
      confirmLabel: t.removeKey,
      danger: true,
    });
    if (!ok) return;
    const next = await api.cloudRemoveKey(provider);
    applyCloudStatus(next, provider, []);
    setMessage(null);
    if (next.providers[provider]?.configured) void refreshCloud();
  };

  const stateText = !status?.configured
    ? t.keyNone
    : status.source === 'env'
      ? format(t.keyEnv, { hint: status.hint || '', name: ENV_NAMES[provider] })
      : status.source === 'session'
        ? format(t.keySession, { hint: status.hint || '' })
        : format(t.keySaved, { hint: status.hint || '' });

  return (
    <section className="py-3.5 border-b border-zinc-800/60 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-xs font-medium text-zinc-200">{t[PROVIDER_TEXT[provider][0]] as string}</h3>
          <p className="text-[11px] text-zinc-500 leading-normal">{t[PROVIDER_TEXT[provider][1]] as string}</p>
        </div>
        <a
          href={KEY_PAGES[provider]}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-zinc-300 underline underline-offset-2 hover:text-zinc-50 transition-colors"
        >
          {t.getKey}
          <ExternalLink size={11} strokeWidth={1.5} />
        </a>
      </div>

      <p className={cn('flex items-center gap-1.5 text-[11px]', status?.configured ? 'text-emerald-400/90' : 'text-zinc-500')}>
        {status?.configured ? <ShieldCheck size={13} strokeWidth={1.5} className="shrink-0" /> : <KeyRound size={13} strokeWidth={1.5} className="shrink-0" />}
        <span>{stateText}</span>
      </p>
      {status?.configured && count > 0 && (
        <p className="text-[11px] text-zinc-500">
          {format(t.modelsCount, { count })} · {selectorSummary(provider, cloudModels, settings.cloud?.visibleModels, t)}
        </p>
      )}
      {status?.configured && listError && (
        <p className="text-[11px] text-red-400">
          {format(t.modelsError, { error: cloudErrorText(new CloudRequestError(provider, listError, listError), '', t) || listError })}
        </p>
      )}

      {showInput ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={value}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            placeholder={t.keyPlaceholder}
            aria-label={format(t.keyLabel, { provider: providerName(provider) })}
            className="flex-1 min-w-0 h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !value.trim()}
            icon={busy ? <Loader2 size={12} className="animate-spin" /> : undefined}
            onClick={() => void save()}
          >
            {busy ? t.checking : t.saveKey}
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setValue(''); }}>
              {t.cancelReplace}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {count > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setChoosing((v) => !v)}>
              {choosing ? t.hideModels : t.chooseModels}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t.replaceKey}
          </Button>
          {status?.source !== 'env' && (
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              {t.removeKey}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={cloudLoading}
            icon={<RefreshCw size={12} className={cloudLoading ? 'animate-spin' : ''} strokeWidth={1.5} />}
            onClick={() => void refreshCloud()}
          >
            {t.refresh}
          </Button>
        </div>
      )}
      {status?.source === 'env' && <p className="text-[11px] text-zinc-500">{format(t.removeEnvNote, { name: ENV_NAMES[provider] })}</p>}
      {message && <p className={cn('text-[11px]', message.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400')}>{message.text}</p>}
      {choosing && status?.configured && <ModelChooser provider={provider} models={cloudModels} t={t} />}
    </section>
  );
};

/**
 * Settings › Cloud models: the providers' API keys and the models each shows in the selector,
 * OpenAI-compatible servers, Ollama Cloud through Ollama, effort and reasoning, costs and the task
 * budget, the context window, and the experimental native tool calls.
 */
export const CloudSettings: React.FC = () => {
  const { settings, setCloud } = useSettingsStore();
  const { cloudStatus, refreshCloud } = useModelStore();
  const { openModels, closeSettings } = useUIStore();
  const t = getTranslations(settings.language);
  const c = t.cloud;
  const cloud = settings.cloud || DEFAULT_SETTINGS.cloud;
  const available = !!window.electronAPI?.cloudStatus;

  useEffect(() => {
    if (available && !cloudStatus) void refreshCloud();
  }, [available, cloudStatus, refreshCloud]);

  const openDiscoverCloud = () => {
    useModelLibraryStore.getState().setCategory('cloud');
    closeSettings();
    openModels('discover');
  };

  return (
    <div className="text-xs">
      <div className="py-3.5 border-b border-zinc-800/60 space-y-2.5">
        <p className="text-zinc-400 leading-relaxed">{c.intro}</p>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-zinc-200">
            <Cloud size={13} strokeWidth={1.5} />
            {c.privacyTitle}
          </p>
          <p className="text-[11px] text-zinc-400 leading-relaxed">{c.privacyNote}</p>
        </div>
        {cloudStatus?.encryption === 'none' && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90 leading-relaxed">
            <AlertTriangle size={13} className="shrink-0 mt-px" strokeWidth={1.5} />
            {c.encryptionMissing}
          </p>
        )}
      </div>

      {available ? (
        <>
          <GroupTitle>{c.providersTitle}</GroupTitle>
          {ORDER.map((provider) => (
            <ProviderCard key={provider} provider={provider} t={c} />
          ))}
          <ServersSection t={c} />
        </>
      ) : null}

      <section className="py-3.5 border-b border-zinc-800/60 space-y-1.5">
        <h3 className="text-xs font-medium text-zinc-200">{c.ollamaSigninTitle}</h3>
        <p className="text-[11px] text-zinc-500 leading-normal">{c.ollamaSigninDesc}</p>
        <Button size="sm" variant="secondary" icon={<Cloud size={12} strokeWidth={1.5} />} onClick={openDiscoverCloud}>
          {c.openDiscoverCloud}
        </Button>
      </section>

      <GroupTitle>{c.reasoningTitle}</GroupTitle>
      <SettingsRow label={c.agentEffort} description={c.agentEffortDesc}>
        <Select
          ariaLabel={c.agentEffort}
          value={cloud.agentEffort || 'auto'}
          onChange={(v) => setCloud({ agentEffort: v })}
          options={EFFORTS.map((level) => ({ value: level, label: effortLabel(level, c) }))}
        />
      </SettingsRow>
      <SettingsRow label={c.chatEffort} description={c.chatEffortDesc}>
        <Select
          ariaLabel={c.chatEffort}
          value={cloud.chatEffort || 'auto'}
          onChange={(v) => setCloud({ chatEffort: v })}
          options={EFFORTS.map((level) => ({ value: level, label: effortLabel(level, c) }))}
        />
      </SettingsRow>
      <SettingsRow label={c.summariesTitle} description={c.summariesDesc}>
        <Toggle checked={cloud.reasoningSummaries !== false} onChange={(checked) => setCloud({ reasoningSummaries: checked })} />
      </SettingsRow>
      <SettingsRow label={c.contextTitle} description={c.contextDesc}>
        <Select
          ariaLabel={c.contextTitle}
          value={cloud.contextLength || 0}
          onChange={(v) => setCloud({ contextLength: v })}
          options={[{ value: 0, label: c.contextAuto }, ...CONTEXT_OPTIONS.map((n) => ({ value: n, label: n.toLocaleString() }))]}
        />
      </SettingsRow>

      <GroupTitle>{c.costsTitle}</GroupTitle>
      <SettingsRow label={c.budgetTitle} description={c.budgetDesc}>
        <Select
          ariaLabel={c.budgetTitle}
          value={cloud.taskBudgetUsd || 0}
          onChange={(v) => setCloud({ taskBudgetUsd: v })}
          options={[
            { value: 0, label: c.budgetNone },
            ...Array.from(new Set([...BUDGET_OPTIONS, ...(cloud.taskBudgetUsd ? [cloud.taskBudgetUsd] : [])]))
              .sort((a, b) => a - b)
              .map((n) => ({ value: n, label: `$${n.toFixed(2)}` })),
          ]}
        />
      </SettingsRow>
      <PricesSection t={c} />

      <GroupTitle icon={<FlaskConical size={12} strokeWidth={1.75} />}>{c.experimentalTitle}</GroupTitle>
      <SettingsRow label={c.nativeToolsTitle} description={c.nativeToolsDesc}>
        <Toggle checked={!!cloud.nativeTools} onChange={(checked) => setCloud({ nativeTools: checked })} />
      </SettingsRow>
    </div>
  );
};
