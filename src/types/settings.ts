export type Language = 'system' | 'en' | 'tr';
export type Theme = 'dark' | 'light';
export type FontSize = 'sm' | 'base' | 'lg';
export type SecurityProfile = 'strict' | 'balanced' | 'autonomous';

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
    enabled: false,
    chatEnabled: false,
    codingEnabled: false,
  },
  ollamaEndpoint: 'http://localhost:11434',
  ollamaTimeoutMs: 60000,
  keepAlive: '5m',
  defaultPresetId: 'balanced',
  defaultModel: 'qwen3:8b',
};
