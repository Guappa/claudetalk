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
  // The message that started the turn, where one did: what a word for whoever asked is sent as a reply to.
  promptId?: string;
}

interface SinkMenuOption {
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

export interface DetailPost {
  revise(text: string): Promise<void>;
}

// A side room off the trail for detail that would swamp it; Discord draws it as a thread on the progress message.
export interface DetailSink {
  post(text: string): Promise<DetailPost>;
}

// Told as well as shown: the transport calls for the attention of whoever the turn is working for.
export interface Delivery {
  notify?: boolean;
}

// The only way a turn talks back to Discord, so a different transport can be dropped in behind it.
export interface MessageSink {
  send(text: string, delivery?: Delivery): Promise<void>;
  notice(text: string): Promise<void>;
  edit(text: string, actions?: SinkAction[]): Promise<void>;
  // A new message that later edits go to, so a trail can carry on past one message's limit.
  continueIn?(text: string, actions?: SinkAction[]): Promise<void>;
  // False once something lasting was posted beneath the edited message; editing it further would break time order.
  isLatest?(): boolean;
  sendFiles(text: string, files: SinkFile[]): Promise<void>;
  ask?(text: string, actions: SinkAction[], delivery?: Delivery): Promise<AskHandle>;
  askWithMenus?(text: string, menus: SinkMenu[], actions: SinkAction[], delivery?: Delivery): Promise<AskHandle>;
  typing?(): void;
  anchor?(): SinkAnchor | null;
  // Null when the transport has no side room to offer, or would not open one here.
  openDetail?(title: string): Promise<DetailSink | null>;
}
