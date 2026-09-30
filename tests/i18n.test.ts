import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { LANGUAGES, isLanguage, sayIn, type Language } from "../src/i18n/index.ts";
import { LanguageChoice } from "../src/i18n/languageChoice.ts";
import { en } from "../src/i18n/locales/en.ts";
import { sv } from "../src/i18n/locales/sv.ts";

const CATALOGS: Record<Language, object> = { en, sv };
const languages = Object.keys(LANGUAGES) as Language[];
const PLURAL = /_(zero|one|two|few|many|other)$/;

function sentences(entries: object, prefix = ""): Array<[string, string]> {
  return Object.entries(entries).flatMap(([name, value]) =>
    typeof value === "string" ? [[prefix + name, value] as [string, string]] : sentences(value as object, `${prefix}${name}.`),
  );
}

const placeholders = (sentence: string): string[] =>
  [...sentence.matchAll(/\{\{\s*([A-Za-z]+)[^}]*\}\}/g)].map((match) => match[1]!).sort();
const nested = (sentence: string): string[] => [...sentence.matchAll(/\$t\(([^)]+)\)/g)].map((match) => match[1]!).sort();
// A command or a path in backticks is typed as written, so it has to read the same in every language.
const literals = (sentence: string): string[] =>
  [...new Set([...sentence.replaceAll("```", "").matchAll(/`([^`]+)`/g)].map((match) => match[1]!))].sort();

// A value for each placeholder a sentence names, of the kind its format expects.
function sampleValues(sentence: string, count: number): Record<string, string | number> {
  const values: Record<string, string | number> = { count };
  for (const match of sentence.matchAll(/\{\{\s*([A-Za-z]+)\s*(,\s*number)?\s*\}\}/g)) {
    if (match[1] !== "count") values[match[1]!] = match[2] ? 1234 : "sample";
  }
  return values;
}

const english = new Map(sentences(en));

describe("the catalog", () => {
  it("offers every language it holds, and holds every language it offers", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(languages.slice().sort());
  });

  it("gives every counted sentence in English both of its forms", () => {
    const counted = [...english.keys()].filter((key) => PLURAL.test(key));
    const bases = new Set(counted.map((key) => key.replace(PLURAL, "")));
    const missing = [...bases].flatMap((base) =>
      ["_one", "_other"].filter((form) => !english.has(base + form)).map((form) => base + form),
    );
    expect(missing).toEqual([]);
  });

  // A translation that drops a value, renames one, or rewrites a command says something the code did not mean.
  it.each(languages)("keeps what each sentence is given and what it quotes the same in %s", (language) => {
    const wrong: string[] = [];
    for (const [key, sentence] of sentences(CATALOGS[language])) {
      const source = english.get(key)!;
      // A language may leave the number out of a sentence about exactly one thing; it may not leave out anything else.
      const given = placeholders(sentence);
      const expected = placeholders(source).filter((name) => name !== "count" || given.includes("count"));
      if (given.join() !== expected.join()) wrong.push(`${key}: takes ${given.join()} where English takes ${expected.join()}`);
      if (nested(sentence).join() !== nested(source).join()) wrong.push(`${key}: nests differently from English`);
      if (literals(sentence).join() !== literals(source).join()) wrong.push(`${key}: quotes ${literals(sentence).join(" ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it.each(languages)("renders every sentence in %s with nothing left unfilled", (language) => {
    const say = sayIn(language) as unknown as (key: string, values: Record<string, string | number>) => string;
    const unfilled: string[] = [];
    for (const [key, sentence] of sentences(CATALOGS[language])) {
      const base = key.replace(PLURAL, "");
      for (const count of [1, 5]) {
        const rendered = say(base, sampleValues(sentence, count));
        if (rendered === base || /\{\{|\$t\(/.test(rendered)) unfilled.push(`${key}: ${rendered}`);
      }
    }
    expect(unfilled).toEqual([]);
  });

  // The typecheck holds each language to English's keys; this holds a language added without the type to the same.
  it("holds the same keys in every language", () => {
    for (const language of languages) {
      expect(sentences(CATALOGS[language]).map(([key]) => key).sort()).toEqual([...english.keys()].sort());
    }
  });

  it("counts in the language it speaks", () => {
    expect(sayIn("en")("queue.runningWith", { count: 1 })).toBe("One turn is running, with 1 message queued behind it.");
    expect(sayIn("en")("queue.runningWith", { count: 3 })).toBe("One turn is running, with 3 messages queued behind it.");
    expect(sayIn("sv")("queue.runningWith", { count: 3 })).toBe("En omgång körs, med 3 meddelanden i kö efter den.");
  });

  // A value is shown as given: a path or a name must not be able to pull another sentence or another value in.
  it("never reads a placeholder or a nested sentence out of a value", () => {
    const smuggled = sayIn("en")("common.sent", { prompt: "{{count}} $t(stop.outlives)" });
    expect(smuggled).toBe("Sent `{{count}} $t(stop.outlives)` to the conversation.");
  });
});

describe("what Discord allows a label", () => {
  const BUTTONS = [
    "common.cancel",
    "fold.sendNow",
    "stop.button",
    "stop.allButton",
    "stop.agentsButton",
    "stop.cloudTaskButton",
    "approvals.approveOnce",
    "approvals.deny",
    "approvals.approveRest",
    "questions.submit",
    "questions.skip",
    "clear.startOver",
    "unbind.deleteChannel",
    "unbind.keep",
    "create.startNew",
    "run.runButton",
    "plugins.enable",
    "plugins.disable",
    "purge.confirm",
  ];
  const LIMITS: Array<[number, string[]]> = [
    [80, BUTTONS],
    [45, ["questions.ownAnswerTitle", "questions.ownAnswerLabel"]],
    [100, ["questions.other", "questions.otherDescription", "run.noListChoice", "agents.titleBare"]],
    [150, ["plugins.choose", "questions.placeholder"]],
  ];

  it.each(languages)("fits every button, title and menu entry in %s", (language) => {
    const catalog = new Map(sentences(CATALOGS[language]));
    const tooLong: string[] = [];
    for (const [limit, keys] of LIMITS) {
      for (const key of keys) {
        const sentence = catalog.get(key);
        expect(sentence, key).toBeDefined();
        if (sentence!.replace(/\{\{[^}]+\}\}/g, "4").length > limit) tooLong.push(`${key} is over ${limit}`);
      }
    }
    expect(tooLong).toEqual([]);
  });
});

describe("the language the bridge speaks", () => {
  const choiceFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "language-")), "language.json");

  it("starts in the host's default", async () => {
    const choice = new LanguageChoice(await choiceFile(), "sv");
    await choice.load();
    expect(choice.current()).toBe("sv");
    expect(choice.wasPicked()).toBe(false);
    expect(choice.say("common.cancel")).toBe("Avbryt");
  });

  it("keeps a language picked in Discord across a restart, over the host's default", async () => {
    const file = await choiceFile();
    await new LanguageChoice(file, "en").choose("sv");

    const restarted = new LanguageChoice(file, "en");
    await restarted.load();
    expect(restarted.current()).toBe("sv");
    expect(restarted.wasPicked()).toBe(true);
  });

  it("ignores a stored language it no longer has", async () => {
    const file = await choiceFile();
    await fs.writeFile(file, JSON.stringify({ language: "xx" }));
    const choice = new LanguageChoice(file, "en");
    await choice.load();
    expect(choice.current()).toBe("en");
  });

  it("knows which codes are languages, and that an object's own plumbing is not one", () => {
    expect(isLanguage("sv")).toBe(true);
    expect(isLanguage("toString")).toBe(false);
  });

  const env = { DISCORD_BOT_TOKEN: "token", DISCORD_GUILD_ID: "1", DISCORD_OWNER_IDS: "12345678901234567", PROJECTS_ROOT: "." };

  it("takes the host's default from BRIDGE_LANGUAGE, and English without it", () => {
    expect(loadConfig(env).language).toBe("en");
    expect(loadConfig({ ...env, BRIDGE_LANGUAGE: "sv" }).language).toBe("sv");
  });

  it("refuses to start on a language it does not have, and lists the ones it does", () => {
    expect(() => loadConfig({ ...env, BRIDGE_LANGUAGE: "klingon" })).toThrow(/BRIDGE_LANGUAGE.*en, sv/s);
  });
});
