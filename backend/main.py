"""
August – FastAPI application entry point.

Exposes:
  WS  /ws          ← Chrome extension connection
  GET /health      ← Liveness check
  POST /command    ← HTTP trigger for testing
  GET /status      ← Extension connection status
"""

from __future__ import annotations

import json
import logging
import logging.config
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.config import config
from backend.commands.models import parse_command
from backend.commands.router import route
from backend.websocket.server import bridge
from backend.pipeline import VoicePipeline

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=config.log.level,
    format=config.log.format,
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("august")

# ── Pipeline singleton ────────────────────────────────────────────────────────

pipeline = VoicePipeline(bridge)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("  August backend starting")
    logger.info("  WebSocket  → ws://%s:%d/ws",   config.server.host, config.server.port)
    logger.info("  Health     → http://%s:%d/health", config.server.host, config.server.port)
    logger.info("  Model      → Whisper %s (%s)",  config.audio.whisper_model, config.audio.device)
    logger.info("  Hotkey     → Ctrl+Space  (push-to-talk)")
    logger.info("=" * 60)

    # Start the voice pipeline (loads Whisper model, arms hotkey)
    await pipeline.start()

    yield

    await pipeline.stop()
    logger.info("August backend shut down.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="August",
    description="Local voice-controlled Chrome agent",
    version="0.1.0",
    lifespan=lifespan,
)

# Only allow local origins – security requirement
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Chrome extensions use chrome-extension:// origin
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    accepted = await bridge.connect(ws)
    if not accepted:
        return
    try:
        await bridge.receive_loop(ws)
    except WebSocketDisconnect:
        pass
    finally:
        await bridge.disconnect()


# ── REST helpers (Phase 1 testing) ────────────────────────────────────────────

@app.get("/health")
async def health():
    from backend.llm.ollama_client import get_ollama_client
    client = get_ollama_client()
    llm_ok = await client.is_available()
    return {
        "status": "ok",
        "extension_connected": bridge.is_connected,
        "whisper_model": config.audio.whisper_model,
        "llm_available": llm_ok,
        "llm_model": config.llm.model,
    }


@app.get("/llm/status")
async def llm_status():
    """Check if Ollama is running and the configured model is available."""
    from backend.llm.ollama_client import get_ollama_client
    client = get_ollama_client()
    available = await client.is_available()
    return {
        "ollama_running": available,
        "model": config.llm.model,
        "base_url": config.llm.ollama_base_url,
        "message": (
            f"Ollama is ready with model '{config.llm.model}'."
            if available
            else (
                f"Ollama not available. Run: ollama serve\n"
                f"Then pull the model: ollama pull {config.llm.model}"
            )
        ),
    }


@app.get("/context")
async def context_endpoint():
    """Return live browser context — useful for debugging Phase 6."""
    from backend.context import browser_context
    return {
        "url":           browser_context.current_url,
        "title":         browser_context.page_title,
        "selected_text": browser_context.selected_text,
        "open_tabs":     len(browser_context.open_tabs),
        "last_updated":  browser_context.last_updated.isoformat()
                         if browser_context.last_updated else None,
    }


@app.get("/status")
async def status_endpoint():
    return {
        "extension_connected": bridge.is_connected,
        "message": (
            "Chrome extension is connected and ready."
            if bridge.is_connected
            else "Waiting for Chrome extension to connect…"
        ),
    }


class TextCommandRequest(BaseModel):
    text: str


@app.post("/command/text")
async def command_from_text(req: TextCommandRequest):
    """
    Accept a plain-text command (as if it came from STT) and execute it.
    Useful for Phase 1 testing without a microphone.

    Example:
        curl -X POST http://127.0.0.1:8765/command/text \
             -H "Content-Type: application/json" \
             -d '{"text": "open youtube"}'
    """
    logger.info("[API] Received text command: %r", req.text)

    from backend.context import browser_context
    result = route(req.text, {"selectedText": browser_context.selected_text})

    if result.command is None:
        return JSONResponse(
            status_code=422,
            content={
                "error": "UNRECOGNIZED_COMMAND",
                "message": (
                    f"Could not parse: {req.text!r}. "
                    "LLM fallback not yet enabled in Phase 1."
                ),
                "router_latency_ms": result.latency_ms,
            },
        )

    logger.info("[API] Router resolved → %s", result.command)

    if not bridge.is_connected:
        return JSONResponse(
            status_code=503,
            content={
                "error": "EXTENSION_NOT_CONNECTED",
                "message": (
                    "Chrome extension is not connected.\n"
                    "Open Chrome and enable the August extension."
                ),
            },
        )

    try:
        ws_result = await bridge.send_command(result.command, source=result.tier)
        return {
            "status": ws_result.status,
            "message": ws_result.message,
            "command": result.command,
            "router_latency_ms": result.latency_ms,
        }
    except (ConnectionError, TimeoutError, ValueError) as exc:
        return JSONResponse(
            status_code=500,
            content={"error": type(exc).__name__, "message": str(exc)},
        )


class RawCommandRequest(BaseModel):
    command: dict


@app.post("/command/raw")
async def command_raw(req: RawCommandRequest):
    """
    Send a raw command JSON directly, bypassing the text router.
    For testing specific actions in Phase 1.

    Example:
        curl -X POST http://127.0.0.1:8765/command/raw \
             -H "Content-Type: application/json" \
             -d '{"command": {"action": "OPEN_URL", "url": "https://youtube.com"}}'
    """
    logger.info("[API] Raw command: %s", req.command)

    try:
        parse_command(req.command)  # validate only
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "INVALID_COMMAND", "message": str(exc)})

    if not bridge.is_connected:
        return JSONResponse(
            status_code=503,
            content={
                "error": "EXTENSION_NOT_CONNECTED",
                "message": "Chrome extension is not connected.",
            },
        )

    try:
        ws_result = await bridge.send_command(req.command)
        return {
            "status": ws_result.status,
            "message": ws_result.message,
            "command": req.command,
        }
    except (ConnectionError, TimeoutError, ValueError) as exc:
        return JSONResponse(
            status_code=500,
            content={"error": type(exc).__name__, "message": str(exc)},
        )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=config.server.host,
        port=config.server.port,
        log_level=config.log.level.lower(),
        reload=False,
    )
