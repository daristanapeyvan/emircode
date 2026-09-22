import React from 'react';
import { Download } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';
import { AppLogo } from '../common/AppLogo';

export const EmptyState: React.FC = () => {
  const { installedModels, selectedModel, connectionStatus } = useModelStore();
  const { settings } = useSettingsStore();
  const { openModels } = useUIStore();
  const t = getTranslations(settings.language);

  const hasModels = installedModels.length > 0;

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center select-none max-w-md mx-auto my-auto animate-in fade-in duration-300">
      <div className="mb-4">
        <AppLogo size={42} />
      </div>

      <h3 className="text-sm font-semibold text-zinc-100 mb-1.5 tracking-tight">
        {t.chat.emptyTitle}
      </h3>

      <p className="text-xs text-zinc-400 max-w-sm leading-relaxed mb-5">
        {t.chat.emptySubtitle}
      </p>

      {!hasModels && connectionStatus === 'connected' && (
        <Button
          variant="primary"
          size="sm"
          icon={<Download size={14} strokeWidth={1.5} />}
          onClick={() => openModels('discover')}
        >
          {t.chat.downloadModelAction}
        </Button>
      )}

      {hasModels && selectedModel && (
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/60 text-[11px] font-mono text-zinc-300 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>{selectedModel}</span>
        </div>
      )}
    </div>
  );
};
