---
'@zhin.js/agent': major
---

Remove the unconstrained `accept_task` Workroom command. Task acceptance now enters through a trusted `WorkroomAcceptancePolicyDecisionPort`; the Kernel validates exact Task/Assignment/candidate bindings and permits automatic acceptance only for low-risk, fully deterministic, evidence-complete candidates before appending a structured Acceptance Record with Journal CAS.

Pre-policy `task.accepted` journal entries do not satisfy the new record schema and must be exported for audit and replanned instead of being silently promoted to accepted Project state.
