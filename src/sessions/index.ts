import fs from "node:fs/promises";
import path from "node:path";
import { claudeProjectsDir, expandShortPath } from "../platform.ts";
import { newestCopy } from "./resolve.ts";
import { scanTranscript } from "./transcriptScanner.ts";
import { listActiveSessions, type ActiveSession } from "./activeSessions.ts";

const TRANSCRIPT_SUFFIX = ".jsonl";

export interface SessionRecord {
  sessionId: string;
  name: string | null;
  cwd: string | null;
  lastActivity: Date | null;
  transcriptPath: string;
  sizeBytes: number;
  live: ActiveSession | null;
}

export type ResumableRecord = SessionRecord & { cwd: string };

// A transcript without a working directory cannot be resumed, and every resume path checks this first.
export function hasWorkingDir(record: SessionRecord): record is ResumableRecord {
  return record.cwd !== null;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  record: SessionRecord;
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

// Listing live sessions spawns the CLI, and a picker keystroke or a turn's bookkeeping asks several times a second.
const LIVE_CACHE_MS = 5000;
// Long enough to ride out a CLI that is briefly too busy to answer, short enough that a terminal closed since stops holding its conversation.
const LIVE_TRUST_MS = 60_000;

type ListLive = () => Promise<ActiveSession[] | null>;

interface LiveListing {
  asked: number;
  listed: number;
  sessions: ActiveSession[];
}

export class SessionIndex {
  private readonly scanned = new Map<string, CacheEntry>();
  private live: LiveListing | null = null;
  // The listing on its way, if one is: every look that arrives meanwhile waits for it instead of spawning its own.
  private listing: Promise<ActiveSession[]> | null = null;
  private forgotten = 0;
  private readonly listLive: ListLive;
  private readonly root: string;
  private readonly now: () => number;

  // Each defaults to the host's own; a test hands in a folder, a listing and a clock of its making.
  constructor(listLive: ListLive = listActiveSessions, root: string = claudeProjectsDir(), now: () => number = Date.now) {
    this.listLive = listLive;
    this.root = root;
    this.now = now;
  }

  private liveSessions(): Promise<ActiveSession[]> {
    if (this.live && this.now() - this.live.asked < LIVE_CACHE_MS) return Promise.resolve(this.live.sessions);
    this.listing ??= this.list().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private async list(): Promise<ActiveSession[]> {
    const forgotten = this.forgotten;
    const sessions = await this.listLive();
    const asked = this.now();
    const known = this.live;
    // A listing that failed is not word that nothing is live, so the last one that worked stands for a while; held for good it would refuse a conversation over a terminal closed days ago.
    const believed = known !== null && asked - known.listed < LIVE_TRUST_MS ? known.sessions : [];
    const listing =
      sessions !== null ? { asked, listed: asked, sessions } : { asked, listed: known?.listed ?? 0, sessions: believed };
    // A listing that was out while something was stopped may still name it, and is not kept.
    if (forgotten === this.forgotten) this.live = listing;
    return listing.sessions;
  }

  // What was live a moment ago stops being true the instant something is stopped.
  forgetLive(): void {
    this.live = null;
    this.forgotten += 1;
  }

  // A transcript is named after its session, so the one asked for is looked for by name in each project folder, and nothing else is read.
  async find(sessionId: string): Promise<SessionRecord | null> {
    // The id names a file under each project folder; one with a separator in it would name a file somewhere else.
    if (!/^[\w.-]+$/.test(sessionId)) return null;
    const file = `${sessionId}${TRANSCRIPT_SUFFIX}`;
    const [liveBySession, dirs] = await Promise.all([this.liveBySession(), readDirSafe(this.root)]);
    const copies = await Promise.all(dirs.map((dir) => this.recordFor(path.join(this.root, dir, file), file)));
    const found = copies.filter((record): record is SessionRecord => record !== null);
    const newest = newestCopy(found, sessionId);
    return newest ? { ...newest, live: liveBySession.get(sessionId) ?? null } : null;
  }

  async build(): Promise<SessionRecord[]> {
    const root = this.root;
    const [liveBySession, dirs] = await Promise.all([this.liveBySession(), readDirSafe(root)]);
    const records: SessionRecord[] = [];

    for (const dir of dirs) {
      const projectDir = path.join(root, dir);
      for (const file of await readDirSafe(projectDir)) {
        if (!file.endsWith(TRANSCRIPT_SUFFIX)) continue;

        const record = await this.recordFor(path.join(projectDir, file), file);
        if (record) records.push({ ...record, live: liveBySession.get(record.sessionId) ?? null });
      }
    }

    return records;
  }

  private async liveBySession(): Promise<Map<string, ActiveSession>> {
    return new Map((await this.liveSessions()).map((session) => [session.sessionId, session]));
  }

  private async recordFor(transcriptPath: string, file: string): Promise<SessionRecord | null> {
    const stat = await fs.stat(transcriptPath).catch(() => null);
    if (!stat) return null;

    const cached = this.scanned.get(transcriptPath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.record;

    const info = await scanTranscript(transcriptPath);
    if (!info.hasContent) return null;

    const record: SessionRecord = {
      sessionId: file.slice(0, -TRANSCRIPT_SUFFIX.length),
      ...info,
      // A transcript records whatever spelling the session was started with, short name included.
      cwd: info.cwd ? expandShortPath(info.cwd) : null,
      transcriptPath,
      sizeBytes: stat.size,
      live: null,
    };
    this.scanned.set(transcriptPath, { size: stat.size, mtimeMs: stat.mtimeMs, record });
    return record;
  }
}
