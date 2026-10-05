// English is the source every other language is checked against: {{placeholders}}, `commands` and **bold** carry over unchanged, only the words around them are translated.
export const en = {
  common: {
    nobody: "nobody",
    unknown: "unknown",
    cancel: "Cancel",
    nothingRunning: "Nothing is running here.",
    sent: "Sent `{{prompt}}` to the conversation.",
    noLongerBound:
      "This channel is no longer bound to a conversation, so there is nothing to run this in. `/resume` opens a conversation in a channel of its own.",
    staleControl:
      "This bridge does not recognise that control; it is most likely left from an older version. Run the command again for a fresh one.",
  },
  units: {
    seconds: "{{seconds}}s",
    minutesSeconds: "{{minutes}}m {{seconds}}s",
    tokens_one: "{{count}} token",
    tokens_other: "{{count}} tokens",
    kiloTokens: "{{thousands}}k tokens",
    minutesAgo: "{{quantity}}m ago",
    hoursAgo: "{{quantity}}h ago",
    daysAgo: "{{quantity}}d ago",
  },
  language: {
    current:
      "Bridge language: **{{name}}**. That covers what the bridge itself says; Claude answers in whatever language you write to it.",
    changed:
      "Bridge language: **{{name}}**, from here on. That covers what the bridge itself says; a turn already running keeps the language it started in. Claude's answers are not affected: it replies in whatever language you write to it.",
  },
  trailChoice: {
    own: "This conversation has its own choice of what the trail draws. `/trail reset:True` makes it follow the bridge's default again.",
    follows:
      "This conversation follows the bridge's default for what the trail draws. `/trail hide:` or `/trail show:` here gives it a choice of its own.",
    everywhere: "The bridge's default, for every conversation that has not made a choice of its own:",
    drawn: "Drawn: {{kinds}}",
    hidden: "Hidden: {{kinds}}",
    none: "nothing",
    stillCounted:
      "A hidden call still counts as a step in the heading, and an approval or a question is still asked. A change shows from the next tool call, in a turn already running too.",
    everywhereIsOwners:
      "Only an owner can change the default for every conversation, and nothing has changed. Leave `everywhere` out to choose for this conversation, or ask an owner to set the default.",
    kinds: {
      edits: "edits and written files",
      commands: "commands",
      reads: "reads and searches",
      web: "web fetches and searches",
      agents: "agents and skills",
      todos: "to-do lists",
      other: "other tools",
    },
  },
  access: {
    ownersOnly:
      "`/{{command}}` is an owner's. Operators drive the bot; who else may use it, and what runs inside it, is the owner's to decide.",
    none: "You do not have access to this bridge. An owner has to give it to you.",
  },
  command: {
    noHandler:
      "`/{{command}}` is registered with Discord but this bridge has no handler for it. Restart the bridge to re-register its commands.",
    failed: "`/{{command}}` failed: {{error}}. Try it again; if it keeps failing, the bridge log on the host has the details.",
    pressFailed:
      "That press failed: {{error}}. What it was for may be half done, so look before pressing again; the bridge log on the host has the details.",
  },
  binding: {
    unbound: "This channel isn't bound to a conversation yet.",
    notInServer:
      "Conversations only exist inside a server, not in a DM. Run this in a channel of the server the bridge is configured for.",
    alreadyOpen: "**{{name}}** is already open in <#{{channelId}}>.",
    bound: "Bound to **{{channel}}**.",
    noWorkspace:
      "You have no workspace to answer from. Ask an owner to set `WORKSPACES_ROOT`, or use `/create` to start a conversation of your own.",
  },
  attachments: {
    executable: "`{{name}}`, because {{extension}} is an executable format",
    tooLarge: "`{{name}}`, because it is over {{megabytes}} MB",
    refused:
      "Not saved for this turn: {{files}}. The session runs with the host's rights, so a file it could execute is not worth the convenience. Put it in the working directory yourself if it is meant to be there.",
    unfetched_one:
      "Could not download {{names}} from Discord, so the session will not see it. Discord's file links expire and its CDN sometimes refuses; send the file again if it matters.",
    unfetched_other:
      "Could not download {{names}} from Discord, so the session will not see them. Discord's file links expire and its CDN sometimes refuses; send the file again if it matters.",
  },
  outbox: {
    tooLarge: "Too large to attach, left in `{{folder}}`: {{names}}.",
    failed:
      "Could not attach what is in `{{folder}}`: {{error}}. The files are still there on the host and the bridge tries again on its own; if it keeps failing, check that the bot may attach files in this channel.",
    files_one: "{{count}} file",
    files_other: "{{count}} files",
  },
  context: {
    critical: "Context is about {{percent}}% full. Run `/compact` soon, or it will compact on its own mid-task.",
    approaching: "Context is about {{percent}}% full. `/context` shows the breakdown, `/compact` frees space.",
  },
  trail: {
    working: "**Working** {{elapsed}}",
    workingSteps_one: "**Working** {{elapsed}} · {{count}} step",
    workingSteps_other: "**Working** {{elapsed}} · {{count}} steps",
    done: "**Worked** {{elapsed}}",
    doneSteps_one: "**Worked** {{elapsed}} · {{count}} step",
    doneSteps_other: "**Worked** {{elapsed}} · {{count}} steps",
    stopped: "**Stopped after** {{elapsed}}",
    stoppedSteps_one: "**Stopped after** {{elapsed}} · {{count}} step",
    stoppedSteps_other: "**Stopped after** {{elapsed}} · {{count}} steps",
    failed: "**Failed after** {{elapsed}}",
    failedSteps_one: "**Failed after** {{elapsed}} · {{count}} step",
    failedSteps_other: "**Failed after** {{elapsed}} · {{count}} steps",
    started: "**Started**",
    interrupted: "**Interrupted: the bridge stopped while this was running. Send a message to continue.**",
    answerDone: "Done.",
    answerDoneNoText: "Done, with no text to show.",
    answerCompacted: "Compacted.",
    answerStopped: "Stopped.",
    compacting: "Compacting the conversation, which can take a while.",
    retryingRefresh: "Another Claude Code process was refreshing the login; trying this turn again in a minute.",
    compactingHeading: "**Compacting** {{elapsed}}",
    compactingSteps_one: "**Compacting** {{elapsed}} · {{count}} step",
    compactingSteps_other: "**Compacting** {{elapsed}} · {{count}} steps",
    compactFailed: "Compaction failed: {{error}}. The conversation carries on as it was; `/compact` tries again.",
    agentDone: "**{{name}}** finished · {{elapsed}}",
    agentFailed: "**{{name}}** failed · {{elapsed}}",
    agentStopped: "**{{name}}** stopped · {{elapsed}}",
    compactedAuto:
      "Compacted (auto): {{before, number}} to {{after, number}} tokens, {{dropped, number}} dropped in total, {{seconds}}s.",
    compactedManual:
      "Compacted (manual): {{before, number}} to {{after, number}} tokens, {{dropped, number}} dropped in total, {{seconds}}s.",
    moreLines_one: "... {{count}} more line",
    moreLines_other: "... {{count}} more lines",
    written_one: "{{path}} ({{count}} line)",
    written_other: "{{path}} ({{count}} lines)",
  },
  tools: {
    read: "**Read** {{path}}",
    notebook: "**Notebook** {{path}}",
    find: "**Find** {{pattern}} in {{path}}",
    findAnywhere: "**Find** {{pattern}}",
    search: "**Search** {{pattern}} in {{path}}",
    searchAnywhere: "**Search** {{pattern}}",
    fetch: "**Fetch** {{url}}",
    webSearch: "**Web search** {{query}}",
    toolSearch: "**Tool search** {{query}}",
    agent: "**Agent** {{description}}",
    skill: "**Skill** /{{name}}",
    todos_one: "**Todo** · {{count}} item",
    todos_other: "**Todo** · {{count}} items",
    server: "**{{server}}** {{tool}}",
    other: "**{{name}}**",
  },
  turn: {
    draining:
      "The bridge is shutting down and takes nothing new. It lets running turns finish first, which can take a while; send this again once it is back.",
    failed: "The turn failed.\n```\n{{error}}\n```",
    checkFailed:
      "Your message was not sent to Claude: the check before the turn failed with {{error}}. Try sending it again; if it keeps failing, the bridge log on the host has the details.",
    heldByBackgroundAgent:
      "That conversation is running as a background agent (`{{shortId}}`). Run `/takeover` here to stop it and continue, or `claude attach {{shortId}}` on the host.",
    openInTerminalIdle:
      "That conversation is open in a terminal on the host (pid {{pid}}, {{cwd}}), where nothing is running. Run `/takeover` here to close it there and continue, or close that terminal yourself.",
    openInTerminalBusy:
      "That conversation is open in a terminal on the host (pid {{pid}}, {{cwd}}), and a turn is running there. Let it finish or stop it there, then try again.",
    openInTerminal:
      "That conversation is open in a terminal on the host (pid {{pid}}, {{cwd}}). Close that terminal or switch it to another conversation, then try again.",
    conversationGone:
      "This channel's conversation was started over or unbound while your message was on its way, so it was not run. Send it again.",
    turnLimit:
      "The turn reached the limit `CLAUDE_MAX_TURNS` puts on how often one may go back to the model, and Claude Code stopped it there. What it did is kept. Send a message to have it carry on, or raise the limit in `.env` on the host and restart the bridge.",
    unknownSession:
      "Claude Code has no conversation under the session id this channel is bound to: its transcript was removed from the host, or its first turn never got far enough to write one. Sending the message again cannot help. Run `/clear` to start a fresh conversation in this channel.",
    errors: {
      stopped: "The turn was stopped.",
      orphanTwice:
        "Claude Code reported a background command left over from an earlier turn twice in a row, and a session that starts by reporting one refuses every tool call. Send the message again; it normally clears on the next try.",
      refreshTwice:
        "Claude Code could not refresh the login twice in a row: another of its processes held the refresh, or died holding it. Try again in a minute; if it keeps happening, close other Claude Code processes on the host or sign in again there.",
      ended: "The turn ended as {{subtype}}. Try sending your message again.",
      unexplained: "Claude Code ended the turn with an error and gave no reason. Try sending your message again.",
      endedSaying: "The turn ended as {{subtype}}.\n{{text}} Try sending your message again.",
      couldNotRun:
        "Claude Code could not run this turn: {{error}}. Check that it is installed and logged in on the host, then try again.",
    },
  },
  fold: {
    handedOver:
      "Handed to the running turn. Claude takes it up at its next step, or right after this turn's answer if no step is left.",
    takenUp: "Taken up by the running turn.",
    neverTaken: "The turn ended before this was taken up. Send it again.",
    sendNow: "Send now",
    sent: "Sent now. The step Claude was on was cut short so it could read your message, and it carries on from there. Agents and background commands it had running were left running.",
    nothingWaiting: "Nothing is waiting: the running turn has already taken your message up.",
    notRunning: "No turn is running here any more, so there is nothing to interrupt.",
    notInterrupted: "The running turn could not be interrupted, so your message still waits for its next step.",
  },
  queue: {
    behind_one: "Queued behind the turn still running.",
    behind_other: "Queued behind {{count}} messages.",
    runningAlone: "One turn is running, with nothing queued behind it.",
    runningWith_one: "One turn is running, with {{count}} message queued behind it.",
    runningWith_other: "One turn is running, with {{count}} messages queued behind it.",
    full: "This conversation already holds {{limit}} messages: one running and {{queued}} queued behind it. Let it catch up, run `/stop` to end the one in flight and let the next start, or `/stop all:true` to drop the queue with it.",
  },
  restart: {
    unsupervised:
      "Not restarted: this bridge was started by hand, or by a service installed before it could restart itself, so nothing would start it again. Run the autostart installer from the README again, or stop and start it on the host.",
    broken:
      "Not restarted: the code on the host would not start, so the bridge keeps running as it is. Fix what it names, then ask again.\n```\n{{error}}\n```",
    checkTimedOut:
      "Not restarted: checking that the code on the host would start took over a minute and was given up. The bridge keeps running as it is; the log on the host may say what it was waiting on.",
    now: "Restarting now. The bridge says so here once it is back.",
    afterTurns_one:
      "Restarting as soon as the {{count}} running turn has finished and nothing else is running. The bridge works as usual until then, and says so here once it is back.",
    afterTurns_other:
      "Restarting as soon as the {{count}} running turns have finished and nothing else is running. The bridge works as usual until then, and says so here once it is back.",
    back: "The bridge is back after its restart, on v{{version}}.",
  },
  update: {
    out_one: "**v{{version}}** of the bridge is out, {{count}} version past the v{{current}} running here.",
    out_other: "**v{{version}}** of the bridge is out, {{count}} versions past the v{{current}} running here.",
    more_one: "... and {{count}} more change",
    more_other: "... and {{count}} more changes",
    how: "Everything in between: <{{url}}>. To update, pull the new code on the host and restart the bridge, or pull the new image. This is said once per version, and no more than once a week.",
  },
  stop: {
    button: "Stop",
    allButton: "Stop all",
    agentsButton: "Stop agents",
    cloudTaskButton: "Stop cloud task",
    outlives:
      "The turn's whole process tree is killed; on Windows a command that had detached itself from that tree can outlive it, so check the host if it was something long.",
    noAgents: "No agent or cloud task is running here, so there was nothing to stop.",
    agentsAsked_one:
      "Asked {{count}} task to stop. The turn itself carries on, and Claude is told it was stopped; press **Stop** to end the turn as well.",
    agentsAsked_other:
      "Asked {{count}} tasks to stop. The turn itself carries on, and Claude is told they were stopped; press **Stop** to end the turn as well.",
    nothingYet_one: "Nothing is running yet; {{count}} message queued here will run in turn.",
    nothingYet_other: "Nothing is running yet; {{count}} messages queued here will run in turn.",
    turn: "Stopped this turn. Nothing was queued, so Claude takes no further action here until your next message. $t(stop.outlives)",
    turnThenQueue_one: "Stopped this turn. The {{count}} message queued behind it runs next. $t(stop.outlives)",
    turnThenQueue_other: "Stopped this turn. The {{count}} messages queued behind it run next. $t(stop.outlives)",
    queueOnly_one: "Nothing was running, but the message queued here was dropped.",
    queueOnly_other: "Nothing was running, but the {{count}} messages queued here were dropped.",
    all: "Stopped. Claude takes no further action here until your next message. $t(stop.outlives)",
    allWithQueue_one:
      "Stopped. The message queued behind it was dropped too. Claude takes no further action here until your next message. $t(stop.outlives)",
    allWithQueue_other:
      "Stopped. The {{count}} messages queued behind it were dropped too. Claude takes no further action here until your next message. $t(stop.outlives)",
  },
  agents: {
    title: "Agents: {{asked}}",
    titleBare: "Agents",
    tally: "**Agents** · {{tally}}",
    tallyRunning: "{{quantity}} running",
    tallyDone: "{{quantity}} done",
    tallyFailed: "{{quantity}} failed",
    tallyStopped: "{{quantity}} stopped",
    more: "and {{quantity}} more",
    tools_one: "{{count}} tool",
    tools_other: "{{count}} tools",
    running: "running",
    waiting: "waiting on a background command",
    completed: "done in {{elapsed}}",
    failed: "failed after {{elapsed}}",
    stopped: "stopped after {{elapsed}}",
  },
  approvals: {
    request: "**{{tool}}** wants to run. Approve it?\n```\n{{detail}}\n```",
    deleteOutside:
      "Claude wants to delete something outside this conversation's folder, which the bridge refuses unless an owner allows it. Allow this one command?\n```\n{{detail}}\n```",
    writeOutside:
      "Claude wants to write a file outside this conversation's folder, which the bridge refuses unless an owner allows it. Allow this one write?\n```\n{{detail}}\n```",
    approveOnce: "Approve once",
    deny: "Deny",
    approveRest: "Approve the rest of this turn",
    approvedOnce: "Approved once.",
    approvedRest: "Approved for the rest of this turn.",
    approvedRestQuiet: "Approved, and the rest of this turn will not ask again.",
    denied: "Denied from Discord.",
    ended: "The turn ended before this was answered.",
    expired: "No answer in {{minutes}} minutes, so it was denied.",
    stale: "That request is already answered, expired, or from before a restart.",
    ownersOnly: "Only an owner of this bridge can answer a permission request.",
  },
  questions: {
    heading_one: "Claude has a question.",
    heading_other: "Claude has {{count}} questions.",
    question: "**{{number}}. {{header}}** {{question}}",
    questionPickAny: "**{{number}}. {{header}}** {{question}} Pick any that apply.",
    placeholder: "Question {{number}}",
    unnamedOption: "(blank)",
    other: "Other...",
    otherDescription: "Type an answer of your own",
    ownAnswerTitle: "Your own answer to question {{number}}",
    ownAnswerLabel: "Answer",
    submit: "Submit",
    skip: "Skip",
    answered: "Answered: {{summary}}.",
    skipped: "Skipped: Claude is told to continue on its own judgement and to say what it assumed.",
    expired: "No answer in {{minutes}} minutes, so Claude continues without one.",
    ended: "The turn ended before this was answered.",
    stale: "Those questions are already answered, expired, or from before a restart.",
    unanswered: "Question {{number}} has no answer yet. Pick one, or press Skip to send none.",
  },
  sync: {
    fromYou: "**You** · terminal · {{clock}}",
    fromClaude: "**Claude** · terminal · {{clock}}",
    drift_one:
      "{{count}} message happened in this conversation outside Discord since you were last here. It was {{ago}}, {{when}}. Run `/sync` to see it.",
    drift_other:
      "{{count}} messages happened in this conversation outside Discord since you were last here. The last was {{ago}}, {{when}}. Run `/sync` to see them.",
    running:
      "A turn is running here right now, and what it says is on its way to this channel. Run `/sync` again once it has finished.",
    nothingNew: "Nothing new: nothing has happened in this conversation outside Discord since you were last here.",
    all_one: "{{count}} message from outside Discord:",
    all_other: "{{count}} messages from outside Discord:",
    latest_one: "{{count}} message from outside Discord. Where you left off, with all of them in the file:",
    latest_other: "{{count}} messages from outside Discord. Where you left off, with all of them in the file:",
    leftOff: "Where you left off:",
    countedRecent:
      "That counts only the most recent: the bridge reads back the last {{megabytes}} MB of a transcript, and more happened before that than it holds.",
  },
  ask: {
    withContext_one: "Asking with the last {{count}} message as context.",
    withContext_other: "Asking with the last {{count}} messages as context.",
    noContext: "Asking with no extra context.",
  },
  category: {
    full: "**{{name}}** already holds {{limit}} channels, which is all Discord allows. Use another category, or move something out of that one first.",
    notMovable: "Only a text channel inside a server can be moved. Run `/category` in the conversation's own channel.",
    current: "This conversation sits in **{{name}}**.",
    none: "This conversation is not in any category. Pass a name to put it in one.",
    moved: "Moved to **{{name}}**.",
    moveFailed:
      "Could not move it to **{{name}}**: {{error}}. The bot needs Manage Channels, and a category can hold {{limit}} channels.",
  },
  clear: {
    running: "A turn is running here. Let it finish or `/stop` it, then `/clear`.",
    confirm:
      "This starts this channel over with a fresh conversation in `{{cwd}}`: the same folder, model, effort and members, but with none of what was said in this one. The current conversation stays on the host, listed by `/sessions`, and `/resume` with its session id opens it in a channel of its own. The channel's messages stay; `/purge` removes them.",
    startOver: "Start over",
    unbound: "This channel isn't bound to a conversation, so there is nothing to clear.",
    stale:
      "This was offered for a conversation this channel no longer holds, so nothing was started over. Run `/clear` again if this one should be.",
    done: "Started over. This channel now holds a fresh conversation in `{{cwd}}`; the previous one is still on the host as `{{sessionId}}`.",
    cancelled: "Left it alone. The conversation continues as it was.",
  },
  unbind: {
    unbound: "This channel isn't bound to a conversation, so there is nothing to unbind.",
    running: "A turn is running here. Let it finish or `/stop` it, then `/unbind`.",
    done: "Unbound. The conversation is still on the host and can be resumed with `/resume`. The channel is now just a channel; delete it, or keep it for the history?",
    doneShared:
      "Unbound. The conversation is still on the host and can be resumed with `/resume`. This channel only answered when the bot was tagged, and it stays as it is.",
    boundAgain:
      "This channel has been bound to a conversation again since, so it was not deleted. Run `/unbind` here again if it should go.",
    deleteChannel: "Delete the channel",
    keep: "Keep it",
    kept: "Kept. The channel stays as it is, with its history.",
    notDeletable: "This channel cannot be deleted from here. Remove it in Discord's channel settings.",
    deleting: "Deleting the channel...",
    deleteFailed:
      "Could not delete the channel: {{error}}. The bot needs Manage Channels; remove it in Discord's channel settings instead.",
  },
  takeover: {
    closedTerminal:
      "Closed Claude Code in the terminal on the host (pid {{pid}}). To open the conversation there again, run `claude --resume {{sessionId}}` on the host.",
    free: "This conversation is free now: send your message.",
    heldRuns: "Your message from before runs now.",
    notClosed:
      "Claude Code in the terminal on the host (pid {{pid}}) did not close within a few seconds, so nothing was taken over. Close that terminal on the host, then try again.",
    running: "A turn is running here right now. Use `/stop` to end it.",
    nothingHolding: "Nothing is holding this conversation. Just send a message.",
    stopped: "Stopped background agent `{{shortId}}`.",
  },
  create: {
    topic: 'Claude Code conversation "{{name}}" in {{cwd}}',
    channelFailed:
      "Could not create the channel: {{error}}. The bot needs Manage Channels, Manage Roles and Manage Messages in this server; Manage Roles is what lets it make the channel private to you.",
    ownersOnlyHere:
      "Only an owner can create conversations here. Set WORKSPACES_ROOT to give other operators somewhere of their own to work.",
    folderFailed:
      "Could not use `{{cwd}}` as the working directory: {{error}}. Check the path is somewhere the bridge may write, or pass an existing folder as `project`.",
    categoryFailed: "Could not use the category **{{name}}**: {{error}}. The bot needs Manage Channels to make one.",
    done: "Created {{channel}} for **{{name}}** in `{{cwd}}`.",
    resumeButton: "Resume {{name}} ({{age}})",
    startNew: "Start a new one",
    existing_one: "`{{cwd}}` already has {{count}} conversation. Resume one, or start another alongside it?",
    existing_other: "`{{cwd}}` already has {{count}} conversations. Resume one, or start another alongside it?",
    existingMore_one:
      "`{{cwd}}` already has {{count}} conversation ({{hidden}} older not shown). Resume one, or start another alongside it?",
    existingMore_other:
      "`{{cwd}}` already has {{count}} conversations ({{hidden}} older not shown). Resume one, or start another alongside it?",
    cancelled: "Left it alone. Nothing was created.",
    tooOld: "That `/create` is too old to act on now. Run it again.",
    gone: "That conversation is no longer on the host: its transcript was removed or moved. Run `/create` again to start a fresh one.",
  },
  fork: {
    unbound: "This channel isn't bound to a conversation, so there is nothing to branch.",
    unnamed: "conversation",
    branching: "Branching into {{channel}}...",
    notStarted:
      "Nothing was branched: the branch's first turn did not start, and the channel made for it was removed again. That happens when this conversation is open in a terminal or held by a background agent, when its queue is full or was dropped, or when the bridge is shutting down. Run `/fork` again once it is free.",
    notBound:
      "Created {{channel}}, but the branch's first turn ended without Claude Code reporting a new session id, so that channel is not bound; what the turn came to is shown there. If the branch does appear in `/sessions`, `/resume` opens it in a channel of its own, and {{channel}} can be deleted.",
    done: "Branched **{{source}}** into {{channel}} as **{{name}}**. This channel is untouched.",
  },
  resume: {
    ambiguous: '"{{name}}" is ambiguous. Did you mean: {{candidates}}?',
    andMore: "{{candidates}}, and {{count}} more",
    notFound: 'No conversation named "{{name}}". Use `/sessions` to see what exists.',
    noFolder: 'Found "{{name}}" but could not read its working directory from the transcript, so it cannot be resumed.',
    opened: "Opened {{channel}} for **{{name}}** in `{{cwd}}`.",
    openedPastOlder_one:
      "Opened {{channel}} for **{{name}}** in `{{cwd}}` ({{count}} older conversation with the same name was skipped).",
    openedPastOlder_other:
      "Opened {{channel}} for **{{name}}** in `{{cwd}}` ({{count}} older conversations with the same name were skipped).",
  },
  sessions: {
    title: "Conversations on the host",
    titleMatching: 'Conversations matching "{{filter}}"',
    none: "No conversations found yet. Start one with `/create <name>`.",
    hidden_one: "{{count}} conversation in the temp folder is left out. Pass a filter to include it.",
    hidden_other: "{{count}} conversations in the temp folder are left out. Pass a filter to include them.",
    older: "+{{older}} older",
    live: "live ({{kind}}, {{status}})",
    starting: "starting",
  },
  members: {
    runs: "Runs in `{{cwd}}` as the host user, with full machine access.",
    seenByNobody: "Nobody else can see it.",
    seenBy_one: "{{count}} other can see it.",
    seenBy_other: "{{count}} others can see it.",
    visibilityFailed:
      "Access was recorded, but the channel's visibility could not be changed: {{error}}. The bot needs Manage Roles for that.",
    inviteBot: "Bots cannot be invited to a conversation; pick a person.",
    alreadyIn: "{{user}} already has access to this conversation.",
    invited: "{{user}} can now see this conversation.",
    inviteWarning:
      "This lets them **read** the channel, including everything already said here. It does not let them use the bot: messages and commands from anyone who is not an operator are ignored. `/operator add` is what hands over the machine.",
    notMember: "{{user}} is not a member of this conversation.",
    removed: "{{user}} removed.",
    sharedChannel:
      "Nothing was changed. This channel was here before the conversation, so who can see it is set in Discord's own channel settings, not by the bridge. `/invite` and `/uninvite` work in a channel made by `/create`, `/resume` or `/fork`.",
    summary: "Owner: {{owner}}\nCan see it: {{watchers}}",
  },
  operators: {
    title: "Who may use this bridge",
    ownersFixed: "Owners are set on the host and cannot be changed here.",
    owners: "Owners",
    operators: "Operators",
    bot: "Bots cannot be operators; pick a person.",
    isOwner:
      "{{user}} is an owner, set in `DISCORD_OWNER_IDS` on the host. That is above operator and cannot be changed from Discord.",
    added:
      "{{user}} is an operator from now. **They can run anything on this machine**, as the host user, with its credentials and its Claude plan.",
    already: "{{user}} is already an operator.",
    removed: "{{user}} is no longer an operator. Conversations they already started stay bound.",
    notOperator: "{{user}} is not an operator.",
  },
  run: {
    noListYet:
      "This conversation's commands are not known yet: they are learned the first time a turn runs in its folder. Send a message here first, then `/run` will list them as you type.",
    noListChoice: "No command list yet: send a message here first, then try again",
    notAName: "`{{command}}` is not a command name. Pick one from the list `/run` offers as you type.",
    unknown:
      "`/{{command}}` is not a command this conversation has. Pick one from the list `/run` offers as you type; a plugin installed since the last turn here shows up after the next one.",
    confirm: "Run this in the conversation?",
    takes: "Takes: `{{hint}}`",
    nothingStarts: "Nothing starts until you press Run.",
    runButton: "Run",
    unbound: "This channel isn't bound to a conversation, so there is nothing to run a command in.",
    cancelled: "Left it alone. Nothing was run.",
    tooOld: "That `/run` is too old to act on now. Run it again.",
  },
  typed: {
    clear:
      "`/clear` typed as a message would start a session this channel cannot see. Use this bot's own `/clear` command, which starts the conversation over in this channel, or `/purge` to delete the channel's messages.",
    bridgeOwned:
      "`/{{command}}` applies to one process, and every turn here runs a new one, so it would report success and then revert. Use this bot's own `/{{command}}` command instead, which stores the value for this conversation and applies it on every turn.",
    terminalOnly: "`/{{command}}` only runs in an interactive terminal. Run it on the host machine.",
    billedReview: "It starts a cloud review, which can be billed on top of your plan.",
    asksFirst:
      "`{{typed}}` was not run. {{caution}} In a terminal Claude Code asks before it starts, but a command typed as a message here would start without asking. Use `{{viaRun}}` instead: it shows exactly what will run and waits for you to press Run.",
  },
  settings: {
    current: "{{setting}} is set to `{{value}}` for this conversation.",
    notOverridden: "{{setting}} is not overridden here, so turns run with {{fallback}}.",
    changed:
      "{{setting}} set to `{{value}}`. It applies from the next turn onward; a turn already running keeps what it started with.",
    hostDefault: "`{{value}}` (host default)",
    claudeDefault: "Claude Code's default",
    cleared: "{{setting}} is cleared for this conversation, so from the next turn it runs with {{fallback}}.",
    defaultChoice: "default · clear the override and follow the host",
    unknownModel:
      "`{{value}}` is not a model Claude Code offers on this host, so every turn set to it would fail. Nothing has changed. Pick one of the suggestions `/model` shows as you type: {{offered}}.",
  },
  whoami: {
    title: "This channel",
    resumeHint: "Resume it on the host without going through the picker:",
    directory: "Directory",
    model: "Model",
    effort: "Effort",
    context: "Context",
    contextStanding: "{{percent}}% of {{ceiling}}",
    contextUnmeasured: "Not measured yet. The next turn here measures it.",
    version: "bridge v{{version}}",
    newerVersion: "v{{version}} is out",
    claude: "Claude Code {{bundled}}",
    claudeDiffers: "Claude Code {{bundled}} for turns, {{host}} on the host",
  },
  usage: {
    notReported: "Plan usage: not reported yet. Claude Code sends it with each turn, so it appears after the first one.",
    plan: "Plan usage: {{windows}} (as of {{when}})",
    window: "{{label}} {{percent}}% used, resets {{when}}",
    windowReset: "{{label}} reset {{when}}, with no figure reported since",
    fiveHour: "5-hour window",
    weekAll: "week, all models",
    weekOpus: "week, Opus",
    weekSonnet: "week, Sonnet",
  },
  spend: {
    underCent: "under $0.01",
    mineNone: "This conversation: nothing yet.",
    mine_one: "This conversation: {{count}} turn here · {{input}} in, {{output}} out, {{cached}} cached",
    mine_other: "This conversation: {{count}} turns here · {{input}} in, {{output}} out, {{cached}} cached",
    allNone: "Every conversation touched: nothing yet.",
    all_one: "Every conversation touched: {{count}} turn here · {{input}} in, {{output}} out, {{cached}} cached",
    all_other: "Every conversation touched: {{count}} turns here · {{input}} in, {{output}} out, {{cached}} cached",
    cost: "API-equivalent cost, which a subscription is not billed by: {{mine}} this conversation over its life, {{all}} across every conversation touched.",
    costWithLast:
      "API-equivalent cost, which a subscription is not billed by: {{mine}} this conversation over its life (last turn {{last}}), {{all}} across every conversation touched.",
    footnote:
      "Plan usage is for the whole account. Turns and tokens are counted since the bridge started {{since}}; a restart resets them, and turns run in a terminal are never counted. Tokens are the session's own and leave out what its agents used; the cost includes them.",
  },
  plugins: {
    none: "No plugins reported by `claude plugin list --json`. If you expected some, check that Claude Code is on PATH for this process.",
    choose: "Choose a plugin",
    summary_one: "{{count}} plugin installed, {{enabled}} enabled.",
    summary_other: "{{count}} plugins installed, {{enabled}} enabled.",
    optionEnabled: "{{version}} · enabled",
    optionDisabled: "{{version}} · disabled",
    enable: "Enable",
    disable: "Disable",
    enabled: "Enabled {{id}}.",
    disabled: "Disabled {{id}}.",
    enableFailed: "Could not enable `{{id}}`: {{error}}. Run the same command on the host to see the full output.",
    disableFailed: "Could not disable `{{id}}`: {{error}}. Run the same command on the host to see the full output.",
  },
  mcp: {
    none: "Claude Code reports no MCP servers for this conversation's folder.",
    choose: "Choose a server",
    summary_one: "{{count}} MCP server for this conversation's folder, {{connected}} connected.",
    summary_other: "{{count}} MCP servers for this conversation's folder, {{connected}} connected.",
    stateConnected_one: "connected, {{count}} tool",
    stateConnected_other: "connected, {{count}} tools",
    stateFailed: "failed",
    stateNeedsAuth: "needs a sign-in",
    statePending: "still connecting",
    stateDisabled: "switched off",
    failedBecause:
      "Claude Code could not connect to it: {{error}}. Reconnect tries again; if it keeps failing, the server's own setup on the host is where to look.",
    signInOnHost:
      "It is waiting for a sign-in, which cannot be given from Discord. Run `/mcp` in Claude Code on the host and authorise it there; a claude.ai connector is authorised in the connector settings on claude.ai.",
    offForFolder: "It is switched off for this folder, so no session here loads it.",
    stillConnecting: "Claude Code is still connecting to it. Run `/mcp` again in a moment.",
    switchOn: "Switch on",
    switchOff: "Switch off",
    reconnect: "Reconnect",
    appliesFromNextTurn: "This holds for the folder: the next turn here sees it, and so does a terminal opened there.",
    gone: "Claude Code reports no server named `{{name}}` for this folder any more. Run `/mcp` again for the current list.",
    changeFailed: "Could not change `{{name}}`: {{error}}. Run `/mcp` in Claude Code on the host to see what it says there.",
    unreachable:
      "Could not ask Claude Code about its MCP servers: {{error}}. Check that Claude Code is installed and signed in on the host, then run `/mcp` again.",
  },
  skills: {
    none: "No skills known for this conversation yet. Send it a message first, then try again: the list comes from the session itself.",
    option: "Run /{{skill}}",
    range: "{{first}} to {{last}}",
    available_one: "{{count}} skill available in this conversation.",
    available_other: "{{count}} skills available in this conversation.",
    availableAcross_one: "{{count}} skill available in this conversation, A to Z across {{menus}} menus.",
    availableAcross_other: "{{count}} skills available in this conversation, A to Z across {{menus}} menus.",
    omitted_one: "The last {{count}} did not fit; send `/name` as a message to run one of those.",
    omitted_other: "The last {{count}} did not fit; send `/name` as a message to run one of those.",
  },
  purge: {
    notDeletable:
      "`/purge` only works in a server text channel where the bot can manage messages. Run it in the conversation's channel, or give the bot Manage Messages here.",
    running: "A turn is running here. Let it finish or `/stop` it, then `/purge`.",
    warning: "This deletes every message in this channel, including yours. It cannot be undone.",
    warningConversation:
      "The conversation on the host is not touched, and your next message carries on from it. The channel does not get its history back.",
    confirm: "Delete them",
    cancelled: "Left the channel alone.",
    deleting: "Deleting...",
    empty: "Nothing to delete; the channel is already empty.",
    deleted_one: "Deleted {{count}} message.",
    deleted_other: "Deleted {{count}} messages.",
    slow_one: "{{count}} of them was older than {{days}} days, which Discord only lets go one at a time.",
    slow_other: "{{count}} of them were older than {{days}} days, which Discord only lets go one at a time.",
    failed_one: "{{count}} could not be deleted.",
    failed_other: "{{count}} could not be deleted.",
    conversationKept: "The conversation itself is untouched, and your next message carries on from it.",
    stoppedPartway: "The purge stopped partway: {{error}}. Run `/purge` again to finish.",
  },
} as const;
