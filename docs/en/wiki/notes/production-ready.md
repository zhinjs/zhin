---
title: Is the running Bot ready?
---

# The process started; is the Bot usable?

**Check three things: process liveness, Runtime readiness, and real platform delivery.** The first two have probes. The last needs an actual conversation on the target platform.

A “listening” log line alone cannot establish that the Bot works.

This check is for deployment acceptance. Port `8068` below is the new-project default; use the actual port and `http.base` printed or configured for your deployment.

## Check Runtime first

```bash
curl --fail http://127.0.0.1:8068/pub/health
curl --fail http://127.0.0.1:8068/pub/ready
```

`/pub/health` only proves the HTTP process responds. `/pub/ready` returns 503 before the first generation commits and 200 when ready. To require particular Endpoints or Agent bindings, declare them under `http.readiness`.

For a protected detailed report, run `zhin doctor --live <API Base> --json` or request `/api/system/readiness`. Doctor exits nonzero for non-readiness, authentication failure, or request failure.

Use the reported reason to choose the next check.

## Finish with platform delivery

Readiness probes do not test platform transport or model credentials. Send a message from a real account and confirm that the Bot receives and replies.

If you depend on proactive sends, test one separately. Treat those exchanges as release evidence rather than inferring delivery from the probe.

See [Production Deployment](/en/operations/production) for readiness configuration and authentication, and [Troubleshooting](/en/troubleshooting/) for symptom-based diagnosis.
