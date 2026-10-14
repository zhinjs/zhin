---
"@zhin.js/agent": patch
---

Agent evals: the eval driver accepts a real-model source (`createLiveModel`), and the nightly MiniMax runner now replays seed cases that declare `live` semantic checks end to end through the driver. The PR gate also runs those checks on each scripted run, so it stays deterministic (#723).
