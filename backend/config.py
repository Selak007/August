"""
August – Global configuration.
All tuneable knobs live here; nothing else imports os.environ directly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"          # localhost only – never expose externally
    port: int = 8765
    path: str = "/ws"


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
