import type { Config } from "./config.ts";
import { assertSpawnable, resolveClaudeBin } from "./platform.ts";
import { readAuthStatus, SIGNED_OUT } from "./claude/auth.ts";
import { ConversationStore } from "./conversations.ts";
import { OperatorStore } from "./operators.ts";
import { CapabilityCache } from "./claude/capabilities.ts";
import { ContextTracker } from "./claude/contextTracker.ts";
import { UsageLedger } from "./claude/usageLedger.ts";
import { PlanUsage } from "./claude/planUsage.ts";
import { TurnFlow } from "./discord/turnFlow.ts";
import { OutboxDelivery } from "./discord/outboxDelivery.ts";
import { SessionIndex } from "./sessions/index.ts";
import { PendingCreates } from "./discord/pendingCreate.ts";
import { ApprovalPrompts } from "./discord/approvals.ts";

export interface Bridge {
  config: Config;
  store: ConversationStore;
  operators: OperatorStore;
  capabilities: CapabilityCache;
  usage: UsageLedger;
  planUsage: PlanUsage;
  approvals: ApprovalPrompts;
  outbox: OutboxDelivery;
  flow: TurnFlow;
  sessions: SessionIndex;
  pendingCreates: PendingCreates;
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

  const capabilities = new CapabilityCache();
  const usage = new UsageLedger();
  const planUsage = new PlanUsage();
  const approvals = new ApprovalPrompts();
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
    capabilities,
    usage,
    planUsage,
    approvals,
    outbox,
    flow: new TurnFlow(capabilities, trackerFor, usage, planUsage, approvals, outbox, config),
    sessions: new SessionIndex(),
    pendingCreates: new PendingCreates(),
  };
}
