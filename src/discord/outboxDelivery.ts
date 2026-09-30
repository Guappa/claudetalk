import fs from "node:fs/promises";
import { collectOutbox, describeSkipped, outboxPath } from "./outbox.ts";
import type { MessageSink } from "./messageSink.ts";
import type { Say } from "../i18n/index.ts";

export class OutboxDelivery {
  private readonly reported = new Set<string>();
  private readonly inFlight = new Map<string, Promise<number>>();

  async hasFiles(cwd: string, sessionId: string): Promise<boolean> {
    try {
      return (await fs.readdir(outboxPath(cwd, sessionId))).length > 0;
    } catch {
      return false;
    }
  }

  // Deliveries for one conversation run in series, so a sweep and the turn's own delivery cannot both send a file.
  deliver(say: Say, cwd: string, sessionId: string, sink: MessageSink, minAgeMs = 0): Promise<number> {
    const previous = this.inFlight.get(sessionId) ?? Promise.resolve(0);
    const task = previous.then(() => this.run(say, cwd, sessionId, sink, minAgeMs));
    this.inFlight.set(sessionId, task);
    return task.finally(() => {
      if (this.inFlight.get(sessionId) === task) this.inFlight.delete(sessionId);
    });
  }

  private async run(say: Say, cwd: string, sessionId: string, sink: MessageSink, minAgeMs: number): Promise<number> {
    const { files, skipped, discard } = await collectOutbox(cwd, sessionId, minAgeMs);
    if (files.length > 0) {
      await sink.sendFiles(files.length === 1 ? files[0]!.name : say("outbox.files", { count: files.length }), files);
    }
    await discard();
    await this.report(say, sessionId, skipped, sink);
    return files.length;
  }

  // A file left behind is named once, not on every sweep until somebody deletes it.
  private async report(say: Say, sessionId: string, skipped: string[], sink: MessageSink): Promise<void> {
    const prefix = `${sessionId}/`;
    const still = new Set(skipped.map((name) => prefix + name));
    for (const key of this.reported) {
      if (key.startsWith(prefix) && !still.has(key)) this.reported.delete(key);
    }
    const fresh = skipped.filter((name) => !this.reported.has(prefix + name));
    for (const name of fresh) this.reported.add(prefix + name);

    const note = describeSkipped(say, fresh, sessionId);
    if (note) await sink.send(note);
  }
}
