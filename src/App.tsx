import React, { useEffect } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { HistorySidebar } from './components/layout/HistorySidebar';
import { ChatContainer } from './components/chat/ChatContainer';
import { SettingsModal } from './components/settings/SettingsModal';
import { ModelManagerModal } from './components/models/ModelManagerModal';
import { ModelDetailsModal } from './components/models/ModelDetailsModal';
import { CommandPalette } from './components/palette/CommandPalette';
import { DownloadProgress } from './components/models/DownloadProgress';
import { AgentWorkspace } from './components/agent/AgentWorkspace';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { useSettingsStore } from './stores/settingsStore';
import { useModelStore } from './stores/modelStore';
import { useChatStore } from './stores/chatStore';
import { useAgentStore } from './stores/agentStore';
import { useUIStore } from './stores/uiStore';

export const App: React.FC = () => {
  const { init: initSettings } = useSettingsStore();
  const { checkConnection } = useModelStore();
  const { init: initChat, createNewChat, isStreaming, stopStreaming } = useChatStore();
  const {
    openCommandPalette,
    openSettings,
    openModels,
    closeSettings,
    closeModels,
    closeCommandPalette,
    closeModelDetails,
    isSettingsOpen,
    isModelsOpen,
    isCommandPaletteOpen,
    isModelDetailsOpen,
    activeAppMode,
  } = useUIStore();

  // App Initialization
  useEffect(() => {
    (async () => {
      if (typeof window !== 'undefined') {
        (window as any).__stores = {
          useSettingsStore,
          useModelStore,
          useChatStore,
          useAgentStore,
          useUIStore,
        };
      }
      await initSettings();
      await checkConnection();
      await initChat();
      await useAgentStore.getState().init();
    })();
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl+N: New chat or New Agent Task
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (activeAppMode === 'agent') {
          useAgentStore.getState().clearSession();
          if (!useAgentStore.getState().workspaceRoot) {
            useAgentStore.getState().openWorkspaceDialog();
          }
        } else {
          createNewChat();
        }
        return;
      }

      // Ctrl+K: Command palette
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Ctrl+Shift+M: Models manager
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        openModels();
        return;
      }

      // Ctrl+,: Settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        openSettings();
        return;
      }

      // Escape: Stop generation or close open modals
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          closeCommandPalette();
        } else if (isModelDetailsOpen) {
          closeModelDetails();
        } else if (isModelsOpen) {
          closeModels();
        } else if (isSettingsOpen) {
          closeSettings();
        } else if (isStreaming) {
          stopStreaming();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    createNewChat,
    openCommandPalette,
    openModels,
    openSettings,
    closeSettings,
    closeModels,
    closeCommandPalette,
    closeModelDetails,
    isSettingsOpen,
    isModelsOpen,
    isCommandPaletteOpen,
    isModelDetailsOpen,
    isStreaming,
    stopStreaming,
  ]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas-dark text-zinc-200">
      {/* Native Windows Title Bar */}
      <TitleBar />

      {/* Main Content Viewport */}
      <div className="flex-1 flex overflow-hidden">
        <HistorySidebar />
        {activeAppMode === 'agent' ? <AgentWorkspace /> : <ChatContainer />}
      </div>

      {/* Modals & Overlays */}
      <SettingsModal />
      <ModelManagerModal />
      <ModelDetailsModal />
      <CommandPalette />
      <DownloadProgress />
      <OnboardingModal />
    </div>
  );
};

export default App;
