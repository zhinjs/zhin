---
"@zhin.js/ai": patch
"@zhin.js/agent": patch
---

Provider resilience gate cases for model fallback and request timeouts (#724). The eval scripted model can register several candidate models and records the model id of each request; a `hang` fault step drives a virtual clock so timeout cases never wait in real time. The provider request timeout now accepts injected timers (`ProviderTimers`).
