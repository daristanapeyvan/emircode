import React, { useState, useEffect } from 'react';
import {
  PanelLeft,
  Settings,
  Layers,
  Search,
  Minus,
  Square,
  Copy,
  X,
} from 'lucide-react';
import { ModelSelector } from '../chat/ModelSelector';
import { IconButton } from '../common/IconButton';
import { AppLogo } from '../common/AppLogo';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const {
    openSettings,
    openModels,
    openCommandPalette,
    toggleSidebar,
  } = useUIStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  useEffect(() => {
    if (window.electronAPI?.isMaximized) {
      window.electronAPI.isMaximized().then(setIsMaximized);
    }
    if (window.electronAPI?.onMaximizeChange) {
      const unsub = window.electronAPI.onMaximizeChange(setIsMaximized);
      return unsub;
    }
  }, []);

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  return (
    <div className="h-10 bg-zinc-950/90 border-b border-zinc-800/40 flex items-center justify-between px-2.5 select-none z-30 shrink-0 [app-region:drag]">
      {/* Left unified brand & workflow cluster */}
      <div className="flex items-center gap-2 [app-region:no-drag]">
        {/* Unified Brand Unit */}
        <div className="flex items-center gap-2 pr-1 select-none">
          <AppLogo size={18} />
          <span className="text-xs font-semibold text-zinc-100 tracking-tight font-sans">
            Emir Code
          </span>
        </div>

        <div className="h-3.5 w-px bg-zinc-800/50 mx-0.5" />

        {/* Sidebar toggle (new chats, projects and tasks start from the sidebar) */}
        <IconButton
          label={t.titleBar.toggleSidebar}
          icon={<PanelLeft size={15} strokeWidth={1.5} />}
          onClick={toggleSidebar}
          size="sm"
        />

        {/* Compact Model Selector */}
        <ModelSelector />
      </div>

      {/* Quiet window drag area */}
      <div className="flex-1 h-full" />

      {/* Right controls */}
      <div className="flex items-center gap-1 [app-region:no-drag]">
        <IconButton
          label={t.titleBar.commandPalette}
          icon={<Search size={14} strokeWidth={1.5} />}
          onClick={openCommandPalette}
          size="sm"
        />

        <IconButton
          label={t.titleBar.models}
          icon={<Layers size={14} strokeWidth={1.5} />}
          onClick={() => openModels()}
          size="sm"
        />

        <IconButton
          label={t.titleBar.settings}
          icon={<Settings size={14} strokeWidth={1.5} />}
          onClick={() => openSettings()}
          size="sm"
        />

        {/* Windows Native Window Frame Buttons */}
        {window.electronAPI && (
          <div className="flex items-center ml-1.5 pl-1.5 border-l border-zinc-800/50">
            <button
              type="button"
              title={t.titleBar.minimize}
              onClick={handleMinimize}
              className="w-8 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors cursor-pointer rounded-sm"
            >
              <Minus size={13} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              title={isMaximized ? t.titleBar.restore : t.titleBar.maximize}
              onClick={handleMaximize}
              className="w-8 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors cursor-pointer rounded-sm"
            >
              {isMaximized ? (
                <Copy size={11} strokeWidth={1.5} className="rotate-90" />
              ) : (
                <Square size={11} strokeWidth={1.5} />
              )}
            </button>
            <button
              type="button"
              title={t.titleBar.close}
              onClick={handleClose}
              className="w-8 h-7 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-red-600 transition-colors cursor-pointer rounded-sm"
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
