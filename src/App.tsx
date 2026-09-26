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
import { NewProjectDialog, focusAgentComposer } from './components/agent/NewProjectDialog';
import { DialogHost } from './components/common/DialogHost';
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
    setActiveAppMode,
    openNewProject,
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
      // Ctrl+Shift+N: New project (Emir Code)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveAppMode('agent');
        openNewProject();
        return;
      }

      // Ctrl+N: New chat, or a new task in the open project (no project yet: New Project)
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (activeAppMode === 'agent') {
          const { workspaceRoot, startTaskInFolder } = useAgentStore.getState();
          if (workspaceRoot) {
            startTaskInFolder(workspaceRoot).then((started) => started && focusAgentComposer());
          } else {
            openNewProject();
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

      // Escape: Stop generation or close open modals (unless a dialog or menu already took the key)
      if (e.key === 'Escape' && !e.defaultPrevented) {
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
    activeAppMode,
    setActiveAppMode,
    openNewProject,
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
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-canvas text-zinc-200">
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
      <NewProjectDialog />
      <DialogHost />
    </div>
  );
};

export default App;
