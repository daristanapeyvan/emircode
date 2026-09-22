import { create } from 'zustand';
import { OllamaModel, OllamaRunningModel, OllamaShowResponse, OllamaPullProgress } from '@/types/ollama';
import { ollamaClient } from '@/lib/ollama/OllamaClient';
import { ModelService } from '@/lib/ollama/ModelService';
import { formatBytes } from '@/lib/utils/formatters';

const modelService = new ModelService(ollamaClient);

export interface ActiveDownload {
  name: string;
  status: string;
  completed: number;
  total: number;
  percentage: number;
  speed: string;
}

interface ModelState {
  installedModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  selectedModel: string;
  selectedModelDetails: OllamaShowResponse | null;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  connectionError: string | null;
  downloads: Record<string, ActiveDownload>;
  isRefreshing: boolean;

  checkConnection: (endpoint?: string) => Promise<boolean>;
  fetchModels: () => Promise<void>;
  fetchRunning: () => Promise<void>;
  selectModel: (name: string) => Promise<void>;
  inspectModel: (name: string) => Promise<OllamaShowResponse | null>;
  pullModel: (name: string) => Promise<void>;
  cancelPull: (name: string) => void;
  deleteModel: (name: string) => Promise<void>;
  unloadModel: (name: string) => Promise<void>;
}

export const useModelStore = create<ModelState>((set, get) => ({
  installedModels: [],
  runningModels: [],
  selectedModel: '',
  selectedModelDetails: null,
  connectionStatus: 'connecting',
  connectionError: null,
  downloads: {},
  isRefreshing: false,

  checkConnection: async (endpoint) => {
    set({ connectionStatus: 'connecting', connectionError: null });
    const res = await ollamaClient.testConnection(endpoint);
    if (res.ok) {
      set({ connectionStatus: 'connected', connectionError: null });
      get().fetchModels();
      get().fetchRunning();
      return true;
    } else {
      set({ connectionStatus: 'disconnected', connectionError: res.error || 'Cannot connect to Ollama' });
      return false;
    }
  },

  fetchModels: async () => {
    set({ isRefreshing: true });
    try {
      const models = await modelService.getInstalledModels();
      const currentSelected = get().selectedModel;

      let nextSelected = currentSelected;
      if (!currentSelected || !models.some((m) => m.name === currentSelected)) {
        if (models.length > 0) {
          nextSelected = models[0].name;
        } else {
          nextSelected = '';
        }
      }

      set({
        installedModels: models,
        selectedModel: nextSelected,
        connectionStatus: 'connected',
        connectionError: null,
      });

      if (nextSelected) {
        get().selectModel(nextSelected);
      }
    } catch (err: any) {
      set({
        connectionStatus: 'disconnected',
        connectionError: err.message || 'Failed to list models',
      });
    } finally {
      set({ isRefreshing: false });
    }
  },

  fetchRunning: async () => {
    try {
      const running = await modelService.getRunningModels();
      set({ runningModels: running });
    } catch (err) {
      console.error('Failed to get running models:', err);
    }
  },

  selectModel: async (name: string) => {
    set({ selectedModel: name });
    try {
      const details = await modelService.getModelDetails(name);
      set({ selectedModelDetails: details });
    } catch (err) {
      console.error('Failed to get model details for selector:', err);
    }
  },

  inspectModel: async (name: string) => {
    try {
      return await modelService.getModelDetails(name);
    } catch (err) {
      console.error('Failed to inspect model:', err);
      return null;
    }
  },

  pullModel: async (name: string) => {
    let lastTime = Date.now();
    let lastCompleted = 0;

    const { promise } = modelService.pullModel(name, (progress: OllamaPullProgress) => {
      const total = progress.total || 0;
      const completed = progress.completed || 0;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      let speed = '';
      if (timeDiff >= 0.5 && completed > lastCompleted) {
        const bytesDiff = completed - lastCompleted;
        speed = `${formatBytes(bytesDiff / timeDiff)}/s`;
        lastTime = now;
        lastCompleted = completed;
      }

      set((state) => ({
        downloads: {
          ...state.downloads,
          [name]: {
            name,
            status: progress.status,
            completed,
            total,
            percentage,
            speed: speed || state.downloads[name]?.speed || '',
          },
        },
      }));
    });

    try {
      await promise;
      // Download completed
      set((state) => {
        const next = { ...state.downloads };
        delete next[name];
        return { downloads: next };
      });
      // Refresh models
      await get().fetchModels();
    } catch (err) {
      set((state) => {
        const next = { ...state.downloads };
        delete next[name];
        return { downloads: next };
      });
      throw err;
    }
  },

  cancelPull: (name: string) => {
    modelService.cancelPull(name);
    set((state) => {
      const next = { ...state.downloads };
      delete next[name];
      return { downloads: next };
    });
  },

  deleteModel: async (name: string) => {
    await modelService.deleteModel(name);
    await get().fetchModels();
    await get().fetchRunning();
  },

  unloadModel: async (name: string) => {
    await modelService.unloadModel(name);
    await get().fetchRunning();
  },
}));
