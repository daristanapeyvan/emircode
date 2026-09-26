import React from 'react';
import { Select } from '@/components/common/Select';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { Button } from '../common/Button';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Language, SecurityProfile } from '@/types/settings';

export const GeneralSettings: React.FC = () => {
  const { settings, updateSettings, setLanguage } = useSettingsStore();
  const t = getTranslations(settings.language);
  const securityProfile = settings.securityProfile || 'strict';
  const securityHint =
    securityProfile === 'autonomous'
      ? t.agent.securityHintAutonomous
      : securityProfile === 'balanced'
      ? t.agent.securityHintBalanced
      : t.agent.securityHintStrict;

  return (
    <div>
      <SettingsRow label={t.settings.language}>
        <Select
          ariaLabel={t.settings.language}
          value={settings.language}
          onChange={(v) => setLanguage(v as Language)}
          options={[
            { value: 'system', label: t.settings.languageSystem },
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.securityProfile} description={securityHint}>
        <Select
          ariaLabel={t.settings.securityProfile}
          value={securityProfile}
          onChange={(v) => updateSettings({ securityProfile: v as SecurityProfile })}
          options={[
            { value: 'strict', label: t.agent.securityProfileStrict },
            { value: 'balanced', label: t.agent.securityProfileBalanced },
            { value: 'autonomous', label: t.agent.securityProfileAutonomous },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.circuitBreaker} description={t.settings.circuitBreakerDesc}>
        <Select
          ariaLabel={t.settings.circuitBreaker}
          value={settings.circuitBreakerMinutes || 30}
          onChange={(v) => updateSettings({ circuitBreakerMinutes: v })}
          options={[
            { value: 30, label: t.settings.minutes30 },
            { value: 45, label: t.settings.minutes45 },
            { value: 60, label: t.settings.minutes60 },
            { value: 120, label: t.settings.minutes120 },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.confirmDestructive} description={t.settings.confirmDestructiveDesc}>
        <Toggle checked={settings.confirmDestructive} onChange={(checked) => updateSettings({ confirmDestructive: checked })} />
      </SettingsRow>

      <SettingsRow label={t.settings.setupWizard} description={t.settings.setupWizardDesc}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            localStorage.removeItem('emir_code_onboarding_completed');
            window.location.reload();
          }}
        >
          {t.settings.setupWizardOpen}
        </Button>
      </SettingsRow>
    </div>
  );
};
