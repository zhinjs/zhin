---
'@zhin.js/agent': patch
---

Agent evals: multi-message ingress cases (#725). A case can now feed several timed messages through the IM admission protocol (TurnAdmissionGate) on a virtual clock, which makes same-sender merging, FIFO queuing of different members, cancel and queue-full/expiry testable end to end.
