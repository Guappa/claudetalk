import { readJsonOr, writeJsonAtomic } from "../jsonFile.ts";
import { isLanguage, sayIn, type Language, type Say } from "./index.ts";

// The language the bridge itself speaks: the host's default until someone picks one in Discord, which then outlives a restart.
export class LanguageChoice {
  private chosen: Language;
  private picked = false;
  private readonly filePath: string;

  constructor(filePath: string, hostDefault: Language) {
    this.filePath = filePath;
    this.chosen = hostDefault;
  }

  async load(): Promise<void> {
    const stored = await readJsonOr<{ language?: unknown }>(this.filePath, () => ({}));
    if (typeof stored?.language !== "string" || !isLanguage(stored.language)) return;
    this.chosen = stored.language;
    this.picked = true;
  }

  current(): Language {
    return this.chosen;
  }

  // True once the language came from Discord and no longer follows the host's default.
  wasPicked(): boolean {
    return this.picked;
  }

  get say(): Say {
    return sayIn(this.chosen);
  }

  async choose(language: Language): Promise<void> {
    this.chosen = language;
    this.picked = true;
    await writeJsonAtomic(this.filePath, { language });
  }
}
