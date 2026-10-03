"""
August – LLM fallback handler (Tier 2).

Called by the pipeline when the deterministic router (Tier 1) returns None.
Wraps OllamaClient with:
  - Availability check (is Ollama running?)
  - Context injection (current URL, page title)
  - Final Pydantic validation of the LLM's output
  - Structured logging throughout
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.commands.models import parse_command, AugustCommand
from backend.llm.ollama_client import get_ollama_client

logger = logging.getLogger(__name__)


class LLMFallbackResult:
    __slots__ = ("command", "raw_command", "latency_ms", "error", "retried")

    def __init__(
        self,
        command:     Optional[AugustCommand],
        raw_command: Optional[dict],
        latency_ms:  float,
        error:       Optional[str] = None,
        retried:     bool = False,
    ):
        self.command     = command
        self.raw_command = raw_command
        self.latency_ms  = latency_ms
        self.error       = error
        self.retried     = retried

    @property
    def success(self) -> bool:
        return self.command is not None


async def llm_fallback(
    text: str,
    current_url: Optional[str]  = None,
    page_title:  Optional[str]  = None,
) -> LLMFallbackResult:
    """
    Attempt to convert *text* into a validated AugustCommand using Ollama.

    Pipeline:
        text → OllamaClient.generate_command()
             → parse_llm_response()      (JSON extraction + whitelist check)
             → parse_command()           (Pydantic validation)
             → LLMFallbackResult

    Returns a LLMFallbackResult.  Check .success before using .command.
    """
    client = get_ollama_client()

    # Quick availability check — skip LLM call if Ollama is down
    available = await client.is_available()
    if not available:
        msg = (
            f"Ollama is not running or model '{client.model}' is not loaded.\n"
            f"Start Ollama:  ollama serve\n"
            f"Pull model:    ollama pull {client.model}"
        )
        logger.warning("[LLM] %s", msg)
        return LLMFallbackResult(None, None, 0.0, error=msg)

    # Generate command from LLM
    llm_result = await client.generate_command(
        user_text   = text,
        current_url = current_url,
        page_title  = page_title,
    )

    if not llm_result.success:
        logger.error(
            "[LLM] Failed to produce a valid command for %r: %s",
            text, llm_result.error,
        )
        return LLMFallbackResult(
            None, None, llm_result.latency_ms,
            error=llm_result.error,
            retried=llm_result.retried,
        )

    # Final Pydantic validation — this is the security gate
    raw_cmd = llm_result.command
    try:
        validated = parse_command(raw_cmd)
        logger.info(
            "[LLM] ✓ Validated  action=%s  latency=%.0fms  retried=%s",
            validated.action, llm_result.latency_ms, llm_result.retried,
        )
        return LLMFallbackResult(
            command     = validated,
            raw_command = raw_cmd,
            latency_ms  = llm_result.latency_ms,
            retried     = llm_result.retried,
        )
    except ValueError as exc:
        msg = f"LLM produced a command that failed validation: {exc}"
        logger.error("[LLM] %s  raw=%s", msg, raw_cmd)
        return LLMFallbackResult(
            None, raw_cmd, llm_result.latency_ms,
            error=msg, retried=llm_result.retried,
        )
