import type { ChatInputCommandInteraction } from "discord.js";
import type { Bridge } from "../../bridge.ts";
import type { Say } from "../../i18n/index.ts";
import { requireConversation } from "../binding.ts";
import { tierOf } from "../policy.ts";
import { respond } from "../respond.ts";
import { TRAIL_KINDS, type TrailKind } from "../toolTrail.ts";
import { hiddenAfter } from "../trailChoice.ts";

function listed(say: Say, kinds: TrailKind[]): string {
  return kinds.length > 0 ? kinds.map((kind) => say(`trailChoice.kinds.${kind}`)).join(", ") : say("trailChoice.none");
}

// What stands, whose choice it is, and the two things a hidden line does not take away.
function standing(say: Say, whose: "own" | "follows" | "everywhere", hidden: ReadonlySet<TrailKind>): string {
  const drawn = TRAIL_KINDS.filter((kind) => !hidden.has(kind));
  const left = TRAIL_KINDS.filter((kind) => hidden.has(kind));
  return [
    say(`trailChoice.${whose}`),
    say("trailChoice.drawn", { kinds: listed(say, drawn) }),
    say("trailChoice.hidden", { kinds: listed(say, left) }),
    say("trailChoice.stillCounted"),
  ].join("\n");
}

// The default is every conversation's, so it is an owner's to change; an operator chooses for the conversation they are in.
async function chooseEverywhere(
  bridge: Bridge,
  interaction: ChatInputCommandInteraction,
  hide: string | null,
  show: string | null,
): Promise<void> {
  const say = bridge.language.say;
  const changing = hide !== null || show !== null;
  if (changing && tierOf(bridge, interaction.user.id) !== "owner") {
    await respond(interaction, say("trailChoice.everywhereIsOwners"));
    return;
  }
  if (changing) await bridge.trail.chooseEverywhere(hiddenAfter(bridge.trail.hiddenIn(undefined), hide, show));
  await respond(interaction, standing(say, "everywhere", bridge.trail.hiddenIn(undefined)));
}

export async function handleTrail(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const hide = interaction.options.getString("hide");
  const show = interaction.options.getString("show");
  if (interaction.options.getBoolean("everywhere")) {
    await chooseEverywhere(bridge, interaction, hide, show);
    return;
  }

  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;
  const own = conversation.trailHidden;
  if (interaction.options.getBoolean("reset")) {
    await bridge.store.setTrailHidden(conversation.sessionId, undefined);
  } else if (hide !== null || show !== null) {
    await bridge.store.setTrailHidden(conversation.sessionId, hiddenAfter(bridge.trail.hiddenIn(own), hide, show));
  }

  const chosen = bridge.store.bySession(conversation.sessionId)?.trailHidden;
  await respond(interaction, standing(bridge.language.say, chosen ? "own" : "follows", bridge.trail.hiddenIn(chosen)));
}
