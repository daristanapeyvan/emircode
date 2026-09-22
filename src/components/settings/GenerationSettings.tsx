import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Sliders } from 'lucide-react';
import { SettingsRow } from './SettingsRow';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { GenerationOptions } from '@/types/ollama';

export const GenerationSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const { activeChatId, updateChatOptions } = useChatStore();
  const t = getTranslations(settings.language);

  const [showAdvanced, setShowAdvanced] = useState(false);

  // Get active chat options or default
  const activeChat = activeChatId ? storageService.getChat(activeChatId) : null;
  const currentOptions: GenerationOptions = activeChat?.options || {};

  const presets = storageService.getData().presets || [];

  const handleOptionChange = (key: keyof GenerationOptions, value: any) => {
    const updated = { ...currentOptions, [key]: value };
    if (activeChatId) {
      updateChatOptions(activeChatId, updated);
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
    <div className="space-y-4">
      {/* Preset selector */}
      <SettingsRow
        label={t.settings.presets}
        description={t.settings.presetsDesc}
      >
        <select
          value={settings.defaultPresetId}
          onChange={(e) => handlePresetSelect(e.target.value)}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </SettingsRow>

      {/* Basic Sampling Parameters */}
      <div className="space-y-1">
        {/* Temperature */}
        <SettingsRow
          label={`${t.settings.temperature} (${currentOptions.temperature ?? 0.7})`}
          description={t.settings.temperatureDesc}
        >
          <div className="flex items-center gap-3 w-48">
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={currentOptions.temperature ?? 0.7}
              onChange={(e) => handleOptionChange('temperature', parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </SettingsRow>

        {/* Top P */}
        <SettingsRow
          label={`${t.settings.topP} (${currentOptions.top_p ?? 0.9})`}
          description={t.settings.topPDesc}
        >
          <div className="flex items-center gap-3 w-48">
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={currentOptions.top_p ?? 0.9}
              onChange={(e) => handleOptionChange('top_p', parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </SettingsRow>

        {/* Top K */}
        <SettingsRow
          label={`${t.settings.topK} (${currentOptions.top_k ?? 40})`}
          description={t.settings.topKDesc}
        >
          <div className="flex items-center gap-3 w-48">
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={currentOptions.top_k ?? 40}
              onChange={(e) => handleOptionChange('top_k', parseInt(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </SettingsRow>
      </div>

      {/* Progressive Disclosure Toggle */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer py-1 font-medium"
        >
          {showAdvanced ? (
            <ChevronDown size={14} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} />
          )}
          <span>
            {showAdvanced ? t.settings.hideAdvancedGeneration : t.settings.advancedGeneration}
          </span>
        </button>
      </div>

      {/* Advanced Parameters Revealed */}
      {showAdvanced && (
        <div className="space-y-1 pl-3 border-l border-zinc-800">
          <SettingsRow
            label={`${t.settings.repeatPenalty} (${currentOptions.repeat_penalty ?? 1.1})`}
            description="Penalizes repetitive n-grams to reduce looping."
          >
            <input
              type="number"
              step="0.05"
              min="0.8"
              max="2.0"
              value={currentOptions.repeat_penalty ?? 1.1}
              onChange={(e) => handleOptionChange('repeat_penalty', parseFloat(e.target.value))}
              className="w-24 h-7 px-2 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right font-mono"
            />
          </SettingsRow>

          <SettingsRow
            label={t.settings.seed}
            description="Random seed for reproducible outputs. Leave blank for random."
          >
            <input
              type="number"
              placeholder="Random"
              value={currentOptions.seed ?? ''}
              onChange={(e) => handleOptionChange('seed', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-24 h-7 px-2 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right font-mono"
            />
          </SettingsRow>

          <SettingsRow
            label={t.settings.contextWindowSize}
            description="Ollama context size (num_ctx). Default is model native (e.g. 4096)."
          >
            <input
              type="number"
              step="1024"
              min="1024"
              max="131072"
              placeholder="4096"
              value={currentOptions.num_ctx ?? ''}
              onChange={(e) => handleOptionChange('num_ctx', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-28 h-7 px-2 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right font-mono"
            />
          </SettingsRow>
        </div>
      )}
    </div>
  );
};
