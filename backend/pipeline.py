"""
August – Voice Pipeline Orchestrator (Phase 3)

Connects:
    PushToTalkRecorder  →  deterministic router  →  ExtensionBridge  →  Chrome

Runs the recorder in a daemon thread (keyboard.wait blocks),
bridges back to the FastAPI asyncio event loop via
asyncio.run_coroutine_threadsafe().

Lifecycle:
    pipeline = VoicePipeline(bridge)
    await pipeline.start()      ← call from FastAPI lifespan
    await pipeline.stop()       ← call on shutdown
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import TYPE_CHECKING, Optional

from backend.commands.router import route
from backend.commands.llm_fallback import llm_fallback
from backend.config import config
from backend.websocket.server import ExtensionBridge

if TYPE_CHECKING:
    from backend.audio.recorder import PushToTalkRecorder

logger = logging.getLogger(__name__)


class VoicePipeline:
    """
    Wires the full voice→browser pipeline together.

    Thread model
    ────────────
    • Main thread  : asyncio event loop (FastAPI / uvicorn)
    • Daemon thread: keyboard listener + sounddevice capture (recorder)
    • Daemon thread: Whisper transcription (spawned per utterance by recorder)

    The recorder's on_result callback fires on the Whisper thread.
    We use run_coroutine_threadsafe to dispatch the command coroutine
    back onto the asyncio loop.
    """

    def __init__(self, bridge: ExtensionBridge) -> None:
        self._bridge     = bridge
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._recorder: Optional["PushToTalkRecorder"] = None
        self._thread: Optional[threading.Thread]        = None
        self._started    = False

    # ── Callbacks (called from recorder daemon thread) ────────────────────────

    def _on_listening(self) -> None:
        logger.info("[PIPELINE] 🎙  Listening…")
        self._notify_extension("listening", "🎙 Listening…")

    def _on_stopped(self) -> None:
        logger.info("[PIPELINE] ⏹  Processing audio…")
        self._notify_extension("processing", "⏹ Processing…")

    def _on_result(self, text: str) -> None:
        """
        Called with the transcribed text from the Whisper thread.
        Tier 1: deterministic router.
        Tier 2: LLM fallback (Ollama) if router has no match.
        """
        logger.info("[VOICE]  %r", text)
        self._notify_extension("routing", f'"{text}"', transcript=text)

        # ── Tier 1: Deterministic ─────────────────────────────────────────────
        from backend.context import browser_context
        router_result = route(text, {"selectedText": browser_context.selected_text})

        if router_result.command is not None:
            logger.info(
                "[ROUTER] Tier 1 match → %s  (%.1fms)",
                router_result.command["action"], router_result.latency_ms,
            )
            self._notify_extension(
                "routing",
                f"⚡ {router_result.command['action']}",
                transcript=text,
                intent=router_result.command["action"],
            )
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._dispatch(text, router_result.command, "deterministic"),
                    self._loop,
                )
            return

        # ── Tier 2: LLM fallback ──────────────────────────────────────────────
        logger.info("[ROUTER] No Tier 1 match — escalating to Ollama for %r", text)
        self._notify_extension(
            "llm",
            "🤖 Thinking…",
            transcript=text,
        )

        if self._loop:
            asyncio.run_coroutine_threadsafe(
                self._llm_dispatch(text),
                self._loop,
            )

    # ── Async dispatch (runs on the asyncio event loop) ───────────────────────

    async def _dispatch(self, text: str, command: dict, tier: str) -> None:
        if not self._bridge.is_connected:
            logger.error(
                "[PIPELINE] Chrome extension not connected — cannot execute %r.",
                command["action"],
            )
            self._notify_extension(
                "error",
                "✗ Chrome extension not connected.",
                transcript=text,
            )
            return

        logger.info("[WS] Sending  action=%s", command["action"])

        try:
            result = await self._bridge.send_command(command, source=tier)
            if result.status == "SUCCESS":
                logger.info("[SUCCESS] %s — %s", command["action"], result.message)
                self._notify_extension(
                    "success",
                    f"✓ {result.message}",
                    transcript=text,
                    intent=command["action"],
                )
            else:
                logger.warning("[FAILURE] %s — %s", command["action"], result.message)
                self._notify_extension(
                    "failure",
                    f"✗ {result.message}",
                    transcript=text,
                    intent=command["action"],
                )
        except ConnectionError as exc:
            logger.error("[PIPELINE] %s", exc)
            self._notify_extension("error", f"✗ {exc}", transcript=text)
        except TimeoutError as exc:
            logger.error("[PIPELINE] Timeout: %s", exc)
            self._notify_extension("error", f"✗ Timeout: {exc}", transcript=text)
        except Exception as exc:
            logger.exception("[PIPELINE] Unexpected error: %s", exc)

    async def _llm_dispatch(self, text: str) -> None:
        """Tier 2: call Ollama with browser context, validate, dispatch to Chrome."""
        from backend.context import browser_context

        ctx = browser_context.to_llm_context()
        if ctx:
            logger.info("[LLM] Context: %s", browser_context.summary())

        result = await llm_fallback(
            text,
            current_url = browser_context.current_url or None,
            page_title  = browser_context.page_title  or None,
        )

        if not result.success:
            logger.warning("[LLM] Could not produce a command: %s", result.error)
            self._notify_extension(
                "unrecognized",
                f'✗ Not understood: "{text}"',
                transcript=text,
            )
            return

        logger.info(
            "[LLM] → %s  (%.0fms  retried=%s)",
            result.command.action, result.latency_ms, result.retried,
        )
        self._notify_extension(
            "routing",
            f"🤖 {result.command.action}",
            transcript=text,
            intent=str(result.command.action),
        )
        await self._dispatch(text, result.raw_command, "llm")

    # ── Side panel notifications ──────────────────────────────────────────────

    def _notify_extension(
        self,
        state: str,
        status: str,
        transcript: str = "",
        intent: str = "",
    ) -> None:
        """
        Send a UI-only status update to the extension (no Chrome action taken).
        Fire-and-forget — we don't wait for a response.
        """
        if self._loop is None or not self._bridge.is_connected:
            return

        payload = {
            "id": f"notify-{state}-{int(time.time()*1000)}",
            "type": "NOTIFY",
            "status": status,
            "transcript": transcript,
            "intent": intent,
        }

        async def _send():
            try:
                ws = self._bridge._ws  # access the raw WS for fire-and-forget
                if ws:
                    import json
                    await ws.send_text(json.dumps(payload))
            except Exception:
                pass  # UI notifications are best-effort

        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(_send(), self._loop)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start the voice pipeline. Call from FastAPI lifespan."""
        if self._started:
            return

        self._loop = asyncio.get_event_loop()

        # Audio deps (sounddevice/PortAudio, faster-whisper, keyboard hooks) are
        # optional: without them the backend still serves /ws and /command/*.
        try:
            from backend.audio.recorder import PushToTalkRecorder
        except (ImportError, OSError) as exc:
            logger.warning(
                "[PIPELINE] Voice input disabled (%s). Bridge + REST endpoints still work. "
                "Install requirements-audio.txt and PortAudio to enable push-to-talk.", exc,
            )
            return

        self._recorder = PushToTalkRecorder(
            on_result    = self._on_result,
            on_listening = self._on_listening,
            on_stopped   = self._on_stopped,
            model_size   = config.audio.whisper_model,
            device       = config.audio.device,
            vad_silence_ms = 700,
        )

        # Run the blocking recorder.start() in a daemon thread
        self._thread = threading.Thread(
            target=self._recorder.start,
            kwargs={"warm_up": True},
            daemon=True,
            name="august-recorder",
        )
        self._thread.start()
        self._started = True
        logger.info(
            "[PIPELINE] Voice pipeline started  model=%s  device=%s",
            config.audio.whisper_model,
            config.audio.device,
        )

    async def stop(self) -> None:
        """Stop the voice pipeline. Call from FastAPI lifespan shutdown."""
        if self._recorder:
            self._recorder.stop_listening()
        self._started = False
        logger.info("[PIPELINE] Voice pipeline stopped.")
