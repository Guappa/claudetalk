export interface SinkFile {
  name: string;
  data: Buffer;
}

// A label and an id, not a button: a sink decides how to draw an action, and Discord draws a button.
export interface SinkAction {
  id: string;
  label: string;
  tone?: "normal" | "danger";
}

export interface AskHandle {
  close(outcome: string): Promise<void>;
}

// Where the progress message lives, so a bridge that died can find it again.
export interface SinkAnchor {
  channelId: string;
  messageId: string;
}

export interface SinkMenuOption {
  value: string;
  label: string;
  description?: string;
}

// A list to pick from, one or several; Discord draws it as a select menu.
export interface SinkMenu {
  id: string;
  placeholder: string;
  options: SinkMenuOption[];
  multiple: boolean;
}

// The only way a turn talks back to Discord, so a different transport can be dropped in behind it.
export interface MessageSink {
  send(text: string): Promise<void>;
  notice(text: string): Promise<void>;
  edit(text: string, actions?: SinkAction[]): Promise<void>;
  sendFiles(text: string, files: SinkFile[]): Promise<void>;
  ask?(text: string, actions: SinkAction[]): Promise<AskHandle>;
  askWithMenus?(text: string, menus: SinkMenu[], actions: SinkAction[]): Promise<AskHandle>;
  typing?(): void;
  anchor?(): SinkAnchor | null;
}
