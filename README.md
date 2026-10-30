# WChess

WChess is a browser chess club with online presence, friend requests, hosted two-player matches, and beginner/intermediate/expert computer play.

## Run locally

```sh
npm start
```

## Run the checks

```sh
npm test
```

The built-in AI checks cover mate in one, taking a hanging queen, and responding to a checking rook at every difficulty level. They use Node's test runner and add no runtime dependencies.

## Render free demo

Use a Node web service with build command `npm install` and start command `npm start`. The free demo stores social state at `/tmp/wchess-data.json`; Render’s free web-service filesystem is ephemeral, so player, friend, and match data can reset when the service sleeps, restarts, or redeploys.

## Best-effort warm-up

The GitHub Actions workflow `.github/workflows/keep-wchess-awake.yml` sends a read-only `GET /api/health` request every 10 minutes (at minutes 7, 17, 27, 37, 47, and 57 UTC) to reduce Render idle sleep. GitHub can delay or drop scheduled runs, and Render can restart a free service at any time, so this does not guarantee continuous availability. Keeping one Render instance warm continuously can use roughly 720–744 of the workspace’s 750 free instance-hours in a month. A visitor’s first request also wakes a sleeping Render service automatically, usually with about a one-minute cold start.


## WChess 1.6 — 3D board and tactical studio

The refreshed interface uses a forest-and-brass palette and a perspective board with a rotating turn animation, an adjustable tilt, and four board themes. Players can turn 3D off, flip the board, show or hide coordinates, legal-move hints and last-move highlights, change sound volume, and copy the current FEN or PGN. A local coach runs the existing browser engine and highlights a legal suggestion without playing it. The game panel now tracks plies, captures, checks and material balance.

The tactics studio includes 59 distinct, answer-checked puzzle positions across 59 themes: named mating patterns, mate-in-one through mate-in-five, tactical ideas and endgames. It supports theme filtering, hints, full-line reveal, retry, previous/next navigation, automatic opponent replies, and explicit underpromotion choices. Solved puzzles, attempt counts and best streak are saved in local storage. Each puzzle links to its original Lichess game, and the trainer includes short checkmate-recognition notes from the referenced lesson video.

Puzzle positions were selected from the [Lichess open puzzle database](https://database.lichess.org/), which is released under **CC0**; themes and descriptions follow the [official Lichess puzzle taxonomy](https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml). No Lichess source code is bundled. The feature benchmark included the [Chess.com Google Play listing](https://play.google.com/store/apps/details?id=com.chess&hl=en_US), the [Lichess server feature set](https://github.com/lichess-org/lila), and the [MIT-licensed Android Chess project](https://github.com/jcarolus/android-chess). The trainer’s six recognition cues were checked against the [referenced YouTube lesson](https://www.youtube.com/watch?v=iBZLU1FXhcI); the app links to the video rather than copying its footage or transcript.

The Android WebView package is version **1.6** (version code 7) and keeps the current install-compatible debug signing key. The free Render service remains the only live deployment target; puzzle training is bundled locally and does not require paid storage or a new service.

The live Android download is [WChess-1.6.apk](https://wchess-live.onrender.com/downloads/WChess.apk).
