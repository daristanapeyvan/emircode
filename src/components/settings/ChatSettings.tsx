import React from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const ChatSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);

  return (
    <div className="space-y-1">
      <SettingsRow
        label={t.settings.sendOnEnter}
        description={t.settings.sendOnEnterDesc}
      >
        <Toggle
          checked={settings.sendOnEnter}
          onChange={(checked) => updateSettings({ sendOnEnter: checked })}
        />
      </SettingsRow>

      <SettingsRow
        label={t.settings.showMetadata}
        description={t.settings.showMetadataDesc}
      >
        <Toggle
          checked={settings.showMetadata}
          onChange={(checked) => updateSettings({ showMetadata: checked })}
        />
      </SettingsRow>

      <SettingsRow
        label={t.settings.autoTitles}
        description={t.settings.autoTitlesDesc}
      >
        <Toggle
          checked={settings.autoGenerateTitles}
          onChange={(checked) => updateSettings({ autoGenerateTitles: checked })}
        />
      </SettingsRow>
    </div>
  );
};
