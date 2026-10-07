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

/** The isolated environment of the agent's commands (see electron/sandbox.ts). */
export interface CommandIsolationConfig {
  /** Run commands isolated where the system allows it. */
  enabled: boolean;
  /** Isolated commands may use the internet (local services stay unreachable). */
  network: boolean;
}

/** "auto" = the provider's default; the rest: see CloudEffort (electron/cloud/types.ts). */
export type CloudEffortSetting = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A price per million tokens in US dollars (input, input read from the cache, output). */
export interface ModelPrice {
  input: number;
  cachedInput?: number;
  output: number;
}

/**
 * Cloud models (Ollama Cloud, Claude, GPT, Gemini, Mistral, OpenAI-compatible servers). The API keys
 * and server addresses are not here: the main process keeps them.
 */
export interface CloudConfig {
  /**
   * Context window of cloud models in tokens, for the agent's budget. 0 = automatic (64K, never
   * more than the model takes). Larger values shorten the history less but cost more per step.
   */
  contextLength: number;
  /** Effort of the agent's steps (Claude effort, OpenAI reasoning effort, Gemini thinking level). */
  agentEffort: CloudEffortSetting;
  /** Effort of chat answers. */
  chatEffort: CloudEffortSetting;
  /** Show the reasoning summaries of OpenAI's reasoning models (in the thinking block). */
  reasoningSummaries: boolean;
  /**
   * Models shown in the model selector, per provider ("anthropic" → ["claude-opus-5-5", …]). A
   * provider without an entry shows its default selection (see visibleModels.ts). Hidden models stay
   * reachable from the command palette and the selector's search.
   */
  visibleModels: Record<string, string[]>;
  /** Prices the user set, by model reference; they win over the built-in table (pricing.ts). */
  prices: Record<string, ModelPrice>;
  /** Estimated cost after which the agent stops a task, in US dollars (0 = no limit). */
  taskBudgetUsd: number;
  /** Experimental: Claude and GPT get the agent's actions as their own tools (see nativeTools.ts). */
  nativeTools: boolean;
}

export interface WebAccessConfig {
  enabled: boolean;
  chatEnabled: boolean;
  codingEnabled: boolean;
}

/** How a new web page gets its design theme: off, by the site's topic, random, or one fixed theme. */
export type DesignThemeMode = 'off' | 'topic' | 'random' | 'fixed';
/** The component stylesheet (buttons, forms, tables, cards): automatic = on for models below 8B. */
export type DesignBaseCssMode = 'auto' | 'on' | 'off';

export interface DesignThemeConfig {
  mode: DesignThemeMode;
  /** Theme used when mode is 'fixed'. */
  fixedThemeId: string;
  baseCss: DesignBaseCssMode;
  /** Load theme fonts from Google Fonts; off = system fonts only (no request leaves the page). */
  webFonts: boolean;
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

  // Isolated environment of the agent's commands
  commandIsolation: CommandIsolationConfig;

  // Cloud models (Ollama Cloud, Claude, GPT)
  cloud: CloudConfig;

  // Ollama
  ollamaEndpoint: string;
  ollamaTimeoutMs: number;
  keepAlive: string;

  // Generation Defaults
  defaultPresetId: string;
  defaultModel: string;

  // Agent Hardware Optimization & Synthesis Strategy (Open-source, configurable)
  agentOptimization: AgentOptimizationConfig;

  // Design themes for web pages the agent creates
  designTheme: DesignThemeConfig;
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
  commandIsolation: { enabled: true, network: false },
  webAccess: {
    enabled: true,
    chatEnabled: true,
    codingEnabled: true,
  },
  cloud: {
    contextLength: 0,
    agentEffort: 'auto',
    chatEffort: 'auto',
    reasoningSummaries: true,
    visibleModels: {},
    prices: {},
    taskBudgetUsd: 0,
    nativeTools: false,
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
  designTheme: {
    mode: 'topic',
    fixedThemeId: 'kum',
    baseCss: 'auto',
    webFonts: true,
  },
};
