---
"@zhin.js/speech": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"zhin.js": minor
---

Add optional peer `@zhin.js/speech`: inbound STT (`audio.strategy: transcribe` default), outbound TTS (`segment.tts` + `voice_stt`/`voice_tts` tools), TTS providers edge/openai/azure/custom. Remove `@zhin.js/plugin-voice`; use `speech:` config key instead of `voice:`.
