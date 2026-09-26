import React from 'react';
import { Select } from '@/components/common/Select';
import { SettingsRow, RangeControl } from './SettingsRow';
import { Toggle } from '@/components/common/Toggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { HardwareOptimizationProfile, DEFAULT_SETTINGS, WebSynthesisStrategy, ModificationStrategy } from '@/types/settings';
import { defaultContextForHardware } from '@/lib/ollama/ModelRuntime';

const CONTEXT_LENGTH_OPTIONS = [4096, 8192, 12288, 16384, 24576, 32768, 65536];
const PROFILES: HardwareOptimizationProfile[] = ['auto', 'low', 'balanced', 'high', 'custom'];

/** How the agent uses this computer and the model: context, output length, thinking, file strategies. */
export const AgentSettings: React.FC = () => {
  const { settings, setAgentOptimization, hardware } = useSettingsStore();
  const t = getTranslations(settings.language);
  const agentOpt = settings.agentOptimization || DEFAULT_SETTINGS.agentOptimization;

  const profileLabels: Record<HardwareOptimizationProfile, string> = {
    auto: t.settings.profileAuto,
    low: t.settings.profileLow,
    balanced: t.settings.profileBalanced,
    high: t.settings.profileHigh,
    custom: t.settings.profileCustom,
  };

  return (
    <div>
      <SettingsRow label={t.settings.hardwareProfile} description={t.settings.hardwareProfileDesc}>
        <Select
          ariaLabel={t.settings.hardwareProfile}
          value={agentOpt.hardwareProfile || 'auto'}
          onChange={(v) => setAgentOptimization({ hardwareProfile: v as HardwareOptimizationProfile })}
          options={PROFILES.map((profile) => ({ value: profile, label: profileLabels[profile] }))}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.contextWindowSize} description={t.settings.contextLengthDesc}>
        <Select
          ariaLabel={t.settings.contextWindowSize}
          value={agentOpt.contextLength || 0}
          onChange={(v) => setAgentOptimization({ contextLength: v })}
          options={[
            { value: 0, label: `${t.settings.contextAuto} (${defaultContextForHardware(agentOpt.hardwareProfile, hardware).toLocaleString()})` },
            ...CONTEXT_LENGTH_OPTIONS.map((n) => ({ value: n, label: n.toLocaleString() })),
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.maxTokens} description={t.settings.maxTokensDesc}>
        <RangeControl
          label={t.settings.maxTokens}
          min={1024}
          max={8192}
          step={256}
          value={agentOpt.maxTokens || 4096}
          onChange={(v) => setAgentOptimization({ maxTokens: Math.round(v) })}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.agentThinking} description={t.settings.agentThinkingDesc}>
        <Toggle checked={!!agentOpt.agentThinking} onChange={(checked) => setAgentOptimization({ agentThinking: checked })} />
      </SettingsRow>

      <SettingsRow label={t.settings.webSynthesisStrategy} description={t.settings.webSynthesisStrategyDesc}>
        <Select
          ariaLabel={t.settings.webSynthesisStrategy}
          value={agentOpt.webSynthesisStrategy || 'auto'}
          onChange={(v) => setAgentOptimization({ webSynthesisStrategy: v as WebSynthesisStrategy })}
          options={[
            { value: 'auto', label: t.settings.strategyAuto },
            { value: 'single_file', label: t.settings.strategySingleFile },
            { value: 'modular', label: t.settings.strategyModular },
          ]}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.modificationStrategy} description={t.settings.modificationStrategyDesc}>
        <Select
          ariaLabel={t.settings.modificationStrategy}
          value={agentOpt.modificationStrategy || 'smart_injection'}
          onChange={(v) => setAgentOptimization({ modificationStrategy: v as ModificationStrategy })}
          options={[
            { value: 'smart_injection', label: t.settings.modSmartInjection },
            { value: 'full_overwrite', label: t.settings.modFullOverwrite },
          ]}
        />
      </SettingsRow>
    </div>
  );
};
