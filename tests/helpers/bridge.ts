import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Bridge } from "../../src/bridge.ts";
import { CapabilityCache } from "../../src/claude/capabilities.ts";
import { ContextTracker } from "../../src/claude/contextTracker.ts";
import { PlanUsage } from "../../src/claude/planUsage.ts";
import { UsageLedger } from "../../src/claude/usageLedger.ts";
import type { Config } from "../../src/config.ts";
import { ConversationStore } from "../../src/conversations.ts";
import { ActiveTurns } from "../../src/discord/activeTurns.ts";
import { ApprovalPrompts } from "../../src/discord/approvals.ts";
import { OutboxDelivery } from "../../src/discord/outboxDelivery.ts";
import { Pending, PendingCreates } from "../../src/discord/pendingCreate.ts";
import { QuestionPrompts } from "../../src/discord/questions.ts";
import { TurnFlow } from "../../src/discord/turnFlow.ts";
import { LanguageChoice } from "../../src/i18n/languageChoice.ts";
import { OperatorStore } from "../../src/operators.ts";
import type { SessionIndex, SessionRecord } from "../../src/sessions/index.ts";

export const GUILD = "200000000000000001";
export const OWNER = "100000000000000001";
export const OPERATOR = "100000000000000002";
export const STRANGER = "100000000000000003";

// A bridge made of the real parts over a scratch folder; only the transcripts on disk are stood in for, by the records handed in.
export async function testBridge(records: SessionRecord[] = [], config: Partial<Config> = {}): Promise<Bridge> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-test-"));
  const settled: Config = {
    botToken: "unused",
    guildId: GUILD,
    ownerIds: [OWNER],
    projectsRoot: path.join(dir, "projects"),
    bindingsPath: path.join(dir, "conversations.json"),
    operatorsPath: path.join(dir, "operators.json"),
    toolApprovals: false,
    language: "en",
    ...config,
  };
  const store = new ConversationStore(settled.bindingsPath);
  await store.load();
  const operators = new OperatorStore(settled.operatorsPath);
  await operators.load();
  await operators.add(OPERATOR);
  const language = new LanguageChoice(path.join(dir, "language.json"), settled.language);
  await language.load();
  const capabilities = new CapabilityCache();
  const usage = new UsageLedger();
  const planUsage = new PlanUsage();
  const approvals = new ApprovalPrompts();
  const questions = new QuestionPrompts();
  const activeTurns = new ActiveTurns(path.join(dir, "turns.json"));
  const outbox = new OutboxDelivery();
  const sessions = {
    build: async () => records,
    find: async (sessionId: string) => records.find((record) => record.sessionId === sessionId) ?? null,
    forgetLive: () => undefined,
  } as unknown as SessionIndex;

  return {
    config: settled,
    store,
    operators,
    language,
    capabilities,
    usage,
    planUsage,
    approvals,
    questions,
    activeTurns,
    latestPosts: new Map<string, string>(),
    outbox,
    flow: new TurnFlow(
      capabilities,
      () => new ContextTracker(),
      usage,
      planUsage,
      approvals,
      questions,
      outbox,
      activeTurns,
      settled,
      () => language.say,
      1,
    ),
    sessions,
    pendingCreates: new PendingCreates(),
    pendingRuns: new Pending(),
  };
}
