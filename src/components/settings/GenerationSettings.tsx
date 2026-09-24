import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Sliders, Cpu, HardDrive, RefreshCw } from 'lucide-react';
import { SettingsRow } from './SettingsRow';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { GenerationOptions } from '@/types/ollama';
import { HardwareOptimizationProfile, DEFAULT_SETTINGS, WebSynthesisStrategy } from '@/types/settings';
import { defaultContextForHardware } from '@/lib/ollama/ModelRuntime';
import { Toggle } from '@/components/common/Toggle';
import { cn } from '@/lib/utils/cn';

const CONTEXT_LENGTH_OPTIONS = [4096, 8192, 12288, 16384, 24576, 32768, 65536];

export const GenerationSettings: React.FC = () => {
  const { settings, updateSettings, setAgentOptimization, hardware, refreshHardware } = useSettingsStore();
  const { activeChatId, updateChatOptions } = useChatStore();
  const t = getTranslations(settings.language);
  const agentOpt = settings.agentOptimization || DEFAULT_SETTINGS.agentOptimization;

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
            description={t.settings.chatContextOverrideDesc}
          >
            <input
              type="number"
              step="1024"
              min="1024"
              max="131072"
              placeholder={t.settings.contextAuto}
              value={currentOptions.num_ctx ?? ''}
              onChange={(e) => handleOptionChange('num_ctx', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-28 h-7 px-2 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 text-right font-mono"
            />
          </SettingsRow>
        </div>
      )}

      {/* Agent Hardware Optimization & Synthesis Strategy Section */}
      <div className="pt-4 border-t border-zinc-800/80 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
            <Cpu size={15} className="text-blue-400" />
            {t.settings.agentOptimization}
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            {t.settings.agentOptimizationDesc}
          </p>
        </div>

        {/* Hardware Status Card */}
        {hardware && (
          <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium flex items-center gap-1.5">
                <HardDrive size={13} className="text-zinc-500" />
                {t.settings.detectedHardware}
              </span>
              <button
                type="button"
                onClick={() => refreshHardware()}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors cursor-pointer"
                title="Yeniden tara"
              >
                <RefreshCw size={11} />
                Yenile
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-zinc-300">
              <div className="bg-zinc-950/60 p-2 rounded border border-zinc-800/60">
                <span className="text-zinc-500 block text-[10px]">CPU</span>
                <span className="font-medium truncate block" title={hardware.cpu?.model}>
                  {hardware.cpu?.model || 'Native CPU'}
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {hardware.cpu?.cores || '?'} çekirdek / {hardware.cpu?.logicalProcessors || '?'} iş parçacığı
                </span>
              </div>
              <div className="bg-zinc-950/60 p-2 rounded border border-zinc-800/60">
                <span className="text-zinc-500 block text-[10px]">RAM</span>
                <span className="font-medium text-emerald-400">
                  {hardware.ram?.totalGb ? `${hardware.ram.totalGb} GB` : 'Bilinmiyor'}
                </span>
                <span className="text-zinc-500 text-[10px] block">
                  {hardware.ram?.availableGb ? `${hardware.ram.availableGb} GB kullanılabilir` : ''}
                </span>
              </div>
              <div className="bg-zinc-950/60 p-2 rounded border border-zinc-800/60">
                <span className="text-zinc-500 block text-[10px]">GPU / Hızlandırıcı</span>
                <span className="font-medium text-indigo-400 truncate block" title={hardware.gpu?.model}>
                  {hardware.gpu?.model || 'Entegre / CPU'}
                </span>
                <span className="text-zinc-500 text-[10px] block">
                  {hardware.gpu?.vramMb
                    ? `${Math.round(hardware.gpu.vramMb / 1024)} GB VRAM`
                    : 'Sistem Belleği'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Profile Chips */}
        <SettingsRow
          label={t.settings.hardwareProfile}
          description={t.settings.hardwareProfileDesc}
        >
          <div className="flex flex-wrap gap-1.5 justify-end">
            {(['auto', 'low', 'balanced', 'high', 'custom'] as HardwareOptimizationProfile[]).map((prof) => {
              const isActive = (agentOpt.hardwareProfile || 'auto') === prof;
              const labels: Record<HardwareOptimizationProfile, string> = {
                auto: t.settings.profileAuto || 'Otomatik',
                low: t.settings.profileLow || 'Düşük',
                balanced: t.settings.profileBalanced || 'Dengeli',
                high: t.settings.profileHigh || 'Yüksek',
                custom: t.settings.profileCustom || 'Özel',
              };
              return (
                <button
                  key={prof}
                  type="button"
                  onClick={() => setAgentOptimization({ hardwareProfile: prof })}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer font-medium',
                    isActive
                      ? 'bg-blue-600/20 border-blue-500/80 text-blue-300 shadow-sm'
                      : 'bg-zinc-900 border-zinc-750 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  )}
                >
                  {labels[prof]}
                </button>
              );
            })}
          </div>
        </SettingsRow>

        {/* Context Length (num_ctx) shared by agent and chat */}
        <SettingsRow
          label={t.settings.contextWindowSize}
          description={t.settings.contextLengthDesc}
        >
          <select
            value={agentOpt.contextLength || 0}
            onChange={(e) => setAgentOptimization({ contextLength: parseInt(e.target.value, 10) || 0 })}
            className="h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 max-w-[220px]"
          >
            <option value={0}>
              {t.settings.contextAuto} ({defaultContextForHardware(agentOpt.hardwareProfile, hardware).toLocaleString()})
            </option>
            {CONTEXT_LENGTH_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} token
              </option>
            ))}
          </select>
        </SettingsRow>

        {/* Max Tokens Slider */}
        <SettingsRow
          label={`${t.settings.maxTokens} (${agentOpt.maxTokens || 4096})`}
          description={t.settings.maxTokensDesc}
        >
          <div className="flex items-center gap-3 w-48">
            <input
              type="range"
              min="1024"
              max="8192"
              step="256"
              value={agentOpt.maxTokens || 4096}
              onChange={(e) => setAgentOptimization({ maxTokens: parseInt(e.target.value) })}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </SettingsRow>

        {/* Agent reasoning for thinking-capable models */}
        <SettingsRow
          label={t.settings.agentThinking}
          description={t.settings.agentThinkingDesc}
        >
          <Toggle
            checked={!!agentOpt.agentThinking}
            onChange={(checked) => setAgentOptimization({ agentThinking: checked })}
          />
        </SettingsRow>

        {/* Web Synthesis Strategy */}
        <SettingsRow
          label={t.settings.webSynthesisStrategy}
          description={t.settings.webSynthesisStrategyDesc}
        >
          <select
            value={agentOpt.webSynthesisStrategy || 'auto'}
            onChange={(e) => setAgentOptimization({ webSynthesisStrategy: e.target.value as WebSynthesisStrategy })}
            className="h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 max-w-[220px]"
          >
            <option value="auto">{t.settings.strategyAuto}</option>
            <option value="single_file">{t.settings.strategySingleFile}</option>
            <option value="modular">{t.settings.strategyModular}</option>
          </select>
        </SettingsRow>

        {/* Modification Strategy */}
        <SettingsRow
          label={t.settings.modificationStrategy}
          description={t.settings.modificationStrategyDesc}
        >
          <select
            value={agentOpt.modificationStrategy || 'smart_injection'}
            onChange={(e) => setAgentOptimization({ modificationStrategy: e.target.value as any })}
            className="h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 max-w-[220px]"
          >
            <option value="smart_injection">{t.settings.modSmartInjection}</option>
            <option value="full_overwrite">{t.settings.modFullOverwrite}</option>
          </select>
        </SettingsRow>
      </div>
    </div>
  );
};
