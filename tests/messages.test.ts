import { describe, it, expect } from "vitest";
import { attachmentsRoot, longTmpDir } from "../src/platform.ts";
import { randomUUID } from "node:crypto";
import { addressesBot, addressesSomeoneElse, shouldQuoteReplied, type Addressing } from "../src/discord/addressing.ts";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  ATTACHMENT_TTL_MS,
  MAX_ATTACHMENT_BYTES,
  appendAttachmentPaths,
  describeRefused,
  describeUnfetched,
  downloadAttachments,
  extensionFor,
  imagesAmong,
  inlineImage,
  isExpired,
  screenAttachments,
} from "../src/attachments.ts";
import { nothingToSend } from "../src/discord/handlers/message.ts";
import { sayIn } from "../src/i18n/index.ts";
import { attributionOnly, buildContext, composePrompt, noContext, stripBotMention } from "../src/discord/context.ts";

const say = sayIn("en");

describe("attachment screening", () => {
  const file = (name: string, size = 1000) => ({ url: "https://cdn.example/x", name, contentType: null, size });

  it("keeps source and scripts, which are the point of a coding bridge", () => {
    const { allowed, refused } = screenAttachments([
      file("server.ts"),
      file("deploy.sh"),
      file("notes.md"),
      file("shot.png"),
      file("build.ps1"),
    ]);
    expect(allowed.map((attachment) => attachment.name)).toEqual(["server.ts", "deploy.sh", "notes.md", "shot.png", "build.ps1"]);
    expect(refused).toEqual([]);
  });

  it("refuses formats that exist only to be executed", () => {
    const { allowed, refused } = screenAttachments([file("setup.exe"), file("payload.SCR"), file("x.lnk")]);
    expect(allowed).toEqual([]);
    expect(refused.map((file) => file.name)).toEqual(["setup.exe", "payload.SCR", "x.lnk"]);
  });

  it("refuses a file too large to be worth saving", () => {
    const { refused } = screenAttachments([file("dump.bin", MAX_ATTACHMENT_BYTES + 1)]);
    expect(refused[0]?.reason).toBe("too-large");
    expect(describeRefused(say, refused)).toContain("over 25 MB");
  });

  it("says which file was refused and why, and stays quiet when none was", () => {
    const { refused } = screenAttachments([file("setup.exe")]);
    const notice = describeRefused(say, refused);
    expect(notice).toContain("setup.exe");
    expect(notice).toContain("executable format");
    expect(describeRefused(say, [])).toBeNull();
  });
});

describe("stripBotMention", () => {
  it("removes the mention and trims", () => {
    expect(stripBotMention("<@123> check the nas", "123")).toBe("check the nas");
  });

  it("removes the nickname form of the mention", () => {
    expect(stripBotMention("<@!123> hello", "123")).toBe("hello");
  });

  it("leaves other people's mentions alone", () => {
    expect(stripBotMention("<@123> ask <@456> about it", "123")).toBe("ask <@456> about it");
  });
});

describe("buildContext", () => {
  const messages = [
    { authorId: "u1", authorName: "First", content: "the nas is full", at: new Date("2026-09-13T14:30:00Z"), isBot: false },
    { authorId: "u2", authorName: "Second", content: "since when?", at: new Date("2026-09-13T14:31:00Z"), isBot: false },
    { authorId: "bot", authorName: "TheBot", content: "earlier reply", at: new Date("2026-09-13T14:32:00Z"), isBot: true },
  ];

  it("names each speaker with a taggable id", () => {
    const context = buildContext(messages);
    expect(context.text).toContain("First (<@u1>) at 2026-09-13 14:30 UTC: the nas is full");
    expect(context.text).toContain("Second (<@u2>) at 2026-09-13 14:31 UTC: since when?");
  });

  it("lets the bot tag back the humans it saw", () => {
    expect(buildContext(messages).mentionableUserIds).toEqual(["u1", "u2"]);
  });

  it("never marks a bot as mentionable", () => {
    expect(buildContext(messages).mentionableUserIds).not.toContain("bot");
  });

  it("fences quoted messages behind a marker they cannot guess", () => {
    const context = buildContext(messages);
    const token = /BEGIN CHANNEL MESSAGES ([0-9a-f]{16})/.exec(context.text)?.[1];
    expect(token).toBeDefined();
    expect(context.text).toContain(`END CHANNEL MESSAGES ${token}`);
    expect(buildContext(messages).text).not.toContain(token!);
  });

  it("counts the messages it carries, leaving out one with nothing written in it", () => {
    const withAnEmbedOnly = [...messages, { ...messages[0]!, content: "  " }];
    expect(buildContext(withAnEmbedOnly).carried).toBe(messages.length);
    expect(attributionOnly(messages[0]!).carried).toBe(0);
    expect(noContext().carried).toBe(0);
  });

  it("skips empty messages such as bare attachments", () => {
    const context = buildContext([{ ...messages[0]!, content: "   " }]);
    expect(context.text).toBe("");
    expect(context.mentionableUserIds).toEqual([]);
  });

  it("truncates a very long message", () => {
    const context = buildContext([{ ...messages[0]!, content: "x".repeat(5000) }]);
    expect(context.text).toContain(`${"x".repeat(597)}...`);
    expect(context.text).not.toContain("x".repeat(598));
  });

  it("deduplicates a speaker who said several things", () => {
    const repeated = [messages[0]!, { ...messages[0]!, content: "and growing" }];
    expect(buildContext(repeated).mentionableUserIds).toEqual(["u1"]);
  });
});

describe("attributionOnly", () => {
  const asker = { authorId: "u1", authorName: "First", content: "hi", at: new Date(), isBot: false };

  it("costs one line and still allows tagging back", () => {
    const context = attributionOnly(asker);
    expect(context.text.split("\n")).toHaveLength(1);
    expect(context.mentionableUserIds).toEqual(["u1"]);
  });

  it("adds nothing to a prompt when there is no context", () => {
    expect(composePrompt(noContext(), "just this")).toBe("just this");
  });

  it("separates context from the prompt when there is context", () => {
    const composed = composePrompt(attributionOnly(asker), "do the thing");
    expect(composed).toContain("The request to act on:");
    expect(composed.endsWith("do the thing")).toBe(true);
  });
});

describe("attachmentsRoot", () => {
  it("never contains an 8.3 short name, so it is spelled the way indexed folders are", () => {
    expect(attachmentsRoot()).not.toContain("~");
  });

  it("resolves under the real temp directory", () => {
    expect(attachmentsRoot().startsWith(longTmpDir())).toBe(true);
  });
});

describe("attachment lifetime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  it("keeps a file long enough for a follow-up to act on it", () => {
    expect(isExpired(Date.parse("2026-09-14T11:58:00Z"), now)).toBe(false);
  });

  it("expires a file once it is past the retention window", () => {
    expect(isExpired(Date.parse("2026-09-14T10:00:00Z"), now)).toBe(true);
  });

  it("retains for an hour", () => {
    expect(ATTACHMENT_TTL_MS).toBe(60 * 60 * 1000);
  });
});

describe("deciding a message is for the bot", () => {
  const bot = "bot-id";
  const me = "me";
  const addressing = (over: Partial<Addressing> = {}): Addressing => ({
    mentionsBot: false,
    repliedAuthorId: null,
    botUserId: bot,
    authorId: me,
    ...over,
  });

  it("accepts an explicit tag", () => {
    expect(addressesBot(addressing({ mentionsBot: true }))).toBe(true);
  });

  it("accepts a reply to the bot even with the ping switched off", () => {
    expect(addressesBot(addressing({ repliedAuthorId: bot }))).toBe(true);
  });

  it("ignores a plain message", () => {
    expect(addressesBot(addressing())).toBe(false);
  });

  it("ignores a reply to somebody else", () => {
    expect(addressesBot(addressing({ repliedAuthorId: "someone-else" }))).toBe(false);
  });

  it("quotes the message when replying to another person", () => {
    expect(shouldQuoteReplied(addressing({ mentionsBot: true, repliedAuthorId: "someone-else" }))).toBe(true);
  });

  it("does not re-quote the bot's own message, which the session already has", () => {
    expect(shouldQuoteReplied(addressing({ repliedAuthorId: bot }))).toBe(false);
  });

  it("has nothing to quote when the message is not a reply", () => {
    expect(shouldQuoteReplied(addressing({ mentionsBot: true }))).toBe(false);
  });

  it("stays out of a reply aimed at another person", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: "someone-else" }))).toBe(true);
  });

  it("joins a reply to another person once it is tagged in", () => {
    expect(addressesSomeoneElse(addressing({ mentionsBot: true, repliedAuthorId: "someone-else" }))).toBe(false);
  });

  it("still hears someone replying to their own earlier message", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: me }))).toBe(false);
  });

  it("still hears a reply to the bot", () => {
    expect(addressesSomeoneElse(addressing({ repliedAuthorId: bot }))).toBe(false);
  });

  it("still hears a plain message", () => {
    expect(addressesSomeoneElse(addressing())).toBe(false);
  });
});

describe("the saved extension follows the bytes", () => {
  it("renames an image whose name disagrees with what Discord says it is", () => {
    expect(extensionFor("shot.png", "image/webp")).toBe(".webp");
    expect(extensionFor("dump", "application/pdf")).toBe(".pdf");
  });

  it("keeps a name that already fits the type, as written", () => {
    expect(extensionFor("photo.JPEG", "image/jpeg")).toBe(".JPEG");
    expect(extensionFor("notes.md", null)).toBe(".md");
  });

  it("never renames source, whatever generic type Discord attaches to it", () => {
    expect(extensionFor("server.ts", "text/plain; charset=utf-8")).toBe(".ts");
    expect(extensionFor("deploy.sh", "application/octet-stream")).toBe(".sh");
  });
});

describe("a message with nothing left in it spends no turn", () => {
  it("is empty when there is no text and no file survived", () => {
    expect(nothingToSend("", 0)).toBe(true);
    expect(nothingToSend("   ", 0)).toBe(true);
  });

  it("still runs for text alone or a file alone", () => {
    expect(nothingToSend("look at this", 0)).toBe(false);
    expect(nothingToSend("", 1)).toBe(false);
  });
});

describe("an image goes inside the message as well as by its path", () => {
  const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(40, 1)]);
  const served = async (body: Buffer): Promise<{ url: string; close: () => void }> => {
    const server = http.createServer((_request, response) => response.end(body));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`, close: () => server.close() };
  };

  // What the sender called a file can be wrong, and an image sent under the wrong type is one the API may refuse.
  it("tells an image by its first bytes, whatever it was called, and leaves anything else to its path", () => {
    expect(inlineImage(png)).toEqual({ mediaType: "image/png", base64: png.toString("base64") });
    expect(inlineImage(Buffer.from("\xff\xd8\xff\xe0 and the rest", "latin1"))?.mediaType).toBe("image/jpeg");
    expect(inlineImage(Buffer.from("GIF89a and the rest", "latin1"))?.mediaType).toBe("image/gif");
    expect(inlineImage(Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "latin1"))?.mediaType).toBe("image/webp");
    expect(inlineImage(Buffer.from("%PDF-1.7 and the rest", "latin1"))).toBeUndefined();
    expect(inlineImage(Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt ", "latin1"))).toBeUndefined();
    expect(inlineImage(Buffer.alloc(0))).toBeUndefined();
  });

  it("leaves an image too large for one message to its path alone", () => {
    const large = Buffer.concat([png, Buffer.alloc(4_000_000)]);
    expect(inlineImage(large)).toBeUndefined();
  });

  it("reads an image as it is downloaded, under the type its bytes give, and says in the prompt which files it already shows", async () => {
    const [image, notes] = await Promise.all([served(png), served(Buffer.from("plain notes"))]);
    const { saved } = await downloadAttachments(
      [
        { url: image.url, name: "shot.jpg", contentType: "image/jpeg", size: png.length },
        { url: notes.url, name: "notes.txt", contentType: "text/plain", size: 11 },
      ],
      randomUUID(),
    );
    image.close();
    notes.close();

    expect(imagesAmong(saved)).toEqual([{ mediaType: "image/png", base64: png.toString("base64") }]);
    const lines = appendAttachmentPaths("look", saved).split("\n");
    expect(lines.at(-2)).toBe(`[Attachment: image/jpeg, shown in this message] ${saved[0]!.path}`);
    expect(lines.at(-1)).toBe(`[Attachment: text/plain] ${saved[1]!.path}`);
  });
});

describe("a download that fails is named, not skipped in silence", () => {
  it("reports the file and saves nothing for it", async () => {
    const { saved, failed } = await downloadAttachments(
      [{ url: "http://127.0.0.1:1/nothing", name: "shot.png", contentType: "image/png", size: 10 }],
      randomUUID(),
    );
    expect(saved).toEqual([]);
    expect(failed).toEqual(["shot.png"]);
    expect(describeUnfetched(say, failed)).toContain("`shot.png`");
    expect(describeUnfetched(say, [])).toBeNull();
  });
});
