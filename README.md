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
