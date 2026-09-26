import React from 'react';
import { Select } from '@/components/common/Select';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Theme, FontSize } from '@/types/settings';

export const AppearanceSettings: React.FC = () => {
  const { settings, setTheme, setFontSize, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);

  return (
    <div>
      <SettingsRow label={t.settings.theme}>
        <Select
          ariaLabel={t.settings.theme}
          value={settings.theme}
          onChange={(v) => setTheme(v as Theme)}
          options={[
            { value: 'dark', label: t.settings.themeDark },
            { value: 'light', label: t.settings.themeLight },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.fontSize} description={t.settings.fontSizeDesc}>
        <Select
          ariaLabel={t.settings.fontSize}
          value={settings.fontSize}
          onChange={(v) => setFontSize(v as FontSize)}
          options={[
            { value: 'sm', label: t.settings.fontSmall },
            { value: 'base', label: t.settings.fontMedium },
            { value: 'lg', label: t.settings.fontLarge },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.reducedMotion} description={t.settings.reducedMotionDesc}>
        <Toggle checked={settings.reducedMotion} onChange={(checked) => updateSettings({ reducedMotion: checked })} />
      </SettingsRow>
    </div>
  );
};
