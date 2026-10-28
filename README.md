# WChess

WChess is a browser chess club with online presence, friend requests, hosted two-player matches, and beginner/intermediate/expert computer play.

## Run locally

```sh
npm start
```

## Render demo

Use a Node web service with build command `npm install` and start command `npm start`. The free demo stores social state at the configured `WCHESS_DATA_FILE` path; Render's free web-service filesystem is ephemeral, so player/friend/match data can reset when the service sleeps, restarts, or redeploys.
