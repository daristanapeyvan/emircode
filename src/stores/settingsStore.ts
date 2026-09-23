import { create } from 'zustand';
import { AppSettings, DEFAULT_SETTINGS, Language, Theme, FontSize, WebAccessConfig } from '@/types/settings';
import { HardwareInfo } from '@/types/hardware';
import { storageService } from '@/lib/storage/StorageService';
import { ollamaClient } from '@/lib/ollama/OllamaClient';
import { WebAccessService } from '@/lib/web/WebAccessService';

interface SettingsState {
  settings: AppSettings;
  hardware: HardwareInfo | null;
  isInitialized: boolean;
  init: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setWebAccess: (config: Partial<WebAccessConfig>) => void;
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setOllamaEndpoint: (endpoint: string) => void;
  refreshHardware: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hardware: null,
  isInitialized: false,

  init: async () => {
    if (window.electronAPI?.getSystemLocale) {
      try {
        const locale = await window.electronAPI.getSystemLocale();
        if (locale) {
          (window as any).__systemLocale = locale;
        }
      } catch (err) {
        // ignore
      }
    }

    const data = await storageService.init();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...(data.settings || {}),
      webAccess: {
        ...DEFAULT_SETTINGS.webAccess,
        ...(data.settings?.webAccess || {}),
      },
    };

    // Apply theme class to document
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Configure client endpoint
    ollamaClient.setEndpoint(settings.ollamaEndpoint);

    set({ settings, isInitialized: true });

    // Fetch hardware
    get().refreshHardware();
  },

  updateSettings: (partial) => {
    const newSettings = { ...get().settings, ...partial };
    storageService.getData().settings = newSettings;
    storageService.save();

    if (partial.theme) {
      if (partial.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }

    if (partial.ollamaEndpoint) {
      ollamaClient.setEndpoint(partial.ollamaEndpoint);
    }

    set({ settings: newSettings });
  },

  setWebAccess: (partialConfig) => {
    const currentWeb = get().settings.webAccess || DEFAULT_SETTINGS.webAccess;
    const newWebAccess = { ...currentWeb, ...partialConfig };
    get().updateSettings({ webAccess: newWebAccess });

    // Immediate in-flight request cancellation if Web Access is toggled OFF
    if (newWebAccess.enabled === false) {
      WebAccessService.abortAllActiveRequests('Kullanıcı Web Erişimini kapattı.');
      if (typeof window !== 'undefined' && (window as any).electronAPI?.webAbortAll) {
        (window as any).electronAPI.webAbortAll().catch(() => {});
      }
    }
  },

  setLanguage: (language) => {
    get().updateSettings({ language });
  },

  setTheme: (theme) => {
    get().updateSettings({ theme });
  },

  setFontSize: (fontSize) => {
    get().updateSettings({ fontSize });
  },

  setOllamaEndpoint: (ollamaEndpoint) => {
    get().updateSettings({ ollamaEndpoint });
  },

  refreshHardware: async () => {
    try {
      if (window.electronAPI?.getHardwareInfo) {
        const info = await window.electronAPI.getHardwareInfo();
        set({ hardware: info });
      } else {
        // Safe browser fallback with realistic client hint
        const cores = navigator.hardwareConcurrency || 4;
        set({
          hardware: {
            cpu: {
              model: 'Native Processor',
              cores: Math.floor(cores / 2) || 2,
              logicalProcessors: cores,
            },
            ram: {
              totalBytes: 16 * 1024 * 1024 * 1024,
              availableBytes: 8 * 1024 * 1024 * 1024,
              totalGb: 16,
              availableGb: 8,
            },
          },
        });
      }
    } catch (err) {
      console.error('Failed to detect hardware:', err);
    }
  },
}));
