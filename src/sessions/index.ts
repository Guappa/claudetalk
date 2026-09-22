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

export class SessionIndex {
  private readonly scanned = new Map<string, CacheEntry>();
  private live: { at: number; sessions: ActiveSession[] } | null = null;

  private async liveSessions(): Promise<ActiveSession[]> {
    if (this.live && Date.now() - this.live.at < LIVE_CACHE_MS) return this.live.sessions;
    const sessions = await listActiveSessions();
    this.live = { at: Date.now(), sessions };
    return sessions;
  }

  async find(sessionId: string): Promise<SessionRecord | null> {
    return (await this.build()).find((record) => record.sessionId === sessionId) ?? null;
  }

  async build(): Promise<SessionRecord[]> {
    const root = claudeProjectsDir();
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
    let stat;
    try {
      stat = await fs.stat(transcriptPath);
    } catch {
      return null;
    }

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
