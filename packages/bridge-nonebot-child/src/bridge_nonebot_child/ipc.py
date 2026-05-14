"""NDJSON lines on stdout for the parent Bridge session. Logs must go to stderr only."""

from __future__ import annotations

import json
import sys
import uuid
from typing import Any, Mapping


def write_record(record: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def emit_outbound_intent(
    *,
    correlation_id: str | None,
    payload: Mapping[str, Any],
    envelope_id: str | None = None,
) -> str:
    eid = envelope_id or str(uuid.uuid4())
    rec: dict[str, Any] = {
        "kind": "outbound_intent",
        "id": eid,
        "source": "im",
        "queue": None,
        "payload": dict(payload),
    }
    if correlation_id is not None:
        rec["correlationId"] = correlation_id
    write_record(rec)
    return eid


def emit_dispatch_result(
    *,
    dispatch_id: str,
    payload: Mapping[str, Any],
) -> None:
    write_record(
        {
            "kind": "dispatch_result",
            "id": dispatch_id,
            "source": "im",
            "queue": None,
            "payload": dict(payload),
        }
    )
