import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { Bridge } from "../../bridge.ts";
import {
  listMcpServers,
  reconnectMcpServer,
  setMcpServerEnabled,
  type McpServer,
  type McpState,
} from "../../claude/mcpServers.ts";
import type { Conversation } from "../../conversations.ts";
import type { Say } from "../../i18n/index.ts";
import { errorMessage } from "../../text.ts";
import { requireConversation } from "../binding.ts";
import { MENU_OPTION_CHARS, MENU_OPTIONS } from "../limits.ts";
import { MCP_SELECT, mcpReconnectId, mcpToggleId, type Action } from "../menus.ts";
import { optionForDiscord } from "../outgoing.ts";
import { respond, settleMenu } from "../respond.ts";
import type { SelectOption } from "./skills.ts";

const STATE_KEYS = {
  failed: "mcp.stateFailed",
  "needs-auth": "mcp.stateNeedsAuth",
  pending: "mcp.statePending",
  disabled: "mcp.stateDisabled",
} as const satisfies Record<Exclude<McpState, "connected">, string>;

function describeState(say: Say, server: McpServer): string {
  return server.state === "connected" ? say("mcp.stateConnected", { count: server.tools }) : say(STATE_KEYS[server.state]);
}

// What a server is doing, and for one that is not working, why and what would change that.
export function describeServer(say: Say, server: McpServer): string {
  const heading = `\`${server.name}\` · ${describeState(say, server)}`;
  if (server.state === "failed")
    return `${heading}\n${say("mcp.failedBecause", { error: server.error || say("common.unknown") })}`;
  if (server.state === "needs-auth") return `${heading}\n${say("mcp.signInOnHost")}`;
  if (server.state === "disabled") return `${heading}\n${say("mcp.offForFolder")}`;
  if (server.state === "pending") return `${heading}\n${say("mcp.stillConnecting")}`;
  return heading;
}

export function mcpSelectOptions(say: Say, servers: McpServer[]): SelectOption[] {
  return servers.slice(0, MENU_OPTIONS).map((server) => ({
    label: server.name.slice(0, MENU_OPTION_CHARS),
    value: server.name.slice(0, MENU_OPTION_CHARS),
    description: describeState(say, server).slice(0, MENU_OPTION_CHARS),
  }));
}

// As many as the menu beneath it can offer, so the list and the menu name the same servers.
function serverLines(say: Say, servers: McpServer[]): string {
  return servers
    .slice(0, MENU_OPTIONS)
    .map((server) => `- \`${server.name}\` · ${describeState(say, server)}`)
    .join("\n");
}

// A press arrives with nothing but the channel it was made in, and the servers are the folder's.
function conversationOf(bridge: Bridge, interaction: StringSelectMenuInteraction | ButtonInteraction): Conversation | undefined {
  return bridge.store.byChannel(interaction.channelId);
}

function unreachable(say: Say, error: unknown): string {
  return say("mcp.unreachable", { error: errorMessage(error) });
}

export async function handleMcpCommand(bridge: Bridge, interaction: ChatInputCommandInteraction): Promise<void> {
  const say = bridge.language.say;
  const conversation = await requireConversation(bridge, interaction);
  if (!conversation) return;

  let servers: McpServer[];
  try {
    servers = await listMcpServers(conversation.cwd);
  } catch (error) {
    await respond(interaction, unreachable(say, error));
    return;
  }
  if (servers.length === 0) {
    await respond(interaction, say("mcp.none"));
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(MCP_SELECT)
    .setPlaceholder(say("mcp.choose"))
    .addOptions(mcpSelectOptions(say, servers).map(optionForDiscord));
  const working = servers.filter((server) => server.state === "connected").length;

  await respond(interaction, {
    content: `${say("mcp.summary", { count: servers.length, connected: working })}\n${serverLines(say, servers)}`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

// What can be done with a server depends on what it is doing: one that is off can only be switched on, and reconnecting it would say nothing.
function controlsFor(say: Say, server: McpServer): ActionRowBuilder<ButtonBuilder> {
  const buttons =
    server.state === "disabled"
      ? [
          new ButtonBuilder()
            .setCustomId(mcpToggleId(server.name, true))
            .setLabel(say("mcp.switchOn"))
            .setStyle(ButtonStyle.Success),
        ]
      : [
          new ButtonBuilder()
            .setCustomId(mcpReconnectId(server.name))
            .setLabel(say("mcp.reconnect"))
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(mcpToggleId(server.name, false))
            .setLabel(say("mcp.switchOff"))
            .setStyle(ButtonStyle.Danger),
        ];
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

export async function chooseMcpServer(bridge: Bridge, interaction: StringSelectMenuInteraction, action: Action<"mcp-chosen">) {
  const say = bridge.language.say;
  const conversation = conversationOf(bridge, interaction);
  if (!conversation) return await settleMenu(interaction, say("binding.unbound"));

  await interaction.deferUpdate();
  try {
    const server = (await listMcpServers(conversation.cwd)).find((candidate) => candidate.name === action.name);
    if (!server) return await settleMenu(interaction, say("mcp.gone", { name: action.name }));
    await settleMenu(interaction, describeServer(say, server), [controlsFor(say, server)]);
  } catch (error) {
    await settleMenu(interaction, unreachable(say, error));
  }
}

async function settleChange(
  bridge: Bridge,
  interaction: ButtonInteraction,
  name: string,
  change: (cwd: string) => Promise<McpServer | null>,
): Promise<void> {
  const say = bridge.language.say;
  const conversation = conversationOf(bridge, interaction);
  if (!conversation) return await settleMenu(interaction, say("binding.unbound"));

  await interaction.deferUpdate();
  try {
    const server = await change(conversation.cwd);
    if (!server) return await settleMenu(interaction, say("mcp.gone", { name }));
    await settleMenu(interaction, `${describeServer(say, server)}\n${say("mcp.appliesFromNextTurn")}`);
  } catch (error) {
    await settleMenu(interaction, say("mcp.changeFailed", { name, error: errorMessage(error) }));
  }
}

export async function toggleMcpServer(bridge: Bridge, interaction: ButtonInteraction, action: Action<"mcp-toggle">) {
  await settleChange(bridge, interaction, action.name, (cwd) => setMcpServerEnabled(cwd, action.name, action.enable));
}

export async function reconnectChosenServer(bridge: Bridge, interaction: ButtonInteraction, action: Action<"mcp-reconnect">) {
  await settleChange(bridge, interaction, action.name, (cwd) => reconnectMcpServer(cwd, action.name));
}
