import { createInstance, type TFunction } from "i18next";
import { en } from "./locales/en.ts";
import { sv } from "./locales/sv.ts";

// Each language under the name its own speakers know it by, which is how a picker should list it.
export const LANGUAGES = {
  en: "English",
  sv: "Svenska",
} as const;

export type Language = keyof typeof LANGUAGES;

// Looks a sentence up by its key in one language; the keys and what each takes are checked against English at compile time.
export type Say = TFunction;

// A language is added here and named in LANGUAGES; leaving one out of either is caught by a test.
export const CATALOGS: Record<Language, object> = { en, sv };

const catalog = createInstance();
void catalog.init({
  resources: Object.fromEntries(Object.entries(CATALOGS).map(([code, translation]) => [code, { translation }])),
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function isLanguage(value: string): value is Language {
  return Object.hasOwn(LANGUAGES, value);
}

export function sayIn(language: Language): Say {
  return catalog.getFixedT(language);
}
