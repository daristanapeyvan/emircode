import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Layers,
  Download,
  Settings,
  Sun,
  Moon,
  Globe,
  Search,
  FolderPlus,
  ScrollText,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { useAgentStore } from '@/stores/agentStore';
import { focusAgentComposer } from '@/components/agent/NewProjectDialog';
import { getTranslations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

type Group = 'actions' | 'navigation' | 'preferences' | 'models';
const GROUP_ORDER: Group[] = ['actions', 'navigation', 'preferences', 'models'];

interface CommandItem {
  id: string;
  title: string;
  category: Group;
  icon: React.ReactNode | null;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { isCommandPaletteOpen, closeCommandPalette, openSettings, openModels, openNewProject, setActiveAppMode, activeAppMode, setSystemPromptOpen } = useUIStore();
  const workspaceRoot = useAgentStore((s) => s.workspaceRoot);
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
      category: 'actions',
      icon: <Plus size={14} strokeWidth={1.5} />,
      action: () => {
        createNewChat();
        setActiveAppMode('chat');
        closeCommandPalette();
      },
    },
    {
      id: 'new_project',
      title: t.projects.paletteNewProject,
      category: 'actions',
      icon: <FolderPlus size={14} strokeWidth={1.5} />,
      action: () => {
        closeCommandPalette();
        setActiveAppMode('agent');
        openNewProject();
      },
    },
    ...(workspaceRoot
      ? [
          {
            id: 'new_task',
            title: t.projects.paletteNewTask,
            category: 'actions' as Group,
            icon: <Plus size={14} strokeWidth={1.5} />,
            action: () => {
              closeCommandPalette();
              setActiveAppMode('agent');
              useAgentStore
                .getState()
                .startTaskInFolder(workspaceRoot)
                .then((started) => started && focusAgentComposer());
            },
          },
        ]
      : []),
    ...(activeAppMode === 'chat' && activeChatId
      ? [
          {
            id: 'system_prompt',
            title: t.chat.systemInstructions,
            category: 'actions' as Group,
            icon: <ScrollText size={14} strokeWidth={1.5} />,
            action: () => {
              closeCommandPalette();
              setSystemPromptOpen(true);
            },
          },
        ]
      : []),
    {
      id: 'manage_models',
      title: t.commandPalette.openModels,
      category: 'navigation',
      icon: <Layers size={14} strokeWidth={1.5} />,
      action: () => {
        openModels('installed');
        closeCommandPalette();
      },
    },
    {
      id: 'download_model',
      title: t.commandPalette.downloadModel,
      category: 'actions',
      icon: <Download size={14} strokeWidth={1.5} />,
      action: () => {
        openModels('discover');
        closeCommandPalette();
      },
    },
    {
      id: 'open_settings',
      title: t.commandPalette.openSettings,
      category: 'navigation',
      icon: <Settings size={14} strokeWidth={1.5} />,
      action: () => {
        openSettings();
        closeCommandPalette();
      },
    },
    {
      id: 'toggle_theme',
      title: t.commandPalette.toggleTheme,
      category: 'preferences',
      icon: settings.theme === 'dark' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />,
      action: () => {
        setTheme(settings.theme === 'dark' ? 'light' : 'dark');
        closeCommandPalette();
      },
    },
    {
      id: 'switch_language',
      title: t.commandPalette.switchLanguage,
      category: 'preferences',
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
      title: m.name,
      category: 'models',
      icon: null,
      action: () => {
        selectModel(m.name);
        closeCommandPalette();
      },
    });
  });

  // Filter commands; listed group by group, so the arrow keys follow what is on screen
  const query = search.toLowerCase().trim();
  const filtered = GROUP_ORDER.flatMap((group) => commands.filter((c) => c.category === group && c.title.toLowerCase().includes(query)));
  const groupLabels: Record<Group, string> = {
    actions: t.commandPalette.groupActions,
    navigation: t.commandPalette.groupNavigation,
    preferences: t.commandPalette.groupPreferences,
    models: t.commandPalette.groupModels,
  };

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
        className="fixed inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-[2px]"
        onClick={closeCommandPalette}
      />

      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-10 text-xs">
        <div className="flex items-center px-3.5 py-2.5 border-b border-zinc-800 gap-2.5">
          <Search size={15} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.commandPalette.placeholder}
            aria-label={t.commandPalette.placeholder}
            className="flex-1 bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-zinc-500">{t.commandPalette.noCommandsFound}</div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const firstOfGroup = idx === 0 || filtered[idx - 1].category !== item.category;
              return (
                <React.Fragment key={item.id}>
                  {firstOfGroup && <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-zinc-500">{groupLabels[item.category]}</div>}
                  <button
                    type="button"
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded text-left transition-colors cursor-pointer',
                      isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                    )}
                  >
                    <span className={cn('w-3.5 shrink-0', isSelected ? 'text-zinc-200' : 'text-zinc-500')}>{item.icon}</span>
                    <span className={cn('truncate', item.category === 'models' && 'font-mono')}>{item.title}</span>
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
