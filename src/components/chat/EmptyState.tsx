import React from 'react';
import { Cloud, Download } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';
import { isCloudRef } from '@/lib/providers/modelRef';

/** The start of a chat: a greeting (the model selector above says which model answers). Without a model, the way to get one. */
export const EmptyState: React.FC = () => {
  const { installedModels, connectionStatus, selectedModel, cloudModels } = useModelStore();
  const { settings } = useSettingsStore();
  const { openModels, openSettings } = useUIStore();
  const t = getTranslations(settings.language);
  const cloudSelected = isCloudRef(selectedModel);

  // Without a connection the banner above explains what is wrong (a cloud model does not need Ollama).
  if (connectionStatus !== 'connected' && !cloudSelected && cloudModels.length === 0) return null;

  if (installedModels.length === 0 && cloudModels.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 text-center select-none">
        <p className="text-sm text-zinc-400">{t.cloud.noLocalNoCloud}</p>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" icon={<Download size={14} strokeWidth={1.5} />} onClick={() => openModels('discover')}>
            {t.chat.downloadModelAction}
          </Button>
          <Button variant="secondary" size="sm" icon={<Cloud size={14} strokeWidth={1.5} />} onClick={() => openSettings('cloud')}>
            {t.cloud.addCloudModels}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <h2 className="text-2xl font-medium tracking-tight text-zinc-200 text-center select-none">{t.chat.emptyHeading}</h2>
  );
};
