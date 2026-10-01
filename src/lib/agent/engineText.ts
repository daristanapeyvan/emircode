/**
 * engineText.ts
 * The texts the agent shows the user (steps, notices, logs, the final message) in the interface
 * language; they live in the translation files under `engine`. What the agent tells the MODEL stays
 * English in the code: local models follow English instructions more reliably.
 */
import { format, getTranslations } from '../localization/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import type { en } from '../localization/translations/en';

export type EngineTextKey = keyof typeof en.engine;

export function engineTexts(): typeof en.engine {
  return getTranslations(useSettingsStore.getState().settings.language).engine;
}

/** A text of the agent with its "{name}" placeholders filled. */
export function et(key: EngineTextKey, params: Record<string, string | number> = {}): string {
  return format(String(engineTexts()[key]), params);
}
