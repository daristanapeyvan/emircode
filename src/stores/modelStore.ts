import { create } from 'zustand';
import { OllamaModel, OllamaRunningModel, OllamaShowResponse, OllamaPullProgress } from '@/types/ollama';
import { ollamaClient } from '@/lib/ollama/OllamaClient';
import { ModelService } from '@/lib/ollama/ModelService';
import { formatBytes } from '@/lib/utils/formatters';
import { registerCloudModels, knownCloudModel } from '@/lib/ollama/ModelRuntime';
import { CLOUD_PROVIDERS, CloudProviderId, formatModelRef, isCloudRef, parseModelRef } from '@/lib/providers/modelRef';
import type { CloudErrorCode, CloudModelInfo, CloudStatus } from '../../electron/preload';

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

  /** Models of the cloud providers that have a key, newest first per provider. */
  cloudModels: CloudModelInfo[];
  /** Which providers have a key (never the key itself). */
  cloudStatus: CloudStatus | null;
  /** The last error of a provider's model list (a code). */
  cloudErrors: Partial<Record<CloudProviderId, CloudErrorCode>>;
  cloudLoading: boolean;

  checkConnection: (endpoint?: string) => Promise<boolean>;
  fetchModels: () => Promise<void>;
  fetchRunning: () => Promise<void>;
  selectModel: (name: string) => Promise<void>;
  inspectModel: (name: string) => Promise<OllamaShowResponse | null>;
  pullModel: (name: string) => Promise<void>;
  cancelPull: (name: string) => void;
  deleteModel: (name: string) => Promise<void>;
  unloadModel: (name: string) => Promise<void>;

  /** Reads which providers have a key and lists their models. */
  refreshCloud: () => Promise<void>;
  /** After a key was saved or removed: the new status and, if given, the provider's models. */
  applyCloudStatus: (status: CloudStatus, provider?: CloudProviderId, models?: CloudModelInfo[]) => void;
}

/** What the composer needs to know about a cloud model (vision), in the shape of Ollama's /api/show. */
function cloudDetails(ref: string): OllamaShowResponse {
  const info = knownCloudModel(ref);
  const { provider } = parseModelRef(ref);
  const vision = info?.vision ?? provider === 'anthropic';
  return {
    capabilities: ['completion', ...(vision ? ['vision'] : []), ...(info?.thinking ? ['thinking'] : [])],
    details: { family: info?.family || provider, parameter_size: info?.parameterSize },
  };
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
  cloudModels: [],
  cloudStatus: null,
  cloudErrors: {},
  cloudLoading: false,

  checkConnection: async (endpoint) => {
    set({ connectionStatus: 'connecting', connectionError: null });
    const targetEndpoint = endpoint || ollamaClient.getEndpoint();
    let res = await ollamaClient.testConnection(targetEndpoint);

    // Auto-recovery: If local Ollama endpoint cannot be reached, try auto-starting local service
    const isLocal = !targetEndpoint || targetEndpoint.includes('localhost') || targetEndpoint.includes('127.0.0.1');
    if (!res.ok && isLocal && window.electronAPI?.startOllamaService) {
      try {
        const started = await window.electronAPI.startOllamaService();
        if (started) {
          await new Promise((r) => setTimeout(r, 1000));
          res = await ollamaClient.testConnection(targetEndpoint);
        }
      } catch {
        // ignore
      }
    }

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

      // A cloud model stays selected: it does not depend on the local Ollama.
      let nextSelected = currentSelected;
      if (!currentSelected || (!isCloudRef(currentSelected) && !models.some((m) => m.name === currentSelected))) {
        if (models.length > 0) {
          nextSelected = models[0].name;
        } else {
          const cloud = get().cloudModels[0];
          nextSelected = cloud ? formatModelRef(cloud.provider, cloud.id) : '';
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
    if (isCloudRef(name)) {
      set({ selectedModelDetails: cloudDetails(name) });
      return;
    }
    try {
      const details = await modelService.getModelDetails(name);
      set({ selectedModelDetails: details });
    } catch (err) {
      console.error('Failed to get model details for selector:', err);
    }
  },

  inspectModel: async (name: string) => {
    if (isCloudRef(name)) return cloudDetails(name);
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

  refreshCloud: async () => {
    const api = window.electronAPI;
    if (!api?.cloudStatus || !api.cloudListModels) return;
    set({ cloudLoading: true });
    try {
      const status = await api.cloudStatus();
      const lists = await Promise.all(
        CLOUD_PROVIDERS.map(async (provider) => {
          if (!status.providers[provider]?.configured) return { provider, models: [] as CloudModelInfo[] };
          const res = await api.cloudListModels!(provider);
          return res.ok ? { provider, models: res.models } : { provider, models: [] as CloudModelInfo[], error: res.error.code };
        })
      );
      const cloudErrors: Partial<Record<CloudProviderId, CloudErrorCode>> = {};
      for (const list of lists) if ('error' in list && list.error) cloudErrors[list.provider] = list.error;
      const cloudModels = lists.flatMap((l) => l.models);
      registerCloudModels(cloudModels);
      set({ cloudStatus: status, cloudModels, cloudErrors });
      const selected = get().selectedModel;
      if (!selected && cloudModels.length && get().installedModels.length === 0) {
        get().selectModel(formatModelRef(cloudModels[0].provider, cloudModels[0].id));
      } else if (isCloudRef(selected)) {
        set({ selectedModelDetails: cloudDetails(selected) });
      }
    } catch (err) {
      console.error('Failed to read the cloud providers:', err);
    } finally {
      set({ cloudLoading: false });
    }
  },

  applyCloudStatus: (status, provider, models) => {
    set((state) => {
      let cloudModels = state.cloudModels.filter((m) => status.providers[m.provider]?.configured);
      const cloudErrors = { ...state.cloudErrors };
      if (provider && models) {
        cloudModels = [...cloudModels.filter((m) => m.provider !== provider), ...models];
        delete cloudErrors[provider];
        registerCloudModels(models);
      }
      if (provider && !status.providers[provider]?.configured) delete cloudErrors[provider];
      return { cloudStatus: status, cloudModels, cloudErrors };
    });
    const selected = get().selectedModel;
    if (isCloudRef(selected) && !status.providers[parseModelRef(selected).provider as CloudProviderId]?.configured) {
      const local = get().installedModels[0];
      get().selectModel(local ? local.name : '');
    }
  },
}));
