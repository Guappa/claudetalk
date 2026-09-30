import fs from "node:fs/promises";
import path from "node:path";
import { claudeProjectsDir, expandShortPath } from "../platform.ts";
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

type ListLive = () => Promise<ActiveSession[] | null>;

export class SessionIndex {
  private readonly scanned = new Map<string, CacheEntry>();
  private live: { at: number; sessions: ActiveSession[] } | null = null;
  private readonly listLive: ListLive;
  private readonly root: string;

  // Both default to the host's own; a test hands in a folder and a listing of its making.
  constructor(listLive: ListLive = listActiveSessions, root: string = claudeProjectsDir()) {
    this.listLive = listLive;
    this.root = root;
  }

  private async liveSessions(): Promise<ActiveSession[]> {
    if (this.live && Date.now() - this.live.at < LIVE_CACHE_MS) return this.live.sessions;
    const sessions = await this.listLive();
    // A listing that failed is not remembered as "nothing is live": the last one known stands until a listing succeeds.
    if (sessions === null) return this.live?.sessions ?? [];
    this.live = { at: Date.now(), sessions };
    return sessions;
  }

  // What was live a moment ago stops being true the instant something is stopped.
  forgetLive(): void {
    this.live = null;
  }

  // A session resumed from another folder can leave a transcript under each; the one written to last is the conversation.
  async find(sessionId: string): Promise<SessionRecord | null> {
    const copies = (await this.build()).filter((record) => record.sessionId === sessionId);
    const written = (record: SessionRecord): number => record.lastActivity?.getTime() ?? 0;
    return copies.sort((first, second) => written(second) - written(first))[0] ?? null;
  }

  async build(): Promise<SessionRecord[]> {
    const root = this.root;
    const liveBySession = new Map((await this.liveSessions()).map((session) => [session.sessionId, session]));
    const records: SessionRecord[] = [];

    for (const dir of await readDirSafe(root)) {
      const projectDir = path.join(root, dir);
      for (const file of await readDirSafe(projectDir)) {
        if (!file.endsWith(TRANSCRIPT_SUFFIX)) continue;

        const record = await this.recordFor(path.join(projectDir, file), file);
        if (record) records.push({ ...record, live: liveBySession.get(record.sessionId) ?? null });
      }
    }

    return records;
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
