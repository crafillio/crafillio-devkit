import { create } from 'zustand';
import { en } from './locales/en';
import type { Messages } from './locales/en';

/**
 * Translation.
 *
 * English is the source of truth: `Messages` is derived from it, so adding a
 * key without translating it is a type error in every other locale rather than
 * a string that silently goes missing at runtime.
 *
 * Locales load on demand — shipping every language in the main bundle would
 * cost every user the weight of languages they will never read.
 */

export type LocaleCode = 'en' | 'de' | 'fr' | 'es';

export interface LocaleMeta {
  code: LocaleCode;
  /** Written in the language itself, as is conventional in a language picker. */
  label: string;
  english: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'de', label: 'Deutsch', english: 'German' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'es', label: 'Español', english: 'Spanish' },
];

/** A partial translation: anything missing falls back to English. */
export type PartialMessages = { [K in keyof Messages]?: Partial<Messages[K]> };

const loaders: Record<Exclude<LocaleCode, 'en'>, () => Promise<{ messages: PartialMessages }>> = {
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  es: () => import('./locales/es'),
};

interface I18nState {
  locale: LocaleCode;
  messages: Messages;
  /** Loads a locale and switches to it. English needs no fetch. */
  setLocale(locale: LocaleCode): Promise<void>;
}

/** Overlays a partial translation on English so gaps degrade rather than break. */
function merge(partial: PartialMessages): Messages {
  const out: Record<string, Record<string, string>> = {};
  for (const group of Object.keys(en)) {
    out[group] = {
      ...(en as Record<string, Record<string, string>>)[group],
      ...((partial as Record<string, Record<string, string> | undefined>)[group] ?? {}),
    };
  }
  return out as unknown as Messages;
}

export const useI18n = create<I18nState>((set) => ({
  locale: 'en',
  messages: en,

  async setLocale(locale) {
    if (locale === 'en') {
      set({ locale, messages: en });
      document.documentElement.lang = 'en';
      return;
    }
    try {
      const loaded = await loaders[locale]();
      set({ locale, messages: merge(loaded.messages) });
      document.documentElement.lang = locale;
    } catch {
      // A missing or broken locale must not leave the app blank.
      set({ locale: 'en', messages: en });
      document.documentElement.lang = 'en';
    }
  },
}));

/**
 * Translation hook.
 *
 * Usage: `const t = useT(); t.common.save`
 *
 * Returning the message tree rather than a `t('a.b.c')` lookup keeps every key
 * type-checked — a typo is a compile error, not a string of dots on screen.
 */
export function useT(): Messages {
  return useI18n((s) => s.messages);
}

/** For non-React callers such as store actions. */
export function messages(): Messages {
  return useI18n.getState().messages;
}

/**
 * Fills `{name}` placeholders.
 *
 * Interpolation is done here rather than by concatenating strings, because
 * word order differs between languages and a sentence split across
 * concatenation cannot be translated properly.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export type { Messages };
