"""
August – Ollama HTTP client.

Uses httpx (already a Phase 1 dependency) to call the Ollama REST API.
No extra packages needed.

API used:  POST /api/chat  (OpenAI-compatible chat format)
Docs:      https://github.com/ollama/ollama/blob/main/docs/api.md

Security:
  - Only calls localhost (never external services)
  - LLM output is always parsed + validated before use
  - Never executes raw LLM output as code
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional

import httpx

from backend.config import config
from backend.llm.parser import LLMParseError, parse_llm_response
from backend.llm.prompts import (
    SYSTEM_PROMPT,
    CORRECTION_PROMPT,
    build_user_message,
)

logger = logging.getLogger(__name__)


# ── Result type ───────────────────────────────────────────────────────────────

class LLMResult:
    __slots__ = ("command", "raw_response", "latency_ms", "retried", "error")

    def __init__(
        self,
        command: Optional[dict],
        raw_response: str,
        latency_ms: float,
        retried: bool = False,
        error: Optional[str] = None,
    ):
        self.command      = command
        self.raw_response = raw_response
        self.latency_ms   = latency_ms
        self.retried      = retried
        self.error        = error

    @property
    def success(self) -> bool:
        return self.command is not None


# ── Ollama client ─────────────────────────────────────────────────────────────

class OllamaClient:
    """
    Async Ollama client with retry logic.

    Parameters
    ----------
    base_url    : Ollama server URL (default: http://127.0.0.1:11434)
    model       : Ollama model tag  (default from config)
    temperature : Sampling temperature — 0.0 = deterministic
    timeout     : Request timeout in seconds
    max_retries : How many times to retry with correction prompt
    """

    def __init__(
        self,
        base_url: str    = "",
        model: str       = "",
        temperature: float = 0.0,
        timeout: float   = 30.0,
        max_retries: int = 2,
    ):
        self.base_url    = base_url    or config.llm.ollama_base_url
        self.model       = model       or config.llm.model
        self.temperature = temperature or config.llm.temperature
        self.timeout     = timeout
        self.max_retries = max_retries
        self._client     = httpx.AsyncClient(timeout=self.timeout)

    # ── Low-level API call ────────────────────────────────────────────────────

    async def _chat(self, messages: list[dict]) -> str:
        """Call the Ollama /api/chat endpoint and return the raw response text."""
        url     = f"{self.base_url}/api/chat"
        payload = {
            "model":    self.model,
            "messages": messages,
            "stream":   False,
            "options":  {"temperature": self.temperature},
        }

        try:
            resp = await self._client.post(url, json=payload)
            resp.raise_for_status()
        except httpx.ConnectError:
            raise ConnectionError(
                f"Cannot connect to Ollama at {self.base_url}.\n"
                "Make sure Ollama is running:  ollama serve"
            )
        except httpx.TimeoutException:
            raise TimeoutError(
                f"Ollama did not respond within {self.timeout}s. "
                "Try a smaller model: ollama pull llama3.2:1b"
            )
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"Ollama returned HTTP {e.response.status_code}: {e.response.text[:200]}"
            )

        data    = resp.json()
        content = data.get("message", {}).get("content", "").strip()
        return content

    # ── High-level: command generation ───────────────────────────────────────

    async def generate_command(
        self,
        user_text: str,
        current_url: Optional[str]   = None,
        page_title: Optional[str]    = None,
    ) -> LLMResult:
        """
        Ask the LLM to convert *user_text* into a command dict.

        Retries once with a correction prompt if the first response
        cannot be parsed.

        Returns an LLMResult.  Check .success before using .command.
        """
        t0 = time.perf_counter()
        user_msg = build_user_message(user_text, current_url, page_title)

        messages = [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": user_msg},
        ]

        raw        = ""
        retried    = False
        last_error = ""

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.info(
                    "[LLM] Calling Ollama  model=%s  attempt=%d  command=%r",
                    self.model, attempt, user_text,
                )
                raw = await self._chat(messages)
                logger.debug("[LLM] Raw response: %r", raw)

                command   = parse_llm_response(raw)
                latency   = (time.perf_counter() - t0) * 1000
                logger.info(
                    "[LLM] ✓ Parsed command: %s  (%.0fms, retried=%s)",
                    command, latency, retried,
                )
                return LLMResult(command, raw, latency, retried)

            except LLMParseError as e:
                last_error = str(e)
                logger.warning(
                    "[LLM] Parse failed (attempt %d/%d): %s",
                    attempt, self.max_retries, e,
                )

                if attempt < self.max_retries:
                    # Add correction message and retry
                    correction = CORRECTION_PROMPT.replace("{command}", user_text)
                    messages += [
                        {"role": "assistant", "content": raw},
                        {"role": "user",      "content": correction},
                    ]
                    retried = True

            except (ConnectionError, TimeoutError, RuntimeError) as e:
                latency = (time.perf_counter() - t0) * 1000
                logger.error("[LLM] Infrastructure error: %s", e)
                return LLMResult(None, "", latency, retried, str(e))

        # All attempts exhausted
        latency = (time.perf_counter() - t0) * 1000
        logger.error("[LLM] All %d attempts failed: %s", self.max_retries, last_error)
        return LLMResult(None, raw, latency, retried, last_error)

    # ── Health check ──────────────────────────────────────────────────────────

    async def is_available(self) -> bool:
        """Return True if Ollama is reachable and the model is loaded."""
        try:
            resp = await self._client.get(
                f"{self.base_url}/api/tags",
                timeout=3.0,
            )
            if resp.status_code != 200:
                return False
            models = [m["name"] for m in resp.json().get("models", [])]
            # Check if configured model is available (prefix match)
            return any(self.model in m for m in models)
        except Exception:
            return False

    async def aclose(self) -> None:
        await self._client.aclose()


# ── Singleton ─────────────────────────────────────────────────────────────────

_client: Optional[OllamaClient] = None


def get_ollama_client() -> OllamaClient:
    global _client
    if _client is None:
        _client = OllamaClient()
    return _client
