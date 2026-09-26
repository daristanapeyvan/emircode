import React from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { DEFAULT_SETTINGS } from '@/types/settings';

export const WebAccessSettings: React.FC = () => {
  const { settings, setWebAccess } = useSettingsStore();
  const t = getTranslations(settings.language);
  const webAccess = settings.webAccess || DEFAULT_SETTINGS.webAccess;
  const isGlobalEnabled = webAccess.enabled;

  return (
    <div>
      <SettingsRow label={t.settings.internetAccess} description={t.settings.internetAccessDesc}>
        <Toggle checked={isGlobalEnabled} onChange={(checked) => setWebAccess({ enabled: checked })} />
      </SettingsRow>

      <SettingsRow label={t.settings.chatSearch} description={t.settings.chatSearchDesc} className={!isGlobalEnabled ? 'opacity-50' : undefined}>
        <Toggle checked={webAccess.chatEnabled} disabled={!isGlobalEnabled} onChange={(checked) => setWebAccess({ chatEnabled: checked })} />
      </SettingsRow>

      <SettingsRow label={t.settings.codingSearch} description={t.settings.codingSearchDesc} className={!isGlobalEnabled ? 'opacity-50' : undefined}>
        <Toggle checked={webAccess.codingEnabled} disabled={!isGlobalEnabled} onChange={(checked) => setWebAccess({ codingEnabled: checked })} />
      </SettingsRow>
    </div>
  );
};
