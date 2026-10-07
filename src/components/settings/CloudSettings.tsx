import React, { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Select } from '@/components/common/Select';
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
import { CloudProviderId, PROVIDER_NAMES } from '@/lib/providers/modelRef';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';

type CloudTexts = ReturnType<typeof getTranslations>['cloud'];

const KEY_PAGES: Record<CloudProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  'ollama-cloud': 'https://ollama.com/settings/keys',
};
const ENV_NAMES: Record<CloudProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
};
const ORDER: CloudProviderId[] = ['anthropic', 'openai', 'ollama-cloud'];
const CONTEXT_OPTIONS = [32768, 65536, 131072, 200000, 400000, 1000000];

const providerTitle = (provider: CloudProviderId, t: CloudTexts) =>
  provider === 'anthropic' ? t.providerAnthropic : provider === 'openai' ? t.providerOpenAI : t.providerOllamaCloud;
const providerDesc = (provider: CloudProviderId, t: CloudTexts) =>
  provider === 'anthropic' ? t.descAnthropic : provider === 'openai' ? t.descOpenAI : t.descOllamaCloud;

/** One provider: its key (entered, never shown again), where it is kept and how many models it offers. */
const ProviderCard: React.FC<{ provider: CloudProviderId; t: CloudTexts }> = ({ provider, t }) => {
  const { cloudStatus, cloudModels, cloudErrors, applyCloudStatus, refreshCloud, cloudLoading } = useModelStore();
  const status = cloudStatus?.providers[provider];
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
        const text = res.error.code === 'auth' ? format(t.keyRejected, { provider: PROVIDER_NAMES[provider] }) : cloudErrorText(err, '', t) || res.error.message;
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
      message: format(t.removeConfirm, { provider: PROVIDER_NAMES[provider] }),
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
          <h3 className="text-xs font-medium text-zinc-200">{providerTitle(provider, t)}</h3>
          <p className="text-[11px] text-zinc-500 leading-normal">{providerDesc(provider, t)}</p>
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
        <span>
          {stateText}
          {status?.configured && count > 0 ? ` · ${format(t.modelsCount, { count })}` : ''}
        </span>
      </p>
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
            aria-label={format(t.keyLabel, { provider: PROVIDER_NAMES[provider] })}
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
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
    </section>
  );
};

/** Settings › Cloud models: API keys of Ollama Cloud, Claude and GPT, Ollama Cloud through Ollama, the context window. */
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

      {available ? ORDER.map((provider) => <ProviderCard key={provider} provider={provider} t={c} />) : null}

      <section className="py-3.5 border-b border-zinc-800/60 space-y-1.5">
        <h3 className="text-xs font-medium text-zinc-200">{c.ollamaSigninTitle}</h3>
        <p className="text-[11px] text-zinc-500 leading-normal">{c.ollamaSigninDesc}</p>
        <Button size="sm" variant="secondary" icon={<Cloud size={12} strokeWidth={1.5} />} onClick={openDiscoverCloud}>
          {c.openDiscoverCloud}
        </Button>
      </section>

      <SettingsRow label={c.contextTitle} description={c.contextDesc}>
        <Select
          ariaLabel={c.contextTitle}
          value={cloud.contextLength || 0}
          onChange={(v) => setCloud({ contextLength: v })}
          options={[{ value: 0, label: c.contextAuto }, ...CONTEXT_OPTIONS.map((n) => ({ value: n, label: n.toLocaleString() }))]}
        />
      </SettingsRow>
    </div>
  );
};
