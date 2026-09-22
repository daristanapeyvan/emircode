import { OllamaClient } from './OllamaClient';
import { OllamaModel, OllamaRunningModel, OllamaShowResponse, OllamaPullProgress } from '@/types/ollama';

export interface DiscoverModelItem {
  id: string;
  name: string;
  family: string;
  parameterSize: string;
  approxSize: string;
  description: string;
  capabilities: ('chat' | 'reasoning' | 'vision' | 'tools' | 'coding')[];
  recommendedRamGb: number;
}

export const CURATED_DISCOVER_MODELS: DiscoverModelItem[] = [
  {
    id: 'qwen3:8b',
    name: 'Qwen3 8B',
    family: 'qwen3',
    parameterSize: '8.2B',
    approxSize: '5.2 GB',
    description: 'High-performance multilingual model with native reasoning capabilities.',
    capabilities: ['chat', 'reasoning', 'tools'],
    recommendedRamGb: 8,
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B',
    family: 'qwen2.5',
    parameterSize: '7.6B',
    approxSize: '4.7 GB',
    description: 'Specialized code generation, debugging, and software architecture model.',
    capabilities: ['chat', 'coding', 'tools'],
    recommendedRamGb: 8,
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    family: 'llama',
    parameterSize: '8.0B',
    approxSize: '4.7 GB',
    description: 'Meta\'s industry standard instruction-tuned model with 128k context support.',
    capabilities: ['chat', 'tools'],
    recommendedRamGb: 8,
  },
  {
    id: 'deepseek-r1:8b',
    name: 'DeepSeek R1 8B',
    family: 'deepseek',
    parameterSize: '8.0B',
    approxSize: '4.9 GB',
    description: 'Reinforcement-learning tuned reasoning model with explicit thought traces.',
    capabilities: ['chat', 'reasoning'],
    recommendedRamGb: 8,
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    family: 'mistral',
    parameterSize: '7.2B',
    approxSize: '4.1 GB',
    description: 'Fast, compact, and balanced general-purpose language model.',
    capabilities: ['chat'],
    recommendedRamGb: 8,
  },
  {
    id: 'gemma2:2b',
    name: 'Gemma 2 2B',
    family: 'gemma2',
    parameterSize: '2.6B',
    approxSize: '1.6 GB',
    description: 'Ultra-lightweight model by Google, excellent for systems with limited RAM.',
    capabilities: ['chat'],
    recommendedRamGb: 4,
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B',
    family: 'gemma2',
    parameterSize: '9.2B',
    approxSize: '5.5 GB',
    description: 'Google\'s capable medium-tier model with strong reasoning and instruction following.',
    capabilities: ['chat'],
    recommendedRamGb: 12,
  },
  {
    id: 'phi4:14b',
    name: 'Phi-4 14B',
    family: 'phi4',
    parameterSize: '14.7B',
    approxSize: '9.1 GB',
    description: 'Microsoft\'s state-of-the-art small language model with high math & coding density.',
    capabilities: ['chat', 'reasoning', 'coding'],
    recommendedRamGb: 16,
  },
  {
    id: 'llama3.2-vision:11b',
    name: 'Llama 3.2 Vision 11B',
    family: 'llama3.2-vision',
    parameterSize: '11.0B',
    approxSize: '7.9 GB',
    description: 'Multimodal vision model capable of visual understanding and image analysis.',
    capabilities: ['chat', 'vision'],
    recommendedRamGb: 16,
  },
];

export class ModelService {
  private client: OllamaClient;
  private activePullControllers = new Map<string, AbortController>();

  constructor(client: OllamaClient) {
    this.client = client;
  }

  async getInstalledModels(): Promise<OllamaModel[]> {
    return await this.client.listModels();
  }

  async getRunningModels(): Promise<OllamaRunningModel[]> {
    return await this.client.listRunning();
  }

  async getModelDetails(name: string): Promise<OllamaShowResponse> {
    return await this.client.showModel(name);
  }

  async deleteModel(name: string): Promise<void> {
    await this.client.deleteModel(name);
  }

  async unloadModel(name: string): Promise<void> {
    await this.client.unloadModel(name);
  }

  pullModel(
    name: string,
    onProgress: (progress: OllamaPullProgress) => void
  ): { promise: Promise<void>; cancel: () => void } {
    const controller = new AbortController();
    this.activePullControllers.set(name, controller);

    const promise = (async () => {
      try {
        await this.client.pullModel(name, onProgress, controller.signal);
      } finally {
        this.activePullControllers.delete(name);
      }
    })();

    const cancel = () => {
      controller.abort();
      this.activePullControllers.delete(name);
    };

    return { promise, cancel };
  }

  cancelPull(name: string) {
    const controller = this.activePullControllers.get(name);
    if (controller) {
      controller.abort();
      this.activePullControllers.delete(name);
    }
  }

  isPulling(name: string): boolean {
    return this.activePullControllers.has(name);
  }
}
