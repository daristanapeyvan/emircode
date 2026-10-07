import React from 'react';
import { Cloud, Download, MessageSquare } from 'lucide-react';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Button } from '../common/Button';
import { StartIcon } from '../common/StartIcon';
import { PROVIDER_COMPANIES, cloudOwner, isCloudRef, modelShortName } from '@/lib/providers/modelRef';
import { format } from '@/lib/localization/i18n';

/** The start of a chat: the mode's icon, a greeting and the model that will answer. Without a model, the way to get one. */
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
        <StartIcon icon={<MessageSquare size={22} strokeWidth={1.5} />} />
        <p className="text-xs text-zinc-400">{t.cloud.noLocalNoCloud}</p>
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
    <div className="flex flex-col items-center gap-4 text-center select-none">
      <StartIcon icon={<MessageSquare size={22} strokeWidth={1.5} />} />
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-zinc-100">{t.chat.emptyHeading}</h2>
        {selectedModel && (
          <p className="text-xs text-zinc-500">
            {cloudOwner(selectedModel)
              ? format(t.cloud.emptyModelLineCloud, { model: modelShortName(selectedModel), company: PROVIDER_COMPANIES[cloudOwner(selectedModel)!] })
              : t.chat.emptyModelLine.replace('{model}', selectedModel)}
          </p>
        )}
      </div>
    </div>
  );
};
