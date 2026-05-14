"""CLI entry: stdio NDJSON Bridge v1 child with NoneBot2 + O1 plugin allowlist."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime
from typing import Any

import anyio
import nonebot
from nonebot import get_driver, load_plugin
from nonebot.adapters.console import Adapter as ConsoleAdapter, Bot, MessageEvent
from nonebot.adapters.console.message import Message, MessageSegment
from nonebot.log import default_filter, default_format, logger as nb_logger
from nonechat.model import Channel, Robot, User

from bridge_nonebot_child.ipc import emit_dispatch_result

SUPPORTED_VERSION = 1


def _send(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _content_to_message(content: list[dict[str, Any]] | None) -> Message:
    msg = Message()
    if not content:
        msg += MessageSegment.text("")
        return msg
    for seg in content:
        if not isinstance(seg, dict):
            continue
        t = seg.get("type")
        data = seg.get("data") if isinstance(seg.get("data"), dict) else {}
        if t == "text":
            msg += MessageSegment.text(str(data.get("text", "")))
        else:
            msg += MessageSegment.text("")
    if not msg:
        msg += MessageSegment.text("")
    return msg


def _dispatch_to_event(payload: dict[str, Any], self_id: str) -> MessageEvent:
    sender = payload.get("$sender") if isinstance(payload.get("$sender"), dict) else {}
    channel = payload.get("$channel") if isinstance(payload.get("$channel"), dict) else {}
    uid = str(sender.get("id", "user"))
    nick = str(sender.get("name", uid))
    ctype = str(channel.get("type", "private"))
    cid = str(channel.get("id", "c1"))
    if ctype == "private":
        ch = Channel(id=f"private:{cid}", name="private", description="", avatar="")
    else:
        ch = Channel(id=f"group:{cid}", name="group", description="", avatar="")
    raw_content = payload.get("$content")
    content_list = raw_content if isinstance(raw_content, list) else []
    return MessageEvent(
        time=datetime.now(),
        self_id=self_id,
        user=User(id=uid, nickname=nick),
        message_id=str(payload.get("$id", uuid.uuid4())),
        message=_content_to_message(content_list),
        channel=ch,
    ).convert()


async def _read_line() -> str:
    return await anyio.to_thread.run_sync(sys.stdin.readline)


async def _run() -> None:
    token = os.environ.get("ZHIN_BRIDGE_IPC_TOKEN", "")
    allow_raw = os.environ.get("ZHIN_BRIDGE_NB_PLUGIN_MODULES", "[]")
    try:
        allowlist: list[str] = json.loads(allow_raw)
    except json.JSONDecodeError:
        allowlist = []
    if not isinstance(allowlist, list) or not all(isinstance(x, str) for x in allowlist):
        allowlist = []

    os.environ.setdefault("DRIVER", "~none")
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    os.environ.setdefault("CONSOLE_HEADLESS_MODE", "true")

    # NoneBot's default loguru sink uses stdout; Bridge IPC requires stdout to be NDJSON-only.
    nb_logger.remove()
    nb_logger.add(
        sys.stderr,
        level=0,
        diagnose=False,
        filter=default_filter,
        format=default_format,
    )

    nonebot.init(_env_file=None, driver="~none", log_level="WARNING")
    driver = get_driver()
    driver.register_adapter(ConsoleAdapter)

    for mod in allowlist:
        load_plugin(mod)

    await driver._lifespan.startup()  # noqa: SLF001

    try:
        adapter = driver._adapters["Console"]  # noqa: SLF001
        from nonebot import get_plugin_config
        from nonebot.adapters.console.config import Config as ConsoleCfg

        cfg = get_plugin_config(ConsoleCfg)
        rid = cfg.console_bot_id
        rname = cfg.console_bot_name
        bot = Bot(adapter, Robot(id=rid, nickname=rname))
        adapter.bot_connect(bot)

        first = True
        while True:
            line = (await _read_line()).rstrip("\n")
            if line == "" and first:
                continue
            if line == "":
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                if first:
                    _send({"kind": "hello_error", "code": "invalid_hello"})
                return
            if first:
                first = False
                if (
                    not isinstance(msg, dict)
                    or msg.get("kind") != "hello"
                    or not isinstance(msg.get("protocolVersion"), int)
                    or not isinstance(msg.get("token"), str)
                ):
                    _send({"kind": "hello_error", "code": "invalid_hello"})
                    return
                if msg["protocolVersion"] != SUPPORTED_VERSION:
                    _send({"kind": "hello_error", "code": "version_mismatch"})
                    return
                if msg["token"] != token:
                    _send({"kind": "hello_error", "code": "token_mismatch"})
                    return
                _send({"kind": "hello_ok", "protocolVersion": SUPPORTED_VERSION})
                continue

            if isinstance(msg, dict) and msg.get("kind") == "dispatch" and msg.get("source") == "im":
                dispatch_id = str(msg.get("id", ""))
                payload = msg.get("payload")
                if not isinstance(payload, dict):
                    payload = {}
                os.environ["ZHIN_BRIDGE_CURRENT_DISPATCH_ID"] = dispatch_id
                try:
                    ev = _dispatch_to_event(payload, rid)
                    await bot.handle_event(ev)
                finally:
                    os.environ.pop("ZHIN_BRIDGE_CURRENT_DISPATCH_ID", None)

                emit_dispatch_result(
                    dispatch_id=dispatch_id,
                    payload={"handled": True, "shortCircuit": False},
                )
    finally:
        await driver._lifespan.shutdown()  # noqa: SLF001


def main_sync() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main_sync()
