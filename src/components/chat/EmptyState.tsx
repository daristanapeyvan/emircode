import React from 'react';
import { Download, MessageSquare } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';
import { StartIcon } from '../common/StartIcon';

/** The start of a chat: the mode's icon, a greeting and the model that will answer. Without a model, the way to get one. */
export const EmptyState: React.FC = () => {
  const { installedModels, connectionStatus, selectedModel } = useModelStore();
  const { settings } = useSettingsStore();
  const { openModels } = useUIStore();
  const t = getTranslations(settings.language);

  // Without a connection the banner above explains what is wrong.
  if (connectionStatus !== 'connected') return null;

  if (installedModels.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center select-none">
        <StartIcon icon={<MessageSquare size={22} strokeWidth={1.5} />} />
        <p className="text-xs text-zinc-400">{t.chat.noModelsInstalled}</p>
        <Button variant="primary" size="sm" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => openModels('discover')}>
          {t.chat.downloadModelAction}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center select-none">
      <StartIcon icon={<MessageSquare size={22} strokeWidth={1.5} />} />
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-zinc-100">{t.chat.emptyHeading}</h2>
        {selectedModel && <p className="text-xs text-zinc-500">{t.chat.emptyModelLine.replace('{model}', selectedModel)}</p>}
      </div>
    </div>
  );
};
