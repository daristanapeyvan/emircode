import { create } from 'zustand';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'webAccess'
  | 'models'
  | 'generation'
  | 'agent'
  | 'design'
  | 'keyboard'
  | 'storage'
  | 'ollama'
  | 'advanced'
  | 'about';

export type ModelsTab = 'installed' | 'discover' | 'running';

const EXPLORER_KEY = 'emir.agent.explorerOpen';

/** The Project Explorer starts closed; once the user opens (or closes) it, that choice stays. */
function readExplorerOpen(): boolean {
  try {
    return localStorage.getItem(EXPLORER_KEY) === 'true';
  } catch {
    return false;
  }
}

interface UIState {
  isSettingsOpen: boolean;
  settingsCategory: SettingsCategory;
  isModelsOpen: boolean;
  modelsTab: ModelsTab;
  isCommandPaletteOpen: boolean;
  isModelDetailsOpen: boolean;
  inspectingModelName: string;
  isSystemPromptOpen: boolean;
  isSidebarOpen: boolean;
  activeAppMode: 'chat' | 'agent';
  isNewProjectOpen: boolean;
  isExplorerOpen: boolean;

  openSettings: (category?: SettingsCategory) => void;
  closeSettings: () => void;
  openModels: (tab?: ModelsTab) => void;
  closeModels: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  openModelDetails: (name: string) => void;
  closeModelDetails: () => void;
  toggleSystemPrompt: () => void;
  setSystemPromptOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveAppMode: (mode: 'chat' | 'agent') => void;
  toggleAppMode: () => void;
  openNewProject: () => void;
  closeNewProject: () => void;
  setExplorerOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSettingsOpen: false,
  settingsCategory: 'general',
  isModelsOpen: false,
  modelsTab: 'installed',
  isCommandPaletteOpen: false,
  isModelDetailsOpen: false,
  inspectingModelName: '',
  isSystemPromptOpen: false,
  isSidebarOpen: true,
  activeAppMode: 'chat',
  isNewProjectOpen: false,
  isExplorerOpen: readExplorerOpen(),

  setActiveAppMode: (activeAppMode) => set({ activeAppMode }),
  toggleAppMode: () => set((s) => ({ activeAppMode: s.activeAppMode === 'chat' ? 'agent' : 'chat' })),

  openNewProject: () => set({ isNewProjectOpen: true }),
  closeNewProject: () => set({ isNewProjectOpen: false }),
  setExplorerOpen: (open) => {
    try {
      localStorage.setItem(EXPLORER_KEY, String(open));
    } catch {
      /* a convenience only */
    }
    set({ isExplorerOpen: open });
  },

  openSettings: (category = 'general') => set({ isSettingsOpen: true, settingsCategory: category }),
  closeSettings: () => set({ isSettingsOpen: false }),

  openModels: (tab = 'installed') => set({ isModelsOpen: true, modelsTab: tab }),
  closeModels: () => set({ isModelsOpen: false }),

  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),

  openModelDetails: (name) => set({ isModelDetailsOpen: true, inspectingModelName: name }),
  closeModelDetails: () => set({ isModelDetailsOpen: false, inspectingModelName: '' }),

  toggleSystemPrompt: () => set((s) => ({ isSystemPromptOpen: !s.isSystemPromptOpen })),
  setSystemPromptOpen: (open) => set({ isSystemPromptOpen: open }),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
}));
