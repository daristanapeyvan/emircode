import { Language } from '@/types/settings';
import { en } from './translations/en';
import { tr } from './translations/tr';

export const translations = {
  en,
  tr,
};

export type Translations = typeof en;

export function detectSystemLanguage(): 'tr' | 'en' {
  const electronLocale = typeof window !== 'undefined' && (window as any).__systemLocale;
  if (electronLocale && typeof electronLocale === 'string') {
    if (electronLocale.toLowerCase().startsWith('tr')) return 'tr';
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('tr')) {
      return 'tr';
    }
  }
  return 'en';
}

export function resolveLanguage(lang?: Language): 'tr' | 'en' {
  if (!lang || lang === 'system') {
    return detectSystemLanguage();
  }
  return lang === 'tr' ? 'tr' : 'en';
}

export function getTranslations(lang?: Language): Translations {
  const resolved = resolveLanguage(lang);
  return translations[resolved] || translations.tr;
}
