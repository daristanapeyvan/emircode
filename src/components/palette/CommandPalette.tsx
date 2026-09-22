import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Layers,
  Download,
  Settings,
  Sun,
  Moon,
  Globe,
  FileText,
  Search,
  Check,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { isCommandPaletteOpen, closeCommandPalette, openSettings, openModels } = useUIStore();
  const { createNewChat, activeChatId } = useChatStore();
  const { settings, setTheme, setLanguage } = useSettingsStore();
  const { installedModels, selectModel } = useModelStore();
  const t = getTranslations(settings.language);

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build command list
  const commands: CommandItem[] = [
    {
      id: 'new_chat',
      title: t.commandPalette.newChat,
      category: 'Actions',
      icon: <Plus size={14} strokeWidth={1.5} />,
      action: () => {
        createNewChat();
        closeCommandPalette();
      },
    },
    {
      id: 'manage_models',
      title: t.commandPalette.openModels,
      category: 'Navigation',
      icon: <Layers size={14} strokeWidth={1.5} />,
      action: () => {
        openModels('installed');
        closeCommandPalette();
      },
    },
    {
      id: 'download_model',
      title: t.commandPalette.downloadModel,
      category: 'Actions',
      icon: <Download size={14} strokeWidth={1.5} />,
      action: () => {
        openModels('discover');
        closeCommandPalette();
      },
    },
    {
      id: 'open_settings',
      title: t.commandPalette.openSettings,
      category: 'Navigation',
      icon: <Settings size={14} strokeWidth={1.5} />,
      action: () => {
        openSettings();
        closeCommandPalette();
      },
    },
    {
      id: 'toggle_theme',
      title: t.commandPalette.toggleTheme,
      category: 'Preferences',
      icon: settings.theme === 'dark' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />,
      action: () => {
        setTheme(settings.theme === 'dark' ? 'light' : 'dark');
        closeCommandPalette();
      },
    },
    {
      id: 'switch_language',
      title: t.commandPalette.switchLanguage,
      category: 'Preferences',
      icon: <Globe size={14} strokeWidth={1.5} />,
      action: () => {
        setLanguage(settings.language === 'en' ? 'tr' : 'en');
        closeCommandPalette();
      },
    },
  ];

  // Add switch to installed model commands
  installedModels.forEach((m) => {
    commands.push({
      id: `model_${m.name}`,
      title: `${t.commandPalette.switchModel} ${m.name}`,
      category: 'Models',
      icon: <Layers size={14} strokeWidth={1.5} />,
      action: () => {
        selectModel(m.name);
        closeCommandPalette();
      },
    });
  });

  // Filter commands
  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase().trim())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCommandPaletteOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, filtered, selectedIndex, closeCommandPalette]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={closeCommandPalette}
      />

      {/* Palette Container */}
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-10 text-xs">
        {/* Search Header */}
        <div className="flex items-center px-3.5 py-3 border-b border-zinc-800 bg-zinc-950/80 gap-2.5">
          <Search size={15} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.commandPalette.placeholder}
            className="flex-1 bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-mono">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs">
              {t.commandPalette.noCommandsFound}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded text-xs transition-colors cursor-pointer text-left',
                    isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn(isSelected ? 'text-blue-400' : 'text-zinc-500')}>
                      {item.icon}
                    </span>
                    <span className="font-medium">{item.title}</span>
                  </div>

                  <span className="text-[10px] text-zinc-500 font-mono">
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
