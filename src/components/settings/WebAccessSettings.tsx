import React from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const WebAccessSettings: React.FC = () => {
  const { settings, setWebAccess } = useSettingsStore();
  const t = getTranslations(settings.language);
  const webAccess = settings.webAccess || {
    enabled: false,
    chatEnabled: false,
    codingEnabled: false,
  };

  const isGlobalEnabled = webAccess.enabled;

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {t.settings.webAccessTitle || 'WEB ACCESS'}
        </h3>
        <p className="text-[11px] text-zinc-500 mt-1">
          {t.settings.webAccessSubtitle || 'Configure online search and documentation lookup capabilities for local models.'}
        </p>
      </div>

      <div className="space-y-1">
        {/* Global Web Access */}
        <SettingsRow
          label={t.settings.internetAccess || 'Internet Access'}
          description={
            t.settings.internetAccessDesc ||
            'Allow the assistant to access the web when needed.'
          }
        >
          <Toggle
            checked={isGlobalEnabled}
            onChange={(checked) => setWebAccess({ enabled: checked })}
          />
        </SettingsRow>

        {/* Visual Separator */}
        <div className="border-b border-zinc-800/40 my-2" />

        {/* Chat Search Toggle */}
        <SettingsRow
          label={t.settings.chatSearch || 'Chat Search'}
          description={
            t.settings.chatSearchDesc || 'Allow web search during chat.'
          }
          className={!isGlobalEnabled ? 'opacity-50' : undefined}
        >
          <Toggle
            checked={webAccess.chatEnabled}
            disabled={!isGlobalEnabled}
            onChange={(checked) => setWebAccess({ chatEnabled: checked })}
          />
        </SettingsRow>

        {/* Coding Agent Search Toggle */}
        <SettingsRow
          label={t.settings.codingSearch || 'Coding Agent Search'}
          description={
            t.settings.codingSearchDesc ||
            'Allow the coding agent to research documentation online.'
          }
          className={!isGlobalEnabled ? 'opacity-50' : undefined}
        >
          <Toggle
            checked={webAccess.codingEnabled}
            disabled={!isGlobalEnabled}
            onChange={(checked) => setWebAccess({ codingEnabled: checked })}
          />
        </SettingsRow>
      </div>
    </div>
  );
};
