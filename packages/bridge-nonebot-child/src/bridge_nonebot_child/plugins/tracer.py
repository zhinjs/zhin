"""Minimal O1 allowlist demo plugin: reacts to Console MessageEvent and emits Bridge outbound via ipc shim."""

from __future__ import annotations

import os

from nonebot import on_message
from nonebot.adapters.console import MessageEvent

from bridge_nonebot_child.ipc import emit_outbound_intent


def _glue() -> tuple[str, str, str, str]:
    bot_id = os.environ.get("ZHIN_BRIDGE_GLUE_BOT_ID", "")
    eco = os.environ.get("ZHIN_BRIDGE_GLUE_ECOSYSTEM", "")
    inst = os.environ.get("ZHIN_BRIDGE_GLUE_INSTANCE_ID", "")
    ctx = os.environ.get("ZHIN_BRIDGE_OUTBOUND_CONTEXT", "nonebot-tracer")
    return bot_id, eco, inst, ctx


def _channel_for_event(ev: MessageEvent) -> tuple[str, str]:
    """OutboundGate channel.type + id from Console event."""
    cid = ev.channel.id
    if cid == "_direct" or cid.startswith("private:"):
        return "private", ev.get_user_id()
    return "group", cid


_matcher = on_message(priority=10, block=False)


@_matcher.handle()
async def _handle(ev: MessageEvent) -> None:
    dispatch_id = os.environ.get("ZHIN_BRIDGE_CURRENT_DISPATCH_ID")
    text = ev.get_plaintext()
    bot_id, eco, inst, ctx = _glue()
    ch_type, ch_id = _channel_for_event(ev)
    emit_outbound_intent(
        correlation_id=dispatch_id,
        payload={
            "botId": bot_id,
            "ecosystem": eco,
            "instanceId": inst,
            "context": ctx,
            "channel": {"type": ch_type, "id": ch_id},
            "content": [{"type": "text", "data": {"text": f"[nb-tracer] {text}"}}],
        },
    )
