import type { Catalog } from "../catalog.ts";

export const sv: Catalog = {
  common: {
    nobody: "ingen",
    unknown: "okänt",
    cancel: "Avbryt",
    nothingRunning: "Inget körs här.",
    sent: "Skickade `{{prompt}}` till konversationen.",
    noLongerBound:
      "Den här kanalen är inte längre kopplad till någon konversation, så det finns inget att köra detta i. `/resume` öppnar en konversation i en egen kanal.",
    staleControl:
      "Bryggan känner inte igen den kontrollen; den är troligen kvar från en äldre version. Kör kommandot igen för att få en ny.",
  },
  units: {
    seconds: "{{seconds}} s",
    minutesSeconds: "{{minutes}} min {{seconds}} s",
    tokens_one: "{{count}} token",
    tokens_other: "{{count}} tokens",
    kiloTokens: "{{thousands}}k tokens",
    minutesAgo: "{{quantity}} min sedan",
    hoursAgo: "{{quantity}} h sedan",
    daysAgo: "{{quantity}} d sedan",
  },
  language: {
    current: "Bryggans språk: **{{name}}**. Det gäller det bryggan själv säger; Claude svarar på det språk du skriver på.",
    changed:
      "Bryggans språk: **{{name}}**, från och med nu. Det gäller det bryggan själv säger; en omgång som redan körs behåller språket den började på. Claudes svar påverkas inte: den svarar på det språk du skriver på.",
  },
  access: {
    ownersOnly:
      "`/{{command}}` är förbehållet ägare. Operatörer kör boten; vilka fler som får använda den, och vad som körs i den, avgör ägaren.",
    none: "Du har inte åtkomst till den här bryggan. En ägare måste ge dig det.",
  },
  command: {
    noHandler:
      "`/{{command}}` är registrerat hos Discord men bryggan har ingen hanterare för det. Starta om bryggan så registreras kommandona på nytt.",
    failed:
      "`/{{command}}` misslyckades: {{error}}. Försök igen; om det fortsätter misslyckas finns detaljerna i bryggans logg på värddatorn.",
    pressFailed:
      "Tryckningen misslyckades: {{error}}. Det den gällde kan vara halvgjort, så titta efter innan du trycker igen; detaljerna finns i bryggans logg på värddatorn.",
  },
  binding: {
    unbound: "Den här kanalen är inte kopplad till någon konversation än.",
    notInServer:
      "Konversationer finns bara i en server, inte i ett DM. Kör detta i en kanal på servern som bryggan är konfigurerad för.",
    alreadyOpen: "**{{name}}** är redan öppen i <#{{channelId}}>.",
    bound: "Kopplad till **{{channel}}**.",
    noWorkspace:
      "Du har ingen arbetsyta att svara från. Be en ägare att sätta `WORKSPACES_ROOT`, eller använd `/create` för att starta en egen konversation.",
  },
  attachments: {
    executable: "`{{name}}`, eftersom {{extension}} är ett körbart format",
    tooLarge: "`{{name}}`, eftersom den är större än {{megabytes}} MB",
    refused:
      "Sparades inte för den här omgången: {{files}}. Sessionen körs med värddatorns rättigheter, så en fil den skulle kunna köra är inte värd bekvämligheten. Lägg den själv i arbetskatalogen om den ska finnas där.",
    unfetched_one:
      "Kunde inte hämta {{names}} från Discord, så sessionen kommer inte att se den. Discords fillänkar går ut och deras CDN nekar ibland; skicka filen igen om den är viktig.",
    unfetched_other:
      "Kunde inte hämta {{names}} från Discord, så sessionen kommer inte att se dem. Discords fillänkar går ut och deras CDN nekar ibland; skicka filerna igen om de är viktiga.",
  },
  outbox: {
    tooLarge: "För stora för att bifoga, ligger kvar i `{{folder}}`: {{names}}.",
    failed:
      "Kunde inte bifoga det som ligger i `{{folder}}`: {{error}}. Filerna ligger kvar på värddatorn och bryggan försöker igen av sig själv; om det fortsätter misslyckas, kontrollera att boten får bifoga filer i den här kanalen.",
    files_one: "{{count}} fil",
    files_other: "{{count}} filer",
  },
  context: {
    critical:
      "Kontexten är ungefär {{percent}} % full. Kör `/compact` snart, annars komprimeras den av sig själv mitt i en uppgift.",
    approaching: "Kontexten är ungefär {{percent}} % full. `/context` visar fördelningen, `/compact` frigör utrymme.",
  },
  trail: {
    working: "**Arbetar** {{elapsed}}",
    workingSteps_one: "**Arbetar** {{elapsed}} · {{count}} steg",
    workingSteps_other: "**Arbetar** {{elapsed}} · {{count}} steg",
    done: "**Arbetade** {{elapsed}}",
    doneSteps_one: "**Arbetade** {{elapsed}} · {{count}} steg",
    doneSteps_other: "**Arbetade** {{elapsed}} · {{count}} steg",
    stopped: "**Stoppad efter** {{elapsed}}",
    stoppedSteps_one: "**Stoppad efter** {{elapsed}} · {{count}} steg",
    stoppedSteps_other: "**Stoppad efter** {{elapsed}} · {{count}} steg",
    failed: "**Misslyckades efter** {{elapsed}}",
    failedSteps_one: "**Misslyckades efter** {{elapsed}} · {{count}} steg",
    failedSteps_other: "**Misslyckades efter** {{elapsed}} · {{count}} steg",
    started: "**Påbörjad**",
    interrupted: "**Avbruten: bryggan stannade medan detta kördes. Skicka ett meddelande för att fortsätta.**",
    answerDone: "Klart.",
    answerDoneNoText: "Klart, utan någon text att visa.",
    answerCompacted: "Komprimerad.",
    answerStopped: "Stoppad.",
    compacting: "Komprimerar konversationen, vilket kan ta en stund.",
    retryingRefresh: "En annan Claude Code-process höll på att förnya inloggningen; försöker omgången igen om en stund.",
    compactingHeading: "**Komprimerar** {{elapsed}}",
    compactingSteps_one: "**Komprimerar** {{elapsed}} · {{count}} steg",
    compactingSteps_other: "**Komprimerar** {{elapsed}} · {{count}} steg",
    compactFailed: "Komprimeringen misslyckades: {{error}}. Konversationen fortsätter som den var; `/compact` försöker igen.",
    agentDone: "**{{name}}** klar · {{elapsed}}",
    agentFailed: "**{{name}}** misslyckades · {{elapsed}}",
    agentStopped: "**{{name}}** stoppad · {{elapsed}}",
    compactedAuto:
      "Komprimerad (automatiskt): {{before, number}} till {{after, number}} tokens, {{dropped, number}} borttagna totalt, {{seconds}} s.",
    compactedManual:
      "Komprimerad (manuellt): {{before, number}} till {{after, number}} tokens, {{dropped, number}} borttagna totalt, {{seconds}} s.",
    moreLines_one: "... {{count}} rad till",
    moreLines_other: "... {{count}} rader till",
    written_one: "{{path}} ({{count}} rad)",
    written_other: "{{path}} ({{count}} rader)",
  },
  tools: {
    read: "**Läser** {{path}}",
    notebook: "**Notebook** {{path}}",
    find: "**Hittar** {{pattern}} i {{path}}",
    findAnywhere: "**Hittar** {{pattern}}",
    search: "**Söker** {{pattern}} i {{path}}",
    searchAnywhere: "**Söker** {{pattern}}",
    fetch: "**Hämtar** {{url}}",
    webSearch: "**Webbsökning** {{query}}",
    toolSearch: "**Verktygssökning** {{query}}",
    agent: "**Agent** {{description}}",
    skill: "**Skill** /{{name}}",
    todos_one: "**Att göra** · {{count}} punkt",
    todos_other: "**Att göra** · {{count}} punkter",
    server: "**{{server}}** {{tool}}",
    other: "**{{name}}**",
  },
  turn: {
    draining:
      "Bryggan håller på att stängas av och tar inte emot något nytt. Den låter pågående omgångar bli klara först, vilket kan ta en stund; skicka detta igen när den är tillbaka.",
    failed: "Omgången misslyckades.\n```\n{{error}}\n```",
    checkFailed:
      "Ditt meddelande skickades inte till Claude: kontrollen före omgången misslyckades med {{error}}. Skicka det igen; om det fortsätter misslyckas finns detaljerna i bryggans logg på värddatorn.",
    heldByBackgroundAgent:
      "Den konversationen körs som en bakgrundsagent (`{{shortId}}`). Kör `/takeover` här för att stoppa den och fortsätta, eller `claude attach {{shortId}}` på värddatorn.",
    openInTerminal:
      "Den konversationen är öppen i en terminal på värddatorn (pid {{pid}}, {{cwd}}). Stäng den terminalen eller byt den till en annan konversation och försök sedan igen.",
    conversationGone:
      "Den här kanalens konversation börjades om eller kopplades från medan ditt meddelande var på väg, så det kördes inte. Skicka det igen.",
    unknownSession:
      "Claude Code har ingen konversation under det sessions-id som den här kanalen är kopplad till: dess transkript har tagits bort från värddatorn, eller så kom dess första omgång aldrig så långt att ett skrevs. Att skicka meddelandet igen hjälper inte. Kör `/clear` för att starta en ny konversation i den här kanalen.",
    errors: {
      stopped: "Omgången stoppades.",
      orphanTwice:
        "Claude Code rapporterade ett bakgrundskommando som blivit kvar från en tidigare omgång två gånger i rad, och en session som börjar med att rapportera ett sådant nekar varje verktygsanrop. Skicka meddelandet igen; det brukar gå över vid nästa försök.",
      refreshTwice:
        "Claude Code kunde inte förnya inloggningen två gånger i rad: en annan av dess processer höll förnyelsen, eller dog med den. Försök igen om en minut; om det fortsätter, stäng andra Claude Code-processer på värden eller logga in igen där.",
      ended: "Omgången slutade som {{subtype}}. Försök skicka ditt meddelande igen.",
      unexplained: "Claude Code avslutade omgången med ett fel utan att ange någon orsak. Försök skicka ditt meddelande igen.",
      endedSaying: "Omgången slutade som {{subtype}}.\n{{text}} Försök skicka ditt meddelande igen.",
      couldNotRun:
        "Claude Code kunde inte köra den här omgången: {{error}}. Kontrollera att det är installerat och inloggat på värddatorn och försök sedan igen.",
    },
  },
  fold: {
    handedOver:
      "Överlämnat till den pågående omgången. Claude tar upp det vid nästa steg, eller direkt efter omgångens svar om inget steg återstår.",
    takenUp: "Har tagits upp av den pågående omgången.",
    neverTaken: "Omgången tog slut innan detta togs upp. Skicka det igen.",
    sendNow: "Skicka nu",
    sent: "Skickat nu. Steget Claude höll på med avbröts så att den kunde läsa ditt meddelande, och den fortsätter därifrån. Agenter och bakgrundskommandon som den hade igång fick fortsätta köra.",
    nothingWaiting: "Inget väntar: den pågående omgången har redan tagit upp ditt meddelande.",
    notRunning: "Ingen omgång körs här längre, så det finns inget att avbryta.",
    notInterrupted: "Den pågående omgången kunde inte avbrytas, så ditt meddelande väntar fortfarande på nästa steg.",
  },
  queue: {
    behind_one: "I kö bakom omgången som fortfarande körs.",
    behind_other: "I kö bakom {{count}} meddelanden.",
    runningAlone: "En omgång körs, utan något i kö efter den.",
    runningWith_one: "En omgång körs, med {{count}} meddelande i kö efter den.",
    runningWith_other: "En omgång körs, med {{count}} meddelanden i kö efter den.",
    full: "Den här konversationen håller redan {{limit}} meddelanden: ett som körs och {{queued}} i kö efter det. Låt den komma ikapp, kör `/stop` för att avsluta det som körs och låta nästa börja, eller `/stop all:true` för att tömma kön också.",
  },
  stop: {
    button: "Stoppa",
    allButton: "Stoppa allt",
    agentsButton: "Stoppa agenter",
    cloudTaskButton: "Stoppa molnuppgift",
    outlives:
      "Omgångens hela processträd avslutas; på Windows kan ett kommando som hade kopplat loss sig från trädet överleva det, så kontrollera värddatorn om det var något långvarigt.",
    noAgents: "Ingen agent eller molnuppgift körs här, så det fanns inget att stoppa.",
    agentsAsked_one:
      "Begärde att {{count}} uppgift stoppas. Själva omgången fortsätter, och Claude får veta att den stoppades; tryck på **Stoppa** för att avsluta omgången också.",
    agentsAsked_other:
      "Begärde att {{count}} uppgifter stoppas. Själva omgången fortsätter, och Claude får veta att de stoppades; tryck på **Stoppa** för att avsluta omgången också.",
    nothingYet_one: "Inget körs än; {{count}} meddelande i kö här körs i tur och ordning.",
    nothingYet_other: "Inget körs än; {{count}} meddelanden i kö här körs i tur och ordning.",
    turn: "Stoppade den här omgången. Inget låg i kö, så Claude gör inget mer här förrän ditt nästa meddelande. $t(stop.outlives)",
    turnThenQueue_one: "Stoppade den här omgången. Meddelandet som låg i kö efter den körs härnäst. $t(stop.outlives)",
    turnThenQueue_other:
      "Stoppade den här omgången. De {{count}} meddelanden som låg i kö efter den körs härnäst. $t(stop.outlives)",
    queueOnly_one: "Inget kördes, men meddelandet som låg i kö här ströks.",
    queueOnly_other: "Inget kördes, men de {{count}} meddelanden som låg i kö här ströks.",
    all: "Stoppat. Claude gör inget mer här förrän ditt nästa meddelande. $t(stop.outlives)",
    allWithQueue_one:
      "Stoppat. Meddelandet som låg i kö efter den ströks också. Claude gör inget mer här förrän ditt nästa meddelande. $t(stop.outlives)",
    allWithQueue_other:
      "Stoppat. De {{count}} meddelanden som låg i kö efter den ströks också. Claude gör inget mer här förrän ditt nästa meddelande. $t(stop.outlives)",
  },
  agents: {
    title: "Agenter: {{asked}}",
    titleBare: "Agenter",
    tally: "**Agenter** · {{tally}}",
    tallyRunning: "{{quantity}} körs",
    tallyDone: "{{quantity}} klara",
    tallyFailed: "{{quantity}} misslyckade",
    tallyStopped: "{{quantity}} stoppade",
    more: "och {{quantity}} till",
    tools_one: "{{count}} verktyg",
    tools_other: "{{count}} verktyg",
    running: "körs",
    waiting: "väntar på ett bakgrundskommando",
    completed: "klar på {{elapsed}}",
    failed: "misslyckades efter {{elapsed}}",
    stopped: "stoppad efter {{elapsed}}",
  },
  approvals: {
    request: "**{{tool}}** vill köra. Vill du godkänna det?\n```\n{{detail}}\n```",
    approveOnce: "Godkänn en gång",
    deny: "Neka",
    approveRest: "Godkänn resten av omgången",
    approvedOnce: "Godkänt en gång.",
    approvedRest: "Godkänt för resten av den här omgången.",
    approvedRestQuiet: "Godkänt, och resten av den här omgången frågar inte igen.",
    denied: "Nekat från Discord.",
    ended: "Omgången tog slut innan detta besvarades.",
    expired: "Inget svar på {{minutes}} minuter, så det nekades.",
    stale: "Den förfrågan är redan besvarad, har gått ut, eller är från före en omstart.",
    ownersOnly: "Bara en ägare av den här bryggan kan svara på en behörighetsförfrågan.",
  },
  questions: {
    heading_one: "Claude har en fråga.",
    heading_other: "Claude har {{count}} frågor.",
    question: "**{{number}}. {{header}}** {{question}}",
    questionPickAny: "**{{number}}. {{header}}** {{question}} Välj alla som passar.",
    placeholder: "Fråga {{number}}",
    unnamedOption: "(tom)",
    other: "Annat...",
    otherDescription: "Skriv ett eget svar",
    ownAnswerTitle: "Ditt eget svar på fråga {{number}}",
    ownAnswerLabel: "Svar",
    submit: "Skicka",
    skip: "Hoppa över",
    answered: "Besvarat: {{summary}}.",
    skipped: "Överhoppat: Claude får veta att den ska fortsätta efter eget omdöme och säga vad den antog.",
    expired: "Inget svar på {{minutes}} minuter, så Claude fortsätter utan ett.",
    ended: "Omgången tog slut innan detta besvarades.",
    stale: "De frågorna är redan besvarade, har gått ut, eller är från före en omstart.",
    unanswered: "Fråga {{number}} har inget svar än. Välj ett, eller tryck på Hoppa över för att inte skicka något.",
  },
  sync: {
    fromYou: "**Du** · terminal · {{clock}}",
    fromClaude: "**Claude** · terminal · {{clock}}",
    drift_one:
      "{{count}} meddelande har tillkommit i den här konversationen utanför Discord sedan du senast var här. Det kom {{ago}}, {{when}}. Kör `/sync` för att se det.",
    drift_other:
      "{{count}} meddelanden har tillkommit i den här konversationen utanför Discord sedan du senast var här. Det senaste kom {{ago}}, {{when}}. Kör `/sync` för att se dem.",
    running: "En omgång körs här just nu, och det den säger är på väg till den här kanalen. Kör `/sync` igen när den är klar.",
    nothingNew: "Inget nytt: inget har hänt i den här konversationen utanför Discord sedan du senast var här.",
    all_one: "{{count}} meddelande från utanför Discord:",
    all_other: "{{count}} meddelanden från utanför Discord:",
    latest_one: "{{count}} meddelande från utanför Discord. Här slutade du, med alla i filen:",
    latest_other: "{{count}} meddelanden från utanför Discord. Här slutade du, med alla i filen:",
    leftOff: "Här slutade du:",
    countedRecent:
      "Det räknar bara de senaste: bryggan läser tillbaka de sista {{megabytes}} MB av ett transkript, och mer hände före det än vad som ryms där.",
  },
  ask: {
    withContext_one: "Frågar med det senaste meddelandet som kontext.",
    withContext_other: "Frågar med de senaste {{count}} meddelandena som kontext.",
    noContext: "Frågar utan extra kontext.",
  },
  category: {
    full: "**{{name}}** innehåller redan {{limit}} kanaler, vilket är allt Discord tillåter. Använd en annan kategori, eller flytta ut något ur den först.",
    notMovable: "Bara en textkanal i en server kan flyttas. Kör `/category` i konversationens egen kanal.",
    current: "Den här konversationen ligger i **{{name}}**.",
    none: "Den här konversationen ligger inte i någon kategori. Ange ett namn för att lägga den i en.",
    moved: "Flyttad till **{{name}}**.",
    moveFailed:
      "Kunde inte flytta den till **{{name}}**: {{error}}. Boten behöver behörigheten Hantera kanaler (Manage Channels), och en kategori rymmer {{limit}} kanaler.",
  },
  clear: {
    running: "En omgång körs här. Låt den bli klar eller kör `/stop`, och sedan `/clear`.",
    confirm:
      "Det här börjar om i den här kanalen med en ny konversation i `{{cwd}}`: samma mapp, modell, effort och medlemmar, men utan något av det som sagts i den här. Den nuvarande konversationen ligger kvar på värddatorn, listas av `/sessions`, och `/resume` med dess sessions-id öppnar den i en egen kanal. Kanalens meddelanden ligger kvar; `/purge` tar bort dem.",
    startOver: "Börja om",
    unbound: "Den här kanalen är inte kopplad till någon konversation, så det finns inget att rensa.",
    stale:
      "Det här erbjöds för en konversation som den här kanalen inte längre har, så inget börjades om. Kör `/clear` igen om den här ska börjas om.",
    done: "Börjat om. Den här kanalen har nu en ny konversation i `{{cwd}}`; den förra ligger kvar på värddatorn som `{{sessionId}}`.",
    cancelled: "Lät det vara. Konversationen fortsätter som förut.",
  },
  unbind: {
    unbound: "Den här kanalen är inte kopplad till någon konversation, så det finns inget att koppla från.",
    running: "En omgång körs här. Låt den bli klar eller kör `/stop`, och sedan `/unbind`.",
    done: "Frånkopplad. Konversationen ligger kvar på värddatorn och kan återupptas med `/resume`. Kanalen är nu bara en kanal; ta bort den, eller behålla den för historikens skull?",
    doneShared:
      "Frånkopplad. Konversationen ligger kvar på värddatorn och kan återupptas med `/resume`. Den här kanalen svarade bara när boten taggades, och den är kvar som den är.",
    boundAgain:
      "Den här kanalen har kopplats till en konversation igen sedan dess, så den togs inte bort. Kör `/unbind` här igen om den ska bort.",
    deleteChannel: "Ta bort kanalen",
    keep: "Behåll den",
    kept: "Behållen. Kanalen är kvar som den är, med sin historik.",
    notDeletable: "Den här kanalen kan inte tas bort härifrån. Ta bort den i Discords kanalinställningar.",
    deleting: "Tar bort kanalen...",
    deleteFailed:
      "Kunde inte ta bort kanalen: {{error}}. Boten behöver behörigheten Hantera kanaler (Manage Channels); ta bort den i Discords kanalinställningar i stället.",
  },
  takeover: {
    running: "En omgång körs här just nu. Använd `/stop` för att avsluta den.",
    nothingHolding: "Inget håller den här konversationen. Skicka bara ett meddelande.",
    stopped: "Stoppade bakgrundsagenten `{{shortId}}`.",
  },
  create: {
    topic: 'Claude Code-konversationen "{{name}}" i {{cwd}}',
    channelFailed:
      "Kunde inte skapa kanalen: {{error}}. Boten behöver behörigheterna Hantera kanaler (Manage Channels), Hantera roller (Manage Roles) och Hantera meddelanden (Manage Messages) på den här servern; Hantera roller är det som låter den göra kanalen privat för dig.",
    ownersOnlyHere:
      "Bara en ägare kan skapa konversationer här. Sätt WORKSPACES_ROOT för att ge andra operatörer en egen plats att arbeta på.",
    folderFailed:
      "Kunde inte använda `{{cwd}}` som arbetskatalog: {{error}}. Kontrollera att sökvägen ligger där bryggan får skriva, eller ange en befintlig mapp som `project`.",
    categoryFailed:
      "Kunde inte använda kategorin **{{name}}**: {{error}}. Boten behöver behörigheten Hantera kanaler (Manage Channels) för att skapa en.",
    done: "Skapade {{channel}} för **{{name}}** i `{{cwd}}`.",
    resumeButton: "Återuppta {{name}} ({{age}})",
    startNew: "Starta en ny",
    existing_one: "`{{cwd}}` har redan {{count}} konversation. Återuppta den, eller starta en till bredvid?",
    existing_other: "`{{cwd}}` har redan {{count}} konversationer. Återuppta en, eller starta en till bredvid?",
    existingMore_one:
      "`{{cwd}}` har redan {{count}} konversation ({{hidden}} äldre visas inte). Återuppta den, eller starta en till bredvid?",
    existingMore_other:
      "`{{cwd}}` har redan {{count}} konversationer ({{hidden}} äldre visas inte). Återuppta en, eller starta en till bredvid?",
    cancelled: "Lät det vara. Inget skapades.",
    tooOld: "Det `/create` är för gammalt för att agera på nu. Kör det igen.",
    gone: "Den konversationen finns inte längre på värddatorn: dess transkript har tagits bort eller flyttats. Kör `/create` igen för att starta en ny.",
  },
  fork: {
    unbound: "Den här kanalen är inte kopplad till någon konversation, så det finns inget att förgrena.",
    unnamed: "konversation",
    branching: "Förgrenar till {{channel}}...",
    notStarted:
      "Inget förgrenades: grenens första omgång startade inte, och kanalen som skapades för den togs bort igen. Det händer när den här konversationen är öppen i en terminal eller hålls av en bakgrundsagent, när dess kö är full eller ströks, eller när bryggan håller på att stängas av. Kör `/fork` igen när den är ledig.",
    notBound:
      "Skapade {{channel}}, men grenens första omgång slutade utan att Claude Code rapporterade något nytt sessions-id, så den kanalen är inte kopplad; vad omgången kom fram till visas där. Om grenen ändå dyker upp i `/sessions` öppnar `/resume` den i en egen kanal, och {{channel}} kan tas bort.",
    done: "Förgrenade **{{source}}** till {{channel}} som **{{name}}**. Den här kanalen är orörd.",
  },
  resume: {
    ambiguous: '"{{name}}" är tvetydigt. Menade du: {{candidates}}?',
    andMore: "{{candidates}} och {{count}} till",
    notFound: 'Ingen konversation heter "{{name}}". Använd `/sessions` för att se vilka som finns.',
    noFolder: 'Hittade "{{name}}" men kunde inte läsa dess arbetskatalog ur transkriptet, så den kan inte återupptas.',
    opened: "Öppnade {{channel}} för **{{name}}** i `{{cwd}}`.",
    openedPastOlder_one:
      "Öppnade {{channel}} för **{{name}}** i `{{cwd}}` ({{count}} äldre konversation med samma namn hoppades över).",
    openedPastOlder_other:
      "Öppnade {{channel}} för **{{name}}** i `{{cwd}}` ({{count}} äldre konversationer med samma namn hoppades över).",
  },
  sessions: {
    title: "Konversationer på värddatorn",
    titleMatching: 'Konversationer som matchar "{{filter}}"',
    none: "Inga konversationer hittades än. Starta en med `/create <name>`.",
    hidden_one: "{{count}} konversation i temp-mappen är utelämnad. Ange ett filter för att ta med den.",
    hidden_other: "{{count}} konversationer i temp-mappen är utelämnade. Ange ett filter för att ta med dem.",
    older: "+{{older}} äldre",
    live: "aktiv ({{kind}}, {{status}})",
    starting: "startar",
  },
  members: {
    runs: "Körs i `{{cwd}}` som värddatorns användare, med full åtkomst till maskinen.",
    seenByNobody: "Ingen annan kan se den.",
    seenBy_one: "{{count}} annan kan se den.",
    seenBy_other: "{{count}} andra kan se den.",
    visibilityFailed:
      "Åtkomsten sparades, men kanalens synlighet kunde inte ändras: {{error}}. Boten behöver behörigheten Hantera roller (Manage Roles) för det.",
    inviteBot: "Botar kan inte bjudas in till en konversation; välj en person.",
    alreadyIn: "{{user}} har redan åtkomst till den här konversationen.",
    invited: "{{user}} kan nu se den här konversationen.",
    inviteWarning:
      "Det här låter dem **läsa** kanalen, inklusive allt som redan sagts här. Det låter dem inte använda boten: meddelanden och kommandon från någon som inte är operatör ignoreras. `/operator add` är det som lämnar över maskinen.",
    notMember: "{{user}} är inte medlem i den här konversationen.",
    removed: "{{user}} borttagen.",
    sharedChannel:
      "Inget ändrades. Den här kanalen fanns före konversationen, så vem som kan se den bestäms i Discords egna kanalinställningar, inte av bryggan. `/invite` och `/uninvite` fungerar i en kanal som skapats av `/create`, `/resume` eller `/fork`.",
    summary: "Ägare: {{owner}}\nKan se den: {{watchers}}",
  },
  operators: {
    title: "Vilka som får använda den här bryggan",
    ownersFixed: "Ägare sätts på värddatorn och kan inte ändras här.",
    owners: "Ägare",
    operators: "Operatörer",
    bot: "Botar kan inte vara operatörer; välj en person.",
    isOwner:
      "{{user}} är ägare, satt i `DISCORD_OWNER_IDS` på värddatorn. Det står över operatör och kan inte ändras från Discord.",
    added:
      "{{user}} är operatör från och med nu. **Hen kan köra vad som helst på den här maskinen**, som värddatorns användare, med dess inloggningar och dess Claude-plan.",
    already: "{{user}} är redan operatör.",
    removed: "{{user}} är inte längre operatör. Konversationer hen redan startat förblir kopplade.",
    notOperator: "{{user}} är inte operatör.",
  },
  run: {
    noListYet:
      "Den här konversationens kommandon är inte kända än: de lärs in första gången en omgång körs i dess mapp. Skicka ett meddelande här först, så listar `/run` dem medan du skriver.",
    noListChoice: "Ingen kommandolista än: skicka ett meddelande här först och försök igen",
    notAName: "`{{command}}` är inget kommandonamn. Välj ett ur listan som `/run` visar medan du skriver.",
    unknown:
      "`/{{command}}` är inget kommando som den här konversationen har. Välj ett ur listan som `/run` visar medan du skriver; ett plugin som installerats sedan den senaste omgången här dyker upp efter nästa.",
    confirm: "Köra detta i konversationen?",
    takes: "Argument: `{{hint}}`",
    nothingStarts: "Inget startar förrän du trycker på Kör.",
    runButton: "Kör",
    unbound: "Den här kanalen är inte kopplad till någon konversation, så det finns inget att köra ett kommando i.",
    cancelled: "Lät det vara. Inget kördes.",
    tooOld: "Det `/run` är för gammalt för att agera på nu. Kör det igen.",
  },
  typed: {
    clear:
      "`/clear` skrivet som ett meddelande skulle starta en session som den här kanalen inte kan se. Använd botens eget `/clear`-kommando, som börjar om konversationen i den här kanalen, eller `/purge` för att ta bort kanalens meddelanden.",
    bridgeOwned:
      "`/{{command}}` gäller för en enda process, och varje omgång här kör en ny, så det skulle rapportera att det lyckades och sedan återgå. Använd botens eget `/{{command}}`-kommando i stället, som sparar värdet för den här konversationen och tillämpar det på varje omgång.",
    terminalOnly: "`/{{command}}` körs bara i en interaktiv terminal. Kör det på värddatorn.",
    billedReview: "Det startar en molngranskning, som kan debiteras utöver din plan.",
    asksFirst:
      "`{{typed}}` kördes inte. {{caution}} I en terminal frågar Claude Code innan det startar, men ett kommando skrivet som ett meddelande här skulle starta utan att fråga. Använd `{{viaRun}}` i stället: det visar exakt vad som kommer att köras och väntar på att du trycker på Kör.",
  },
  settings: {
    current: "{{setting}} är satt till `{{value}}` för den här konversationen.",
    notOverridden: "{{setting}} är inte åsidosatt här, så omgångar körs med {{fallback}}.",
    changed:
      "{{setting}} satt till `{{value}}`. Det gäller från och med nästa omgång; en omgång som redan körs behåller det den började med.",
    hostDefault: "`{{value}}` (värddatorns standard)",
    claudeDefault: "Claude Codes standard",
  },
  whoami: {
    title: "Den här kanalen",
    resumeHint: "Återuppta den på värddatorn utan att gå via väljaren:",
    directory: "Katalog",
    model: "Modell",
    effort: "Effort",
    version: "brygga v{{version}}",
    claude: "Claude Code {{bundled}}",
    claudeDiffers: "Claude Code {{bundled}} för omgångar, {{host}} på värden",
  },
  usage: {
    notReported: "Plananvändning: inte rapporterad än. Claude Code skickar den med varje omgång, så den syns efter den första.",
    plan: "Plananvändning: {{windows}} (senast rapporterad {{when}})",
    window: "{{label}} {{percent}} % använt, nollställs {{when}}",
    windowReset: "{{label}} nollställdes {{when}}, ingen siffra rapporterad sedan dess",
    fiveHour: "5-timmarsfönster",
    weekAll: "vecka, alla modeller",
    weekOpus: "vecka, Opus",
    weekSonnet: "vecka, Sonnet",
  },
  spend: {
    underCent: "under $0.01",
    mineNone: "Den här konversationen: inget än.",
    mine_one: "Den här konversationen: {{count}} omgång här · {{input}} in, {{output}} ut, {{cached}} cachat",
    mine_other: "Den här konversationen: {{count}} omgångar här · {{input}} in, {{output}} ut, {{cached}} cachat",
    allNone: "Alla berörda konversationer: inget än.",
    all_one: "Alla berörda konversationer: {{count}} omgång här · {{input}} in, {{output}} ut, {{cached}} cachat",
    all_other: "Alla berörda konversationer: {{count}} omgångar här · {{input}} in, {{output}} ut, {{cached}} cachat",
    cost: "API-motsvarande kostnad, som en prenumeration inte debiteras efter: {{mine}} för den här konversationen under dess livstid, {{all}} över alla berörda konversationer.",
    costWithLast:
      "API-motsvarande kostnad, som en prenumeration inte debiteras efter: {{mine}} för den här konversationen under dess livstid (senaste omgången {{last}}), {{all}} över alla berörda konversationer.",
    footnote:
      "Plananvändningen gäller hela kontot. Omgångar och tokens räknas sedan bryggan startade {{since}}; en omstart nollställer dem, och omgångar som körs i en terminal räknas aldrig. Tokens är sessionens egna och utelämnar det dess agenter använde; kostnaden räknar med dem.",
  },
  plugins: {
    none: "Inga plugin rapporterades av `claude plugin list --json`. Om du väntade dig några, kontrollera att Claude Code finns på PATH för den här processen.",
    choose: "Välj ett plugin",
    summary_one: "{{count}} plugin installerat, {{enabled}} aktiverat.",
    summary_other: "{{count}} plugin installerade, {{enabled}} aktiverade.",
    optionEnabled: "{{version}} · aktiverat",
    optionDisabled: "{{version}} · inaktiverat",
    enable: "Aktivera",
    disable: "Inaktivera",
    enabled: "Aktiverade {{id}}.",
    disabled: "Inaktiverade {{id}}.",
    enableFailed: "Kunde inte aktivera `{{id}}`: {{error}}. Kör samma kommando på värddatorn för att se hela utskriften.",
    disableFailed: "Kunde inte inaktivera `{{id}}`: {{error}}. Kör samma kommando på värddatorn för att se hela utskriften.",
  },
  skills: {
    none: "Inga skills är kända för den här konversationen än. Skicka ett meddelande till den först och försök sedan igen: listan kommer från sessionen själv.",
    option: "Kör /{{skill}}",
    range: "{{first}} till {{last}}",
    available_one: "{{count}} skill tillgänglig i den här konversationen.",
    available_other: "{{count}} skills tillgängliga i den här konversationen.",
    availableAcross_one: "{{count}} skill tillgänglig i den här konversationen, A till Ö över {{menus}} menyer.",
    availableAcross_other: "{{count}} skills tillgängliga i den här konversationen, A till Ö över {{menus}} menyer.",
    omitted_one: "Den sista fick inte plats; skicka `/name` som ett meddelande för att köra den.",
    omitted_other: "De sista {{count}} fick inte plats; skicka `/name` som ett meddelande för att köra någon av dem.",
  },
  purge: {
    notDeletable:
      "`/purge` fungerar bara i en textkanal på en server där boten får hantera meddelanden. Kör det i konversationens kanal, eller ge boten behörigheten Hantera meddelanden (Manage Messages) här.",
    running: "En omgång körs här. Låt den bli klar eller `/stop` den, sedan `/purge`.",
    warning: "Det här tar bort varje meddelande i den här kanalen, även dina. Det går inte att ångra.",
    warningConversation:
      "Konversationen på värddatorn rörs inte, och ditt nästa meddelande fortsätter från den. Kanalen får inte tillbaka sin historik.",
    confirm: "Ta bort dem",
    cancelled: "Lät kanalen vara.",
    deleting: "Tar bort...",
    empty: "Inget att ta bort; kanalen är redan tom.",
    deleted_one: "Tog bort {{count}} meddelande.",
    deleted_other: "Tog bort {{count}} meddelanden.",
    slow_one: "{{count}} av dem var äldre än {{days}} dagar, vilket Discord bara låter ta bort ett i taget.",
    slow_other: "{{count}} av dem var äldre än {{days}} dagar, vilket Discord bara låter ta bort ett i taget.",
    failed_one: "{{count}} kunde inte tas bort.",
    failed_other: "{{count}} kunde inte tas bort.",
    conversationKept: "Själva konversationen är orörd, och ditt nästa meddelande fortsätter från den.",
    stoppedPartway: "Rensningen stannade halvvägs: {{error}}. Kör `/purge` igen för att slutföra.",
  },
};
