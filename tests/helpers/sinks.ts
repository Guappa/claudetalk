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
}

export function recordingSink(): RecordingSink {
  const written: string[] = [];
  const files: string[] = [];
  return {
    written,
    files,
    send: async (text) => void written.push(text),
    notice: async (text) => void written.push(text),
    edit: async (text) => void written.push(text),
    sendFiles: async (label, delivered) => {
      written.push(label);
      files.push(...delivered.map((file) => file.name));
    },
  };
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
