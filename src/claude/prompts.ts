// Everything here is written for Claude to read, so it stays in English whatever language the bridge speaks to people.
const SAY_HELLO = "Say hello in one short line, naming the folder you are working in but not its full path.";

export function helloToNew(name: string): string {
  return `This conversation was created from Discord and is named "${name}". ${SAY_HELLO}`;
}

export const HELLO_AFTER_CLEAR = `This conversation was just started over from Discord in place of an earlier one in the same folder. ${SAY_HELLO}`;

export function helloToBranch(name: string): string {
  return (
    `This conversation has been branched into a copy named "${name}". ` +
    "Say in one line what it was about, so the branch starts with its bearings."
  );
}

const ON_YOUR_OWN = "Continue on your own judgement and say what you assumed.";

export const QUESTIONS_UNANSWERED = {
  skipped: `The person skipped the questions. ${ON_YOUR_OWN}`,
  expired: `Nobody answered the questions in time. ${ON_YOUR_OWN}`,
  ended: `The turn ended before the questions were answered. ${ON_YOUR_OWN}`,
  unaskable: "This conversation cannot show questions, so continue without an answer.",
  unshown: "The questions could not be shown in Discord, so continue without an answer.",
} as const;

export const APPROVAL_REFUSED = {
  denied: "Denied from Discord.",
  expired: "Nobody answered the permission request in time, so it was denied.",
  unaskable: "This conversation cannot show approval buttons.",
  unshown: "The permission request could not be shown in Discord, so it was denied.",
  ended: "The turn ended before the permission request was answered.",
  failed: "The permission check failed before it could be answered, so it was denied.",
} as const;
