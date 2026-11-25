---
description: "Reel Tracker, a Compose Multiplatform movie app in the repo: replay a shipped scenario on Android and iOS, then record and replay your own."
---

# Showcase app: Reel Tracker

Reel Tracker is a small Compose Multiplatform movie tracker for Android and iOS, built on live data from [TMDB](https://www.themoviedb.org). It lives in `showcase-app/` in the repository. It has no UI test code: every on-device check is a platform-agnostic JSON scenario, and one file runs on both platforms.

The walkthrough goes through these steps:

1. Clone and add your TMDB key
2. Build and install on an emulator and a simulator
3. Install mauto and create a workspace
4. Replay a shipped scenario on Android
5. Replay the same file on iOS
6. Record a flow of your own
7. Replay your recording on the other platform
8. Replay in CI

Three facts to know before you start:

- The shipped scenarios are curated fixtures, written by hand. They are not recordings made with mauto.
- `mauto run` replays a scenario by itself. No agent is involved.
- Recording a scenario needs an AI agent following `mauto guide generate`.

The commands for every step are in the [full walkthrough](https://github.com/sh3lan93/mobile-automator/blob/main/showcase-app/README.md#walkthrough).
