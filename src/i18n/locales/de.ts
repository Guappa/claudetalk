import type { Catalog } from "../catalog.ts";

export const de: Catalog = {
  common: {
    nobody: "niemand",
    unknown: "unbekannt",
    cancel: "Abbrechen",
    nothingRunning: "Hier läuft nichts.",
    sent: "`{{prompt}}` an das Gespräch geschickt.",
    noLongerBound:
      "Dieser Kanal ist an kein Gespräch mehr gebunden, also gibt es nichts, worin das laufen könnte. `/resume` öffnet ein Gespräch in einem eigenen Kanal.",
    staleControl:
      "Die Brücke kennt dieses Bedienelement nicht; es stammt vermutlich aus einer älteren Version. Führ den Befehl noch einmal aus, um ein neues zu bekommen.",
  },
  units: {
    seconds: "{{seconds}} s",
    minutesSeconds: "{{minutes}} min {{seconds}} s",
    tokens_one: "{{count}} Token",
    tokens_other: "{{count}} Tokens",
    kiloTokens: "{{thousands}}k Tokens",
    minutesAgo: "vor {{quantity}} min",
    hoursAgo: "vor {{quantity}} h",
    daysAgo: "vor {{quantity}} d",
  },
  language: {
    current:
      "Sprache der Brücke: **{{name}}**. Das gilt für das, was die Brücke selbst sagt; Claude antwortet in der Sprache, in der du schreibst.",
    changed:
      "Sprache der Brücke: **{{name}}**, ab jetzt. Das gilt für das, was die Brücke selbst sagt; ein Durchlauf, der schon läuft, behält die Sprache, in der er begonnen hat. Claudes Antworten sind nicht betroffen: Es antwortet in der Sprache, in der du schreibst.",
  },
  access: {
    ownersOnly:
      "`/{{command}}` gehört den Besitzern. Operatoren steuern den Bot; wer ihn sonst noch benutzen darf und was darin läuft, entscheidet der Besitzer.",
    none: "Du hast keinen Zugang zu dieser Brücke. Ein Besitzer muss ihn dir geben.",
  },
  command: {
    noHandler:
      "`/{{command}}` ist bei Discord registriert, aber diese Brücke hat keinen Handler dafür. Starte die Brücke neu, damit sie ihre Befehle neu registriert.",
    failed:
      "`/{{command}}` ist fehlgeschlagen: {{error}}. Versuch es noch einmal; wenn es weiter fehlschlägt, stehen die Einzelheiten im Log der Brücke auf dem Host.",
    pressFailed:
      "Dieser Klick ist fehlgeschlagen: {{error}}. Was er auslösen sollte, ist vielleicht halb erledigt, also sieh nach, bevor du noch einmal klickst; die Einzelheiten stehen im Log der Brücke auf dem Host.",
  },
  binding: {
    unbound: "Dieser Kanal ist noch an kein Gespräch gebunden.",
    notInServer:
      "Gespräche gibt es nur in einem Server, nicht in einer Direktnachricht. Führ das in einem Kanal des Servers aus, für den die Brücke eingerichtet ist.",
    alreadyOpen: "**{{name}}** ist schon in <#{{channelId}}> offen.",
    bound: "An **{{channel}}** gebunden.",
    noWorkspace:
      "Du hast keinen Arbeitsbereich, aus dem du antworten könntest. Bitte einen Besitzer, `WORKSPACES_ROOT` zu setzen, oder starte mit `/create` ein eigenes Gespräch.",
  },
  attachments: {
    executable: "`{{name}}`, weil {{extension}} ein ausführbares Format ist",
    tooLarge: "`{{name}}`, weil sie größer als {{megabytes}} MB ist",
    refused:
      "Für diesen Durchlauf nicht gespeichert: {{files}}. Die Sitzung läuft mit den Rechten des Hosts, also ist eine Datei, die sie ausführen könnte, die Bequemlichkeit nicht wert. Leg sie selbst ins Arbeitsverzeichnis, wenn sie dort hingehört.",
    unfetched_one:
      "{{names}} konnte nicht von Discord heruntergeladen werden, also wird die Sitzung sie nicht sehen. Discords Dateilinks laufen ab und sein CDN verweigert sich manchmal; schick die Datei noch einmal, wenn es darauf ankommt.",
    unfetched_other:
      "{{names}} konnten nicht von Discord heruntergeladen werden, also wird die Sitzung sie nicht sehen. Discords Dateilinks laufen ab und sein CDN verweigert sich manchmal; schick die Dateien noch einmal, wenn es darauf ankommt.",
  },
  outbox: {
    tooLarge: "Zu groß zum Anhängen, in `{{folder}}` gelassen: {{names}}.",
    failed:
      "Was in `{{folder}}` liegt, konnte nicht angehängt werden: {{error}}. Die Dateien sind noch auf dem Host, und die Brücke versucht es von selbst noch einmal; wenn es weiter fehlschlägt, prüf, ob der Bot in diesem Kanal Dateien anhängen darf.",
    files_one: "{{count}} Datei",
    files_other: "{{count}} Dateien",
  },
  context: {
    critical:
      "Der Kontext ist zu etwa {{percent}} % voll. Führ bald `/compact` aus, sonst wird er mitten in der Arbeit von selbst komprimiert.",
    approaching: "Der Kontext ist zu etwa {{percent}} % voll. `/context` zeigt die Aufteilung, `/compact` schafft Platz.",
  },
  trail: {
    working: "**Arbeitet** {{elapsed}}",
    workingSteps_one: "**Arbeitet** {{elapsed}} · {{count}} Schritt",
    workingSteps_other: "**Arbeitet** {{elapsed}} · {{count}} Schritte",
    done: "**Gearbeitet** {{elapsed}}",
    doneSteps_one: "**Gearbeitet** {{elapsed}} · {{count}} Schritt",
    doneSteps_other: "**Gearbeitet** {{elapsed}} · {{count}} Schritte",
    stopped: "**Gestoppt nach** {{elapsed}}",
    stoppedSteps_one: "**Gestoppt nach** {{elapsed}} · {{count}} Schritt",
    stoppedSteps_other: "**Gestoppt nach** {{elapsed}} · {{count}} Schritte",
    failed: "**Fehlgeschlagen nach** {{elapsed}}",
    failedSteps_one: "**Fehlgeschlagen nach** {{elapsed}} · {{count}} Schritt",
    failedSteps_other: "**Fehlgeschlagen nach** {{elapsed}} · {{count}} Schritte",
    started: "**Gestartet**",
    interrupted: "**Unterbrochen: Die Brücke wurde gestoppt, während das lief. Schick eine Nachricht, um weiterzumachen.**",
    answerDone: "Fertig.",
    answerDoneNoText: "Fertig, ohne Text zum Anzeigen.",
    answerCompacted: "Komprimiert.",
    answerStopped: "Gestoppt.",
    compacting: "Das Gespräch wird komprimiert, was eine Weile dauern kann.",
    retryingRefresh:
      "Ein anderer Claude-Code-Prozess hat gerade die Anmeldung erneuert; dieser Durchlauf wird in einer Minute noch einmal versucht.",
    compactingHeading: "**Komprimiert** {{elapsed}}",
    compactingSteps_one: "**Komprimiert** {{elapsed}} · {{count}} Schritt",
    compactingSteps_other: "**Komprimiert** {{elapsed}} · {{count}} Schritte",
    compactFailed:
      "Die Komprimierung ist fehlgeschlagen: {{error}}. Das Gespräch geht weiter wie bisher; `/compact` versucht es noch einmal.",
    agentDone: "**{{name}}** fertig · {{elapsed}}",
    agentFailed: "**{{name}}** fehlgeschlagen · {{elapsed}}",
    agentStopped: "**{{name}}** gestoppt · {{elapsed}}",
    compactedAuto:
      "Komprimiert (automatisch): {{before, number}} auf {{after, number}} Tokens, {{dropped, number}} insgesamt verworfen, {{seconds}} s.",
    compactedManual:
      "Komprimiert (manuell): {{before, number}} auf {{after, number}} Tokens, {{dropped, number}} insgesamt verworfen, {{seconds}} s.",
    moreLines_one: "... {{count}} weitere Zeile",
    moreLines_other: "... {{count}} weitere Zeilen",
    written_one: "{{path}} ({{count}} Zeile)",
    written_other: "{{path}} ({{count}} Zeilen)",
  },
  tools: {
    read: "**Liest** {{path}}",
    notebook: "**Notebook** {{path}}",
    find: "**Findet** {{pattern}} in {{path}}",
    findAnywhere: "**Findet** {{pattern}}",
    search: "**Sucht** {{pattern}} in {{path}}",
    searchAnywhere: "**Sucht** {{pattern}}",
    fetch: "**Holt** {{url}}",
    webSearch: "**Websuche** {{query}}",
    toolSearch: "**Werkzeugsuche** {{query}}",
    agent: "**Agent** {{description}}",
    skill: "**Skill** /{{name}}",
    todos_one: "**Aufgaben** · {{count}} Punkt",
    todos_other: "**Aufgaben** · {{count}} Punkte",
    server: "**{{server}}** {{tool}}",
    other: "**{{name}}**",
  },
  turn: {
    draining:
      "Die Brücke fährt herunter und nimmt nichts Neues mehr an. Sie lässt laufende Durchläufe erst zu Ende kommen, was eine Weile dauern kann; schick das noch einmal, sobald sie wieder da ist.",
    failed: "Der Durchlauf ist fehlgeschlagen.\n```\n{{error}}\n```",
    checkFailed:
      "Deine Nachricht wurde nicht an Claude geschickt: Die Prüfung vor dem Durchlauf ist mit {{error}} fehlgeschlagen. Versuch, sie noch einmal zu schicken; wenn es weiter fehlschlägt, stehen die Einzelheiten im Log der Brücke auf dem Host.",
    heldByBackgroundAgent:
      "Dieses Gespräch läuft als Hintergrund-Agent (`{{shortId}}`). Führ hier `/takeover` aus, um ihn zu stoppen und weiterzumachen, oder `claude attach {{shortId}}` auf dem Host.",
    openInTerminalIdle:
      "Dieses Gespräch ist in einem Terminal auf dem Host offen (PID {{pid}}, {{cwd}}), in dem gerade nichts läuft. Führ hier `/takeover` aus, um es dort zu schließen und weiterzumachen, oder schließ dieses Terminal selbst.",
    openInTerminalBusy:
      "Dieses Gespräch ist in einem Terminal auf dem Host offen (PID {{pid}}, {{cwd}}), und dort läuft gerade ein Durchlauf. Lass ihn fertig werden oder stopp ihn dort, dann versuch es noch einmal.",
    openInTerminal:
      "Dieses Gespräch ist in einem Terminal auf dem Host offen (PID {{pid}}, {{cwd}}). Schließ dieses Terminal oder wechsle dort zu einem anderen Gespräch, dann versuch es noch einmal.",
    conversationGone:
      "Das Gespräch dieses Kanals wurde neu gestartet oder gelöst, während deine Nachricht unterwegs war, also wurde sie nicht ausgeführt. Schick sie noch einmal.",
    turnLimit:
      "Der Durchlauf hat die Grenze erreicht, die `CLAUDE_MAX_TURNS` dafür setzt, wie oft einer zum Modell zurückgehen darf, und Claude Code hat ihn dort angehalten. Was er getan hat, bleibt erhalten. Schick eine Nachricht, damit er weitermacht, oder heb die Grenze in `.env` auf dem Host an und starte die Brücke neu.",
    unknownSession:
      "Claude Code hat kein Gespräch unter der Sitzungs-ID, an die dieser Kanal gebunden ist: Sein Transkript wurde vom Host entfernt, oder sein erster Durchlauf kam nie weit genug, um eines zu schreiben. Die Nachricht noch einmal zu schicken hilft nicht. Führ `/clear` aus, um in diesem Kanal ein frisches Gespräch zu beginnen.",
    errors: {
      stopped: "Der Durchlauf wurde gestoppt.",
      orphanTwice:
        "Claude Code hat zweimal hintereinander einen Hintergrundbefehl aus einem früheren Durchlauf gemeldet, und eine Sitzung, die mit so einer Meldung beginnt, verweigert jeden Werkzeugaufruf. Schick die Nachricht noch einmal; beim nächsten Versuch ist es normalerweise vorbei.",
      refreshTwice:
        "Claude Code konnte die Anmeldung zweimal hintereinander nicht erneuern: ein anderer seiner Prozesse hielt die Erneuerung, oder ist damit abgestürzt. Versuch es in einer Minute noch einmal; wenn es so bleibt, schließ andere Claude-Code-Prozesse auf dem Host oder meld dich dort neu an.",
      ended: "Der Durchlauf endete als {{subtype}}. Versuch, deine Nachricht noch einmal zu schicken.",
      unexplained:
        "Claude Code hat den Durchlauf mit einem Fehler beendet und keinen Grund genannt. Versuch, deine Nachricht noch einmal zu schicken.",
      endedSaying: "Der Durchlauf endete als {{subtype}}.\n{{text}} Versuch, deine Nachricht noch einmal zu schicken.",
      couldNotRun:
        "Claude Code konnte diesen Durchlauf nicht ausführen: {{error}}. Prüf, ob es auf dem Host installiert und angemeldet ist, dann versuch es noch einmal.",
    },
  },
  fold: {
    handedOver:
      "An den laufenden Durchlauf übergeben. Claude nimmt es bei seinem nächsten Schritt auf, oder gleich nach der Antwort dieses Durchlaufs, wenn kein Schritt mehr übrig ist.",
    takenUp: "Vom laufenden Durchlauf aufgenommen.",
    neverTaken: "Der Durchlauf endete, bevor das aufgenommen wurde. Schick es noch einmal.",
    sendNow: "Jetzt senden",
    sent: "Jetzt gesendet. Der Schritt, an dem Claude war, wurde abgebrochen, damit es deine Nachricht lesen konnte, und es macht von dort weiter. Agenten und Hintergrundbefehle, die es laufen hatte, laufen weiter.",
    nothingWaiting: "Nichts wartet: Der laufende Durchlauf hat deine Nachricht schon aufgenommen.",
    notRunning: "Hier läuft kein Durchlauf mehr, also gibt es nichts zu unterbrechen.",
    notInterrupted:
      "Der laufende Durchlauf ließ sich nicht unterbrechen, also wartet deine Nachricht weiter auf seinen nächsten Schritt.",
  },
  queue: {
    behind_one: "Eingereiht hinter dem Durchlauf, der noch läuft.",
    behind_other: "Eingereiht hinter {{count}} Nachrichten.",
    runningAlone: "Ein Durchlauf läuft, und nichts steht dahinter an.",
    runningWith_one: "Ein Durchlauf läuft, mit {{count}} Nachricht dahinter in der Warteschlange.",
    runningWith_other: "Ein Durchlauf läuft, mit {{count}} Nachrichten dahinter in der Warteschlange.",
    full: "Dieses Gespräch hält schon {{limit}} Nachrichten: Eine läuft und {{queued}} stehen dahinter an. Lass es aufholen, führ `/stop` aus, um die laufende zu beenden und die nächste starten zu lassen, oder `/stop all:true`, um die Warteschlange gleich mit zu verwerfen.",
  },
  restart: {
    unsupervised:
      "Nicht neu gestartet: Diese Brücke wurde von Hand gestartet, oder von einem Dienst, der eingerichtet wurde, bevor sie sich selbst neu starten konnte, also würde nichts sie wieder starten. Führ das Autostart-Installationsskript aus der README noch einmal aus, oder stopp und starte sie auf dem Host.",
    broken:
      "Nicht neu gestartet: Der Code auf dem Host würde nicht starten, also läuft die Brücke weiter, wie sie ist. Behebe, was er nennt, und frag dann noch einmal.\n```\n{{error}}\n```",
    checkTimedOut:
      "Nicht neu gestartet: Die Prüfung, ob der Code auf dem Host starten würde, dauerte über eine Minute und wurde aufgegeben. Die Brücke läuft weiter, wie sie ist; das Log auf dem Host sagt vielleicht, worauf sie gewartet hat.",
    now: "Neustart jetzt. Die Brücke sagt es hier, sobald sie wieder da ist.",
    afterTurns_one:
      "Neustart, sobald der {{count}} laufende Durchlauf fertig ist und sonst nichts läuft. Bis dahin arbeitet die Brücke wie gewohnt, und sie sagt es hier, sobald sie wieder da ist.",
    afterTurns_other:
      "Neustart, sobald die {{count}} laufenden Durchläufe fertig sind und sonst nichts läuft. Bis dahin arbeitet die Brücke wie gewohnt, und sie sagt es hier, sobald sie wieder da ist.",
    back: "Die Brücke ist nach ihrem Neustart wieder da, auf v{{version}}.",
  },
  update: {
    out_one: "**v{{version}}** der Brücke ist erschienen, eine Version nach der v{{current}}, die hier läuft.",
    out_other: "**v{{version}}** der Brücke ist erschienen, {{count}} Versionen nach der v{{current}}, die hier läuft.",
    more_one: "... und {{count}} weitere Änderung",
    more_other: "... und {{count}} weitere Änderungen",
    how: "Alles dazwischen: <{{url}}>. Zum Aktualisieren hol den neuen Code auf dem Host und starte die Brücke neu, oder hol das neue Image. Das wird einmal pro Version gesagt, und höchstens einmal pro Woche.",
  },
  stop: {
    button: "Stopp",
    allButton: "Alles stoppen",
    agentsButton: "Agenten stoppen",
    cloudTaskButton: "Cloud-Aufgabe stoppen",
    outlives:
      "Der ganze Prozessbaum des Durchlaufs wird beendet; unter Windows kann ein Befehl, der sich von diesem Baum gelöst hatte, ihn überleben, also sieh auf dem Host nach, wenn es etwas Langes war.",
    noAgents: "Hier läuft kein Agent und keine Cloud-Aufgabe, also gab es nichts zu stoppen.",
    agentsAsked_one:
      "{{count}} Aufgabe zum Stoppen aufgefordert. Der Durchlauf selbst läuft weiter, und Claude erfährt, dass sie gestoppt wurde; drück **Stopp**, um auch den Durchlauf zu beenden.",
    agentsAsked_other:
      "{{count}} Aufgaben zum Stoppen aufgefordert. Der Durchlauf selbst läuft weiter, und Claude erfährt, dass sie gestoppt wurden; drück **Stopp**, um auch den Durchlauf zu beenden.",
    nothingYet_one: "Noch läuft nichts; {{count}} hier eingereihte Nachricht kommt der Reihe nach dran.",
    nothingYet_other: "Noch läuft nichts; {{count}} hier eingereihte Nachrichten kommen der Reihe nach dran.",
    turn: "Diesen Durchlauf gestoppt. Nichts stand an, also unternimmt Claude hier bis zu deiner nächsten Nachricht nichts weiter. $t(stop.outlives)",
    turnThenQueue_one:
      "Diesen Durchlauf gestoppt. Die {{count}} dahinter eingereihte Nachricht kommt als Nächstes. $t(stop.outlives)",
    turnThenQueue_other:
      "Diesen Durchlauf gestoppt. Die {{count}} dahinter eingereihten Nachrichten kommen als Nächstes. $t(stop.outlives)",
    queueOnly_one: "Es lief nichts, aber die hier eingereihte Nachricht wurde verworfen.",
    queueOnly_other: "Es lief nichts, aber die {{count}} hier eingereihten Nachrichten wurden verworfen.",
    all: "Gestoppt. Claude unternimmt hier bis zu deiner nächsten Nachricht nichts weiter. $t(stop.outlives)",
    allWithQueue_one:
      "Gestoppt. Die dahinter eingereihte Nachricht wurde auch verworfen. Claude unternimmt hier bis zu deiner nächsten Nachricht nichts weiter. $t(stop.outlives)",
    allWithQueue_other:
      "Gestoppt. Die {{count}} dahinter eingereihten Nachrichten wurden auch verworfen. Claude unternimmt hier bis zu deiner nächsten Nachricht nichts weiter. $t(stop.outlives)",
  },
  agents: {
    title: "Agenten: {{asked}}",
    titleBare: "Agenten",
    tally: "**Agenten** · {{tally}}",
    tallyRunning: "{{quantity}} laufen",
    tallyDone: "{{quantity}} fertig",
    tallyFailed: "{{quantity}} fehlgeschlagen",
    tallyStopped: "{{quantity}} gestoppt",
    more: "und {{quantity}} weitere",
    tools_one: "{{count}} Werkzeug",
    tools_other: "{{count}} Werkzeuge",
    running: "läuft",
    waiting: "wartet auf einen Hintergrundbefehl",
    completed: "fertig nach {{elapsed}}",
    failed: "fehlgeschlagen nach {{elapsed}}",
    stopped: "gestoppt nach {{elapsed}}",
  },
  approvals: {
    request: "**{{tool}}** will laufen. Genehmigen?\n```\n{{detail}}\n```",
    deleteOutside:
      "Claude will etwas außerhalb des Ordners dieses Gesprächs löschen, was die Brücke ablehnt, solange kein Besitzer es erlaubt. Diesen einen Befehl erlauben?\n```\n{{detail}}\n```",
    approveOnce: "Einmal genehmigen",
    deny: "Ablehnen",
    approveRest: "Für den Rest dieses Durchlaufs genehmigen",
    approvedOnce: "Einmal genehmigt.",
    approvedRest: "Für den Rest dieses Durchlaufs genehmigt.",
    approvedRestQuiet: "Genehmigt, und der Rest dieses Durchlaufs fragt nicht mehr.",
    denied: "Von Discord aus abgelehnt.",
    ended: "Der Durchlauf endete, bevor das beantwortet wurde.",
    expired: "Keine Antwort in {{minutes}} Minuten, also wurde es abgelehnt.",
    stale: "Diese Anfrage ist schon beantwortet, abgelaufen oder von vor einem Neustart.",
    ownersOnly: "Nur ein Besitzer dieser Brücke kann eine Berechtigungsanfrage beantworten.",
  },
  questions: {
    heading_one: "Claude hat eine Frage.",
    heading_other: "Claude hat {{count}} Fragen.",
    question: "**{{number}}. {{header}}** {{question}}",
    questionPickAny: "**{{number}}. {{header}}** {{question}} Wähl alles, was zutrifft.",
    placeholder: "Frage {{number}}",
    unnamedOption: "(leer)",
    other: "Anderes...",
    otherDescription: "Gib eine eigene Antwort ein",
    ownAnswerTitle: "Deine eigene Antwort auf Frage {{number}}",
    ownAnswerLabel: "Antwort",
    submit: "Absenden",
    skip: "Überspringen",
    answered: "Beantwortet: {{summary}}.",
    skipped: "Übersprungen: Claude soll nach eigenem Ermessen weitermachen und sagen, wovon es ausgegangen ist.",
    expired: "Keine Antwort in {{minutes}} Minuten, also macht Claude ohne eine weiter.",
    ended: "Der Durchlauf endete, bevor das beantwortet wurde.",
    stale: "Diese Fragen sind schon beantwortet, abgelaufen oder von vor einem Neustart.",
    unanswered: "Frage {{number}} hat noch keine Antwort. Wähl eine, oder drück Überspringen, um keine zu schicken.",
  },
  sync: {
    fromYou: "**Du** · Terminal · {{clock}}",
    fromClaude: "**Claude** · Terminal · {{clock}}",
    drift_one:
      "{{count}} Nachricht ist in diesem Gespräch außerhalb von Discord passiert, seit du zuletzt hier warst. Das war {{ago}}, {{when}}. Führ `/sync` aus, um sie zu sehen.",
    drift_other:
      "{{count}} Nachrichten sind in diesem Gespräch außerhalb von Discord passiert, seit du zuletzt hier warst. Die letzte war {{ago}}, {{when}}. Führ `/sync` aus, um sie zu sehen.",
    running:
      "Hier läuft gerade ein Durchlauf, und was er sagt, ist auf dem Weg in diesen Kanal. Führ `/sync` noch einmal aus, sobald er fertig ist.",
    nothingNew: "Nichts Neues: In diesem Gespräch ist außerhalb von Discord nichts passiert, seit du zuletzt hier warst.",
    all_one: "{{count}} Nachricht von außerhalb von Discord:",
    all_other: "{{count}} Nachrichten von außerhalb von Discord:",
    latest_one: "{{count}} Nachricht von außerhalb von Discord. Wo du aufgehört hast, mit allen davon in der Datei:",
    latest_other: "{{count}} Nachrichten von außerhalb von Discord. Wo du aufgehört hast, mit allen davon in der Datei:",
    leftOff: "Wo du aufgehört hast:",
    countedRecent:
      "Das zählt nur das Jüngste: Die Brücke liest die letzten {{megabytes}} MB eines Transkripts zurück, und davor ist mehr passiert, als da hineinpasst.",
  },
  ask: {
    withContext_one: "Frage mit der letzten {{count}} Nachricht als Kontext.",
    withContext_other: "Frage mit den letzten {{count}} Nachrichten als Kontext.",
    noContext: "Frage ohne zusätzlichen Kontext.",
  },
  category: {
    full: "**{{name}}** hält schon {{limit}} Kanäle, mehr erlaubt Discord nicht. Nimm eine andere Kategorie, oder räum erst etwas aus dieser heraus.",
    notMovable: "Nur ein Textkanal in einem Server lässt sich verschieben. Führ `/category` im eigenen Kanal des Gesprächs aus.",
    current: "Dieses Gespräch sitzt in **{{name}}**.",
    none: "Dieses Gespräch ist in keiner Kategorie. Gib einen Namen an, um es in eine zu legen.",
    moved: "Nach **{{name}}** verschoben.",
    moveFailed:
      "Konnte es nicht nach **{{name}}** verschieben: {{error}}. Der Bot braucht Kanäle verwalten, und eine Kategorie fasst {{limit}} Kanäle.",
  },
  clear: {
    running: "Hier läuft ein Durchlauf. Lass ihn zu Ende kommen oder `/stop` ihn, dann `/clear`.",
    confirm:
      "Das startet diesen Kanal mit einem frischen Gespräch in `{{cwd}}` neu: derselbe Ordner, dasselbe Modell, derselbe Aufwand und dieselben Mitglieder, aber ohne alles, was in diesem gesagt wurde. Das jetzige Gespräch bleibt auf dem Host, von `/sessions` gelistet, und `/resume` mit seiner Sitzungs-ID öffnet es in einem eigenen Kanal. Die Nachrichten des Kanals bleiben; `/purge` entfernt sie.",
    startOver: "Neu anfangen",
    unbound: "Dieser Kanal ist an kein Gespräch gebunden, also gibt es nichts zu leeren.",
    stale:
      "Das wurde für ein Gespräch angeboten, das dieser Kanal nicht mehr hält, also wurde nichts neu gestartet. Führ `/clear` noch einmal aus, wenn dieses neu starten soll.",
    done: "Neu angefangen. Dieser Kanal hält jetzt ein frisches Gespräch in `{{cwd}}`; das vorige ist als `{{sessionId}}` noch auf dem Host.",
    cancelled: "In Ruhe gelassen. Das Gespräch geht weiter wie bisher.",
  },
  unbind: {
    unbound: "Dieser Kanal ist an kein Gespräch gebunden, also gibt es nichts zu lösen.",
    running: "Hier läuft ein Durchlauf. Lass ihn zu Ende kommen oder `/stop` ihn, dann `/unbind`.",
    done: "Gelöst. Das Gespräch ist noch auf dem Host und lässt sich mit `/resume` fortsetzen. Der Kanal ist jetzt nur noch ein Kanal; löschen, oder für den Verlauf behalten?",
    doneShared:
      "Gelöst. Das Gespräch ist noch auf dem Host und lässt sich mit `/resume` fortsetzen. Dieser Kanal hat nur geantwortet, wenn der Bot erwähnt wurde, und bleibt, wie er ist.",
    boundAgain:
      "Dieser Kanal wurde seitdem wieder an ein Gespräch gebunden, also wurde er nicht gelöscht. Führ hier noch einmal `/unbind` aus, wenn er weg soll.",
    deleteChannel: "Kanal löschen",
    keep: "Behalten",
    kept: "Behalten. Der Kanal bleibt, wie er ist, mit seinem Verlauf.",
    notDeletable: "Dieser Kanal lässt sich von hier aus nicht löschen. Entfern ihn in Discords Kanaleinstellungen.",
    deleting: "Kanal wird gelöscht...",
    deleteFailed:
      "Konnte den Kanal nicht löschen: {{error}}. Der Bot braucht Kanäle verwalten; entfern ihn stattdessen in Discords Kanaleinstellungen.",
  },
  takeover: {
    closedTerminal:
      "Claude Code im Terminal auf dem Host geschlossen (PID {{pid}}). Um das Gespräch dort wieder zu öffnen, führ auf dem Host `claude --resume {{sessionId}}` aus.",
    free: "Dieses Gespräch ist jetzt frei: Schick deine Nachricht.",
    heldRuns: "Deine Nachricht von vorhin läuft jetzt.",
    notClosed:
      "Claude Code im Terminal auf dem Host (PID {{pid}}) hat sich nicht binnen weniger Sekunden geschlossen, also wurde nichts übernommen. Schließ dieses Terminal auf dem Host, dann versuch es noch einmal.",
    running: "Hier läuft gerade ein Durchlauf. Beende ihn mit `/stop`.",
    nothingHolding: "Nichts hält dieses Gespräch. Schick einfach eine Nachricht.",
    stopped: "Hintergrund-Agent `{{shortId}}` gestoppt.",
  },
  create: {
    topic: 'Claude-Code-Gespräch "{{name}}" in {{cwd}}',
    channelFailed:
      "Konnte den Kanal nicht anlegen: {{error}}. Der Bot braucht Kanäle verwalten, Rollen verwalten und Nachrichten verwalten in diesem Server; Rollen verwalten ist das, womit er den Kanal privat für dich machen kann.",
    ownersOnlyHere:
      "Nur ein Besitzer kann hier Gespräche anlegen. Setz WORKSPACES_ROOT, um anderen Operatoren einen eigenen Platz zum Arbeiten zu geben.",
    folderFailed:
      "Konnte `{{cwd}}` nicht als Arbeitsverzeichnis verwenden: {{error}}. Prüf, ob der Pfad irgendwo liegt, wo die Brücke schreiben darf, oder gib einen vorhandenen Ordner als `project` an.",
    categoryFailed:
      "Konnte die Kategorie **{{name}}** nicht verwenden: {{error}}. Der Bot braucht Kanäle verwalten, um eine anzulegen.",
    done: "{{channel}} für **{{name}}** in `{{cwd}}` angelegt.",
    resumeButton: "{{name}} fortsetzen ({{age}})",
    startNew: "Ein neues anfangen",
    existing_one: "`{{cwd}}` hat schon {{count}} Gespräch. Eines fortsetzen, oder ein weiteres daneben anfangen?",
    existing_other: "`{{cwd}}` hat schon {{count}} Gespräche. Eines fortsetzen, oder ein weiteres daneben anfangen?",
    existingMore_one:
      "`{{cwd}}` hat schon {{count}} Gespräch ({{hidden}} ältere nicht gezeigt). Eines fortsetzen, oder ein weiteres daneben anfangen?",
    existingMore_other:
      "`{{cwd}}` hat schon {{count}} Gespräche ({{hidden}} ältere nicht gezeigt). Eines fortsetzen, oder ein weiteres daneben anfangen?",
    cancelled: "In Ruhe gelassen. Nichts wurde angelegt.",
    tooOld: "Dieses `/create` ist zu alt, um jetzt noch darauf zu reagieren. Führ es noch einmal aus.",
    gone: "Dieses Gespräch ist nicht mehr auf dem Host: Sein Transkript wurde entfernt oder verschoben. Führ `/create` noch einmal aus, um ein frisches anzufangen.",
  },
  fork: {
    unbound: "Dieser Kanal ist an kein Gespräch gebunden, also gibt es nichts abzuzweigen.",
    unnamed: "Gespräch",
    branching: "Zweigt nach {{channel}} ab...",
    notStarted:
      "Nichts wurde abgezweigt: Der erste Durchlauf des Zweigs ist nicht gestartet, und der dafür angelegte Kanal wurde wieder entfernt. Das passiert, wenn dieses Gespräch in einem Terminal offen ist oder von einem Hintergrund-Agenten gehalten wird, wenn seine Warteschlange voll ist oder verworfen wurde, oder wenn die Brücke herunterfährt. Führ `/fork` noch einmal aus, sobald es frei ist.",
    notBound:
      "{{channel}} angelegt, aber der erste Durchlauf des Zweigs endete, ohne dass Claude Code eine neue Sitzungs-ID gemeldet hat, also ist dieser Kanal nicht gebunden; wozu der Durchlauf kam, steht dort. Wenn der Zweig doch in `/sessions` auftaucht, öffnet `/resume` ihn in einem eigenen Kanal, und {{channel}} kann gelöscht werden.",
    done: "**{{source}}** nach {{channel}} als **{{name}}** abgezweigt. Dieser Kanal ist unberührt.",
  },
  resume: {
    ambiguous: '"{{name}}" ist mehrdeutig. Meintest du: {{candidates}}?',
    andMore: "{{candidates}} und {{count}} weitere",
    notFound: 'Kein Gespräch namens "{{name}}". Mit `/sessions` siehst du, was es gibt.',
    noFolder:
      '"{{name}}" gefunden, aber sein Arbeitsverzeichnis ließ sich nicht aus dem Transkript lesen, also kann es nicht fortgesetzt werden.',
    opened: "{{channel}} für **{{name}}** in `{{cwd}}` geöffnet.",
    openedPastOlder_one:
      "{{channel}} für **{{name}}** in `{{cwd}}` geöffnet ({{count}} älteres Gespräch mit demselben Namen wurde übersprungen).",
    openedPastOlder_other:
      "{{channel}} für **{{name}}** in `{{cwd}}` geöffnet ({{count}} ältere Gespräche mit demselben Namen wurden übersprungen).",
  },
  sessions: {
    title: "Gespräche auf dem Host",
    titleMatching: 'Gespräche, die zu "{{filter}}" passen',
    none: "Noch keine Gespräche gefunden. Fang eines mit `/create <name>` an.",
    hidden_one: "{{count}} Gespräch im Temp-Ordner ist ausgelassen. Gib einen Filter an, um es einzuschließen.",
    hidden_other: "{{count}} Gespräche im Temp-Ordner sind ausgelassen. Gib einen Filter an, um sie einzuschließen.",
    older: "+{{older}} ältere",
    live: "live ({{kind}}, {{status}})",
    starting: "startet",
  },
  members: {
    runs: "Läuft in `{{cwd}}` als der Host-Benutzer, mit vollem Zugriff auf die Maschine.",
    seenByNobody: "Niemand sonst kann es sehen.",
    seenBy_one: "{{count}} andere Person kann es sehen.",
    seenBy_other: "{{count}} andere können es sehen.",
    visibilityFailed:
      "Der Zugang wurde vermerkt, aber die Sichtbarkeit des Kanals ließ sich nicht ändern: {{error}}. Dafür braucht der Bot Rollen verwalten.",
    inviteBot: "Bots lassen sich nicht in ein Gespräch einladen; wähl eine Person.",
    alreadyIn: "{{user}} hat schon Zugang zu diesem Gespräch.",
    invited: "{{user}} kann dieses Gespräch jetzt sehen.",
    inviteWarning:
      "Damit können sie den Kanal **lesen**, einschließlich allem, was hier schon gesagt wurde. Den Bot benutzen können sie damit nicht: Nachrichten und Befehle von jemandem, der kein Operator ist, werden ignoriert. `/operator add` ist das, was die Maschine übergibt.",
    notMember: "{{user}} ist kein Mitglied dieses Gesprächs.",
    removed: "{{user}} entfernt.",
    sharedChannel:
      "Nichts wurde geändert. Dieser Kanal war vor dem Gespräch da, also wird in Discords eigenen Kanaleinstellungen festgelegt, wer ihn sehen kann, nicht von der Brücke. `/invite` und `/uninvite` funktionieren in einem Kanal, den `/create`, `/resume` oder `/fork` angelegt hat.",
    summary: "Besitzer: {{owner}}\nKönnen es sehen: {{watchers}}",
  },
  operators: {
    title: "Wer diese Brücke benutzen darf",
    ownersFixed: "Besitzer werden auf dem Host festgelegt und lassen sich hier nicht ändern.",
    owners: "Besitzer",
    operators: "Operatoren",
    bot: "Bots können keine Operatoren sein; wähl eine Person.",
    isOwner:
      "{{user}} ist ein Besitzer, festgelegt in `DISCORD_OWNER_IDS` auf dem Host. Das steht über Operator und lässt sich von Discord aus nicht ändern.",
    added:
      "{{user}} ist ab jetzt Operator. **Sie können auf dieser Maschine alles ausführen**, als der Host-Benutzer, mit dessen Zugangsdaten und dessen Claude-Abo.",
    already: "{{user}} ist schon Operator.",
    removed: "{{user}} ist kein Operator mehr. Gespräche, die sie schon begonnen haben, bleiben gebunden.",
    notOperator: "{{user}} ist kein Operator.",
  },
  run: {
    noListYet:
      "Die Befehle dieses Gesprächs sind noch nicht bekannt: Sie werden beim ersten Durchlauf in seinem Ordner gelernt. Schick hier erst eine Nachricht, dann listet `/run` sie beim Tippen auf.",
    noListChoice: "Noch keine Befehlsliste: Schick hier erst eine Nachricht, dann versuch es noch einmal",
    notAName: "`{{command}}` ist kein Befehlsname. Wähl einen aus der Liste, die `/run` beim Tippen anbietet.",
    unknown:
      "`/{{command}}` ist kein Befehl, den dieses Gespräch hat. Wähl einen aus der Liste, die `/run` beim Tippen anbietet; ein Plugin, das seit dem letzten Durchlauf hier installiert wurde, taucht nach dem nächsten auf.",
    confirm: "Das im Gespräch ausführen?",
    takes: "Nimmt: `{{hint}}`",
    nothingStarts: "Nichts startet, bevor du Ausführen drückst.",
    runButton: "Ausführen",
    unbound: "Dieser Kanal ist an kein Gespräch gebunden, also gibt es nichts, worin ein Befehl laufen könnte.",
    cancelled: "In Ruhe gelassen. Nichts wurde ausgeführt.",
    tooOld: "Dieses `/run` ist zu alt, um jetzt noch darauf zu reagieren. Führ es noch einmal aus.",
  },
  typed: {
    clear:
      "`/clear` als Nachricht getippt würde eine Sitzung starten, die dieser Kanal nicht sehen kann. Nimm den eigenen `/clear`-Befehl dieses Bots, der das Gespräch in diesem Kanal neu anfängt, oder `/purge`, um die Nachrichten des Kanals zu löschen.",
    bridgeOwned:
      "`/{{command}}` gilt für einen Prozess, und jeder Durchlauf hier startet einen neuen, also würde es Erfolg melden und dann zurückfallen. Nimm stattdessen den eigenen `/{{command}}`-Befehl dieses Bots, der den Wert für dieses Gespräch speichert und bei jedem Durchlauf anwendet.",
    terminalOnly: "`/{{command}}` läuft nur in einem interaktiven Terminal. Führ es auf dem Host aus.",
    billedReview: "Es startet eine Cloud-Prüfung, die zusätzlich zu deinem Abo berechnet werden kann.",
    asksFirst:
      "`{{typed}}` wurde nicht ausgeführt. {{caution}} In einem Terminal fragt Claude Code, bevor es startet, aber ein hier als Nachricht getippter Befehl würde starten, ohne zu fragen. Nimm stattdessen `{{viaRun}}`: Es zeigt genau, was laufen wird, und wartet, bis du Ausführen drückst.",
  },
  settings: {
    current: "{{setting}} steht für dieses Gespräch auf `{{value}}`.",
    notOverridden: "{{setting}} ist hier nicht überschrieben, also laufen Durchläufe mit {{fallback}}.",
    changed:
      "{{setting}} auf `{{value}}` gesetzt. Es gilt ab dem nächsten Durchlauf; ein Durchlauf, der schon läuft, behält, womit er begonnen hat.",
    hostDefault: "`{{value}}` (Standard des Hosts)",
    claudeDefault: "dem Standard von Claude Code",
  },
  whoami: {
    title: "Dieser Kanal",
    resumeHint: "Auf dem Host fortsetzen, ohne durch die Auswahl zu gehen:",
    directory: "Verzeichnis",
    model: "Modell",
    effort: "Aufwand",
    context: "Kontext",
    contextStanding: "{{percent}} % von {{ceiling}}",
    contextUnmeasured: "Noch nicht gemessen. Der nächste Durchlauf hier misst ihn.",
    version: "Brücke v{{version}}",
    newerVersion: "v{{version}} ist erschienen",
    claude: "Claude Code {{bundled}}",
    claudeDiffers: "Claude Code {{bundled}} für Durchläufe, {{host}} auf dem Host",
  },
  usage: {
    notReported:
      "Abo-Nutzung: noch nicht gemeldet. Claude Code schickt sie mit jedem Durchlauf, also erscheint sie nach dem ersten.",
    plan: "Abo-Nutzung: {{windows}} (Stand {{when}})",
    window: "{{label}} {{percent}} % verbraucht, setzt sich {{when}} zurück",
    windowReset: "{{label}} zurückgesetzt {{when}}, seitdem keine Zahl gemeldet",
    fiveHour: "5-Stunden-Fenster",
    weekAll: "Woche, alle Modelle",
    weekOpus: "Woche, Opus",
    weekSonnet: "Woche, Sonnet",
  },
  spend: {
    underCent: "unter $0,01",
    mineNone: "Dieses Gespräch: noch nichts.",
    mine_one: "Dieses Gespräch: {{count}} Durchlauf hier · {{input}} rein, {{output}} raus, {{cached}} aus dem Cache",
    mine_other: "Dieses Gespräch: {{count}} Durchläufe hier · {{input}} rein, {{output}} raus, {{cached}} aus dem Cache",
    allNone: "Jedes berührte Gespräch: noch nichts.",
    all_one: "Jedes berührte Gespräch: {{count}} Durchlauf hier · {{input}} rein, {{output}} raus, {{cached}} aus dem Cache",
    all_other: "Jedes berührte Gespräch: {{count}} Durchläufe hier · {{input}} rein, {{output}} raus, {{cached}} aus dem Cache",
    cost: "API-Gegenwert, nach dem ein Abo nicht abgerechnet wird: {{mine}} für dieses Gespräch über seine Lebenszeit, {{all}} über jedes berührte Gespräch.",
    costWithLast:
      "API-Gegenwert, nach dem ein Abo nicht abgerechnet wird: {{mine}} für dieses Gespräch über seine Lebenszeit (letzter Durchlauf {{last}}), {{all}} über jedes berührte Gespräch.",
    footnote:
      "Die Abo-Nutzung gilt für das ganze Konto. Durchläufe und Tokens werden seit dem Start der Brücke {{since}} gezählt; ein Neustart setzt sie zurück, und Durchläufe in einem Terminal werden nie gezählt. Die Tokens sind die der Sitzung selbst, ohne das, was ihre Agenten verbraucht haben; die Kosten schließen sie ein.",
  },
  plugins: {
    none: "`claude plugin list --json` hat keine Plugins gemeldet. Wenn du welche erwartet hast, prüf, ob Claude Code für diesen Prozess im PATH liegt.",
    choose: "Wähl ein Plugin",
    summary_one: "{{count}} Plugin installiert, {{enabled}} aktiviert.",
    summary_other: "{{count}} Plugins installiert, {{enabled}} aktiviert.",
    optionEnabled: "{{version}} · aktiviert",
    optionDisabled: "{{version}} · deaktiviert",
    enable: "Aktivieren",
    disable: "Deaktivieren",
    enabled: "{{id}} aktiviert.",
    disabled: "{{id}} deaktiviert.",
    enableFailed:
      "Konnte `{{id}}` nicht aktivieren: {{error}}. Führ denselben Befehl auf dem Host aus, um die ganze Ausgabe zu sehen.",
    disableFailed:
      "Konnte `{{id}}` nicht deaktivieren: {{error}}. Führ denselben Befehl auf dem Host aus, um die ganze Ausgabe zu sehen.",
  },
  skills: {
    none: "Für dieses Gespräch sind noch keine Skills bekannt. Schick ihm erst eine Nachricht, dann versuch es noch einmal: Die Liste kommt aus der Sitzung selbst.",
    option: "/{{skill}} ausführen",
    range: "{{first}} bis {{last}}",
    available_one: "{{count}} Skill in diesem Gespräch verfügbar.",
    available_other: "{{count}} Skills in diesem Gespräch verfügbar.",
    availableAcross_one: "{{count}} Skill in diesem Gespräch verfügbar, von A bis Z über {{menus}} Menüs.",
    availableAcross_other: "{{count}} Skills in diesem Gespräch verfügbar, von A bis Z über {{menus}} Menüs.",
    omitted_one: "Der letzte {{count}} hat nicht mehr gepasst; schick `/name` als Nachricht, um einen davon auszuführen.",
    omitted_other: "Die letzten {{count}} haben nicht mehr gepasst; schick `/name` als Nachricht, um einen davon auszuführen.",
  },
  purge: {
    notDeletable:
      "`/purge` funktioniert nur in einem Server-Textkanal, in dem der Bot Nachrichten verwalten darf. Führ es im Kanal des Gesprächs aus, oder gib dem Bot hier Nachrichten verwalten.",
    running: "Hier läuft ein Durchlauf. Lass ihn zu Ende kommen oder `/stop` ihn, dann `/purge`.",
    warning: "Das löscht jede Nachricht in diesem Kanal, auch deine. Es lässt sich nicht rückgängig machen.",
    warningConversation:
      "Das Gespräch auf dem Host wird nicht angerührt, und deine nächste Nachricht macht dort weiter. Der Kanal bekommt seinen Verlauf nicht zurück.",
    confirm: "Löschen",
    cancelled: "Kanal in Ruhe gelassen.",
    deleting: "Wird gelöscht...",
    empty: "Nichts zu löschen; der Kanal ist schon leer.",
    deleted_one: "{{count}} Nachricht gelöscht.",
    deleted_other: "{{count}} Nachrichten gelöscht.",
    slow_one: "{{count}} davon war älter als {{days}} Tage, was Discord nur einzeln löschen lässt.",
    slow_other: "{{count}} davon waren älter als {{days}} Tage, was Discord nur einzeln löschen lässt.",
    failed_one: "{{count}} ließ sich nicht löschen.",
    failed_other: "{{count}} ließen sich nicht löschen.",
    conversationKept: "Das Gespräch selbst ist unberührt, und deine nächste Nachricht macht dort weiter.",
    stoppedPartway: "Das Löschen ist mittendrin stehen geblieben: {{error}}. Führ `/purge` noch einmal aus, um fertig zu werden.",
  },
};
