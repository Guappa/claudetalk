import type { MessageSink, SinkAction, SinkMenu } from "../../src/discord/messageSink.ts";

export function quietSink(): MessageSink {
  return {
    send: async () => undefined,
    notice: async () => undefined,
    edit: async () => undefined,
    sendFiles: async () => undefined,
  };
}

export interface RecordingSink extends MessageSink {
  written: string[];
  files: string[];
  // Each entry is one message the sink holds, in order; edits replace the last one it edits into.
  messages: string[];
  // Set by a test to stand for a question or an attachment posted beneath the trail.
  othersBelow: boolean;
}

export function recordingSink(): RecordingSink {
  const written: string[] = [];
  const files: string[] = [];
  const messages: string[] = [];
  let owned = -1;
  const sink: RecordingSink = {
    written,
    files,
    messages,
    othersBelow: false,
    send: async (text) => {
      written.push(text);
      messages.push(text);
      if (owned < 0) owned = messages.length - 1;
    },
    notice: async (text) => void written.push(text),
    edit: async (text) => {
      written.push(text);
      if (owned < 0) {
        messages.push(text);
        owned = messages.length - 1;
      } else messages[owned] = text;
    },
    continueIn: async (text) => {
      written.push(text);
      messages.push(text);
      owned = messages.length - 1;
      sink.othersBelow = false;
    },
    isLatest: () => !sink.othersBelow && owned === messages.length - 1,
    sendFiles: async (label, delivered) => {
      written.push(label);
      messages.push(label);
      files.push(...delivered.map((file) => file.name));
    },
  };
  return sink;
}

export function askingSink(onAsk: (actions: SinkAction[]) => void): MessageSink {
  return {
    ...quietSink(),
    ask: async (_text, actions) => {
      onAsk(actions);
      return { close: async () => undefined };
    },
  };
}

export interface MenuAsk {
  text: string;
  menus: SinkMenu[];
  actions: SinkAction[];
  closed: string[];
}

export function menuAskingSink(onAsk: (ask: MenuAsk) => void): MessageSink {
  return {
    ...quietSink(),
    askWithMenus: async (text, menus, actions) => {
      const ask: MenuAsk = { text, menus, actions, closed: [] };
      onAsk(ask);
      return { close: async (outcome) => void ask.closed.push(outcome) };
    },
  };
}

export function actionId(actions: SinkAction[], prefix: string): string {
  return actions.find((action) => action.id.startsWith(`${prefix}:`))!.id.slice(prefix.length + 1);
}
