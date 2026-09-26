import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Download, Layers, AlertCircle, RefreshCw } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes, formatParameterSize } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';

export const ModelSelector: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    installedModels,
    runningModels,
    selectedModel,
    selectModel,
    connectionStatus,
    fetchModels,
    isRefreshing,
  } = useModelStore();

  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const { openModels } = useUIStore();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runningSet = new Set(runningModels.map((m) => m.name));

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Selector Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded border transition-colors cursor-pointer',
          'bg-zinc-800/80 hover:bg-zinc-700/80 border-zinc-700/60 text-zinc-200'
        )}
      >
        {/* Only a problem is worth a dot: connecting or no connection */}
        {connectionStatus !== 'connected' && (
          <span
            className={cn('w-1.5 h-1.5 rounded-full shrink-0', connectionStatus === 'connecting' ? 'bg-amber-500' : 'bg-red-500')}
            title={connectionStatus === 'connecting' ? t.common.connecting : t.common.disconnected}
          />
        )}

        <span className="font-mono truncate max-w-[140px]">
          {selectedModel || t.modelSelector.selectModel}
        </span>

        <ChevronDown size={13} className="text-zinc-400 shrink-0" strokeWidth={1.5} />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-72 rounded-md bg-zinc-900 border border-zinc-800 shadow-xl z-50 py-1.5 text-xs">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 text-zinc-400 font-medium text-[11px] border-b border-zinc-800/60 mb-1">
            <span>{t.modelSelector.installedModels}</span>
            <button
              type="button"
              onClick={() => fetchModels()}
              disabled={isRefreshing}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-40 cursor-pointer"
              title={t.modelSelector.refresh}
            >
              <RefreshCw size={11} className={cn(isRefreshing && 'animate-spin')} strokeWidth={1.5} />
            </button>
          </div>

          {/* Model List */}
          <div className="max-h-60 overflow-y-auto">
            {installedModels.length === 0 ? (
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
              installedModels.map((m) => {
                const isSelected = m.name === selectedModel;
                const isRunning = runningSet.has(m.name);
                const paramLabel = formatParameterSize(m.details?.parameter_size);
                const sizeLabel = formatBytes(m.size);

                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => {
                      selectModel(m.name);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer',
                      isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/50'
                    )}
                  >
                    <div className="flex flex-col truncate mr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-medium truncate">{m.name}</span>
                        {isRunning && (
                          <span className="text-[11px] font-sans font-normal text-zinc-500 shrink-0">{t.models.activeStatus}</span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-0.5">
                        {paramLabel ? `${paramLabel} · ` : ''}{sizeLabel}
                      </span>
                    </div>

                    {isSelected && (
                      <Check size={14} className="text-zinc-200 shrink-0" strokeWidth={1.5} />
                    )}
                  </button>
                );
              })
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
