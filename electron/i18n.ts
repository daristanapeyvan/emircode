/**
 * Texts the main process shows or returns to the interface (errors of file, command and web
 * requests), in the interface language. They live in the same translation files as the rest of
 * the app, under `main`; the renderer tells the main process which language it uses.
 */
import { en } from '../src/lib/localization/translations/en';
import { tr } from '../src/lib/localization/translations/tr';

type MainTexts = typeof en.main;

let language: 'tr' | 'en' = 'en';

export function setMainLanguage(value: unknown): void {
  if (value === 'tr' || value === 'en') language = value;
}

/** Default before the interface has loaded its settings: the system language. */
export function initMainLanguage(locale: string): void {
  language = locale.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function mainTexts(): MainTexts {
  return language === 'tr' ? tr.main : en.main;
}

/** A main-process text with its "{name}" placeholders filled. */
export function mt(key: keyof MainTexts, params: Record<string, string | number> = {}): string {
  const template = String(mainTexts()[key]);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
