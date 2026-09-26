import React from 'react';
import { RefreshCw, Square } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes } from '@/lib/utils/formatters';
import { Button } from '../common/Button';
import { noticeDialog } from '@/lib/ui/dialogs';

export const RunningTab: React.FC = () => {
  const { runningModels, fetchRunning, unloadModel, isRefreshing } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const handleUnload = async (name: string) => {
    try {
      await unloadModel(name);
    } catch (err: any) {
      void noticeDialog({ title: t.models.unloadFailed, message: err?.message || String(err) });
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={isRefreshing}
          icon={<RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} strokeWidth={1.5} />}
          onClick={() => fetchRunning()}
        >
          {t.models.refresh}
        </Button>
      </div>

      {runningModels.length === 0 ? (
        <p className="py-10 text-center text-zinc-500">{t.models.noRunningModels}</p>
      ) : (
        <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
          {runningModels.map((m) => (
            <div key={m.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <p className="font-mono text-[13px] text-zinc-100 truncate">{m.name}</p>
                <p className="text-[11px] text-zinc-500 font-mono">
                  {[
                    `RAM ${formatBytes(m.size)}`,
                    `VRAM ${m.size_vram > 0 ? formatBytes(m.size_vram) : '—'}`,
                    m.context_length ? `${t.models.contextShort} ${m.context_length}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Button variant="secondary" size="sm" icon={<Square size={12} strokeWidth={1.5} />} onClick={() => handleUnload(m.name)}>
                {t.common.unload}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
