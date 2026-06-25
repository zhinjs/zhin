---
"@zhin.js/speech": minor
"@zhin.js/core": minor
"@zhin.js/agent": minor
"zhin.js": minor
---

Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Breaking: remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
