import { readJsonOr, writeJsonAtomic } from "./jsonFile.ts";

export class OperatorStore {
  private ids: string[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    const parsed = await readJsonOr<unknown>(this.filePath, () => []);
    this.ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  }

  all(): string[] {
    return [...this.ids];
  }

  has(userId: string): boolean {
    return this.ids.includes(userId);
  }

  async add(userId: string): Promise<boolean> {
    if (this.ids.includes(userId)) return false;
    this.ids.push(userId);
    await writeJsonAtomic(this.filePath, this.ids);
    return true;
  }

  async remove(userId: string): Promise<boolean> {
    if (!this.ids.includes(userId)) return false;
    this.ids = this.ids.filter((id) => id !== userId);
    await writeJsonAtomic(this.filePath, this.ids);
    return true;
  }
}
