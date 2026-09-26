import React, { useEffect, useState } from 'react';
import { MessageSquare, Info, Star, Trash2, Search } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useModelLibraryStore } from '@/stores/modelLibraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes, formatParameterSize } from '@/lib/utils/formatters';
import { IconButton } from '../common/IconButton';
import { confirmDialog } from '@/lib/ui/dialogs';
import { inputClass } from '../agent/wizard/wizardUi';
import { cn } from '@/lib/utils/cn';

export const InstalledTab: React.FC = () => {
  const [search, setSearch] = useState('');

  const { installedModels, runningModels, selectModel, deleteModel, pullModel, downloads } = useModelStore();
  const { installed: registryState, checkInstalledModels } = useModelLibraryStore();

  // Every installed model is compared with the Ollama registry on its own: up to date or an update.
  const digests = installedModels.map((m) => `${m.name}@${m.digest}`).join(',');
  useEffect(() => {
    void checkInstalledModels(installedModels.map((m) => ({ name: m.name, digest: m.digest })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digests, checkInstalledModels]);

  const { settings, updateSettings } = useSettingsStore();
  const { createNewChat } = useChatStore();
  const { closeModels, openModelDetails } = useUIStore();
  const t = getTranslations(settings.language);

  const runningSet = new Set(runningModels.map((m) => m.name));

  const filtered = installedModels.filter((m) => m.name.toLowerCase().includes(search.toLowerCase().trim()));

  const handleStartChat = (modelName: string) => {
    selectModel(modelName);
    createNewChat(modelName);
    closeModels();
  };

  const handleDelete = async (modelName: string) => {
    if (
      settings.confirmDestructive &&
      !(await confirmDialog({ title: t.models.deleteModelTitle, message: t.models.deleteConfirm.replace('{name}', modelName), confirmLabel: t.common.delete, danger: true }))
    )
      return;
    await deleteModel(modelName);
  };

  return (
    <div className="space-y-3 text-xs">
      <label className="relative block">
        <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.models.searchPlaceholder}
          aria-label={t.models.searchPlaceholder}
          className={cn(inputClass, 'pl-8')}
        />
      </label>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-zinc-500">{t.models.noInstalledModels}</p>
      ) : (
        <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
          {filtered.map((m) => {
            const isDefault = settings.defaultModel === m.name;
            const paramLabel = formatParameterSize(m.details?.parameter_size);
            const registry = registryState[m.name.includes(':') ? m.name : `${m.name}:latest`];
            const status = [
              isDefault ? t.models.defaultBadge : '',
              runningSet.has(m.name) ? t.models.activeStatus : '',
              registry === 'match' ? t.models.upToDate : '',
            ].filter(Boolean);
            const meta = [paramLabel, formatBytes(m.size), m.details?.quantization_level, m.details?.family].filter(Boolean);

            return (
              <div key={m.name} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800/30 transition-colors">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[13px] text-zinc-100 truncate">{m.name}</span>
                    {status.length > 0 && <span className="text-[11px] text-zinc-500 shrink-0">{status.join(' · ')}</span>}
                    {registry === 'differs' && (
                      <span className="text-[11px] text-amber-400/90 shrink-0" title={t.models.updateAvailableTitle}>
                        {t.models.updateAvailable}
                        {downloads[m.name] ? (
                          <span className="ml-1 tabular-nums">{downloads[m.name].percentage}%</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void pullModel(m.name).catch(() => {})}
                            className="ml-1.5 underline underline-offset-2 hover:text-amber-300 cursor-pointer"
                          >
                            {t.models.update}
                          </button>
                        )}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 font-mono truncate">{meta.join(' · ')}</p>
                </div>

                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <IconButton label={t.models.startChat} icon={<MessageSquare size={14} strokeWidth={1.5} />} size="sm" onClick={() => handleStartChat(m.name)} />
                  <IconButton label={t.common.details} icon={<Info size={14} strokeWidth={1.5} />} size="sm" onClick={() => openModelDetails(m.name)} />
                  <IconButton
                    label={t.models.setDefault}
                    icon={<Star size={14} strokeWidth={1.5} />}
                    size="sm"
                    disabled={isDefault}
                    className={cn(isDefault && 'invisible')}
                    onClick={() => updateSettings({ defaultModel: m.name })}
                  />
                  <IconButton label={t.common.delete} icon={<Trash2 size={14} strokeWidth={1.5} />} size="sm" variant="danger" onClick={() => handleDelete(m.name)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
