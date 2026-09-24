export type Language = 'system' | 'en' | 'tr';
export type Theme = 'dark' | 'light';
export type FontSize = 'sm' | 'base' | 'lg';
export type SecurityProfile = 'strict' | 'balanced' | 'autonomous';

export type HardwareOptimizationProfile = 'auto' | 'low' | 'balanced' | 'high' | 'custom';
export type WebSynthesisStrategy = 'auto' | 'single_file' | 'modular';
export type ModificationStrategy = 'smart_injection' | 'full_overwrite';

export interface AgentOptimizationConfig {
  hardwareProfile: HardwareOptimizationProfile;
  maxTokens: number;
  webSynthesisStrategy: WebSynthesisStrategy;
  modificationStrategy: ModificationStrategy;
  /**
   * Ollama context window (num_ctx) used by both the agent and chat.
   * 0 = automatic (derived from hardware profile, clamped to the model's native limit).
   * Without an explicit value Ollama silently falls back to a small default (4096 tokens)
   * and truncates long prompts, which made models lose their instructions.
   */
  contextLength: number;
  /** Let thinking-capable models (qwen3, deepseek-r1, ...) reason before each agent step. Slower on CPU. */
  agentThinking: boolean;
}

export const CONTEXT_LENGTH_AUTO = 0;

export interface WebAccessConfig {
  enabled: boolean;
  chatEnabled: boolean;
  codingEnabled: boolean;
}

export interface AppSettings {
  // General
  language: Language;
  confirmDestructive: boolean;
  securityProfile: SecurityProfile;
  circuitBreakerMinutes: number;

  // Appearance
  theme: Theme;
  fontSize: FontSize;
  reducedMotion: boolean;

  // Chat
  sendOnEnter: boolean;
  showMetadata: boolean;
  autoGenerateTitles: boolean;
  streamResponse: boolean;

  // Web Access (Zero-Trust, user-configurable internet search & fetch)
  webAccess: WebAccessConfig;

  // Ollama
  ollamaEndpoint: string;
  ollamaTimeoutMs: number;
  keepAlive: string;

  // Generation Defaults
  defaultPresetId: string;
  defaultModel: string;

  // Agent Hardware Optimization & Synthesis Strategy (Open-source, configurable)
  agentOptimization: AgentOptimizationConfig;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  confirmDestructive: true,
  securityProfile: 'strict',
  circuitBreakerMinutes: 30,
  theme: 'dark',
  fontSize: 'base',
  reducedMotion: false,
  sendOnEnter: true,
  showMetadata: true,
  autoGenerateTitles: true,
  streamResponse: true,
  webAccess: {
    enabled: true,
    chatEnabled: true,
    codingEnabled: true,
  },
  ollamaEndpoint: 'http://localhost:11434',
  ollamaTimeoutMs: 60000,
  keepAlive: '5m',
  defaultPresetId: 'balanced',
  defaultModel: 'qwen3:8b',
  agentOptimization: {
    hardwareProfile: 'auto',
    maxTokens: 4096,
    webSynthesisStrategy: 'auto',
    modificationStrategy: 'smart_injection',
    contextLength: CONTEXT_LENGTH_AUTO,
    agentThinking: false,
  },
};
