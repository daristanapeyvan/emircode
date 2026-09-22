import React, { useState } from 'react';
import { MessageSquare, Info, Star, Trash2, Search } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes, formatParameterSize } from '@/lib/utils/formatters';
import { Button } from '../common/Button';
import { cn } from '@/lib/utils/cn';

export const InstalledTab: React.FC = () => {
  const [search, setSearch] = useState('');

  const {
    installedModels,
    runningModels,
    selectedModel,
    selectModel,
    deleteModel,
  } = useModelStore();

  const { settings, updateSettings } = useSettingsStore();
  const { createNewChat } = useChatStore();
  const { closeModels, openModelDetails } = useUIStore();
  const t = getTranslations(settings.language);

  const runningSet = new Set(runningModels.map((m) => m.name));

  const filtered = installedModels.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase().trim())
  );

  const handleStartChat = (modelName: string) => {
    selectModel(modelName);
    createNewChat(modelName);
    closeModels();
  };

  const handleSetDefault = (modelName: string) => {
    updateSettings({ defaultModel: modelName });
  };

  const handleDelete = async (modelName: string) => {
    if (settings.confirmDestructive) {
      const confirmMsg = t.models.deleteConfirm.replace('{name}', modelName);
      if (window.confirm(confirmMsg)) {
        await deleteModel(modelName);
      }
    } else {
      await deleteModel(modelName);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Search filter */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-2.5 text-zinc-500 pointer-events-none" strokeWidth={1.5} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.models.searchPlaceholder}
          className="w-full h-8 pl-8 pr-3 rounded bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
        />
      </div>

      {/* Models List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            {t.models.noInstalledModels}
          </div>
        ) : (
          filtered.map((m) => {
            const isRunning = runningSet.has(m.name);
            const isDefault = settings.defaultModel === m.name;
            const isSelected = selectedModel === m.name;
            const paramLabel = formatParameterSize(m.details?.parameter_size);

            return (
              <div
                key={m.name}
                className={cn(
                  'p-3.5 rounded-lg border bg-zinc-950/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3',
                  isSelected ? 'border-blue-500/40 bg-blue-950/10' : 'border-zinc-800/40 hover:border-zinc-700/50'
                )}
              >
                {/* Model Info */}
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-sm text-zinc-100 truncate">
                      {m.name}
                    </span>

                    {isRunning && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800/60 text-emerald-400 font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {t.models.activeStatus}
                      </span>
                    )}

                    {isDefault && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-950 border border-blue-800/60 text-blue-400 font-medium">
                        {t.models.defaultBadge}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-zinc-500 text-[11px] font-mono">
                    {paramLabel && <span>{paramLabel}</span>}
                    {paramLabel && <span>·</span>}
                    <span>{formatBytes(m.size)}</span>
                    {m.details?.quantization_level && (
                      <>
                        <span>·</span>
                        <span>{m.details.quantization_level}</span>
                      </>
                    )}
                    {m.details?.family && (
                      <>
                        <span>·</span>
                        <span>{m.details.family}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<MessageSquare size={13} strokeWidth={1.5} />}
                    onClick={() => handleStartChat(m.name)}
                  >
                    Chat
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Info size={13} strokeWidth={1.5} />}
                    onClick={() => openModelDetails(m.name)}
                  >
                    {t.common.details}
                  </Button>

                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(m.name)}
                      title={t.models.setDefault}
                      className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Star size={14} strokeWidth={1.5} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(m.name)}
                    title={t.common.delete}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
