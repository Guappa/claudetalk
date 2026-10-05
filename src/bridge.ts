import type { Config } from "./config.ts";
import { assertSpawnable, resolveClaudeBin } from "./platform.ts";
import { readAuthStatus, SIGNED_OUT } from "./claude/auth.ts";
import { readClaudeVersions, type ClaudeVersions } from "./claude/versions.ts";
import { ConversationStore } from "./conversations.ts";
import { OperatorStore } from "./operators.ts";
import { CapabilityCache } from "./claude/capabilities.ts";
import { ModelCatalog } from "./claude/models.ts";
import { ContextTrackers, type ContextStanding } from "./claude/contextTracker.ts";
import { UsageLedger } from "./claude/usageLedger.ts";
import { PlanUsage } from "./claude/planUsage.ts";
import { TurnFlow } from "./discord/turnFlow.ts";
import { TrailChoice } from "./discord/trailChoice.ts";
import { OutboxDelivery } from "./discord/outboxDelivery.ts";
import { SessionIndex } from "./sessions/index.ts";
import { Pending, PendingCreates, type PendingRun } from "./discord/pendingCreate.ts";
import { ApprovalPrompts } from "./discord/approvals.ts";
import { QuestionPrompts } from "./discord/questions.ts";
import { ActiveTurns } from "./discord/activeTurns.ts";
import { LanguageChoice } from "./i18n/languageChoice.ts";
import { UpdateCheck, githubSlug } from "./updateCheck.ts";
import { RestartNote } from "./discord/restart.ts";
import { UpdateNotice } from "./discord/updateNotice.ts";
import { checkBoot, type BootCheck } from "./bootCheck.ts";
import { bridgeRepository, bridgeVersion, describeBuild } from "./version.ts";
import path from "node:path";

export interface Bridge {
  config: Config;
  store: ConversationStore;
  operators: OperatorStore;
  language: LanguageChoice;
  trail: TrailChoice;
  capabilities: CapabilityCache;
  models: ModelCatalog;
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
  // How full a conversation was at its last turn; null until one has run since the bridge started.
  contextOf: (sessionId: string) => ContextStanding | null;
  sessions: SessionIndex;
  pendingCreates: PendingCreates;
  pendingRuns: Pending<PendingRun>;
  // By channel: the last message refused because something held the conversation, kept so that `/takeover` can run it.
  heldMessages: Pending<() => Promise<void>>;
  // Read once at start-up: the Claude Code turns run on, and the one the host's side jobs run on.
  claude: ClaudeVersions;
  updates: UpdateCheck;
  updateNotice: UpdateNotice;
  // The version and commit this process started on: the manifest on disk can move on under a bridge that is still running.
  build: string;
  // Whether something starts the bridge again when it leaves asking for that.
  supervised: boolean;
  restartNote: RestartNote;
  // Whether the code on disk would start, asked before a restart is.
  checkBoot: () => Promise<BootCheck>;
}

export async function createBridge(config: Config, supervised: boolean): Promise<Bridge> {
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
  const updates = new UpdateCheck(bridgeVersion(), config.updateCheck ? githubSlug(bridgeRepository()) : null);
  const updateNotice = new UpdateNotice(path.join(config.dataDir, "update.json"), updates);
  await updateNotice.load();
  const trackers = new ContextTrackers();
  const trail = new TrailChoice(path.join(config.dataDir, "trail.json"));
  await trail.load();

  return {
    config,
    store,
    operators,
    language,
    trail,
    capabilities,
    models: new ModelCatalog(config.projectsRoot),
    usage,
    planUsage,
    approvals,
    questions,
    activeTurns,
    latestPosts: new Map<string, string>(),
    heldAttachments: new Set<string>(),
    claude: readClaudeVersions(),
    build: describeBuild(),
    supervised,
    checkBoot: () => checkBoot(),
    restartNote: new RestartNote(path.join(config.dataDir, "restart.json")),
    updates,
    updateNotice,
    outbox,
    flow: new TurnFlow(
      capabilities,
      (sessionId) => trackers.trackerFor(sessionId),
      usage,
      planUsage,
      approvals,
      questions,
      outbox,
      activeTurns,
      config,
      () => language.say,
      (sessionId) => trail.hiddenIn(store.bySession(sessionId)?.settings.trailHidden),
    ),
    contextOf: (sessionId) => trackers.standing(sessionId),
    sessions: new SessionIndex(),
    pendingCreates: new PendingCreates(),
    pendingRuns: new Pending<PendingRun>(),
    heldMessages: new Pending<() => Promise<void>>(),
  };
}
