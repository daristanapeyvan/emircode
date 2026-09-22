import React from 'react';
import { Modal } from '../common/Modal';
import { Tabs } from '../common/Tabs';
import { InstalledTab } from './InstalledTab';
import { DiscoverTab } from './DiscoverTab';
import { RunningTab } from './RunningTab';
import { useUIStore, ModelsTab } from '@/stores/uiStore';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const ModelManagerModal: React.FC = () => {
  const { isModelsOpen, closeModels, modelsTab, openModels } = useUIStore();
  const { installedModels, runningModels } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const tabs = [
    { id: 'installed', label: t.models.installedTab, count: installedModels.length },
    { id: 'discover', label: t.models.discoverTab },
    { id: 'running', label: t.models.runningTab, count: runningModels.length },
  ];

  return (
    <Modal
      isOpen={isModelsOpen}
      onClose={closeModels}
      title={t.models.title}
      width="max-w-3xl"
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
