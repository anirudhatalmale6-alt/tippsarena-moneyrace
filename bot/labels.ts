/**
 * The short German strings the bot uses for navigation.
 *
 * Everything the operator asked to control lives in message_templates in the
 * database; these are the button labels and one-line notices that sit around
 * them. They are here rather than scattered through the handlers so that "no
 * random English system text" (spec §42) is something you can check by reading
 * one file.
 */
export const L = {
  // menu
  startNow: "🏁 JETZT STARTEN",
  enterCompetition: "🏁 AN WETTBEWERB TEILNEHMEN",
  leaderboard: "🏆 LEADERBOARD",
  myProfile: "👤 MEIN PROFIL",
  myResults: "📊 MEINE ERGEBNISSE",
  invite: "🔗 FREUNDE EINLADEN",
  rules: "📜 REGELN",
  backToMenu: "◀️ ZUM MENÜ",

  // competitions
  pickCompetition: "🏁 Welcher Wettbewerb?",
  noCompetitions: "Gerade läuft kein Wettbewerb. Schau bald wieder vorbei!",
  notFound: "Diesen Wettbewerb gibt es nicht mehr.",
  startPicks: "🎯 TIPPS ABGEBEN",
  reviewPicks: "🎯 TIPPS ANSEHEN / ÄNDERN",
  changePicks: "✏️ TIPPS ÄNDERN",
  completeMissing: "⚠️ FEHLENDE TIPPS ABGEBEN",
  yourPicks: "DEINE TIPPS",

  // giveaways
  enterGiveaway: "🎁 AM GIVEAWAY TEILNEHMEN",
  myEntry: "🏆 MEINE TEILNAHME",
  entered: "Du bist dabei!",
  alreadyEntered: "Du bist bereits dabei.",
  giveawayClosed: "Dieses Giveaway ist bereits beendet.",
  youAreIn: "Du bist dabei.",
  youWon: "Du hast gewonnen! Wir haben dir eine Nachricht geschickt.",
  drawPending: "🔔 Wir informieren dich, sobald der Gewinner feststeht.",
  notEntered: "Du nimmst an diesem Giveaway noch nicht teil.",
  notDrawn: "Teilnahme registriert · Auslosung ausstehend",

  // exact score
  howDoesItEnd: "Wie endet das Spiel?",
  submitScore: "✅ TIPP ABGEBEN",
  exactHit: "EXAKT RICHTIG!",
  rightOutcome: "Richtiges Ergebnis!",
  wrongTip: "Falsch",
  awaitingResult: "Ergebnis steht noch aus",

  // the two rankings, kept apart on purpose
  moneyrace: "MONEYRACE",
  exactScore: "EXACT SCORE",
  ranking: "RANGLISTE",
  whichRanking: "🏆 Welche Rangliste?",

  // predicting
  draw: "Unentschieden",
  back: "◀️ ZURÜCK",
  skip: "ÜBERSPRINGEN ▶️",
  saved: "Gespeichert",
  lockedAlert: "Die Tipps sind bereits geschlossen.",
  matchOf: (index: number, total: number) => `SPIEL ${index} VON ${total}`,

  // membership
  checkUnavailable:
    "Die Prüfung ist gerade nicht möglich. Versuch es in einer Minute noch einmal.",

  // profile / results
  yourProfile: "DEIN PROFIL",
  noResults: "Du hast noch an keinem beendeten Wettbewerb teilgenommen.",
  pendingEvaluation: "Auswertung ausstehend",
  noEntries: "Noch keine Teilnehmer.",

  // invite
  inviteTitle: "DEIN EINLADUNGSLINK",
  inviteBody:
    "Teile diesen Link. Jeder, der über ihn startet, wird dir zugeordnet.",

  // rules
  noRules: "📜 Die Regeln werden gerade überarbeitet.",
};
