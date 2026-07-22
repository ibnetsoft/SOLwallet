'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import ko from './locales/ko';
import en from './locales/en';
import type { TranslationKey } from './locales/ko';

export type Locale = 'en' | 'ko';

const STORAGE_KEY = 'solwallet_language';
const DEFAULT_LOCALE: Locale = 'en';

const translations: Record<Locale, Record<TranslationKey, string>> = { en, ko };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a key, with optional {var} interpolation */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    return stored && translations[stored] ? stored : DEFAULT_LOCALE;
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      let text = translations[locale]?.[key] ?? translations.en[key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Hook to access i18n. Returns { locale, setLocale, t }.
 * Must be used inside <I18nProvider>.
 */
export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx;
}

/**
 * Non-hook helper for use outside React (stores, api files).
 * Reads locale from localStorage directly.
 */
export function getMsg(key: TranslationKey, vars?: Record<string, string | number>): string {
  let locale: Locale = DEFAULT_LOCALE;
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && translations[stored]) locale = stored;
  }
  let text = translations[locale]?.[key] ?? translations.en[key] ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  return text;
}