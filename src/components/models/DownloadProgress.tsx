import React from 'react';
import { X } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useModelLibraryStore } from '@/stores/modelLibraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes } from '@/lib/utils/formatters';
import { IconButton } from '../common/IconButton';

/** Downloads in progress, bottom right; not while a model page with its own progress bar is open. */
export const DownloadProgress: React.FC = () => {
  const { downloads, cancelPull } = useModelStore();
  const language = useSettingsStore((s) => s.settings.language);
  const onModelPage = useUIStore((s) => s.isModelsOpen && s.modelsTab === 'discover');
  const openModel = useModelLibraryStore((s) => s.openModel);
  const t = getTranslations(language);
  const downloadList = Object.values(downloads);

  if (downloadList.length === 0 || (onModelPage && openModel)) return null;

  return (
    <div className="fixed bottom-20 right-6 z-40 w-80 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-3 space-y-3 select-none text-xs">
      <p className="font-medium text-zinc-200">{t.models.downloadsTitle}</p>

      {downloadList.map((dl) => (
        <div key={dl.name} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-zinc-100 truncate">{dl.name}</span>
            <IconButton label={t.library.cancel} icon={<X size={13} strokeWidth={1.5} />} size="sm" onClick={() => cancelPull(dl.name)} />
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
            <div className="bg-zinc-400 h-full transition-all duration-200" style={{ width: `${dl.percentage}%` }} />
          </div>
          <p className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 tabular-nums">
            <span className="truncate">{dl.status}</span>
            <span className="shrink-0">
              {dl.total > 0 ? `${formatBytes(dl.completed)} / ${formatBytes(dl.total)}` : formatBytes(dl.completed)}
              {dl.speed ? ` · ${dl.speed}` : ''}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
};
