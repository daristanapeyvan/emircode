import { create } from 'zustand';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  Language,
  Theme,
  FontSize,
  WebAccessConfig,
  AgentOptimizationConfig,
  HardwareOptimizationProfile,
  DesignThemeConfig,
} from '@/types/settings';
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
  setAgentOptimization: (config: Partial<AgentOptimizationConfig>) => void;
  setDesignTheme: (config: Partial<DesignThemeConfig>) => void;
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
      agentOptimization: {
        ...DEFAULT_SETTINGS.agentOptimization,
        ...(data.settings?.agentOptimization || {}),
      },
      designTheme: {
        ...DEFAULT_SETTINGS.designTheme,
        ...(data.settings?.designTheme || {}),
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

    // Fetch hardware, then re-derive the automatic profile so older saved values
    // (e.g. the former 2400-token limit) follow the current recommendations.
    get()
      .refreshHardware()
      .then(() => {
        if ((get().settings.agentOptimization?.hardwareProfile || 'auto') === 'auto') {
          get().setAgentOptimization({ hardwareProfile: 'auto' });
        }
      })
      .catch(() => {});
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

  setAgentOptimization: (partialConfig) => {
    const currentOpt = get().settings.agentOptimization || DEFAULT_SETTINGS.agentOptimization;
    let newOpt: AgentOptimizationConfig = { ...currentOpt, ...partialConfig };

    // If a specific preset profile is selected, set recommended profile parameters.
    // maxTokens is only an upper bound per step; values below ~3000 truncated complete files
    // (a styled page easily needs 2000-3000 tokens), which forced models into plain output.
    if (partialConfig.hardwareProfile) {
      if (partialConfig.hardwareProfile === 'low') {
        newOpt = {
          ...newOpt,
          hardwareProfile: 'low',
          maxTokens: partialConfig.maxTokens ?? 3072,
          webSynthesisStrategy: partialConfig.webSynthesisStrategy ?? 'single_file',
          modificationStrategy: partialConfig.modificationStrategy ?? 'full_overwrite',
        };
      } else if (partialConfig.hardwareProfile === 'balanced') {
        newOpt = {
          ...newOpt,
          hardwareProfile: 'balanced',
          maxTokens: partialConfig.maxTokens ?? 4096,
          webSynthesisStrategy: partialConfig.webSynthesisStrategy ?? 'auto',
          modificationStrategy: partialConfig.modificationStrategy ?? 'smart_injection',
        };
      } else if (partialConfig.hardwareProfile === 'high') {
        newOpt = {
          ...newOpt,
          hardwareProfile: 'high',
          maxTokens: partialConfig.maxTokens ?? 8192,
          webSynthesisStrategy: partialConfig.webSynthesisStrategy ?? 'modular',
          modificationStrategy: partialConfig.modificationStrategy ?? 'smart_injection',
        };
      } else if (partialConfig.hardwareProfile === 'auto') {
        const hw = get().hardware;
        const ramGb = hw?.ram?.totalGb ?? 16;
        const cores = hw?.cpu?.logicalProcessors ?? 4;
        const hasGpu = !!(hw?.gpu?.model);

        if (ramGb < 12 || cores <= 4) {
          newOpt = {
            ...newOpt,
            hardwareProfile: 'auto',
            maxTokens: 3072,
            webSynthesisStrategy: 'single_file',
            modificationStrategy: 'full_overwrite',
          };
        } else if (ramGb >= 24 && hasGpu) {
          newOpt = {
            ...newOpt,
            hardwareProfile: 'auto',
            maxTokens: 6144,
            webSynthesisStrategy: 'auto',
            modificationStrategy: 'smart_injection',
          };
        } else {
          newOpt = {
            ...newOpt,
            hardwareProfile: 'auto',
            maxTokens: 4096,
            webSynthesisStrategy: 'auto',
            modificationStrategy: 'smart_injection',
          };
        }
      }
    } else if (
      partialConfig.maxTokens !== undefined ||
      partialConfig.webSynthesisStrategy !== undefined ||
      partialConfig.modificationStrategy !== undefined
    ) {
      if (currentOpt.hardwareProfile !== 'custom') {
        newOpt.hardwareProfile = 'custom';
      }
    }

    get().updateSettings({ agentOptimization: newOpt });
  },

  setDesignTheme: (partialConfig) => {
    const current = get().settings.designTheme || DEFAULT_SETTINGS.designTheme;
    get().updateSettings({ designTheme: { ...current, ...partialConfig } });
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
