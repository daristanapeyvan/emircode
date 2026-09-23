import { create } from 'zustand';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'webAccess'
  | 'models'
  | 'generation'
  | 'keyboard'
  | 'storage'
  | 'ollama'
  | 'advanced'
  | 'about';

export type ModelsTab = 'installed' | 'discover' | 'running';

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

  setActiveAppMode: (activeAppMode) => set({ activeAppMode }),
  toggleAppMode: () => set((s) => ({ activeAppMode: s.activeAppMode === 'chat' ? 'agent' : 'chat' })),

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
