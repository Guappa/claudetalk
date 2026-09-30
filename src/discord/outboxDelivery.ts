import fs from "node:fs/promises";
import { outboxPath } from "../outboxFolder.ts";
import { collectOutbox, describeSkipped, type OutboxResult } from "./outbox.ts";
import type { MessageSink } from "./messageSink.ts";
import type { Say } from "../i18n/index.ts";

export class OutboxDelivery {
  private readonly reported = new Set<string>();
  // Files that were sent and then could not be removed, by conversation and name, with the mark each was sent at.
  private readonly unremoved = new Map<string, string>();
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
    // A delivery that failed is its own caller's to hear about, not the next one's reason to fail.
    const task = previous.catch(() => 0).then(() => this.run(say, cwd, sessionId, sink, minAgeMs));
    this.inFlight.set(sessionId, task);
    return task.finally(() => {
      if (this.inFlight.get(sessionId) === task) this.inFlight.delete(sessionId);
    });
  }

  private async run(say: Say, cwd: string, sessionId: string, sink: MessageSink, minAgeMs: number): Promise<number> {
    const prefix = `${sessionId}/`;
    const sentAlready = (name: string, mark: string): boolean => this.unremoved.get(prefix + name) === mark;
    let delivered = 0;
    let batch: OutboxResult;
    // What one message could not hold goes in the next one now: left for a later sweep, it is stranded if the conversation is cleared or unbound first.
    do {
      batch = await collectOutbox(cwd, sessionId, minAgeMs, sentAlready);
      delivered += await this.sendBatch(say, prefix, batch, sink);
    } while (batch.files.length > 0 && batch.deferred > 0);
    await this.report(say, sessionId, batch.skipped, sink);
    return delivered;
  }

  // A file held open by something else cannot be removed once it is sent. It is remembered as sent, so that it is not sent again at every sweep and takes no file's place in a later message.
  private async sendBatch(say: Say, prefix: string, batch: OutboxResult, sink: MessageSink): Promise<number> {
    const { files, marks, discard } = batch;
    if (files.length > 0) {
      await sink.sendFiles(files.length === 1 ? files[0]!.name : say("outbox.files", { count: files.length }), files);
    }
    const kept = new Set(await discard());
    for (const held of this.unremoved.keys()) {
      if (held.startsWith(prefix) && !kept.has(held.slice(prefix.length))) this.unremoved.delete(held);
    }
    for (const file of files) {
      if (kept.has(file.name)) this.unremoved.set(prefix + file.name, marks.get(file.name)!);
    }
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
