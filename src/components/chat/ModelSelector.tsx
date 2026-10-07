import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Download, Layers, AlertCircle, RefreshCw, Cloud, Search } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { formatBytes, formatParameterSize } from '@/lib/utils/formatters';
import { CloudProviderId, cloudOwner, formatModelRef, isCompatProvider, isOllamaCloudTag, modelShortName, providerCompany, providerName } from '@/lib/providers/modelRef';
import { visibleIds } from '@/lib/providers/visibleModels';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { cn } from '@/lib/utils/cn';

interface Item {
  value: string;
  name: string;
  detail: string;
  cloud: boolean;
  running?: boolean;
}

interface Group {
  id: string;
  label: string;
  items: Item[];
  /** Models of the provider hidden by Settings › Cloud models › Models in the selector (found by search). */
  hidden: Item[];
  /** Runs on this computer (local Ollama, a local OpenAI-compatible server): no cloud icon. */
  local?: boolean;
}

/** "1M", "200K", "128K" */
const tokens = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`);

export const ModelSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { installedModels, runningModels, selectedModel, selectModel, connectionStatus, fetchModels, isRefreshing, cloudModels, refreshCloud, cloudLoading } =
    useModelStore();

  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const c = t.cloud;
  const { openModels, openSettings } = useUIStore();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const chosen = (settings.cloud || DEFAULT_SETTINGS.cloud).visibleModels;
  const groups = useMemo<Group[]>(() => {
    const runningSet = new Set(runningModels.map((m) => m.name));
    const localItem = (m: (typeof installedModels)[number]): Item => {
      const paramLabel = formatParameterSize(m.details?.parameter_size);
      const cloud = isOllamaCloudTag(m.name) || !!m.remote_host;
      return {
        value: m.name,
        name: m.name,
        detail: cloud ? format(c.runsAt, { company: 'ollama.com' }) : `${paramLabel ? `${paramLabel} · ` : ''}${formatBytes(m.size)}`,
        cloud,
        running: runningSet.has(m.name) && !cloud,
      };
    };
    const local = installedModels.map(localItem);
    const providerGroup = (provider: CloudProviderId, label: string): Group => {
      const shown = visibleIds(provider, cloudModels, chosen);
      const items: Item[] = [];
      const hidden: Item[] = [];
      for (const m of cloudModels) {
        if (m.provider !== provider) continue;
        const item: Item = {
          value: formatModelRef(provider, m.id),
          name: m.id,
          detail: [m.label !== m.id ? m.label : '', m.parameterSize || '', m.contextWindow ? `${tokens(m.contextWindow)} ${t.models.contextShort.toLowerCase()}` : '']
            .filter(Boolean)
            .join(' · '),
          cloud: true,
        };
        // The selected model is always listed, even when it is hidden in the settings.
        (shown.has(m.id) || item.value === selectedModel ? items : hidden).push(item);
      }
      return { id: provider, label, items, hidden, local: isCompatProvider(provider) && !cloudOwner(formatModelRef(provider, 'x')) };
    };
    const servers = Array.from(new Set(cloudModels.map((m) => m.provider).filter(isCompatProvider)));
    return [
      { id: 'local', label: c.groupLocal, items: local.filter((i) => !i.cloud), hidden: [], local: true },
      { id: 'ollama-local-cloud', label: c.groupOllamaThroughOllama, items: local.filter((i) => i.cloud), hidden: [] },
      providerGroup('ollama-cloud', c.groupOllamaCloud),
      providerGroup('anthropic', c.groupAnthropic),
      providerGroup('openai', c.groupOpenAI),
      providerGroup('gemini', c.groupGemini),
      providerGroup('mistral', c.groupMistral),
      ...servers.map((provider) => providerGroup(provider, providerName(provider))),
    ].filter((g) => g.items.length > 0 || g.hidden.length > 0);
  }, [installedModels, runningModels, cloudModels, chosen, selectedModel, c, t.models.contextShort]);

  const total = groups.reduce((n, g) => n + g.items.length + g.hidden.length, 0);
  const q = query.trim().toLowerCase();
  // Searching also finds the models hidden in the settings.
  const visible = q
    ? groups
        .map((g) => ({ ...g, items: [...g.items, ...g.hidden].filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(q)), hidden: [] }))
        .filter((g) => g.items.length > 0)
    : groups;
  const selectedOwner = selectedModel ? cloudOwner(selectedModel) : null;
  const showStatusDot = connectionStatus !== 'connected' && !selectedOwner;

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Selector Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={selectedOwner ? format(c.runsAt, { company: providerCompany(selectedOwner) }) : undefined}
        className={cn(
          'inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded border transition-colors cursor-pointer',
          'bg-zinc-800/80 hover:bg-zinc-700/80 border-zinc-700/60 text-zinc-200'
        )}
      >
        {/* Only a problem is worth a dot: connecting or no connection to the local Ollama */}
        {showStatusDot && (
          <span
            className={cn('w-1.5 h-1.5 rounded-full shrink-0', connectionStatus === 'connecting' ? 'bg-amber-500' : 'bg-red-500')}
            title={connectionStatus === 'connecting' ? t.common.connecting : t.common.disconnected}
          />
        )}
        {selectedOwner && <Cloud size={12} className="text-sky-400 shrink-0" strokeWidth={1.75} aria-label={c.badge} />}

        <span className="font-mono truncate max-w-[160px]">{selectedModel ? modelShortName(selectedModel) : t.modelSelector.selectModel}</span>

        <ChevronDown size={13} className="text-zinc-400 shrink-0" strokeWidth={1.5} />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-80 rounded-md bg-zinc-900 border border-zinc-800 shadow-xl z-50 py-1.5 text-xs">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-400 font-medium text-[11px] border-b border-zinc-800/60 mb-1">
            <span>{cloudModels.length > 0 ? c.selectorTitle : t.modelSelector.installedModels}</span>
            <button
              type="button"
              onClick={() => {
                void fetchModels();
                void refreshCloud();
              }}
              disabled={isRefreshing || cloudLoading}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-40 cursor-pointer"
              title={t.modelSelector.refresh}
            >
              <RefreshCw size={11} className={cn((isRefreshing || cloudLoading) && 'animate-spin')} strokeWidth={1.5} />
            </button>
          </div>

          {total > 10 && (
            <label className="relative block px-2 pb-1.5">
              <Search size={12} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-[60%] text-zinc-500 pointer-events-none" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={c.searchModels}
                aria-label={c.searchModels}
                className="w-full h-7 pl-7 pr-2 rounded bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </label>
          )}

          {/* Model List */}
          <div className="max-h-[min(60vh,30rem)] overflow-y-auto">
            {total === 0 ? (
              <div className="px-3 py-4 text-center text-zinc-500 text-xs">
                {connectionStatus === 'disconnected' ? (
                  <div className="flex flex-col items-center gap-1.5 text-red-400">
                    <AlertCircle size={14} strokeWidth={1.5} />
                    <span>{t.common.disconnected}</span>
                  </div>
                ) : (
                  <span>{t.modelSelector.noModels}</span>
                )}
              </div>
            ) : (
              visible.map((group) => (
                <div key={group.id} role="group" aria-label={group.label}>
                  {(groups.length > 1 || group.id !== 'local') && (
                    <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-zinc-500 flex items-center gap-1.5">
                      {!group.local && <Cloud size={11} strokeWidth={1.75} className="text-sky-400/80" />}
                      {group.label}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const isSelected = item.value === selectedModel;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          selectModel(item.value);
                          setIsOpen(false);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer',
                          isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/50'
                        )}
                      >
                        <div className="flex flex-col truncate mr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-medium truncate">{item.name}</span>
                            {item.running && <span className="text-[11px] font-sans font-normal text-zinc-500 shrink-0">{t.models.activeStatus}</span>}
                          </div>
                          {item.detail && <span className="text-[11px] text-zinc-500 mt-0.5 truncate">{item.detail}</span>}
                        </div>

                        {isSelected && <Check size={14} className="text-zinc-200 shrink-0" strokeWidth={1.5} />}
                      </button>
                    );
                  })}
                  {group.hidden.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        openSettings('cloud');
                      }}
                      className="w-full text-left px-3 pb-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      {format(c.moreModels, { count: group.hidden.length })}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Separator */}
          <div className="border-t border-zinc-800 my-1" />

          {/* Action Links */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openModels('discover');
            }}
            className="w-full text-left px-3 py-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Download size={13} strokeWidth={1.5} />
            <span>{t.modelSelector.downloadModel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openSettings('cloud');
            }}
            className="w-full text-left px-3 py-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Cloud size={13} strokeWidth={1.5} />
            <span>{c.addCloudModels}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openModels('installed');
            }}
            className="w-full text-left px-3 py-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Layers size={13} strokeWidth={1.5} />
            <span>{t.modelSelector.manageModels}</span>
          </button>
        </div>
      )}
    </div>
  );
};
