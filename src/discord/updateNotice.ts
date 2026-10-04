import type { SendableChannels } from "discord.js";
import type { Bridge } from "../bridge.ts";
import type { Say } from "../i18n/index.ts";
import { orderedWriter, readJsonOr } from "../jsonFile.ts";
import { errorMessage } from "../text.ts";
import type { UpdateCheck, UpdateNews } from "../updateCheck.ts";
import { sendNotice } from "./notice.ts";

// Versions can come several to a day; said per version, the notice would be the noisiest thing the bridge does.
const QUIET_FOR_MS = 7 * 24 * 60 * 60 * 1000;
// Longer than other notices: this one carries a list and a link, and there is no hurry in it.
const SHOWN_FOR_MS = 5 * 60_000;
const MAX_CHANGES_SHOWN = 5;

interface Told {
  version: string;
  at: string;
}

// Remembers what an owner was last told of and when, across restarts, so a newer version is said once and never more than weekly.
export class UpdateNotice {
  private readonly filePath: string;
  private readonly updates: UpdateCheck;
  private readonly now: () => number;
  private readonly write: (value: unknown) => Promise<void>;
  private told: Told | null = null;

  constructor(filePath: string, updates: UpdateCheck, now: () => number = Date.now) {
    this.filePath = filePath;
    this.updates = updates;
    this.now = now;
    this.write = orderedWriter(filePath);
  }

  async load(): Promise<void> {
    this.told = await readJsonOr<Told | null>(this.filePath, () => null);
  }

  // Taken in one step, so two messages arriving together cannot both be told.
  take(): UpdateNews | null {
    const news = this.updates.news();
    if (!news || news.version === this.told?.version) return null;
    if (this.told && this.now() - Date.parse(this.told.at) < QUIET_FOR_MS) return null;
    this.told = { version: news.version, at: new Date(this.now()).toISOString() };
    void this.write(this.told).catch((error: unknown) => {
      console.error(`could not write ${this.filePath}: ${errorMessage(error)}`);
    });
    return news;
  }
}

export function describeUpdate(say: Say, news: UpdateNews): string {
  const shown = news.changes.slice(0, MAX_CHANGES_SHOWN).map((change) => `- ${change}`);
  const unshown = news.changes.length - shown.length;
  return [
    say("update.out", { version: news.version, current: news.current, count: news.behind }),
    ...shown,
    ...(unshown > 0 ? [say("update.more", { count: unshown })] : []),
    say("update.how", { url: news.url }),
  ].join("\n");
}

// Said to an owner who is here anyway, where they are: a message the bridge sent on its own would reach people who never asked for one.
export async function tellOwnerOfUpdate(bridge: Bridge, channel: SendableChannels): Promise<void> {
  const news = bridge.updateNotice.take();
  if (!news) return;
  // A courtesy that could not be posted is no reason to refuse the turn it came with.
  await sendNotice(channel, describeUpdate(bridge.language.say, news), SHOWN_FOR_MS).catch((error: unknown) => {
    console.error(`could not say in channel ${channel.id} that a newer version is out: ${errorMessage(error)}`);
  });
}
