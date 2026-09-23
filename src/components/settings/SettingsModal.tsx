import React from 'react';
import {
  Sliders,
  Palette,
  MessageSquare,
  Globe,
  Layers,
  Cpu,
  Keyboard,
  HardDrive,
  Server,
  Info,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { GeneralSettings } from './GeneralSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { ChatSettings } from './ChatSettings';
import { WebAccessSettings } from './WebAccessSettings';
import { GenerationSettings } from './GenerationSettings';
import { KeyboardSettings } from './KeyboardSettings';
import { StorageSettings } from './StorageSettings';
import { OllamaSettings } from './OllamaSettings';
import { AboutSettings } from './AboutSettings';
import { useUIStore, SettingsCategory } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

export const SettingsModal: React.FC = () => {
  const { isSettingsOpen, closeSettings, settingsCategory, openSettings, openModels } = useUIStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const categories: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t.settings.general, icon: <Sliders size={14} strokeWidth={1.5} /> },
    { id: 'appearance', label: t.settings.appearance, icon: <Palette size={14} strokeWidth={1.5} /> },
    { id: 'chat', label: t.settings.chat, icon: <MessageSquare size={14} strokeWidth={1.5} /> },
    { id: 'webAccess', label: t.settings.webAccess || 'Web Access', icon: <Globe size={14} strokeWidth={1.5} /> },
    { id: 'generation', label: t.settings.generation, icon: <Cpu size={14} strokeWidth={1.5} /> },
    { id: 'keyboard', label: t.settings.keyboard, icon: <Keyboard size={14} strokeWidth={1.5} /> },
    { id: 'storage', label: t.settings.storage, icon: <HardDrive size={14} strokeWidth={1.5} /> },
    { id: 'ollama', label: t.settings.ollama, icon: <Server size={14} strokeWidth={1.5} /> },
    { id: 'about', label: t.settings.about, icon: <Info size={14} strokeWidth={1.5} /> },
  ];

  return (
    <Modal
      isOpen={isSettingsOpen}
      onClose={closeSettings}
      title={t.settings.title}
      width="max-w-3xl"
    >
      <div className="flex flex-col sm:flex-row min-h-[420px] gap-6 -m-2">
        {/* Navigation Sidebar */}
        <div className="w-full sm:w-48 border-b sm:border-b-0 sm:border-r border-zinc-800/40 p-2 space-y-0.5 shrink-0 select-none">
          {categories.map((cat) => {
            const isActive = settingsCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => openSettings(cat.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs transition-colors cursor-pointer text-left',
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                )}
              >
                <span className={cn(isActive ? 'text-blue-400' : 'text-zinc-500')}>
                  {cat.icon}
                </span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Category Content Area */}
        <div className="flex-1 p-2 overflow-y-auto max-h-[60vh]">
          {settingsCategory === 'general' && <GeneralSettings />}
          {settingsCategory === 'appearance' && <AppearanceSettings />}
          {settingsCategory === 'chat' && <ChatSettings />}
          {settingsCategory === 'webAccess' && <WebAccessSettings />}
          {settingsCategory === 'generation' && <GenerationSettings />}
          {settingsCategory === 'keyboard' && <KeyboardSettings />}
          {settingsCategory === 'storage' && <StorageSettings />}
          {settingsCategory === 'ollama' && <OllamaSettings />}
          {settingsCategory === 'about' && <AboutSettings />}
        </div>
      </div>
    </Modal>
  );
};
