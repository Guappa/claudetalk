import { orderedWriter, readStore } from "./jsonFile.ts";

export class OperatorStore {
  private ids: string[] = [];
  private readonly filePath: string;
  private readonly write: (value: unknown) => Promise<void>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.write = orderedWriter(filePath);
  }

  async load(): Promise<void> {
    // Read as empty, the list would be written over by the next /operator change, so one that cannot be read stops the start.
    const parsed = await readStore<unknown>(this.filePath, () => []);
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
    await this.write(this.ids);
    return true;
  }

  async remove(userId: string): Promise<boolean> {
    if (!this.ids.includes(userId)) return false;
    this.ids = this.ids.filter((id) => id !== userId);
    await this.write(this.ids);
    return true;
  }
}
