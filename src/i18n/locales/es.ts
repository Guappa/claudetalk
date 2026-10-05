import type { Catalog } from "../catalog.ts";

export const es: Catalog = {
  common: {
    nobody: "nadie",
    unknown: "desconocido",
    cancel: "Cancelar",
    nothingRunning: "Aquí no hay nada en marcha.",
    sent: "Enviado `{{prompt}}` a la conversación.",
    noLongerBound:
      "Este canal ya no está vinculado a ninguna conversación, así que no hay dónde ejecutar esto. `/resume` abre una conversación en un canal propio.",
    staleControl:
      "El puente no reconoce ese control; lo más probable es que quede de una versión anterior. Ejecuta el comando otra vez para tener uno nuevo.",
  },
  units: {
    seconds: "{{seconds}} s",
    minutesSeconds: "{{minutes}} min {{seconds}} s",
    tokens_one: "{{count}} token",
    tokens_other: "{{count}} tokens",
    kiloTokens: "{{thousands}}k tokens",
    minutesAgo: "hace {{quantity}} min",
    hoursAgo: "hace {{quantity}} h",
    daysAgo: "hace {{quantity}} d",
  },
  language: {
    current:
      "Idioma del puente: **{{name}}**. Eso cubre lo que dice el puente en sí; Claude responde en el idioma en que le escribas.",
    changed:
      "Idioma del puente: **{{name}}**, a partir de ahora. Eso cubre lo que dice el puente en sí; un turno que ya está en marcha conserva el idioma con el que empezó. Las respuestas de Claude no cambian: responde en el idioma en que le escribas.",
  },
  trailChoice: {
    own: "Esta conversación tiene su propia elección de lo que muestra la traza. `/trail reset:True` hace que vuelva a seguir el valor predeterminado del puente.",
    follows:
      "Esta conversación sigue el valor predeterminado del puente para lo que muestra la traza. `/trail hide:` o `/trail show:` aquí le da una elección propia.",
    everywhere: "El valor predeterminado del puente, para toda conversación que no haya elegido por su cuenta:",
    drawn: "Se muestra: {{kinds}}",
    hidden: "Oculto: {{kinds}}",
    none: "nada",
    stillCounted:
      "Una llamada oculta sigue contando como paso en el encabezado, y una aprobación o una pregunta se sigue pidiendo. Un cambio se nota desde la siguiente llamada a una herramienta, también en un turno que ya está en marcha.",
    everywhereIsOwners:
      "Solo un propietario puede cambiar el valor predeterminado de todas las conversaciones, y no se ha cambiado nada. Quita `everywhere` para elegir en esta conversación, o pide a un propietario que fije el valor predeterminado.",
    kinds: {
      edits: "ediciones y archivos escritos",
      commands: "comandos",
      reads: "lecturas y búsquedas",
      web: "consultas y búsquedas en la web",
      agents: "agentes y skills",
      todos: "listas de tareas",
      other: "otras herramientas",
    },
  },
  access: {
    ownersOnly:
      "`/{{command}}` es de los propietarios. Los operadores manejan el bot; quién más puede usarlo, y qué se ejecuta dentro, lo decide el propietario.",
    none: "No tienes acceso a este puente. Un propietario tiene que dártelo.",
  },
  command: {
    noHandler:
      "`/{{command}}` está registrado en Discord, pero este puente no tiene un manejador para él. Reinicia el puente para que vuelva a registrar sus comandos.",
    failed:
      "`/{{command}}` falló: {{error}}. Inténtalo otra vez; si sigue fallando, el registro del puente en el host tiene los detalles.",
    pressFailed:
      "Esa pulsación falló: {{error}}. Lo que iba a hacer puede haber quedado a medias, así que mira antes de pulsar otra vez; el registro del puente en el host tiene los detalles.",
  },
  binding: {
    unbound: "Este canal todavía no está vinculado a ninguna conversación.",
    notInServer:
      "Las conversaciones solo existen dentro de un servidor, no en un mensaje directo. Ejecuta esto en un canal del servidor para el que está configurado el puente.",
    alreadyOpen: "**{{name}}** ya está abierta en <#{{channelId}}>.",
    bound: "Vinculado a **{{channel}}**.",
    noWorkspace:
      "No tienes un espacio de trabajo desde el que responder. Pide a un propietario que configure `WORKSPACES_ROOT`, o usa `/create` para iniciar una conversación propia.",
  },
  attachments: {
    executable: "`{{name}}`, porque {{extension}} es un formato ejecutable",
    tooLarge: "`{{name}}`, porque supera los {{megabytes}} MB",
    refused:
      "No guardado para este turno: {{files}}. La sesión se ejecuta con los permisos del host, así que un archivo que pudiera ejecutar no vale la comodidad. Ponlo tú en el directorio de trabajo si es ahí donde debe estar.",
    unfetched_one:
      "No se pudo descargar {{names}} de Discord, así que la sesión no lo verá. Los enlaces de archivos de Discord caducan y su CDN a veces se niega; vuelve a enviar el archivo si importa.",
    unfetched_other:
      "No se pudieron descargar {{names}} de Discord, así que la sesión no los verá. Los enlaces de archivos de Discord caducan y su CDN a veces se niega; vuelve a enviar los archivos si importan.",
  },
  outbox: {
    tooLarge: "Demasiado grande para adjuntar, dejado en `{{folder}}`: {{names}}.",
    failed:
      "No se pudo adjuntar lo que hay en `{{folder}}`: {{error}}. Los archivos siguen ahí en el host y el puente vuelve a intentarlo por su cuenta; si sigue fallando, comprueba que el bot pueda adjuntar archivos en este canal.",
    files_one: "{{count}} archivo",
    files_other: "{{count}} archivos",
  },
  context: {
    critical:
      "El contexto está lleno en torno al {{percent}} %. Ejecuta `/compact` pronto, o se compactará solo a mitad de la tarea.",
    approaching: "El contexto está lleno en torno al {{percent}} %. `/context` muestra el desglose, `/compact` libera espacio.",
  },
  trail: {
    working: "**Trabajando** {{elapsed}}",
    workingSteps_one: "**Trabajando** {{elapsed}} · {{count}} paso",
    workingSteps_other: "**Trabajando** {{elapsed}} · {{count}} pasos",
    done: "**Trabajado** {{elapsed}}",
    doneSteps_one: "**Trabajado** {{elapsed}} · {{count}} paso",
    doneSteps_other: "**Trabajado** {{elapsed}} · {{count}} pasos",
    stopped: "**Detenido tras** {{elapsed}}",
    stoppedSteps_one: "**Detenido tras** {{elapsed}} · {{count}} paso",
    stoppedSteps_other: "**Detenido tras** {{elapsed}} · {{count}} pasos",
    failed: "**Fallido tras** {{elapsed}}",
    failedSteps_one: "**Fallido tras** {{elapsed}} · {{count}} paso",
    failedSteps_other: "**Fallido tras** {{elapsed}} · {{count}} pasos",
    started: "**Iniciado**",
    interrupted: "**Interrumpido: el puente se detuvo mientras esto se ejecutaba. Envía un mensaje para continuar.**",
    answerDone: "Hecho.",
    answerDoneNoText: "Hecho, sin texto que mostrar.",
    answerCompacted: "Compactado.",
    answerStopped: "Detenido.",
    compacting: "Compactando la conversación, lo que puede tardar un rato.",
    retryingRefresh: "Otro proceso de Claude Code estaba renovando el inicio de sesión; este turno se reintenta en un minuto.",
    compactingHeading: "**Compactando** {{elapsed}}",
    compactingSteps_one: "**Compactando** {{elapsed}} · {{count}} paso",
    compactingSteps_other: "**Compactando** {{elapsed}} · {{count}} pasos",
    compactFailed: "La compactación falló: {{error}}. La conversación sigue como estaba; `/compact` lo intenta de nuevo.",
    agentDone: "**{{name}}** terminado · {{elapsed}}",
    agentFailed: "**{{name}}** fallido · {{elapsed}}",
    agentStopped: "**{{name}}** detenido · {{elapsed}}",
    compactedAuto:
      "Compactado (automático): de {{before, number}} a {{after, number}} tokens, {{dropped, number}} descartados en total, {{seconds}} s.",
    compactedManual:
      "Compactado (manual): de {{before, number}} a {{after, number}} tokens, {{dropped, number}} descartados en total, {{seconds}} s.",
    moreLines_one: "... {{count}} línea más",
    moreLines_other: "... {{count}} líneas más",
    written_one: "{{path}} ({{count}} línea)",
    written_other: "{{path}} ({{count}} líneas)",
  },
  tools: {
    read: "**Lee** {{path}}",
    notebook: "**Notebook** {{path}}",
    find: "**Busca archivos** {{pattern}} en {{path}}",
    findAnywhere: "**Busca archivos** {{pattern}}",
    search: "**Busca** {{pattern}} en {{path}}",
    searchAnywhere: "**Busca** {{pattern}}",
    fetch: "**Descarga** {{url}}",
    webSearch: "**Búsqueda web** {{query}}",
    toolSearch: "**Búsqueda de herramientas** {{query}}",
    agent: "**Agente** {{description}}",
    skill: "**Skill** /{{name}}",
    todos_one: "**Pendientes** · {{count}} elemento",
    todos_other: "**Pendientes** · {{count}} elementos",
    server: "**{{server}}** {{tool}}",
    other: "**{{name}}**",
  },
  turn: {
    draining:
      "El puente se está apagando y no acepta nada nuevo; antes deja terminar los turnos en marcha, lo que puede tardar un rato. Envía esto otra vez cuando haya vuelto.",
    failed: "El turno falló.\n```\n{{error}}\n```",
    checkFailed:
      "Tu mensaje no se envió a Claude: la comprobación previa al turno falló con {{error}}. Prueba a enviarlo otra vez; si sigue fallando, el registro del puente en el host tiene los detalles.",
    heldByBackgroundAgent:
      "Esa conversación se está ejecutando como agente en segundo plano (`{{shortId}}`). Ejecuta `/takeover` aquí para detenerlo y continuar, o `claude attach {{shortId}}` en el host.",
    openInTerminalIdle:
      "Esa conversación está abierta en una terminal del host (pid {{pid}}, {{cwd}}), donde no hay nada en marcha. Ejecuta `/takeover` aquí para cerrarla allí y continuar, o cierra esa terminal tú mismo.",
    openInTerminalBusy:
      "Esa conversación está abierta en una terminal del host (pid {{pid}}, {{cwd}}), y allí hay un turno en marcha. Deja que termine o detenlo allí, y vuelve a intentarlo.",
    openInTerminal:
      "Esa conversación está abierta en una terminal del host (pid {{pid}}, {{cwd}}). Cierra esa terminal o cámbiala a otra conversación, y vuelve a intentarlo.",
    conversationGone:
      "La conversación de este canal se reinició o se desvinculó mientras tu mensaje iba de camino, así que no se ejecutó. Envíalo otra vez.",
    turnLimit:
      "El turno alcanzó el límite que `CLAUDE_MAX_TURNS` pone a las veces que uno puede volver al modelo, y Claude Code lo detuvo ahí. Lo que hizo se conserva. Envía un mensaje para que continúe, o sube el límite en `.env` en el host y reinicia el puente.",
    unknownSession:
      "Claude Code no tiene ninguna conversación con el id de sesión al que está vinculado este canal: su transcripción se eliminó del host, o su primer turno nunca llegó lo bastante lejos como para escribir una. Volver a enviar el mensaje no sirve. Ejecuta `/clear` para empezar una conversación nueva en este canal.",
    errors: {
      stopped: "El turno se detuvo.",
      orphanTwice:
        "Claude Code informó dos veces seguidas de un comando en segundo plano que quedó de un turno anterior, y una sesión que empieza informando de uno rechaza todas las llamadas a herramientas. Envía el mensaje otra vez; normalmente se resuelve al siguiente intento.",
      refreshTwice:
        "Claude Code no pudo renovar el inicio de sesión dos veces seguidas: otro de sus procesos tenía la renovación, o murió con ella. Inténtalo de nuevo en un minuto; si sigue pasando, cierra otros procesos de Claude Code en el host o vuelve a iniciar sesión allí.",
      ended: "El turno terminó como {{subtype}}. Prueba a enviar tu mensaje otra vez.",
      unexplained: "Claude Code terminó el turno con un error y no dio ningún motivo. Prueba a enviar tu mensaje otra vez.",
      endedSaying: "El turno terminó como {{subtype}}.\n{{text}} Prueba a enviar tu mensaje otra vez.",
      couldNotRun:
        "Claude Code no pudo ejecutar este turno: {{error}}. Comprueba que esté instalado y con la sesión iniciada en el host, y vuelve a intentarlo.",
    },
  },
  fold: {
    handedOver:
      "Entregado al turno en marcha. Claude lo retoma en su siguiente paso, o justo después de la respuesta de este turno si no queda ningún paso.",
    takenUp: "Retomado por el turno en marcha.",
    neverTaken: "El turno terminó antes de retomar esto. Envíalo otra vez.",
    sendNow: "Enviar ahora",
    sent: "Enviado ahora. El paso en el que estaba Claude se cortó para que pudiera leer tu mensaje, y sigue desde ahí. Los agentes y comandos en segundo plano que tenía en marcha siguen en marcha; el que estaba esperando se detuvo.",
    nothingWaiting: "No hay nada esperando: el turno en marcha ya ha retomado tu mensaje.",
    notRunning: "Aquí ya no hay ningún turno en marcha, así que no hay nada que interrumpir.",
    notInterrupted: "No se pudo interrumpir el turno en marcha, así que tu mensaje sigue esperando a su siguiente paso.",
    sendAnyway: "Enviar ahora de todos modos",
    waitForIt: "Esperar",
    cutsLongCall:
      "Claude está dentro de {{call}}, en marcha desde hace {{elapsed}}. Enviar ahora lo interrumpe y descarta lo que lleva hecho. Si esperas, tu mensaje se entrega en cuanto termine.",
    waiting: "Tu mensaje espera, y Claude lo lee en cuanto termine la llamada en curso.",
    waitOver:
      "Ese turno ya terminó, así que no queda nada que esperar: tu mensaje se respondió en él, o se ejecuta a continuación.",
  },
  queue: {
    behind_one: "En cola detrás del turno que sigue en marcha.",
    behind_other: "En cola detrás de {{count}} mensajes.",
    runningAlone: "Hay un turno en marcha, sin nada en cola detrás.",
    runningWith_one: "Hay un turno en marcha, con {{count}} mensaje en cola detrás.",
    runningWith_other: "Hay un turno en marcha, con {{count}} mensajes en cola detrás.",
    full: "Esta conversación ya tiene {{limit}} mensajes: uno en marcha y {{queued}} en cola detrás. Deja que se ponga al día, ejecuta `/stop` para terminar el que está en curso y dejar que empiece el siguiente, o `/stop all:true` para descartar también la cola.",
  },
  restart: {
    unsupervised:
      "No se reinició: este puente se inició a mano, o lo inició un servicio instalado antes de que pudiera reiniciarse solo, así que nada volvería a iniciarlo. Ejecuta otra vez el instalador de inicio automático del README, o detenlo e inícialo en el host.",
    broken:
      "No se reinició: el código del host no arrancaría, así que el puente sigue funcionando como está. Corrige lo que indica y vuelve a pedirlo.\n```\n{{error}}\n```",
    checkTimedOut:
      "No se reinició: comprobar que el código del host arrancaría llevó más de un minuto y se abandonó. El puente sigue funcionando como está; el registro del host puede decir a qué esperaba.",
    now: "Reiniciando ahora. El puente lo dirá aquí cuando haya vuelto.",
    afterTurns_one:
      "Se reiniciará en cuanto termine el {{count}} turno en marcha y no haya nada más en marcha. Hasta entonces el puente funciona como siempre, y lo dirá aquí cuando haya vuelto.",
    afterTurns_other:
      "Se reiniciará en cuanto terminen los {{count}} turnos en marcha y no haya nada más en marcha. Hasta entonces el puente funciona como siempre, y lo dirá aquí cuando haya vuelto.",
    back: "El puente ha vuelto tras su reinicio, en la v{{version}}.",
  },
  update: {
    out_one: "Ha salido la **v{{version}}** del puente, una versión por delante de la v{{current}} que funciona aquí.",
    out_other: "Ha salido la **v{{version}}** del puente, {{count}} versiones por delante de la v{{current}} que funciona aquí.",
    more_one: "... y {{count}} cambio más",
    more_other: "... y {{count}} cambios más",
    how: "Todo lo que hay entre ambas: <{{url}}>. Para actualizar, descarga el código nuevo en el host y reinicia el puente, o descarga la imagen nueva. Esto se dice una vez por versión, y como mucho una vez por semana.",
  },
  stop: {
    button: "Detener",
    allButton: "Detener todo",
    agentsButton: "Detener agentes",
    cloudTaskButton: "Detener tarea en la nube",
    outlives:
      "Se mata todo el árbol de procesos del turno; en Windows, un comando que se hubiera desprendido de ese árbol puede sobrevivirle, así que revisa el host si era algo largo.",
    noAgents: "Aquí no hay ningún agente ni tarea en la nube en marcha, así que no había nada que detener.",
    agentsAsked_one:
      "Se pidió a {{count}} tarea que se detenga. El turno en sí continúa, y a Claude se le dice que se detuvo; pulsa **Detener** para terminar también el turno.",
    agentsAsked_other:
      "Se pidió a {{count}} tareas que se detengan. El turno en sí continúa, y a Claude se le dice que se detuvieron; pulsa **Detener** para terminar también el turno.",
    nothingYet_one: "Todavía no hay nada en marcha; {{count}} mensaje en cola aquí se ejecutará cuando le toque.",
    nothingYet_other: "Todavía no hay nada en marcha; {{count}} mensajes en cola aquí se ejecutarán cuando les toque.",
    turn: "Este turno se detuvo. No había nada en cola, así que Claude no hace nada más aquí hasta tu próximo mensaje. $t(stop.outlives)",
    turnThenQueue_one: "Este turno se detuvo. El {{count}} mensaje en cola detrás va a continuación. $t(stop.outlives)",
    turnThenQueue_other: "Este turno se detuvo. Los {{count}} mensajes en cola detrás van a continuación. $t(stop.outlives)",
    queueOnly_one: "No había nada en marcha, pero el mensaje en cola aquí se descartó.",
    queueOnly_other: "No había nada en marcha, pero los {{count}} mensajes en cola aquí se descartaron.",
    all: "Detenido. Claude no hace nada más aquí hasta tu próximo mensaje. $t(stop.outlives)",
    allWithQueue_one:
      "Detenido. El mensaje en cola detrás también se descartó. Claude no hace nada más aquí hasta tu próximo mensaje. $t(stop.outlives)",
    allWithQueue_other:
      "Detenido. Los {{count}} mensajes en cola detrás también se descartaron. Claude no hace nada más aquí hasta tu próximo mensaje. $t(stop.outlives)",
  },
  agents: {
    title: "Agentes: {{asked}}",
    titleBare: "Agentes",
    tally: "**Agentes** · {{tally}}",
    tallyRunning: "{{quantity}} en marcha",
    tallyDone: "{{quantity}} hechos",
    tallyFailed: "{{quantity}} fallidos",
    tallyStopped: "{{quantity}} detenidos",
    more: "y {{quantity}} más",
    tools_one: "{{count}} herramienta",
    tools_other: "{{count}} herramientas",
    running: "en marcha",
    waiting: "esperando a un comando en segundo plano",
    completed: "hecho en {{elapsed}}",
    failed: "fallido tras {{elapsed}}",
    stopped: "detenido tras {{elapsed}}",
  },
  approvals: {
    request: "**{{tool}}** quiere ejecutarse. ¿Lo apruebas?\n```\n{{detail}}\n```",
    deleteOutside:
      "Claude quiere borrar algo fuera de la carpeta de esta conversación, lo que el puente rechaza salvo que un propietario lo permita. ¿Permitir este único comando?\n```\n{{detail}}\n```",
    writeOutside:
      "Claude quiere escribir un archivo fuera de la carpeta de esta conversación, lo que el puente rechaza salvo que un propietario lo permita. ¿Permitir esta única escritura?\n```\n{{detail}}\n```",
    approveOnce: "Aprobar una vez",
    deny: "Denegar",
    approveRest: "Aprobar el resto de este turno",
    approvedOnce: "Aprobado una vez.",
    approvedRest: "Aprobado para el resto de este turno.",
    approvedRestQuiet: "Aprobado, y el resto de este turno no volverá a preguntar.",
    denied: "Denegado desde Discord.",
    ended: "El turno terminó antes de que esto tuviera respuesta.",
    expired: "Sin respuesta en {{minutes}} minutos, así que se denegó.",
    stale: "Esa solicitud ya está respondida, ha caducado o es de antes de un reinicio.",
    ownersOnly: "Solo un propietario de este puente puede responder a una solicitud de permiso.",
  },
  questions: {
    heading_one: "Claude tiene una pregunta.",
    heading_other: "Claude tiene {{count}} preguntas.",
    question: "**{{number}}. {{header}}** {{question}}",
    questionPickAny: "**{{number}}. {{header}}** {{question}} Elige todas las que correspondan.",
    placeholder: "Pregunta {{number}}",
    unnamedOption: "(en blanco)",
    other: "Otra...",
    otherDescription: "Escribe una respuesta propia",
    ownAnswerTitle: "Tu propia respuesta a la pregunta {{number}}",
    ownAnswerLabel: "Respuesta",
    submit: "Enviar",
    skip: "Omitir",
    answered: "Respondido: {{summary}}.",
    skipped: "Omitido: a Claude se le dice que continúe según su propio criterio y que diga qué ha supuesto.",
    expired: "Sin respuesta en {{minutes}} minutos, así que Claude continúa sin ella.",
    ended: "El turno terminó antes de que esto tuviera respuesta.",
    stale: "Esas preguntas ya están respondidas, han caducado o son de antes de un reinicio.",
    unanswered: "La pregunta {{number}} todavía no tiene respuesta. Elige una, o pulsa Omitir para no enviar ninguna.",
  },
  sync: {
    fromYou: "**Tú** · terminal · {{clock}}",
    fromClaude: "**Claude** · terminal · {{clock}}",
    drift_one:
      "{{count}} mensaje ocurrió en esta conversación fuera de Discord desde la última vez que estuviste aquí. Fue {{ago}}, {{when}}. Ejecuta `/sync` para verlo.",
    drift_other:
      "{{count}} mensajes ocurrieron en esta conversación fuera de Discord desde la última vez que estuviste aquí. El último fue {{ago}}, {{when}}. Ejecuta `/sync` para verlos.",
    running:
      "Ahora mismo hay un turno en marcha aquí, y lo que dice va de camino a este canal. Ejecuta `/sync` otra vez cuando haya terminado.",
    nothingNew: "Nada nuevo: no ha ocurrido nada en esta conversación fuera de Discord desde la última vez que estuviste aquí.",
    all_one: "{{count}} mensaje de fuera de Discord:",
    all_other: "{{count}} mensajes de fuera de Discord:",
    latest_one: "{{count}} mensaje de fuera de Discord. Donde lo dejaste, con todos ellos en el archivo:",
    latest_other: "{{count}} mensajes de fuera de Discord. Donde lo dejaste, con todos ellos en el archivo:",
    leftOff: "Donde lo dejaste:",
    countedRecent:
      "Eso cuenta solo lo más reciente: el puente relee los últimos {{megabytes}} MB de una transcripción, y antes de eso ocurrió más de lo que cabe ahí.",
  },
  ask: {
    withContext_one: "Preguntando con el último {{count}} mensaje como contexto.",
    withContext_other: "Preguntando con los últimos {{count}} mensajes como contexto.",
    noContext: "Preguntando sin contexto adicional.",
  },
  category: {
    full: "**{{name}}** ya tiene {{limit}} canales, que es todo lo que permite Discord. Usa otra categoría, o saca algo de esa primero.",
    notMovable:
      "Solo se puede mover un canal de texto dentro de un servidor. Ejecuta `/category` en el canal propio de la conversación.",
    current: "Esta conversación está en **{{name}}**.",
    none: "Esta conversación no está en ninguna categoría. Pasa un nombre para ponerla en una.",
    moved: "Movida a **{{name}}**.",
    moveFailed:
      "No se pudo mover a **{{name}}**: {{error}}. El bot necesita Gestionar canales, y una categoría admite {{limit}} canales.",
  },
  clear: {
    running: "Hay un turno en marcha aquí. Deja que termine o usa `/stop`, y después `/clear`.",
    confirm:
      "Esto reinicia este canal con una conversación nueva en `{{cwd}}`: la misma carpeta, modelo, esfuerzo y miembros, pero sin nada de lo dicho en esta. La conversación actual se queda en el host, listada por `/sessions`, y `/resume` con su id de sesión la abre en un canal propio. Los mensajes del canal se quedan; `/purge` los elimina.",
    startOver: "Empezar de nuevo",
    unbound: "Este canal no está vinculado a ninguna conversación, así que no hay nada que limpiar.",
    stale:
      "Esto se ofreció para una conversación que este canal ya no tiene, así que no se reinició nada. Ejecuta `/clear` otra vez si esta debe reiniciarse.",
    done: "Empezado de nuevo. Este canal tiene ahora una conversación nueva en `{{cwd}}`; la anterior sigue en el host como `{{sessionId}}`.",
    cancelled: "Se dejó como estaba. La conversación continúa igual.",
  },
  unbind: {
    unbound: "Este canal no está vinculado a ninguna conversación, así que no hay nada que desvincular.",
    running: "Hay un turno en marcha aquí. Deja que termine o usa `/stop`, y después `/unbind`.",
    done: "Desvinculado. La conversación sigue en el host y se puede retomar con `/resume`. El canal ahora es solo un canal; ¿lo eliminas o lo conservas por el historial?",
    doneShared:
      "Desvinculado. La conversación sigue en el host y se puede retomar con `/resume`. Este canal solo respondía cuando se mencionaba al bot, y se queda como está.",
    boundAgain:
      "Este canal se ha vuelto a vincular a una conversación desde entonces, así que no se eliminó. Ejecuta `/unbind` aquí otra vez si debe irse.",
    deleteChannel: "Eliminar el canal",
    keep: "Conservarlo",
    kept: "Conservado. El canal se queda como está, con su historial.",
    notDeletable: "Este canal no se puede eliminar desde aquí. Quítalo en la configuración del canal de Discord.",
    deleting: "Eliminando el canal...",
    deleteFailed:
      "No se pudo eliminar el canal: {{error}}. El bot necesita Gestionar canales; quítalo en la configuración del canal de Discord.",
  },
  takeover: {
    closedTerminal:
      "Se cerró Claude Code en la terminal del host (pid {{pid}}). Para abrir la conversación allí otra vez, ejecuta `claude --resume {{sessionId}}` en el host.",
    free: "Esta conversación ya está libre: envía tu mensaje.",
    heldRuns: "Tu mensaje de antes se ejecuta ahora.",
    notClosed:
      "Claude Code en la terminal del host (pid {{pid}}) no se cerró en unos segundos, así que no se tomó el control de nada. Cierra esa terminal en el host y vuelve a intentarlo.",
    running: "Ahora mismo hay un turno en marcha aquí. Usa `/stop` para terminarlo.",
    nothingHolding: "Nada retiene esta conversación. Simplemente envía un mensaje.",
    stopped: "Agente en segundo plano `{{shortId}}` detenido.",
  },
  create: {
    topic: 'Conversación de Claude Code "{{name}}" en {{cwd}}',
    channelFailed:
      "No se pudo crear el canal: {{error}}. El bot necesita Gestionar canales, Gestionar roles y Gestionar mensajes en este servidor; Gestionar roles es lo que le permite hacer el canal privado para ti.",
    ownersOnlyHere:
      "Solo un propietario puede crear conversaciones aquí. Configura WORKSPACES_ROOT para dar a los demás operadores un sitio propio donde trabajar.",
    folderFailed:
      "No se pudo usar `{{cwd}}` como directorio de trabajo: {{error}}. Comprueba que la ruta esté en algún sitio donde el puente pueda escribir, o pasa una carpeta existente como `project`.",
    categoryFailed: "No se pudo usar la categoría **{{name}}**: {{error}}. El bot necesita Gestionar canales para crear una.",
    done: "Creado {{channel}} para **{{name}}** en `{{cwd}}`.",
    resumeButton: "Retomar {{name}} ({{age}})",
    startNew: "Empezar una nueva",
    existing_one: "`{{cwd}}` ya tiene {{count}} conversación. ¿Retomas una, o empiezas otra al lado?",
    existing_other: "`{{cwd}}` ya tiene {{count}} conversaciones. ¿Retomas una, o empiezas otra al lado?",
    existingMore_one:
      "`{{cwd}}` ya tiene {{count}} conversación ({{hidden}} más antiguas no mostradas). ¿Retomas una, o empiezas otra al lado?",
    existingMore_other:
      "`{{cwd}}` ya tiene {{count}} conversaciones ({{hidden}} más antiguas no mostradas). ¿Retomas una, o empiezas otra al lado?",
    cancelled: "Se dejó como estaba. No se creó nada.",
    tooOld: "Ese `/create` es demasiado antiguo para actuar ahora. Ejecútalo otra vez.",
    gone: "Esa conversación ya no está en el host: su transcripción se eliminó o se movió. Ejecuta `/create` otra vez para empezar una nueva.",
  },
  fork: {
    unbound: "Este canal no está vinculado a ninguna conversación, así que no hay nada que ramificar.",
    unnamed: "conversación",
    branching: "Ramificando en {{channel}}...",
    notStarted:
      "No se ramificó nada: el primer turno de la rama no arrancó, y el canal creado para ella se volvió a eliminar. Eso ocurre cuando esta conversación está abierta en una terminal o retenida por un agente en segundo plano, cuando su cola está llena o se descartó, o cuando el puente se está apagando. Ejecuta `/fork` otra vez cuando esté libre.",
    notBound:
      "Se creó {{channel}}, pero el primer turno de la rama terminó sin que Claude Code informara de un id de sesión nuevo, así que ese canal no está vinculado; lo que dio de sí el turno se muestra ahí. Si la rama sí aparece en `/sessions`, `/resume` la abre en un canal propio, y {{channel}} se puede eliminar.",
    done: "**{{source}}** ramificada en {{channel}} como **{{name}}**. Este canal queda intacto.",
  },
  resume: {
    ambiguous: '"{{name}}" es ambiguo. ¿Querías decir: {{candidates}}?',
    andMore: "{{candidates}} y {{count}} más",
    notFound: 'No hay ninguna conversación llamada "{{name}}". Usa `/sessions` para ver qué existe.',
    noFolder:
      'Se encontró "{{name}}", pero no se pudo leer su directorio de trabajo de la transcripción, así que no se puede retomar.',
    opened: "Abierto {{channel}} para **{{name}}** en `{{cwd}}`.",
    openedPastOlder_one:
      "Abierto {{channel}} para **{{name}}** en `{{cwd}}` (se saltó {{count}} conversación más antigua con el mismo nombre).",
    openedPastOlder_other:
      "Abierto {{channel}} para **{{name}}** en `{{cwd}}` (se saltaron {{count}} conversaciones más antiguas con el mismo nombre).",
  },
  sessions: {
    title: "Conversaciones en el host",
    titleMatching: 'Conversaciones que coinciden con "{{filter}}"',
    none: "Todavía no se encontró ninguna conversación. Empieza una con `/create <name>`.",
    hidden_one: "{{count}} conversación en la carpeta temporal queda fuera. Pasa un filtro para incluirla.",
    hidden_other: "{{count}} conversaciones en la carpeta temporal quedan fuera. Pasa un filtro para incluirlas.",
    older: "+{{older}} más antiguas",
    live: "activa ({{kind}}, {{status}})",
    starting: "iniciando",
  },
  members: {
    runs: "Se ejecuta en `{{cwd}}` como el usuario del host, con acceso total a la máquina.",
    seenByNobody: "Nadie más puede verla.",
    seenBy_one: "{{count}} persona más puede verla.",
    seenBy_other: "{{count}} personas más pueden verla.",
    visibilityFailed:
      "El acceso quedó registrado, pero no se pudo cambiar la visibilidad del canal: {{error}}. El bot necesita Gestionar roles para eso.",
    inviteBot: "No se puede invitar a un bot a una conversación; elige a una persona.",
    alreadyIn: "{{user}} ya tiene acceso a esta conversación.",
    invited: "{{user}} ya puede ver esta conversación.",
    inviteWarning:
      "Esto le permite **leer** el canal, incluido todo lo que ya se ha dicho aquí. No le permite usar el bot: los mensajes y comandos de quien no sea operador se ignoran. `/operator add` es lo que entrega la máquina.",
    notMember: "{{user}} no es miembro de esta conversación.",
    removed: "{{user}} eliminado.",
    sharedChannel:
      "No se cambió nada. Este canal ya existía antes que la conversación, así que quién puede verlo se define en la propia configuración del canal de Discord, no en el puente. `/invite` y `/uninvite` funcionan en un canal creado por `/create`, `/resume` o `/fork`.",
    summary: "Propietario: {{owner}}\nPueden verla: {{watchers}}",
  },
  operators: {
    title: "Quién puede usar este puente",
    ownersFixed: "Los propietarios se definen en el host y no se pueden cambiar aquí.",
    owners: "Propietarios",
    operators: "Operadores",
    bot: "Un bot no puede ser operador; elige a una persona.",
    isOwner:
      "{{user}} es propietario, definido en `DISCORD_OWNER_IDS` en el host. Eso está por encima de operador y no se puede cambiar desde Discord.",
    added:
      "{{user}} es operador a partir de ahora. **Puede ejecutar cualquier cosa en esta máquina**, como el usuario del host, con sus credenciales y su plan de Claude.",
    already: "{{user}} ya es operador.",
    removed: "{{user}} ya no es operador. Las conversaciones que ya empezó siguen vinculadas.",
    notOperator: "{{user}} no es operador.",
  },
  run: {
    noListYet:
      "Los comandos de esta conversación todavía no se conocen: se aprenden la primera vez que se ejecuta un turno en su carpeta. Envía un mensaje aquí primero, y después `/run` los irá listando mientras escribes.",
    noListChoice: "Todavía no hay lista de comandos: envía un mensaje aquí primero, y vuelve a intentarlo",
    notAName: "`{{command}}` no es un nombre de comando. Elige uno de la lista que `/run` ofrece mientras escribes.",
    unknown:
      "`/{{command}}` no es un comando que tenga esta conversación. Elige uno de la lista que `/run` ofrece mientras escribes; un plugin instalado desde el último turno aquí aparece después del siguiente.",
    confirm: "¿Ejecutar esto en la conversación?",
    takes: "Acepta: `{{hint}}`",
    nothingStarts: "No empieza nada hasta que pulses Ejecutar.",
    runButton: "Ejecutar",
    unbound: "Este canal no está vinculado a ninguna conversación, así que no hay dónde ejecutar un comando.",
    cancelled: "Se dejó como estaba. No se ejecutó nada.",
    tooOld: "Ese `/run` es demasiado antiguo para actuar ahora. Ejecútalo otra vez.",
  },
  typed: {
    clear:
      "`/clear` escrito como mensaje iniciaría una sesión que este canal no puede ver. Usa el comando `/clear` propio de este bot, que reinicia la conversación en este canal, o `/purge` para eliminar los mensajes del canal.",
    bridgeOwned:
      "`/{{command}}` se aplica a un proceso, y cada turno aquí ejecuta uno nuevo, así que informaría de éxito y después revertiría. Usa en su lugar el comando `/{{command}}` propio de este bot, que guarda el valor para esta conversación y lo aplica en cada turno.",
    terminalOnly: "`/{{command}}` solo se ejecuta en una terminal interactiva. Ejecútalo en la máquina host.",
    billedReview: "Inicia una revisión en la nube, que puede facturarse aparte de tu plan.",
    asksFirst:
      "`{{typed}}` no se ejecutó. {{caution}} En una terminal, Claude Code pregunta antes de empezar, pero un comando escrito aquí como mensaje empezaría sin preguntar. Usa `{{viaRun}}` en su lugar: muestra exactamente qué se va a ejecutar y espera a que pulses Ejecutar.",
  },
  settings: {
    current: "{{setting}} está en `{{value}}` para esta conversación.",
    notOverridden: "{{setting}} no está sobrescrito aquí, así que los turnos se ejecutan con {{fallback}}.",
    changed:
      "{{setting}} puesto en `{{value}}`. Se aplica a partir del siguiente turno; un turno que ya está en marcha conserva aquello con lo que empezó.",
    hostDefault: "`{{value}}` (predeterminado del host)",
    claudeDefault: "el predeterminado de Claude Code",
    cleared: "{{setting}} queda sin valor propio en esta conversación, así que desde el siguiente turno se usa {{fallback}}.",
    defaultChoice: "default · quitar el valor propio y seguir al host",
    unknownModel:
      "`{{value}}` no es un modelo que Claude Code ofrezca en este host, así que todo turno puesto en él fallaría. No se ha cambiado nada. Elige una de las sugerencias que `/model` muestra al escribir: {{offered}}.",
  },
  whoami: {
    title: "Este canal",
    resumeHint: "Retómala en el host sin pasar por el selector:",
    directory: "Directorio",
    model: "Modelo",
    effort: "Esfuerzo",
    context: "Contexto",
    contextStanding: "{{percent}} % de {{ceiling}}",
    contextUnmeasured: "Aún sin medir. El próximo turno aquí lo mide.",
    version: "puente v{{version}}",
    newerVersion: "ya salió la v{{version}}",
    claude: "Claude Code {{bundled}}",
    claudeDiffers: "Claude Code {{bundled}} para los turnos, {{host}} en el host",
  },
  usage: {
    notReported: "Uso del plan: todavía sin informar. Claude Code lo envía con cada turno, así que aparece después del primero.",
    plan: "Uso del plan: {{windows}} (informado {{when}})",
    window: "{{label}} {{percent}} % usado, se reinicia {{when}}",
    windowReset: "{{label}} reiniciada {{when}}, sin ninguna cifra informada desde entonces",
    fiveHour: "ventana de 5 horas",
    weekAll: "semana, todos los modelos",
    weekOpus: "semana, Opus",
    weekSonnet: "semana, Sonnet",
  },
  spend: {
    underCent: "menos de $0,01",
    mineNone: "Esta conversación: nada todavía.",
    mine_one: "Esta conversación: {{count}} turno aquí · {{input}} de entrada, {{output}} de salida, {{cached}} en caché",
    mine_other: "Esta conversación: {{count}} turnos aquí · {{input}} de entrada, {{output}} de salida, {{cached}} en caché",
    allNone: "Todas las conversaciones tocadas: nada todavía.",
    all_one:
      "Todas las conversaciones tocadas: {{count}} turno aquí · {{input}} de entrada, {{output}} de salida, {{cached}} en caché",
    all_other:
      "Todas las conversaciones tocadas: {{count}} turnos aquí · {{input}} de entrada, {{output}} de salida, {{cached}} en caché",
    cost: "Coste equivalente en API, por el que una suscripción no factura: {{mine}} esta conversación en toda su vida, {{all}} en todas las conversaciones tocadas.",
    costWithLast:
      "Coste equivalente en API, por el que una suscripción no factura: {{mine}} esta conversación en toda su vida (último turno {{last}}), {{all}} en todas las conversaciones tocadas.",
    footnote:
      "El uso del plan es de toda la cuenta. Los turnos y los tokens se cuentan desde que el puente arrancó {{since}}; un reinicio los pone a cero, y los turnos ejecutados en una terminal nunca se cuentan. Los tokens son los de la sesión en sí y no incluyen lo que usaron sus agentes; el coste sí los incluye.",
  },
  plugins: {
    none: "`claude plugin list --json` no informó de ningún plugin. Si esperabas alguno, comprueba que Claude Code esté en el PATH de este proceso.",
    choose: "Elige un plugin",
    summary_one: "{{count}} plugin instalado, {{enabled}} activado.",
    summary_other: "{{count}} plugins instalados, {{enabled}} activados.",
    optionEnabled: "{{version}} · activado",
    optionDisabled: "{{version}} · desactivado",
    enable: "Activar",
    disable: "Desactivar",
    enabled: "{{id}} activado.",
    disabled: "{{id}} desactivado.",
    enableFailed: "No se pudo activar `{{id}}`: {{error}}. Ejecuta el mismo comando en el host para ver la salida completa.",
    disableFailed: "No se pudo desactivar `{{id}}`: {{error}}. Ejecuta el mismo comando en el host para ver la salida completa.",
  },
  mcp: {
    none: "Claude Code no informa de ningún servidor MCP para la carpeta de esta conversación.",
    choose: "Elige un servidor",
    summary_one: "{{count}} servidor MCP para la carpeta de esta conversación; conectados: {{connected}}.",
    summary_other: "{{count}} servidores MCP para la carpeta de esta conversación; conectados: {{connected}}.",
    stateConnected_one: "conectado, {{count}} herramienta",
    stateConnected_other: "conectado, {{count}} herramientas",
    stateFailed: "falló",
    stateNeedsAuth: "necesita iniciar sesión",
    statePending: "aún conectando",
    stateDisabled: "apagado",
    failedBecause:
      "Claude Code no pudo conectarse: {{error}}. Reconectar lo intenta de nuevo; si sigue fallando, hay que mirar la configuración del servidor en el host.",
    signInOnHost:
      "Está esperando un inicio de sesión, que no se puede dar desde Discord. Ejecuta `/mcp` en Claude Code en el host y autorízalo allí; un conector de claude.ai se autoriza en los ajustes de conectores de claude.ai.",
    offForFolder: "Está apagado para esta carpeta, así que ninguna sesión aquí lo carga.",
    stillConnecting: "Claude Code todavía se está conectando. Ejecuta `/mcp` otra vez dentro de un momento.",
    switchOn: "Encender",
    switchOff: "Apagar",
    reconnect: "Reconectar",
    appliesFromNextTurn: "Vale para la carpeta: el próximo turno aquí lo ve, y también una terminal abierta allí.",
    gone: "Claude Code ya no informa de ningún servidor llamado `{{name}}` para esta carpeta. Ejecuta `/mcp` otra vez para ver la lista actual.",
    changeFailed: "No se pudo cambiar `{{name}}`: {{error}}. Ejecuta `/mcp` en Claude Code en el host para ver qué dice allí.",
    unreachable:
      "No se pudo preguntar a Claude Code por sus servidores MCP: {{error}}. Comprueba que Claude Code está instalado y con sesión iniciada en el host, y ejecuta `/mcp` otra vez.",
  },
  skills: {
    none: "Todavía no se conocen skills para esta conversación. Envíale un mensaje primero, y vuelve a intentarlo: la lista viene de la propia sesión.",
    option: "Ejecutar /{{skill}}",
    range: "{{first}} a {{last}}",
    available_one: "{{count}} skill disponible en esta conversación.",
    available_other: "{{count}} skills disponibles en esta conversación.",
    availableAcross_one: "{{count}} skill disponible en esta conversación, de la A a la Z en {{menus}} menús.",
    availableAcross_other: "{{count}} skills disponibles en esta conversación, de la A a la Z en {{menus}} menús.",
    omitted_one: "El último {{count}} no cupo; envía `/name` como mensaje para ejecutar uno de esos.",
    omitted_other: "Los últimos {{count}} no cupieron; envía `/name` como mensaje para ejecutar uno de esos.",
  },
  purge: {
    notDeletable:
      "`/purge` solo funciona en un canal de texto de un servidor donde el bot pueda gestionar mensajes. Ejecútalo en el canal de la conversación, o dale al bot Gestionar mensajes aquí.",
    running: "Hay un turno en marcha aquí. Deja que termine o usa `/stop`, y después `/purge`.",
    warning: "Esto elimina todos los mensajes de este canal, incluidos los tuyos. No se puede deshacer.",
    warningConversation:
      "La conversación en el host no se toca, y tu próximo mensaje continúa desde ella. El canal no recupera su historial.",
    confirm: "Eliminarlos",
    cancelled: "El canal se dejó como estaba.",
    deleting: "Eliminando...",
    empty: "Nada que eliminar; el canal ya está vacío.",
    deleted_one: "Eliminado {{count}} mensaje.",
    deleted_other: "Eliminados {{count}} mensajes.",
    slow_one: "{{count}} de ellos tenía más de {{days}} días, y Discord solo deja eliminar esos de uno en uno.",
    slow_other: "{{count}} de ellos tenían más de {{days}} días, y Discord solo deja eliminar esos de uno en uno.",
    failed_one: "{{count}} no se pudo eliminar.",
    failed_other: "{{count}} no se pudieron eliminar.",
    conversationKept: "La conversación en sí queda intacta, y tu próximo mensaje continúa desde ella.",
    stoppedPartway: "La purga se detuvo a medias: {{error}}. Ejecuta `/purge` otra vez para terminar.",
  },
};
