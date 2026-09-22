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

// The only way a turn talks back to Discord, so a different transport can be dropped in behind it.
export interface MessageSink {
  send(text: string): Promise<void>;
  notice(text: string): Promise<void>;
  edit(text: string, actions?: SinkAction[]): Promise<void>;
  sendFiles(text: string, files: SinkFile[]): Promise<void>;
  ask?(text: string, actions: SinkAction[]): Promise<AskHandle>;
  typing?(): void;
}
