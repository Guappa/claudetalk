import type { Catalog } from "../catalog.ts";

export const fr: Catalog = {
  common: {
    nobody: "personne",
    unknown: "inconnu",
    cancel: "Annuler",
    nothingRunning: "Rien ne tourne ici.",
    sent: "`{{prompt}}` envoyé à la conversation.",
    noLongerBound:
      "Ce salon n'est plus lié à aucune conversation, il n'y a donc rien où exécuter ceci. `/resume` ouvre une conversation dans un salon à elle.",
    staleControl:
      "La passerelle ne reconnaît pas ce contrôle ; il reste probablement d'une version plus ancienne. Relance la commande pour en avoir un nouveau.",
  },
  units: {
    seconds: "{{seconds}} s",
    minutesSeconds: "{{minutes}} min {{seconds}} s",
    tokens_one: "{{count}} token",
    tokens_other: "{{count}} tokens",
    kiloTokens: "{{thousands}}k tokens",
    minutesAgo: "il y a {{quantity}} min",
    hoursAgo: "il y a {{quantity}} h",
    daysAgo: "il y a {{quantity}} j",
  },
  language: {
    current:
      "Langue de la passerelle : **{{name}}**. Cela couvre ce que dit la passerelle elle-même ; Claude répond dans la langue dans laquelle tu lui écris.",
    changed:
      "Langue de la passerelle : **{{name}}**, à partir de maintenant. Cela couvre ce que dit la passerelle elle-même ; un tour déjà en cours garde la langue dans laquelle il a commencé. Les réponses de Claude ne changent pas : il répond dans la langue dans laquelle tu lui écris.",
  },
  access: {
    ownersOnly:
      "`/{{command}}` est réservée aux propriétaires. Les opérateurs pilotent le bot ; qui d'autre peut l'utiliser, et ce qui tourne dedans, c'est au propriétaire d'en décider.",
    none: "Tu n'as pas accès à cette passerelle. Un propriétaire doit te le donner.",
  },
  command: {
    noHandler:
      "`/{{command}}` est enregistrée auprès de Discord, mais cette passerelle n'a aucun gestionnaire pour elle. Redémarre la passerelle pour qu'elle réenregistre ses commandes.",
    failed:
      "`/{{command}}` a échoué : {{error}}. Réessaie ; si ça continue d'échouer, le journal de la passerelle sur l'hôte a les détails.",
    pressFailed:
      "Ce clic a échoué : {{error}}. Ce qu'il devait faire est peut-être à moitié fait, alors regarde avant de cliquer à nouveau ; le journal de la passerelle sur l'hôte a les détails.",
  },
  binding: {
    unbound: "Ce salon n'est pas encore lié à une conversation.",
    notInServer:
      "Les conversations n'existent que dans un serveur, pas en message privé. Lance ceci dans un salon du serveur pour lequel la passerelle est configurée.",
    alreadyOpen: "**{{name}}** est déjà ouverte dans <#{{channelId}}>.",
    bound: "Lié à **{{channel}}**.",
    noWorkspace:
      "Tu n'as aucun espace de travail d'où répondre. Demande à un propriétaire de définir `WORKSPACES_ROOT`, ou utilise `/create` pour démarrer une conversation à toi.",
  },
  attachments: {
    executable: "`{{name}}`, parce que {{extension}} est un format exécutable",
    tooLarge: "`{{name}}`, parce qu'il dépasse {{megabytes}} Mo",
    refused:
      "Non enregistré pour ce tour : {{files}}. La session tourne avec les droits de l'hôte, alors un fichier qu'elle pourrait exécuter ne vaut pas le confort. Mets-le toi-même dans le répertoire de travail s'il doit s'y trouver.",
    unfetched_one:
      "Impossible de télécharger {{names}} depuis Discord, la session ne le verra donc pas. Les liens de fichiers de Discord expirent et son CDN refuse parfois ; renvoie le fichier si ça compte.",
    unfetched_other:
      "Impossible de télécharger {{names}} depuis Discord, la session ne les verra donc pas. Les liens de fichiers de Discord expirent et son CDN refuse parfois ; renvoie les fichiers si ça compte.",
  },
  outbox: {
    tooLarge: "Trop volumineux pour être joint, laissé dans `{{folder}}` : {{names}}.",
    failed:
      "Impossible de joindre ce qui se trouve dans `{{folder}}` : {{error}}. Les fichiers sont toujours là sur l'hôte et la passerelle réessaie d'elle-même ; si ça continue d'échouer, vérifie que le bot peut joindre des fichiers dans ce salon.",
    files_one: "{{count}} fichier",
    files_other: "{{count}} fichiers",
  },
  context: {
    critical:
      "Le contexte est plein à environ {{percent}} %. Lance `/compact` bientôt, sinon il se compactera tout seul en pleine tâche.",
    approaching: "Le contexte est plein à environ {{percent}} %. `/context` montre le détail, `/compact` libère de la place.",
  },
  trail: {
    working: "**En cours** {{elapsed}}",
    workingSteps_one: "**En cours** {{elapsed}} · {{count}} étape",
    workingSteps_other: "**En cours** {{elapsed}} · {{count}} étapes",
    done: "**Terminé** {{elapsed}}",
    doneSteps_one: "**Terminé** {{elapsed}} · {{count}} étape",
    doneSteps_other: "**Terminé** {{elapsed}} · {{count}} étapes",
    stopped: "**Arrêté après** {{elapsed}}",
    stoppedSteps_one: "**Arrêté après** {{elapsed}} · {{count}} étape",
    stoppedSteps_other: "**Arrêté après** {{elapsed}} · {{count}} étapes",
    failed: "**Échoué après** {{elapsed}}",
    failedSteps_one: "**Échoué après** {{elapsed}} · {{count}} étape",
    failedSteps_other: "**Échoué après** {{elapsed}} · {{count}} étapes",
    started: "**Démarré**",
    interrupted: "**Interrompu : la passerelle s'est arrêtée pendant que ceci tournait. Envoie un message pour continuer.**",
    answerDone: "Terminé.",
    answerDoneNoText: "Terminé, sans texte à montrer.",
    answerCompacted: "Compacté.",
    answerStopped: "Arrêté.",
    compacting: "Compactage de la conversation, ce qui peut prendre un moment.",
    retryingRefresh: "Un autre processus Claude Code renouvelait la connexion ; ce tour est retenté dans une minute.",
    compactingHeading: "**Compactage** {{elapsed}}",
    compactingSteps_one: "**Compactage** {{elapsed}} · {{count}} étape",
    compactingSteps_other: "**Compactage** {{elapsed}} · {{count}} étapes",
    compactFailed: "Le compactage a échoué : {{error}}. La conversation continue telle quelle ; `/compact` réessaie.",
    agentDone: "**{{name}}** terminé · {{elapsed}}",
    agentFailed: "**{{name}}** échoué · {{elapsed}}",
    agentStopped: "**{{name}}** arrêté · {{elapsed}}",
    compactedAuto:
      "Compacté (auto) : de {{before, number}} à {{after, number}} tokens, {{dropped, number}} écartés au total, {{seconds}} s.",
    compactedManual:
      "Compacté (manuel) : de {{before, number}} à {{after, number}} tokens, {{dropped, number}} écartés au total, {{seconds}} s.",
    moreLines_one: "... {{count}} ligne de plus",
    moreLines_other: "... {{count}} lignes de plus",
    written_one: "{{path}} ({{count}} ligne)",
    written_other: "{{path}} ({{count}} lignes)",
  },
  tools: {
    read: "**Lit** {{path}}",
    notebook: "**Notebook** {{path}}",
    find: "**Cherche des fichiers** {{pattern}} dans {{path}}",
    findAnywhere: "**Cherche des fichiers** {{pattern}}",
    search: "**Cherche** {{pattern}} dans {{path}}",
    searchAnywhere: "**Cherche** {{pattern}}",
    fetch: "**Récupère** {{url}}",
    webSearch: "**Recherche web** {{query}}",
    toolSearch: "**Recherche d'outils** {{query}}",
    agent: "**Agent** {{description}}",
    skill: "**Skill** /{{name}}",
    todos_one: "**À faire** · {{count}} élément",
    todos_other: "**À faire** · {{count}} éléments",
    server: "**{{server}}** {{tool}}",
    other: "**{{name}}**",
  },
  turn: {
    draining:
      "La passerelle s'éteint et ne prend plus rien de nouveau. Elle laisse d'abord finir les tours en cours, ce qui peut prendre un moment ; renvoie ceci une fois qu'elle est revenue.",
    failed: "Le tour a échoué.\n```\n{{error}}\n```",
    checkFailed:
      "Ton message n'a pas été envoyé à Claude : la vérification avant le tour a échoué avec {{error}}. Essaie de le renvoyer ; si ça continue d'échouer, le journal de la passerelle sur l'hôte a les détails.",
    heldByBackgroundAgent:
      "Cette conversation tourne comme agent en arrière-plan (`{{shortId}}`). Lance `/takeover` ici pour l'arrêter et continuer, ou `claude attach {{shortId}}` sur l'hôte.",
    openInTerminalIdle:
      "Cette conversation est ouverte dans un terminal sur l'hôte (pid {{pid}}, {{cwd}}), où rien n'est en cours. Lance `/takeover` ici pour la fermer là-bas et continuer, ou ferme ce terminal toi-même.",
    openInTerminalBusy:
      "Cette conversation est ouverte dans un terminal sur l'hôte (pid {{pid}}, {{cwd}}), et un tour y est en cours. Laisse-le finir ou arrête-le là-bas, puis réessaie.",
    openInTerminal:
      "Cette conversation est ouverte dans un terminal sur l'hôte (pid {{pid}}, {{cwd}}). Ferme ce terminal ou passe-le à une autre conversation, puis réessaie.",
    conversationGone:
      "La conversation de ce salon a été relancée ou déliée pendant que ton message était en route, il n'a donc pas été exécuté. Renvoie-le.",
    unknownSession:
      "Claude Code n'a aucune conversation sous l'identifiant de session auquel ce salon est lié : sa transcription a été retirée de l'hôte, ou son premier tour n'est jamais allé assez loin pour en écrire une. Renvoyer le message n'y changera rien. Lance `/clear` pour démarrer une nouvelle conversation dans ce salon.",
    errors: {
      stopped: "Le tour a été arrêté.",
      orphanTwice:
        "Claude Code a signalé deux fois de suite une commande en arrière-plan restée d'un tour précédent, et une session qui commence par en signaler une refuse tout appel d'outil. Renvoie le message ; en général ça passe à l'essai suivant.",
      refreshTwice:
        "Claude Code n'a pas pu renouveler la connexion deux fois de suite : un autre de ses processus tenait le renouvellement, ou est mort avec. Réessaie dans une minute ; si ça continue, ferme les autres processus Claude Code sur l'hôte ou reconnecte-toi là-bas.",
      ended: "Le tour s'est terminé en {{subtype}}. Essaie de renvoyer ton message.",
      unexplained: "Claude Code a terminé le tour sur une erreur sans en donner la raison. Essaie de renvoyer ton message.",
      endedSaying: "Le tour s'est terminé en {{subtype}}.\n{{text}} Essaie de renvoyer ton message.",
      couldNotRun:
        "Claude Code n'a pas pu exécuter ce tour : {{error}}. Vérifie qu'il est installé et connecté sur l'hôte, puis réessaie.",
    },
  },
  fold: {
    handedOver:
      "Transmis au tour en cours. Claude le reprend à sa prochaine étape, ou juste après la réponse de ce tour s'il ne reste aucune étape.",
    takenUp: "Repris par le tour en cours.",
    neverTaken: "Le tour s'est terminé avant que ceci soit repris. Renvoie-le.",
    sendNow: "Envoyer maintenant",
    sent: "Envoyé maintenant. L'étape où en était Claude a été coupée pour qu'il puisse lire ton message, et il continue à partir de là. Les agents et commandes en arrière-plan qu'il avait lancés continuent de tourner.",
    nothingWaiting: "Rien n'attend : le tour en cours a déjà repris ton message.",
    notRunning: "Plus aucun tour ne tourne ici, il n'y a donc rien à interrompre.",
    notInterrupted: "Le tour en cours n'a pas pu être interrompu, ton message attend donc toujours sa prochaine étape.",
  },
  queue: {
    behind_one: "En file derrière le tour encore en cours.",
    behind_other: "En file derrière {{count}} messages.",
    runningAlone: "Un tour est en cours, sans rien en file derrière lui.",
    runningWith_one: "Un tour est en cours, avec {{count}} message en file derrière lui.",
    runningWith_other: "Un tour est en cours, avec {{count}} messages en file derrière lui.",
    full: "Cette conversation tient déjà {{limit}} messages : un en cours et {{queued}} en file derrière. Laisse-la rattraper son retard, lance `/stop` pour finir celui en vol et laisser partir le suivant, ou `/stop all:true` pour écarter la file avec.",
  },
  restart: {
    unsupervised:
      "Pas de redémarrage : cette passerelle a été lancée à la main, ou par un service installé avant qu'elle ne sache se relancer, donc rien ne la relancerait. Relance l'installateur de démarrage automatique du README, ou arrête-la et démarre-la sur l'hôte.",
    broken:
      "Pas de redémarrage : le code sur l'hôte ne démarrerait pas, la passerelle continue donc telle quelle. Corrige ce qu'il indique, puis redemande.\n```\n{{error}}\n```",
    checkTimedOut:
      "Pas de redémarrage : vérifier que le code sur l'hôte démarrerait a pris plus d'une minute et a été abandonné. La passerelle continue telle quelle ; le journal sur l'hôte dit peut-être ce qu'elle attendait.",
    now: "Redémarrage immédiat. La passerelle le dira ici une fois revenue.",
    afterTurns_one:
      "Redémarrage dès que le {{count}} tour en cours sera terminé et que plus rien ne tournera. D'ici là la passerelle fonctionne comme d'habitude, et elle le dira ici une fois revenue.",
    afterTurns_other:
      "Redémarrage dès que les {{count}} tours en cours seront terminés et que plus rien ne tournera. D'ici là la passerelle fonctionne comme d'habitude, et elle le dira ici une fois revenue.",
    back: "La passerelle est revenue après son redémarrage, en v{{version}}.",
  },
  update: {
    out_one: "La **v{{version}}** de la passerelle est sortie, une version après la v{{current}} qui tourne ici.",
    out_other: "La **v{{version}}** de la passerelle est sortie, {{count}} versions après la v{{current}} qui tourne ici.",
    more_one: "... et {{count}} autre changement",
    more_other: "... et {{count}} autres changements",
    how: "Tout ce qu'il y a entre les deux : <{{url}}>. Pour mettre à jour, récupère le nouveau code sur l'hôte et redémarre la passerelle, ou récupère la nouvelle image. C'est dit une fois par version, et au plus une fois par semaine.",
  },
  stop: {
    button: "Arrêter",
    allButton: "Tout arrêter",
    agentsButton: "Arrêter les agents",
    cloudTaskButton: "Arrêter la tâche cloud",
    outlives:
      "Tout l'arbre de processus du tour est tué ; sous Windows, une commande qui s'était détachée de cet arbre peut lui survivre, alors vérifie l'hôte si c'était quelque chose de long.",
    noAgents: "Aucun agent ni tâche cloud ne tourne ici, il n'y avait donc rien à arrêter.",
    agentsAsked_one:
      "{{count}} tâche invitée à s'arrêter. Le tour lui-même continue, et Claude est informé qu'elle a été arrêtée ; appuie sur **Arrêter** pour finir aussi le tour.",
    agentsAsked_other:
      "{{count}} tâches invitées à s'arrêter. Le tour lui-même continue, et Claude est informé qu'elles ont été arrêtées ; appuie sur **Arrêter** pour finir aussi le tour.",
    nothingYet_one: "Rien ne tourne encore ; {{count}} message en file ici partira à son tour.",
    nothingYet_other: "Rien ne tourne encore ; {{count}} messages en file ici partiront à leur tour.",
    turn: "Ce tour est arrêté. Rien n'était en file, donc Claude ne fait plus rien ici jusqu'à ton prochain message. $t(stop.outlives)",
    turnThenQueue_one: "Ce tour est arrêté. Le {{count}} message en file derrière part ensuite. $t(stop.outlives)",
    turnThenQueue_other: "Ce tour est arrêté. Les {{count}} messages en file derrière partent ensuite. $t(stop.outlives)",
    queueOnly_one: "Rien ne tournait, mais le message en file ici a été écarté.",
    queueOnly_other: "Rien ne tournait, mais les {{count}} messages en file ici ont été écartés.",
    all: "Arrêté. Claude ne fait plus rien ici jusqu'à ton prochain message. $t(stop.outlives)",
    allWithQueue_one:
      "Arrêté. Le message en file derrière a été écarté aussi. Claude ne fait plus rien ici jusqu'à ton prochain message. $t(stop.outlives)",
    allWithQueue_other:
      "Arrêté. Les {{count}} messages en file derrière ont été écartés aussi. Claude ne fait plus rien ici jusqu'à ton prochain message. $t(stop.outlives)",
  },
  agents: {
    title: "Agents : {{asked}}",
    titleBare: "Agents",
    tally: "**Agents** · {{tally}}",
    tallyRunning: "{{quantity}} en cours",
    tallyDone: "{{quantity}} terminés",
    tallyFailed: "{{quantity}} échoués",
    tallyStopped: "{{quantity}} arrêtés",
    more: "et {{quantity}} de plus",
    tools_one: "{{count}} outil",
    tools_other: "{{count}} outils",
    running: "en cours",
    waiting: "en attente d'une commande en arrière-plan",
    completed: "terminé en {{elapsed}}",
    failed: "échoué après {{elapsed}}",
    stopped: "arrêté après {{elapsed}}",
  },
  approvals: {
    request: "**{{tool}}** veut s'exécuter. L'approuver ?\n```\n{{detail}}\n```",
    deleteOutside:
      "Claude veut supprimer quelque chose hors du dossier de cette conversation, ce que la passerelle refuse sauf si un propriétaire l'autorise. Autoriser cette seule commande ?\n```\n{{detail}}\n```",
    approveOnce: "Approuver une fois",
    deny: "Refuser",
    approveRest: "Approuver le reste de ce tour",
    approvedOnce: "Approuvé une fois.",
    approvedRest: "Approuvé pour le reste de ce tour.",
    approvedRestQuiet: "Approuvé, et le reste de ce tour ne demandera plus.",
    denied: "Refusé depuis Discord.",
    ended: "Le tour s'est terminé avant que ceci reçoive une réponse.",
    expired: "Pas de réponse en {{minutes}} minutes, donc refusé.",
    stale: "Cette demande a déjà reçu sa réponse, a expiré, ou date d'avant un redémarrage.",
    ownersOnly: "Seul un propriétaire de cette passerelle peut répondre à une demande de permission.",
  },
  questions: {
    heading_one: "Claude a une question.",
    heading_other: "Claude a {{count}} questions.",
    question: "**{{number}}. {{header}}** {{question}}",
    questionPickAny: "**{{number}}. {{header}}** {{question}} Choisis tout ce qui s'applique.",
    placeholder: "Question {{number}}",
    unnamedOption: "(vide)",
    other: "Autre...",
    otherDescription: "Saisis une réponse à toi",
    ownAnswerTitle: "Ta propre réponse à la question {{number}}",
    ownAnswerLabel: "Réponse",
    submit: "Envoyer",
    skip: "Passer",
    answered: "Répondu : {{summary}}.",
    skipped: "Passé : Claude est invité à continuer selon son propre jugement et à dire ce qu'il a supposé.",
    expired: "Pas de réponse en {{minutes}} minutes, donc Claude continue sans.",
    ended: "Le tour s'est terminé avant que ceci reçoive une réponse.",
    stale: "Ces questions ont déjà reçu leur réponse, ont expiré, ou datent d'avant un redémarrage.",
    unanswered:
      "La question {{number}} n'a pas encore de réponse. Choisis-en une, ou appuie sur Passer pour n'en envoyer aucune.",
  },
  sync: {
    fromYou: "**Toi** · terminal · {{clock}}",
    fromClaude: "**Claude** · terminal · {{clock}}",
    drift_one:
      "{{count}} message a eu lieu dans cette conversation hors de Discord depuis ton dernier passage ici. C'était {{ago}}, {{when}}. Lance `/sync` pour le voir.",
    drift_other:
      "{{count}} messages ont eu lieu dans cette conversation hors de Discord depuis ton dernier passage ici. Le dernier était {{ago}}, {{when}}. Lance `/sync` pour les voir.",
    running:
      "Un tour est en cours ici en ce moment, et ce qu'il dit est en route vers ce salon. Relance `/sync` une fois qu'il a fini.",
    nothingNew: "Rien de nouveau : rien ne s'est passé dans cette conversation hors de Discord depuis ton dernier passage ici.",
    all_one: "{{count}} message venu d'ailleurs que Discord :",
    all_other: "{{count}} messages venus d'ailleurs que Discord :",
    latest_one: "{{count}} message venu d'ailleurs que Discord. Là où tu t'étais arrêté, avec tous dans le fichier :",
    latest_other: "{{count}} messages venus d'ailleurs que Discord. Là où tu t'étais arrêté, avec tous dans le fichier :",
    leftOff: "Là où tu t'étais arrêté :",
    countedRecent:
      "Cela ne compte que le plus récent : la passerelle relit les derniers {{megabytes}} Mo d'une transcription, et il s'est passé plus de choses avant que ce qu'ils contiennent.",
  },
  ask: {
    withContext_one: "Question posée avec le dernier {{count}} message comme contexte.",
    withContext_other: "Question posée avec les {{count}} derniers messages comme contexte.",
    noContext: "Question posée sans contexte supplémentaire.",
  },
  category: {
    full: "**{{name}}** tient déjà {{limit}} salons, soit tout ce que Discord permet. Utilise une autre catégorie, ou sors d'abord quelque chose de celle-là.",
    notMovable:
      "Seul un salon textuel dans un serveur peut être déplacé. Lance `/category` dans le salon propre à la conversation.",
    current: "Cette conversation se trouve dans **{{name}}**.",
    none: "Cette conversation n'est dans aucune catégorie. Donne un nom pour la mettre dans une.",
    moved: "Déplacée dans **{{name}}**.",
    moveFailed:
      "Impossible de la déplacer dans **{{name}}** : {{error}}. Le bot a besoin de Gérer les salons, et une catégorie tient {{limit}} salons.",
  },
  clear: {
    running: "Un tour est en cours ici. Laisse-le finir ou lance `/stop`, puis `/clear`.",
    confirm:
      "Ceci relance ce salon avec une nouvelle conversation dans `{{cwd}}` : le même dossier, modèle, effort et les mêmes membres, mais sans rien de ce qui a été dit dans celle-ci. La conversation actuelle reste sur l'hôte, listée par `/sessions`, et `/resume` avec son identifiant de session l'ouvre dans un salon à elle. Les messages du salon restent ; `/purge` les retire.",
    startOver: "Recommencer",
    unbound: "Ce salon n'est pas lié à une conversation, il n'y a donc rien à effacer.",
    stale:
      "Ceci a été proposé pour une conversation que ce salon ne tient plus, rien n'a donc été relancé. Relance `/clear` si celle-ci doit l'être.",
    done: "Recommencé. Ce salon tient maintenant une nouvelle conversation dans `{{cwd}}` ; la précédente est toujours sur l'hôte sous `{{sessionId}}`.",
    cancelled: "Laissé tel quel. La conversation continue comme avant.",
  },
  unbind: {
    unbound: "Ce salon n'est pas lié à une conversation, il n'y a donc rien à délier.",
    running: "Un tour est en cours ici. Laisse-le finir ou lance `/stop`, puis `/unbind`.",
    done: "Délié. La conversation est toujours sur l'hôte et peut être reprise avec `/resume`. Le salon n'est plus qu'un salon ; le supprimer, ou le garder pour l'historique ?",
    doneShared:
      "Délié. La conversation est toujours sur l'hôte et peut être reprise avec `/resume`. Ce salon ne répondait que lorsque le bot était mentionné, et il reste tel quel.",
    boundAgain:
      "Ce salon a été relié à une conversation depuis, il n'a donc pas été supprimé. Relance `/unbind` ici s'il doit partir.",
    deleteChannel: "Supprimer le salon",
    keep: "Le garder",
    kept: "Gardé. Le salon reste tel quel, avec son historique.",
    notDeletable: "Ce salon ne peut pas être supprimé d'ici. Retire-le dans les paramètres du salon de Discord.",
    deleting: "Suppression du salon...",
    deleteFailed:
      "Impossible de supprimer le salon : {{error}}. Le bot a besoin de Gérer les salons ; retire-le plutôt dans les paramètres du salon de Discord.",
  },
  takeover: {
    closedTerminal:
      "Claude Code a été fermé dans le terminal sur l'hôte (pid {{pid}}). Pour y rouvrir la conversation, lance `claude --resume {{sessionId}}` sur l'hôte.",
    free: "Cette conversation est libre maintenant : envoie ton message.",
    heldRuns: "Ton message d'avant s'exécute maintenant.",
    notClosed:
      "Claude Code dans le terminal sur l'hôte (pid {{pid}}) ne s'est pas fermé en quelques secondes, donc rien n'a été repris. Ferme ce terminal sur l'hôte, puis réessaie.",
    running: "Un tour est en cours ici en ce moment. Utilise `/stop` pour le finir.",
    nothingHolding: "Rien ne retient cette conversation. Envoie simplement un message.",
    stopped: "Agent en arrière-plan `{{shortId}}` arrêté.",
  },
  create: {
    topic: 'Conversation Claude Code "{{name}}" dans {{cwd}}',
    channelFailed:
      "Impossible de créer le salon : {{error}}. Le bot a besoin de Gérer les salons, Gérer les rôles et Gérer les messages sur ce serveur ; Gérer les rôles est ce qui lui permet de rendre le salon privé pour toi.",
    ownersOnlyHere:
      "Seul un propriétaire peut créer des conversations ici. Définis WORKSPACES_ROOT pour donner aux autres opérateurs un endroit à eux où travailler.",
    folderFailed:
      "Impossible d'utiliser `{{cwd}}` comme répertoire de travail : {{error}}. Vérifie que le chemin se trouve quelque part où la passerelle peut écrire, ou passe un dossier existant comme `project`.",
    categoryFailed:
      "Impossible d'utiliser la catégorie **{{name}}** : {{error}}. Le bot a besoin de Gérer les salons pour en créer une.",
    done: "{{channel}} créé pour **{{name}}** dans `{{cwd}}`.",
    resumeButton: "Reprendre {{name}} ({{age}})",
    startNew: "En démarrer une nouvelle",
    existing_one: "`{{cwd}}` a déjà {{count}} conversation. En reprendre une, ou en démarrer une autre à côté ?",
    existing_other: "`{{cwd}}` a déjà {{count}} conversations. En reprendre une, ou en démarrer une autre à côté ?",
    existingMore_one:
      "`{{cwd}}` a déjà {{count}} conversation ({{hidden}} plus anciennes non montrées). En reprendre une, ou en démarrer une autre à côté ?",
    existingMore_other:
      "`{{cwd}}` a déjà {{count}} conversations ({{hidden}} plus anciennes non montrées). En reprendre une, ou en démarrer une autre à côté ?",
    cancelled: "Laissé tel quel. Rien n'a été créé.",
    tooOld: "Ce `/create` est trop ancien pour y donner suite maintenant. Relance-le.",
    gone: "Cette conversation n'est plus sur l'hôte : sa transcription a été retirée ou déplacée. Relance `/create` pour en démarrer une nouvelle.",
  },
  fork: {
    unbound: "Ce salon n'est pas lié à une conversation, il n'y a donc rien à brancher.",
    unnamed: "conversation",
    branching: "Branchement dans {{channel}}...",
    notStarted:
      "Rien n'a été branché : le premier tour de la branche n'a pas démarré, et le salon créé pour elle a été retiré. Cela arrive quand cette conversation est ouverte dans un terminal ou tenue par un agent en arrière-plan, quand sa file est pleine ou a été écartée, ou quand la passerelle s'éteint. Relance `/fork` une fois qu'elle est libre.",
    notBound:
      "{{channel}} créé, mais le premier tour de la branche s'est terminé sans que Claude Code signale un nouvel identifiant de session, ce salon n'est donc pas lié ; ce à quoi le tour a abouti y est montré. Si la branche apparaît bien dans `/sessions`, `/resume` l'ouvre dans un salon à elle, et {{channel}} peut être supprimé.",
    done: "**{{source}}** branchée dans {{channel}} sous le nom **{{name}}**. Ce salon est intact.",
  },
  resume: {
    ambiguous: '"{{name}}" est ambigu. Tu voulais dire : {{candidates}} ?',
    andMore: "{{candidates}}, et {{count}} de plus",
    notFound: 'Aucune conversation nommée "{{name}}". Utilise `/sessions` pour voir ce qui existe.',
    noFolder:
      '"{{name}}" a été trouvée, mais son répertoire de travail n\'a pas pu être lu dans la transcription, elle ne peut donc pas être reprise.',
    opened: "{{channel}} ouvert pour **{{name}}** dans `{{cwd}}`.",
    openedPastOlder_one:
      "{{channel}} ouvert pour **{{name}}** dans `{{cwd}}` ({{count}} conversation plus ancienne du même nom a été sautée).",
    openedPastOlder_other:
      "{{channel}} ouvert pour **{{name}}** dans `{{cwd}}` ({{count}} conversations plus anciennes du même nom ont été sautées).",
  },
  sessions: {
    title: "Conversations sur l'hôte",
    titleMatching: 'Conversations correspondant à "{{filter}}"',
    none: "Aucune conversation trouvée pour l'instant. Démarres-en une avec `/create <name>`.",
    hidden_one: "{{count}} conversation dans le dossier temporaire est laissée de côté. Passe un filtre pour l'inclure.",
    hidden_other: "{{count}} conversations dans le dossier temporaire sont laissées de côté. Passe un filtre pour les inclure.",
    older: "+{{older}} plus anciennes",
    live: "active ({{kind}}, {{status}})",
    starting: "démarrage",
  },
  members: {
    runs: "Tourne dans `{{cwd}}` en tant qu'utilisateur de l'hôte, avec un accès complet à la machine.",
    seenByNobody: "Personne d'autre ne peut la voir.",
    seenBy_one: "{{count}} autre personne peut la voir.",
    seenBy_other: "{{count}} autres personnes peuvent la voir.",
    visibilityFailed:
      "L'accès a été enregistré, mais la visibilité du salon n'a pas pu être changée : {{error}}. Le bot a besoin de Gérer les rôles pour cela.",
    inviteBot: "Un bot ne peut pas être invité dans une conversation ; choisis une personne.",
    alreadyIn: "{{user}} a déjà accès à cette conversation.",
    invited: "{{user}} peut maintenant voir cette conversation.",
    inviteWarning:
      "Cela lui permet de **lire** le salon, y compris tout ce qui a déjà été dit ici. Cela ne lui permet pas d'utiliser le bot : les messages et commandes de quiconque n'est pas opérateur sont ignorés. `/operator add` est ce qui confie la machine.",
    notMember: "{{user}} n'est pas membre de cette conversation.",
    removed: "{{user}} retiré.",
    sharedChannel:
      "Rien n'a été changé. Ce salon existait avant la conversation, donc qui peut le voir se règle dans les paramètres du salon de Discord, pas par la passerelle. `/invite` et `/uninvite` fonctionnent dans un salon créé par `/create`, `/resume` ou `/fork`.",
    summary: "Propriétaire : {{owner}}\nPeuvent la voir : {{watchers}}",
  },
  operators: {
    title: "Qui peut utiliser cette passerelle",
    ownersFixed: "Les propriétaires sont définis sur l'hôte et ne peuvent pas être changés ici.",
    owners: "Propriétaires",
    operators: "Opérateurs",
    bot: "Un bot ne peut pas être opérateur ; choisis une personne.",
    isOwner:
      "{{user}} est propriétaire, défini dans `DISCORD_OWNER_IDS` sur l'hôte. C'est au-dessus d'opérateur et ça ne peut pas être changé depuis Discord.",
    added:
      "{{user}} est opérateur à partir de maintenant. **Il peut exécuter n'importe quoi sur cette machine**, en tant qu'utilisateur de l'hôte, avec ses identifiants et son forfait Claude.",
    already: "{{user}} est déjà opérateur.",
    removed: "{{user}} n'est plus opérateur. Les conversations qu'il a déjà démarrées restent liées.",
    notOperator: "{{user}} n'est pas opérateur.",
  },
  run: {
    noListYet:
      "Les commandes de cette conversation ne sont pas encore connues : elles sont apprises la première fois qu'un tour tourne dans son dossier. Envoie d'abord un message ici, puis `/run` les listera au fil de ta saisie.",
    noListChoice: "Pas encore de liste de commandes : envoie d'abord un message ici, puis réessaie",
    notAName: "`{{command}}` n'est pas un nom de commande. Choisis-en une dans la liste que `/run` propose au fil de ta saisie.",
    unknown:
      "`/{{command}}` n'est pas une commande que cette conversation possède. Choisis-en une dans la liste que `/run` propose au fil de ta saisie ; un plugin installé depuis le dernier tour ici apparaît après le suivant.",
    confirm: "Exécuter ceci dans la conversation ?",
    takes: "Prend : `{{hint}}`",
    nothingStarts: "Rien ne démarre tant que tu n'appuies pas sur Exécuter.",
    runButton: "Exécuter",
    unbound: "Ce salon n'est pas lié à une conversation, il n'y a donc rien où exécuter une commande.",
    cancelled: "Laissé tel quel. Rien n'a été exécuté.",
    tooOld: "Ce `/run` est trop ancien pour y donner suite maintenant. Relance-le.",
  },
  typed: {
    clear:
      "`/clear` tapé comme message démarrerait une session que ce salon ne peut pas voir. Utilise la commande `/clear` propre à ce bot, qui relance la conversation dans ce salon, ou `/purge` pour supprimer les messages du salon.",
    bridgeOwned:
      "`/{{command}}` s'applique à un processus, et chaque tour ici en lance un nouveau, donc elle annoncerait un succès puis reviendrait en arrière. Utilise plutôt la commande `/{{command}}` propre à ce bot, qui enregistre la valeur pour cette conversation et l'applique à chaque tour.",
    terminalOnly: "`/{{command}}` ne tourne que dans un terminal interactif. Lance-la sur la machine hôte.",
    billedReview: "Elle lance une revue cloud, qui peut être facturée en plus de ton forfait.",
    asksFirst:
      "`{{typed}}` n'a pas été exécutée. {{caution}} Dans un terminal, Claude Code demande avant de démarrer, mais une commande tapée ici comme message démarrerait sans demander. Utilise plutôt `{{viaRun}}` : elle montre exactement ce qui va tourner et attend que tu appuies sur Exécuter.",
  },
  settings: {
    current: "{{setting}} est réglé sur `{{value}}` pour cette conversation.",
    notOverridden: "{{setting}} n'est pas redéfini ici, les tours tournent donc avec {{fallback}}.",
    changed:
      "{{setting}} réglé sur `{{value}}`. Cela s'applique à partir du prochain tour ; un tour déjà en cours garde ce avec quoi il a commencé.",
    hostDefault: "`{{value}}` (valeur par défaut de l'hôte)",
    claudeDefault: "la valeur par défaut de Claude Code",
  },
  whoami: {
    title: "Ce salon",
    resumeHint: "La reprendre sur l'hôte sans passer par le sélecteur :",
    directory: "Répertoire",
    model: "Modèle",
    effort: "Effort",
    context: "Contexte",
    contextStanding: "{{percent}} % de {{ceiling}}",
    contextUnmeasured: "Pas encore mesuré. Le prochain tour ici le mesure.",
    version: "passerelle v{{version}}",
    newerVersion: "la v{{version}} est sortie",
    claude: "Claude Code {{bundled}}",
    claudeDiffers: "Claude Code {{bundled}} pour les tours, {{host}} sur l'hôte",
  },
  usage: {
    notReported:
      "Utilisation du forfait : pas encore signalée. Claude Code l'envoie à chaque tour, elle apparaît donc après le premier.",
    plan: "Utilisation du forfait : {{windows}} (signalée {{when}})",
    window: "{{label}} {{percent}} % utilisés, se réinitialise {{when}}",
    windowReset: "{{label}} réinitialisée {{when}}, aucun chiffre signalé depuis",
    fiveHour: "fenêtre de 5 heures",
    weekAll: "semaine, tous modèles",
    weekOpus: "semaine, Opus",
    weekSonnet: "semaine, Sonnet",
  },
  spend: {
    underCent: "moins de 0,01 $",
    mineNone: "Cette conversation : rien pour l'instant.",
    mine_one: "Cette conversation : {{count}} tour ici · {{input}} en entrée, {{output}} en sortie, {{cached}} en cache",
    mine_other: "Cette conversation : {{count}} tours ici · {{input}} en entrée, {{output}} en sortie, {{cached}} en cache",
    allNone: "Toutes les conversations touchées : rien pour l'instant.",
    all_one:
      "Toutes les conversations touchées : {{count}} tour ici · {{input}} en entrée, {{output}} en sortie, {{cached}} en cache",
    all_other:
      "Toutes les conversations touchées : {{count}} tours ici · {{input}} en entrée, {{output}} en sortie, {{cached}} en cache",
    cost: "Coût équivalent API, sur lequel un abonnement n'est pas facturé : {{mine}} pour cette conversation sur toute sa durée, {{all}} sur toutes les conversations touchées.",
    costWithLast:
      "Coût équivalent API, sur lequel un abonnement n'est pas facturé : {{mine}} pour cette conversation sur toute sa durée (dernier tour {{last}}), {{all}} sur toutes les conversations touchées.",
    footnote:
      "L'utilisation du forfait vaut pour tout le compte. Les tours et les tokens sont comptés depuis le démarrage de la passerelle {{since}} ; un redémarrage les remet à zéro, et les tours lancés dans un terminal ne sont jamais comptés. Les tokens sont ceux de la session elle-même et n'incluent pas ce que ses agents ont utilisé ; le coût, lui, les inclut.",
  },
  plugins: {
    none: "Aucun plugin signalé par `claude plugin list --json`. Si tu en attendais, vérifie que Claude Code est dans le PATH de ce processus.",
    choose: "Choisis un plugin",
    summary_one: "{{count}} plugin installé, {{enabled}} activé.",
    summary_other: "{{count}} plugins installés, {{enabled}} activés.",
    optionEnabled: "{{version}} · activé",
    optionDisabled: "{{version}} · désactivé",
    enable: "Activer",
    disable: "Désactiver",
    enabled: "{{id}} activé.",
    disabled: "{{id}} désactivé.",
    enableFailed: "Impossible d'activer `{{id}}` : {{error}}. Lance la même commande sur l'hôte pour voir la sortie complète.",
    disableFailed:
      "Impossible de désactiver `{{id}}` : {{error}}. Lance la même commande sur l'hôte pour voir la sortie complète.",
  },
  skills: {
    none: "Aucun skill connu pour cette conversation pour l'instant. Envoie-lui d'abord un message, puis réessaie : la liste vient de la session elle-même.",
    option: "Lancer /{{skill}}",
    range: "{{first}} à {{last}}",
    available_one: "{{count}} skill disponible dans cette conversation.",
    available_other: "{{count}} skills disponibles dans cette conversation.",
    availableAcross_one: "{{count}} skill disponible dans cette conversation, de A à Z sur {{menus}} menus.",
    availableAcross_other: "{{count}} skills disponibles dans cette conversation, de A à Z sur {{menus}} menus.",
    omitted_one: "Le dernier {{count}} n'a pas tenu ; envoie `/name` comme message pour en lancer un de ceux-là.",
    omitted_other: "Les {{count}} derniers n'ont pas tenu ; envoie `/name` comme message pour en lancer un de ceux-là.",
  },
  purge: {
    notDeletable:
      "`/purge` ne fonctionne que dans un salon textuel d'un serveur où le bot peut gérer les messages. Lance-la dans le salon de la conversation, ou donne au bot Gérer les messages ici.",
    running: "Un tour est en cours ici. Laisse-le finir ou lance `/stop`, puis `/purge`.",
    warning: "Ceci supprime tous les messages de ce salon, les tiens compris. C'est irréversible.",
    warningConversation:
      "La conversation sur l'hôte n'est pas touchée, et ton prochain message reprend à sa suite. Le salon ne récupère pas son historique.",
    confirm: "Les supprimer",
    cancelled: "Salon laissé tel quel.",
    deleting: "Suppression...",
    empty: "Rien à supprimer ; le salon est déjà vide.",
    deleted_one: "{{count}} message supprimé.",
    deleted_other: "{{count}} messages supprimés.",
    slow_one: "{{count}} d'entre eux avait plus de {{days}} jours, ce que Discord ne laisse supprimer qu'un par un.",
    slow_other: "{{count}} d'entre eux avaient plus de {{days}} jours, ce que Discord ne laisse supprimer qu'un par un.",
    failed_one: "{{count}} n'a pas pu être supprimé.",
    failed_other: "{{count}} n'ont pas pu être supprimés.",
    conversationKept: "La conversation elle-même est intacte, et ton prochain message reprend à sa suite.",
    stoppedPartway: "La purge s'est arrêtée en cours de route : {{error}}. Relance `/purge` pour finir.",
  },
};
