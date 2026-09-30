import { createInstance, type TFunction } from "i18next";
import { de } from "./locales/de.ts";
import { en } from "./locales/en.ts";
import { es } from "./locales/es.ts";
import { fr } from "./locales/fr.ts";
import { sv } from "./locales/sv.ts";
import { zh } from "./locales/zh.ts";

// Each language under the name its own speakers know it by, which is how a picker should list it.
export const LANGUAGES = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  sv: "Svenska",
  zh: "简体中文",
} as const;

export type Language = keyof typeof LANGUAGES;

// Looks a sentence up by its key in one language; the keys and what each takes are checked against English at compile time.
export type Say = TFunction;

// A language is added here and named in LANGUAGES; leaving one out of either is caught by a test.
export const CATALOGS: Record<Language, object> = { en, de, es, fr, sv, zh };

// A plural form a language did not write says what its other form says: French counts in the millions as "many", and a missing form would otherwise be said in English.
const FILLED_FORMS = ["two", "few", "many"];

function withPluralFallbacks(entries: object): object {
  const filled: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      filled[key] = value;
      if (key.endsWith("_other")) {
        const base = key.slice(0, -"_other".length);
        for (const form of FILLED_FORMS) filled[`${base}_${form}`] ??= value;
      }
    } else {
      filled[key] = withPluralFallbacks(value as object);
    }
  }
  return filled;
}

const catalog = createInstance();
void catalog.init({
  resources: Object.fromEntries(
    Object.entries(CATALOGS).map(([code, translation]) => [code, { translation: withPluralFallbacks(translation) }]),
  ),
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
