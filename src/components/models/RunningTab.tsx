import React from 'react';
import { RefreshCw, Square, CheckCircle, Cpu } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { formatBytes } from '@/lib/utils/formatters';
import { Button } from '../common/Button';

export const RunningTab: React.FC = () => {
  const { runningModels, fetchRunning, unloadModel, isRefreshing } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const handleUnload = async (name: string) => {
    try {
      await unloadModel(name);
    } catch (err: any) {
      alert(`Failed to unload: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">
          Models actively residing in memory (RAM/VRAM)
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={isRefreshing}
          icon={<RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} strokeWidth={1.5} />}
          onClick={() => fetchRunning()}
        >
          {t.common.retry}
        </Button>
      </div>

      {/* Running List */}
      <div className="space-y-2">
        {runningModels.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 space-y-2">
            <CheckCircle size={20} className="mx-auto text-zinc-600" strokeWidth={1.5} />
            <p>{t.models.noRunningModels}</p>
          </div>
        ) : (
          runningModels.map((m) => {
            const memorySize = formatBytes(m.size);
            const vramSize = m.size_vram > 0 ? formatBytes(m.size_vram) : 'CPU';

            return (
              <div
                key={m.name}
                className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/60 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-mono font-medium text-sm text-zinc-100">
                      {m.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-zinc-400 text-[11px] font-mono">
                    <span>RAM: {memorySize}</span>
                    <span>·</span>
                    <span>VRAM: {vramSize}</span>
                    {m.context_length && (
                      <>
                        <span>·</span>
                        <span>Ctx: {m.context_length}</span>
                      </>
                    )}
                  </div>
                </div>

                <Button
                  variant="danger"
                  size="sm"
                  icon={<Square size={12} strokeWidth={1.5} />}
                  onClick={() => handleUnload(m.name)}
                >
                  {t.common.unload}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
