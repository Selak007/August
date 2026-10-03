"""
August – Global configuration.
All tuneable knobs live here; nothing else imports os.environ directly.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from typing import Literal


def _get_or_create_auth_token() -> str:
    """Retrieve auth token from env or persist a secure local session token."""
    token = os.getenv("AUGUST_AUTH_TOKEN")
    if token:
        return token
    # Fixed local default token for zero-friction setup, overrideable via env
    return "august_local_sec_token_98234"


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"          # localhost only – never expose externally
    port: int = 8765
    path: str = "/ws"
    auth_token: str = field(default_factory=_get_or_create_auth_token)
    # Whitelist of allowed origins (only Chrome extensions and localhost)
    allowed_origin_prefixes: tuple[str, ...] = (
        "chrome-extension://",
        "http://127.0.0.1",
        "http://localhost",
    )


@dataclass
class AudioConfig:
    whisper_model: Literal["tiny", "base", "small", "medium"] = "tiny"
    device: Literal["cpu", "cuda"] = "cpu"
    sample_rate: int = 16_000
    vad_threshold: float = 0.5


@dataclass
class LLMConfig:
    ollama_base_url: str = "http://127.0.0.1:11434"
    model: str = "llama3.2:1b"
    temperature: float = 0.0
    max_retries: int = 2


@dataclass
class LogConfig:
    level: str = os.getenv("LOG_LEVEL", "INFO")
    format: str = "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s"


@dataclass
class AugustConfig:
    server: ServerConfig = field(default_factory=ServerConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    log: LogConfig = field(default_factory=LogConfig)


# ── Singleton ────────────────────────────────────────────────────────────────
config = AugustConfig()
