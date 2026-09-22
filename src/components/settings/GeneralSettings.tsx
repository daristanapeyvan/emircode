import React from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '../common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Language, SecurityProfile } from '@/types/settings';

export const GeneralSettings: React.FC = () => {
  const { settings, updateSettings, setLanguage } = useSettingsStore();
  const t = getTranslations(settings.language);

  return (
    <div className="space-y-1">
      <SettingsRow
        label={t.settings.language}
        description={t.settings.languageDesc}
      >
        <select
          value={settings.language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="system">{t.settings.languageSystem}</option>
          <option value="tr">Türkçe</option>
          <option value="en">English</option>
        </select>
      </SettingsRow>

      <SettingsRow
        label={t.settings.securityProfile || 'Güvenlik Profili'}
        description={t.settings.securityProfileDesc || 'Ajanın dosya düzenleme ve komut onay seviyesi'}
      >
        <select
          value={settings.securityProfile || 'strict'}
          onChange={(e) => updateSettings({ securityProfile: e.target.value as SecurityProfile })}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="strict">{t.settings.securityStrict || 'Sıkı (Her işlemde onay sorar)'}</option>
          <option value="balanced">{t.settings.securityBalanced || 'Dengeli (Güvenli dosya düzenlemelerini otomatik onaylar)'}</option>
          <option value="autonomous">{t.settings.securityAutonomous || 'Otonom (Düzenleme ve test komutlarını otomatik yürütür)'}</option>
        </select>
      </SettingsRow>

      <SettingsRow
        label={t.settings.circuitBreaker || 'Ajan Devre Kesici Süresi'}
        description={t.settings.circuitBreakerDesc || 'Ajanın bir görevde aktif çalışabileceği maksimum süre'}
      >
        <select
          value={settings.circuitBreakerMinutes || 30}
          onChange={(e) => updateSettings({ circuitBreakerMinutes: Number(e.target.value) })}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value={30}>{t.settings.minutes30 || '30 Dakika (Önerilen)'}</option>
          <option value={45}>{t.settings.minutes45 || '45 Dakika'}</option>
          <option value={60}>{t.settings.minutes60 || '60 Dakika (1 Saat)'}</option>
          <option value={120}>{t.settings.minutes120 || '120 Dakika (2 Saat)'}</option>
        </select>
      </SettingsRow>

      <SettingsRow
        label={t.settings.confirmDestructive}
        description={t.settings.confirmDestructiveDesc}
      >
        <Toggle
          checked={settings.confirmDestructive}
          onChange={(checked) => updateSettings({ confirmDestructive: checked })}
        />
      </SettingsRow>

      <SettingsRow
        label="Sistem ve Model Kurulum Sihirbazı"
        description="Ollama, Node.js gereksinimlerini kontrol edin veya yerel model seçim sihirbazını yeniden açın"
      >
        <button
          onClick={() => {
            localStorage.removeItem('emir_code_onboarding_completed');
            window.location.reload();
          }}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
        >
          Sihirbazı Aç
        </button>
      </SettingsRow>
    </div>
  );
};
