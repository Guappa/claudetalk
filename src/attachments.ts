import fs from "node:fs/promises";
import path from "node:path";
import { attachmentsRoot } from "./platform.ts";

export interface RemoteAttachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

export interface RefusedAttachment {
  name: string;
  reason: string;
}

export interface ScreenedAttachments {
  allowed: RemoteAttachment[];
  refused: RefusedAttachment[];
}

// Formats whose only purpose is to be run rather than read; source and scripts stay allowed on purpose.
const EXECUTABLE_EXTENSIONS = new Set([
  ".exe", ".com", ".scr", ".pif", ".msi", ".msix", ".appx", ".dll", ".cpl", ".hta",
  ".lnk", ".reg", ".vbs", ".vbe", ".wsf", ".wsh", ".jse", ".jar", ".app", ".msc",
]);

// Only formats whose extension decides how they are opened; text keeps whatever name it was sent under.
const EXTENSIONS_BY_TYPE = new Map<string, string[]>([
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["image/gif", [".gif"]],
  ["image/webp", [".webp"]],
  ["application/pdf", [".pdf"]],
]);

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface SavedAttachment {
  path: string;
  contentType: string | null;
  name: string;
}

const FALLBACK_TYPE = "application/octet-stream";
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;

// Files outlive their turn so a follow-up can still act on them, and are swept by age.
export const ATTACHMENT_TTL_MS = 60 * 60 * 1000;

export function appendAttachmentPaths(prompt: string, files: SavedAttachment[]): string {
  if (files.length === 0) return prompt;
  const lines = files.map((file) => `[Attachment: ${file.contentType ?? FALLBACK_TYPE}] ${file.path}`);
  return `${prompt}\n\n${lines.join("\n")}`;
}

export function isExpired(modifiedAtMs: number, now = Date.now(), ttlMs = ATTACHMENT_TTL_MS): boolean {
  return now - modifiedAtMs > ttlMs;
}

export function extensionFor(name: string, contentType: string | null): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const fitting = EXTENSIONS_BY_TYPE.get(type);
  const named = path.extname(name);
  if (!fitting || fitting.includes(named.toLowerCase())) return named;
  return fitting[0]!;
}

export function screenAttachments(attachments: RemoteAttachment[]): ScreenedAttachments {
  const allowed: RemoteAttachment[] = [];
  const refused: RefusedAttachment[] = [];

  for (const attachment of attachments) {
    const extension = path.extname(attachment.name).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(extension)) {
      refused.push({ name: attachment.name, reason: `${extension} is an executable format` });
    } else if (attachment.size > MAX_ATTACHMENT_BYTES) {
      refused.push({ name: attachment.name, reason: `it is over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` });
    } else {
      allowed.push(attachment);
    }
  }

  return { allowed, refused };
}

export function describeRefused(refused: RefusedAttachment[]): string | null {
  if (refused.length === 0) return null;
  const lines = refused.map((file) => `\`${file.name}\`, because ${file.reason}`);
  return (
    `Not saved for this turn: ${lines.join("; ")}. ` +
    `The session runs with the host's rights, so a file it could execute is not worth the convenience. ` +
    `Put it in the working directory yourself if it is meant to be there.`
  );
}

// A root another account owns or can read is a root they still control the contents of.
async function ownedRoot(): Promise<string> {
  const root = attachmentsRoot();
  await fs.mkdir(root, { recursive: true, mode: OWNER_ONLY_DIR });
  if (!process.getuid) return root;

  const stat = await fs.stat(root);
  if (stat.uid !== process.getuid()) {
    throw new Error(
      `${root} belongs to another user, so attachments cannot be stored there safely. ` +
        "Remove that directory, or point TMPDIR at one you own.",
    );
  }
  if ((stat.mode & 0o077) !== 0) await fs.chmod(root, OWNER_ONLY_DIR);
  return root;
}

export interface DownloadedAttachments {
  saved: SavedAttachment[];
  failed: string[];
}

// A CDN that stalls must not hold the channel's handler open indefinitely.
const DOWNLOAD_TIMEOUT_MS = 30_000;

export function describeUnfetched(failed: string[]): string | null {
  if (failed.length === 0) return null;
  const names = failed.map((name) => `\`${name}\``).join(", ");
  return (
    `Could not download ${names} from Discord, so the session will not see ${failed.length === 1 ? "it" : "them"}. ` +
    "Discord's file links expire and its CDN sometimes refuses; send the file again if it matters."
  );
}

export async function downloadAttachments(
  attachments: RemoteAttachment[],
  turnId: string,
): Promise<DownloadedAttachments> {
  if (attachments.length === 0) return { saved: [], failed: [] };

  const dir = path.join(await ownedRoot(), turnId);
  await fs.mkdir(dir, { recursive: true, mode: OWNER_ONLY_DIR });

  const saved: SavedAttachment[] = [];
  const failed: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    try {
      // Discord attachment URLs are signed and expire, so they are fetched during the turn.
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const target = path.join(dir, `att_${index}${extensionFor(attachment.name, attachment.contentType)}`);
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()), { mode: OWNER_ONLY_FILE });
      saved.push({ path: target, contentType: attachment.contentType, name: attachment.name });
    } catch {
      failed.push(attachment.name);
    }
  }
  return { saved, failed };
}

export async function sweepAttachments(now = Date.now()): Promise<number> {
  const root = attachmentsRoot();

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const dir = path.join(root, entry);
    try {
      const stat = await fs.stat(dir);
      if (!isExpired(stat.mtimeMs, now)) continue;
      await fs.rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}
