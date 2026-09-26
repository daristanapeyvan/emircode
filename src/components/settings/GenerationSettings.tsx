import React, { useState } from 'react';
import { Select } from '@/components/common/Select';
import { ChevronRight } from 'lucide-react';
import { SettingsRow, RangeControl } from './SettingsRow';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { GenerationOptions } from '@/types/ollama';
import { cn } from '@/lib/utils/cn';

const numberInput = 'w-28 h-7 px-2 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right font-mono focus:outline-none focus:border-zinc-600';

/** Sampling of the open chat (preset, temperature, top-p/k) and its per-chat overrides. */
export const GenerationSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const { activeChatId, updateChatOptions } = useChatStore();
  const t = getTranslations(settings.language);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeChat = activeChatId ? storageService.getChat(activeChatId) : null;
  const currentOptions: GenerationOptions = activeChat?.options || {};
  const presets = storageService.getData().presets || [];

  const handleOptionChange = (key: keyof GenerationOptions, value: any) => {
    if (activeChatId) {
      updateChatOptions(activeChatId, { ...currentOptions, [key]: value });
    }
  };

  const handlePresetSelect = (presetId: string) => {
    updateSettings({ defaultPresetId: presetId });
    const selected = presets.find((p) => p.id === presetId);
    if (selected && activeChatId) {
      updateChatOptions(activeChatId, selected.options);
    }
  };

  return (
    <div>
      <SettingsRow label={t.settings.presets} description={t.settings.presetsDesc}>
        <Select
          ariaLabel={t.settings.presets}
          value={settings.defaultPresetId}
          onChange={handlePresetSelect}
          options={presets.map((p) => ({ value: p.id, label: t.settings.presetNames[p.id] || p.name }))}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.temperature} description={t.settings.temperatureDesc}>
        <RangeControl
          label={t.settings.temperature}
          min={0}
          max={1.5}
          step={0.05}
          value={currentOptions.temperature ?? 0.7}
          onChange={(v) => handleOptionChange('temperature', v)}
        />
      </SettingsRow>

      <SettingsRow label={t.settings.topP}>
        <RangeControl label={t.settings.topP} min={0.1} max={1} step={0.05} value={currentOptions.top_p ?? 0.9} onChange={(v) => handleOptionChange('top_p', v)} />
      </SettingsRow>

      <SettingsRow label={t.settings.topK} description={t.settings.topKDesc}>
        <RangeControl label={t.settings.topK} min={1} max={100} step={1} value={currentOptions.top_k ?? 40} onChange={(v) => handleOptionChange('top_k', Math.round(v))} />
      </SettingsRow>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        aria-expanded={showAdvanced}
        className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer py-1"
      >
        <ChevronRight size={14} strokeWidth={1.5} className={cn('transition-transform', showAdvanced && 'rotate-90')} />
        {t.settings.advancedGeneration}
      </button>

      {showAdvanced && (
        <div className="pl-3 border-l border-zinc-800">
          <SettingsRow label={t.settings.repeatPenalty} description={t.settings.repeatPenaltyDesc}>
            <input
              type="number"
              step="0.05"
              min="0.8"
              max="2.0"
              value={currentOptions.repeat_penalty ?? 1.1}
              onChange={(e) => handleOptionChange('repeat_penalty', parseFloat(e.target.value))}
              className={numberInput}
            />
          </SettingsRow>

          <SettingsRow label={t.settings.seed} description={t.settings.seedDesc}>
            <input
              type="number"
              placeholder={t.settings.seedRandom}
              value={currentOptions.seed ?? ''}
              onChange={(e) => handleOptionChange('seed', e.target.value ? parseInt(e.target.value) : undefined)}
              className={numberInput}
            />
          </SettingsRow>

          <SettingsRow label={t.settings.contextWindowSize} description={t.settings.chatContextOverrideDesc}>
            <input
              type="number"
              step="1024"
              min="1024"
              max="131072"
              placeholder={t.settings.contextAuto}
              value={currentOptions.num_ctx ?? ''}
              onChange={(e) => handleOptionChange('num_ctx', e.target.value ? parseInt(e.target.value) : undefined)}
              className={numberInput}
            />
          </SettingsRow>
        </div>
      )}
    </div>
  );
};
