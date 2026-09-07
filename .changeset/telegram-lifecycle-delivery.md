---
"@zhin.js/adapter-telegram": patch
---

Reject sends without a valid platform message ID. Use the shared Endpoint lifecycle to cancel setup requests and polling, isolate late results from replacement connections, and release Webhook routes on failed startup. Release retry listeners and cancel permission lookups when admission closes, preventing stale messages and permissions from entering reopened endpoints. Correct endpoint ID and Webhook setup documentation.
