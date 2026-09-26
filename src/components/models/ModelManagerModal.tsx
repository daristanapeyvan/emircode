import React from 'react';
import { Modal } from '../common/Modal';
import { Tabs } from '../common/Tabs';
import { InstalledTab } from './InstalledTab';
import { DiscoverTab } from './DiscoverTab';
import { RunningTab } from './RunningTab';
import { useUIStore, ModelsTab } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const ModelManagerModal: React.FC = () => {
  const { isModelsOpen, closeModels, modelsTab, openModels } = useUIStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const tabs = [
    { id: 'installed', label: t.models.installedTab },
    { id: 'discover', label: t.models.discoverTab },
    { id: 'running', label: t.models.runningTab },
  ];

  return (
    <Modal
      isOpen={isModelsOpen}
      onClose={closeModels}
      title={t.models.title}
      width="max-w-4xl"
    >
      <div className="space-y-4">
        <Tabs
          tabs={tabs}
          activeTab={modelsTab}
          onChange={(id) => openModels(id as ModelsTab)}
        />

        <div className="pt-1">
          {modelsTab === 'installed' && <InstalledTab />}
          {modelsTab === 'discover' && <DiscoverTab />}
          {modelsTab === 'running' && <RunningTab />}
        </div>
      </div>
    </Modal>
  );
};
