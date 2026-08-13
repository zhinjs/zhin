---
"@zhin.js/agent": minor
---

Add one Turn Event source module that owns concurrent worker-to-stream bridging,
exactly-once terminal emission, error mapping, and worker settlement. Reuse it
from the existing streaming turn path so future IM ingress adapters do not
reimplement event queues or release generation leases while work is active.

Agent surface diagnostics now include root `tools/` convention entries as well
as `agent/tools/`, matching Plugin Runtime discovery.
