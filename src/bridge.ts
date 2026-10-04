import type { Config } from "./config.ts";
import { assertSpawnable, resolveClaudeBin } from "./platform.ts";
import { readAuthStatus, SIGNED_OUT } from "./claude/auth.ts";
import { readClaudeVersions, type ClaudeVersions } from "./claude/versions.ts";
import { ConversationStore } from "./conversations.ts";
import { OperatorStore } from "./operators.ts";
import { CapabilityCache } from "./claude/capabilities.ts";
import { ContextTracker } from "./claude/contextTracker.ts";
import { UsageLedger } from "./claude/usageLedger.ts";
import { PlanUsage } from "./claude/planUsage.ts";
import { TurnFlow } from "./discord/turnFlow.ts";
import { OutboxDelivery } from "./discord/outboxDelivery.ts";
import { SessionIndex } from "./sessions/index.ts";
import { Pending, PendingCreates, type PendingRun } from "./discord/pendingCreate.ts";
import { ApprovalPrompts } from "./discord/approvals.ts";
import { QuestionPrompts } from "./discord/questions.ts";
import { ActiveTurns } from "./discord/activeTurns.ts";
import { LanguageChoice } from "./i18n/languageChoice.ts";
import { UpdateCheck, githubSlug } from "./updateCheck.ts";
import { bridgeRepository, bridgeVersion } from "./version.ts";
import path from "node:path";

export interface Bridge {
  config: Config;
  store: ConversationStore;
  operators: OperatorStore;
  language: LanguageChoice;
  capabilities: CapabilityCache;
  usage: UsageLedger;
  planUsage: PlanUsage;
  approvals: ApprovalPrompts;
  questions: QuestionPrompts;
  activeTurns: ActiveTurns;
  // The newest message posted per channel, shared by every sink so the trail knows what sits beneath it.
  latestPosts: Map<string, string>;
  // Attachment folders of turns that are still waiting or running, which the sweep leaves alone.
  heldAttachments: Set<string>;
  outbox: OutboxDelivery;
  flow: TurnFlow;
  sessions: SessionIndex;
  pendingCreates: PendingCreates;
  pendingRuns: Pending<PendingRun>;
  // Read once at start-up: the Claude Code turns run on, and the one the host's side jobs run on.
  claude: ClaudeVersions;
  updates: UpdateCheck;
}

export async function createBridge(config: Config): Promise<Bridge> {
  assertSpawnable(resolveClaudeBin());

  // Being signed out fails every turn the same way, so it is worth catching before the bot connects.
  const auth = readAuthStatus();
  if (auth && !auth.loggedIn) throw new Error(SIGNED_OUT);

  const store = new ConversationStore(config.bindingsPath);
  await store.load();

  const operators = new OperatorStore(config.operatorsPath);
  await operators.load();

  const language = new LanguageChoice(path.join(config.dataDir, "language.json"), config.language);
  await language.load();

  const capabilities = new CapabilityCache(path.join(config.dataDir, "commands.json"));
  await capabilities.load();
  const usage = new UsageLedger();
  const planUsage = new PlanUsage();
  const approvals = new ApprovalPrompts();
  const questions = new QuestionPrompts();
  const activeTurns = new ActiveTurns(path.join(config.dataDir, "turns.json"));
  await activeTurns.load();
  const outbox = new OutboxDelivery();
  const trackers = new Map<string, ContextTracker>();
  const trackerFor = (sessionId: string): ContextTracker => {
    const existing = trackers.get(sessionId);
    if (existing) return existing;
    const created = new ContextTracker();
    trackers.set(sessionId, created);
    return created;
  };

  return {
    config,
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
    heldAttachments: new Set<string>(),
    claude: readClaudeVersions(),
    updates: new UpdateCheck(bridgeVersion(), config.updateCheck ? githubSlug(bridgeRepository()) : null),
    outbox,
    flow: new TurnFlow(
      capabilities,
      trackerFor,
      usage,
      planUsage,
      approvals,
      questions,
      outbox,
      activeTurns,
      config,
      () => language.say,
    ),
    sessions: new SessionIndex(),
    pendingCreates: new PendingCreates(),
    pendingRuns: new Pending<PendingRun>(),
  };
}
