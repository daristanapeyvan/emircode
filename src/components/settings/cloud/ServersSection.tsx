import React, { useState } from 'react';
import { Globe, HardDrive, KeyRound, Loader2, Network, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CompatEndpointStatus } from '../../../../electron/preload';
import { Button } from '../../common/Button';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { confirmDialog } from '@/lib/ui/dialogs';
import { cloudErrorText } from '@/lib/providers/errorText';
import { CloudRequestError } from '@/lib/providers/ModelGateway';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';
import { ModelChooser, selectorSummary } from './ModelChooser';

type CloudTexts = ReturnType<typeof getTranslations>['cloud'];

/** Common servers: name and address only (the user still confirms and enters the key). */
export const SERVER_PRESETS: Array<{ name: string; url: string; local?: boolean }> = [
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { name: 'Together', url: 'https://api.together.xyz/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1', local: true },
  { name: 'vLLM', url: 'http://localhost:8000/v1', local: true },
  { name: 'llama.cpp', url: 'http://localhost:8080/v1', local: true },
];

const inputClass =
  'w-full h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600';

/** The main process answers an address problem as "address:<reason>". */
function addressError(message: string, t: CloudTexts): string | null {
  const reason = message.match(/^address:(\w+)$/)?.[1];
  if (!reason) return null;
  const key = `errAddress_${reason}` as keyof CloudTexts;
  return typeof t[key] === 'string' ? (t[key] as string) : t.errAddress_invalid;
}

const ServerCard: React.FC<{ server: CompatEndpointStatus; t: CloudTexts }> = ({ server, t }) => {
  const { cloudModels, cloudErrors, applyCloudStatus, refreshCloud, cloudLoading } = useModelStore();
  const { settings } = useSettingsStore();
  const cloud = settings.cloud || DEFAULT_SETTINGS.cloud;
  const [choosing, setChoosing] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const count = cloudModels.filter((m) => m.provider === server.provider).length;
  const listError = cloudErrors[server.provider];
  const place = server.local ? (/^(?:localhost|127\.|\[::1\])/.test(server.host) ? 'computer' : 'lan') : 'remote';

  const remove = async () => {
    const api = window.electronAPI;
    if (!api?.cloudRemoveEndpoint) return;
    const ok = await confirmDialog({
      title: t.serverRemoveTitle,
      message: format(t.serverRemoveConfirm, { name: server.name }),
      confirmLabel: t.serverRemove,
      danger: true,
    });
    if (!ok) return;
    applyCloudStatus(await api.cloudRemoveEndpoint(server.id), server.provider, []);
  };

  const saveKey = async () => {
    const api = window.electronAPI;
    if (!api?.cloudSetKey || !key.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.cloudSetKey(server.provider, key.trim());
      if (res.ok) {
        applyCloudStatus(res.status, server.provider, res.models);
        setKey('');
        setEditingKey(false);
        setMessage({ kind: 'ok', text: format(t.keyCheckedModels, { count: res.models.length }) });
      } else {
        const err = new CloudRequestError(server.provider, res.error.code, res.error.message, { status: res.error.status });
        setMessage({ kind: 'error', text: cloudErrorText(err, '', t) || res.error.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const PlaceIcon = place === 'computer' ? HardDrive : place === 'lan' ? Network : Globe;
  return (
    <div className="rounded-md border border-zinc-800 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-200 truncate">{server.name}</p>
          <p className="text-[11px] text-zinc-500 font-mono truncate">{server.baseURL}</p>
        </div>
        <span
          className={cn(
            'shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] border',
            place === 'remote' ? 'border-sky-900/60 text-sky-300/90' : 'border-emerald-900/60 text-emerald-300/90'
          )}
        >
          <PlaceIcon size={11} strokeWidth={1.5} />
          {place === 'computer' ? t.serverThisComputer : place === 'lan' ? t.serverLan : t.serverRemote}
        </span>
      </div>
      <p className="text-[11px] text-zinc-500">
        {server.configured ? format(t.serverKeySet, { hint: server.hint || '' }) : t.serverNoKey}
        {count > 0 ? ` · ${format(t.modelsCount, { count })} · ${selectorSummary(server.provider, cloudModels, cloud.visibleModels, t)}` : ''}
      </p>
      {listError && (
        <p className="text-[11px] text-red-400">
          {format(t.modelsError, { error: cloudErrorText(new CloudRequestError(server.provider, listError, listError), '', t) || listError })}
        </p>
      )}
      {editingKey && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveKey()}
            placeholder={t.keyPlaceholder}
            aria-label={format(t.keyLabel, { provider: server.name })}
            className={cn(inputClass, 'font-mono flex-1 min-w-0')}
          />
          <Button size="sm" variant="primary" disabled={busy || !key.trim()} icon={busy ? <Loader2 size={12} className="animate-spin" /> : undefined} onClick={() => void saveKey()}>
            {busy ? t.checking : t.saveKey}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditingKey(false); setKey(''); }}>
            {t.cancelReplace}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {count > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setChoosing((v) => !v)}>
            {choosing ? t.hideModels : t.chooseModels}
          </Button>
        )}
        {!editingKey && (
          <Button size="sm" variant="ghost" icon={<KeyRound size={12} strokeWidth={1.5} />} onClick={() => setEditingKey(true)}>
            {server.configured ? t.replaceKey : t.serverAddKey}
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
        <Button size="sm" variant="ghost" icon={<Trash2 size={12} strokeWidth={1.5} />} onClick={() => void remove()}>
          {t.serverRemove}
        </Button>
      </div>
      {message && <p className={cn('text-[11px]', message.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400')}>{message.text}</p>}
      {choosing && <ModelChooser provider={server.provider} models={cloudModels} t={t} />}
    </div>
  );
};

const AddServerForm: React.FC<{ t: CloudTexts }> = ({ t }) => {
  const { applyCloudStatus } = useModelStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [localServer, setLocalServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const add = async () => {
    const api = window.electronAPI;
    if (!api?.cloudAddEndpoint || !name.trim() || !url.trim()) return;
    let host = url.trim();
    try {
      host = new URL(url.trim()).host;
    } catch {
      // the main process explains the address
    }
    const loopback = /^(?:localhost|127\.|\[::1\])/i.test(host);
    // Plain http to a server that is not marked as local is refused by the main process anyway.
    const refused = /^http:/i.test(url.trim()) && !localServer;
    if (!loopback && !refused) {
      const ok = await confirmDialog({
        title: t.serverConfirmTitle,
        message: format(t.serverConfirm, { host }),
        confirmLabel: t.serverConfirmAction,
      });
      if (!ok) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.cloudAddEndpoint({ name: name.trim(), baseURL: url.trim(), key: key.trim() || undefined, localServer });
      if (res.ok) {
        applyCloudStatus(res.status, res.endpoint.provider, res.models);
        setMessage({ kind: 'ok', text: format(t.serverAdded, { name: res.endpoint.name, count: res.models.length }) });
        setName('');
        setUrl('');
        setKey('');
        setLocalServer(false);
      } else {
        const text =
          addressError(res.error.message, t) ||
          (res.error.code === 'auth'
            ? format(t.keyRejected, { provider: name.trim() })
            : cloudErrorText(new CloudRequestError('openai-compatible:new', res.error.code, res.error.message, { status: res.error.status }), '', t, name.trim()) ||
              res.error.message);
        setMessage({ kind: 'error', text });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-dashed border-zinc-800 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <span>{t.serverPresets}</span>
        {SERVER_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => {
              setName(p.name);
              setUrl(p.url);
              setLocalServer(false);
            }}
            className="px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-[11px] text-zinc-400">{t.serverName}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.serverNamePlaceholder} maxLength={40} className={inputClass} />
        </label>
        <label className="space-y-1">
          <span className="block text-[11px] text-zinc-400">{t.serverUrl}</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.serverUrlPlaceholder} spellCheck={false} className={cn(inputClass, 'font-mono')} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="block text-[11px] text-zinc-400">{t.serverKeyOptional}</span>
        <input
          type="password"
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t.keyPlaceholder}
          className={cn(inputClass, 'font-mono')}
        />
      </label>
      <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
        <input type="checkbox" checked={localServer} onChange={(e) => setLocalServer(e.target.checked)} className="accent-accent cursor-pointer" />
        {t.serverLocal}
      </label>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !name.trim() || !url.trim()}
          icon={busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} strokeWidth={1.75} />}
          onClick={() => void add()}
        >
          {busy ? t.serverAdding : t.serverAdd}
        </Button>
      </div>
      {message && <p className={cn('text-[11px] leading-normal', message.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400')}>{message.text}</p>}
    </div>
  );
};

/** Settings › Cloud models › OpenAI-compatible servers. */
export const ServersSection: React.FC<{ t: CloudTexts }> = ({ t }) => {
  const { cloudStatus } = useModelStore();
  const servers = cloudStatus?.endpoints || [];
  return (
    <section className="py-3.5 border-b border-zinc-800/60 space-y-2.5">
      <div className="space-y-0.5">
        <h3 className="text-xs font-medium text-zinc-200">{t.serversTitle}</h3>
        <p className="text-[11px] text-zinc-500 leading-normal">{t.serversDesc}</p>
      </div>
      {servers.length === 0 && <p className="text-[11px] text-zinc-600">{t.serverNone}</p>}
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} t={t} />
      ))}
      <AddServerForm t={t} />
    </section>
  );
};
