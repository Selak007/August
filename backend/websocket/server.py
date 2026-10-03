"""
August – WebSocket server.

Manages the connection from the Chrome extension and dispatches commands.
Only ONE extension connection is expected at a time (single-user, local).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect, status

from backend.commands.models import parse_command, ResultEnvelope
from backend.commands.router import route

logger = logging.getLogger(__name__)


class ExtensionBridge:
    """
    Manages the single active WebSocket connection to the Chrome extension.

    Thread-safety: all methods must be called from the same asyncio event loop.
    """

    def __init__(self) -> None:
        self._ws: Optional[WebSocket] = None
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            if self._ws is not None:
                logger.warning(
                    "[WS] A second extension tried to connect – closing old one."
                )
                try:
                    await self._ws.close(code=1001)
                except Exception:
                    pass
            self._ws = ws
        logger.info("[WS] Chrome extension connected.")

    async def disconnect(self) -> None:
        async with self._lock:
            self._ws = None
            # Reject all pending futures
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(
                        ConnectionError(
                            "Chrome extension disconnected before responding."
                        )
                    )
            self._pending.clear()
        logger.info("[WS] Chrome extension disconnected.")

    @property
    def is_connected(self) -> bool:
        return self._ws is not None

    # ── Sending commands ──────────────────────────────────────────────────────

    async def send_command(
        self,
        command_dict: dict,
        source: str = "deterministic",
        timeout: float = 10.0,
    ) -> ResultEnvelope:
        """
        Validate, send a command and await the extension's acknowledgement.

        Raises:
            ConnectionError – extension not connected
            ValueError      – command validation failed
            TimeoutError    – extension did not respond in *timeout* seconds
        """
        if not self.is_connected:
            raise ConnectionError(
                "Chrome extension is not connected.\n"
                "Open Chrome and make sure the August extension is enabled."
            )

        # Validate
        cmd = parse_command(command_dict)
        cmd_id = str(uuid.uuid4())

        envelope = {
            "id": cmd_id,
            "command": cmd.model_dump(),
            "source": source,
        }

        # Register future before sending to avoid race conditions
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[cmd_id] = fut

        t0 = time.perf_counter()
        logger.info("[WS] Sending  id=%s  command=%s", cmd_id[:8], cmd.model_dump())

        try:
            await self._ws.send_text(json.dumps(envelope))
        except Exception as exc:
            self._pending.pop(cmd_id, None)
            raise ConnectionError(f"Failed to send command to extension: {exc}") from exc

        try:
            result: ResultEnvelope = await asyncio.wait_for(fut, timeout=timeout)
            latency = (time.perf_counter() - t0) * 1000
            logger.info(
                "[WS] Result  id=%s  status=%s  %.1fms",
                cmd_id[:8], result.status, latency
            )
            return result
        except asyncio.TimeoutError:
            self._pending.pop(cmd_id, None)
            raise TimeoutError(
                f"Chrome extension did not respond within {timeout}s. "
                "Is Chrome open and the extension running?"
            )

    # ── Receiving results ─────────────────────────────────────────────────────

    async def receive_loop(self, ws: WebSocket) -> None:
        """Drive the receive loop for *ws*. Runs until the extension disconnects."""
        try:
            while True:
                raw = await ws.receive_text()
                await self._handle_message(raw)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.error("[WS] Unexpected receive error: %s", exc)
        finally:
            await self.disconnect()

    async def _handle_message(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("[WS] Received non-JSON message: %r", raw[:200])
            return

        # ── Browser context update (no correlation id needed) ─────────────────
        if data.get("type") == "CONTEXT":
            from backend.context import browser_context
            browser_context.update_from_dict(data.get("context", {}))
            logger.debug("[WS] Context updated: %s", browser_context.summary())
            return

        # ── Command result (correlated by id) ─────────────────────────────────
        msg_id = data.get("id")
        if not msg_id:
            logger.warning("[WS] Message has no id field: %r", data)
            return

        fut = self._pending.pop(msg_id, None)
        if fut is None:
            logger.warning("[WS] Received result for unknown id=%r", msg_id)
            return

        try:
            result = ResultEnvelope(**data)
            if not fut.done():
                fut.set_result(result)
        except Exception as exc:
            if not fut.done():
                fut.set_exception(exc)


# ── Singleton ─────────────────────────────────────────────────────────────────
bridge = ExtensionBridge()
