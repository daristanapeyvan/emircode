/**
 * checkTexts.ts
 * The texts of the acceptance checks (TaskContract / TaskValidator) as keys with parameters. The
 * model reads them in English; the user sees them in the interface language. Kept independent of
 * the settings store, so the checks stay usable in tests and the E2E harness.
 */
import { en } from '../localization/translations/en';
import { tr } from '../localization/translations/tr';
import { format } from '../localization/i18n';

export type CheckKey = keyof typeof en.checks;
export type CheckParam = string | number | CheckText | CheckText[];

export interface CheckText {
  key: CheckKey;
  params?: Record<string, CheckParam>;
}

export const check = (key: CheckKey, params?: Record<string, CheckParam>): CheckText => ({ key, params });

const isText = (value: unknown): value is CheckText => !!value && typeof value === 'object' && 'key' in (value as any);

/** A check text in one language; nested texts (the dead links of a menu) are joined with "; ". */
export function renderCheck(text: CheckText, language: 'en' | 'tr' = 'en'): string {
  const texts = language === 'tr' ? tr.checks : en.checks;
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(text.params || {})) {
    if (Array.isArray(value)) params[name] = value.map((v) => renderCheck(v, language)).join('; ');
    else if (isText(value)) params[name] = renderCheck(value, language);
    else params[name] = value as string | number;
  }
  return format(String(texts[text.key]), params);
}
