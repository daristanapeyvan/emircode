import React from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Theme, FontSize } from '@/types/settings';

export const AppearanceSettings: React.FC = () => {
  const { settings, setTheme, setFontSize, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);

  return (
    <div className="space-y-1">
      <SettingsRow
        label={t.settings.theme}
        description={t.settings.themeDesc}
      >
        <select
          value={settings.theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="dark">{t.settings.themeDark}</option>
          <option value="light">{t.settings.themeLight}</option>
        </select>
      </SettingsRow>

      <SettingsRow
        label={t.settings.fontSize}
        description={t.settings.fontSizeDesc}
      >
        <select
          value={settings.fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="sm">Compact (13px)</option>
          <option value="base">Standard (14px)</option>
          <option value="lg">Spacious (15px)</option>
        </select>
      </SettingsRow>

      <SettingsRow
        label={t.settings.reducedMotion}
        description={t.settings.reducedMotionDesc}
      >
        <Toggle
          checked={settings.reducedMotion}
          onChange={(checked) => updateSettings({ reducedMotion: checked })}
        />
      </SettingsRow>
    </div>
  );
};
