"""
August – LLM JSON response parser.

Responsible for:
  1. Extracting a JSON object from raw LLM output (handles markdown, stray text)
  2. Validating it against the command whitelist
  3. Returning a clean dict ready for Pydantic validation

This is intentionally separate from the Pydantic models so the parser
can gracefully handle LLM quirks before strict validation.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional, Tuple

from backend.llm.prompts import ALLOWED_ACTIONS

logger = logging.getLogger(__name__)


class LLMParseError(Exception):
    """Raised when the LLM output cannot be parsed into a valid command."""
    pass


def extract_json(raw: str) -> Optional[Dict[str, Any]]:
    """
    Extract the first JSON object from *raw* text.

    Handles:
      - Clean JSON:            {"action": "SEARCH", ...}
      - Markdown code block:   ```json\n{...}\n```
      - Leading/trailing text: "Sure! Here is: {...}"
    """
    raw = raw.strip()

    # Strip markdown code fences
    raw = re.sub(r"```(?:json)?\s*", "", raw)
    raw = re.sub(r"```\s*$", "", raw, flags=re.MULTILINE)

    # Find the first {...} block
    match = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
    if not match:
        logger.warning("[PARSER] No JSON object found in: %r", raw[:200])
        return None

    try:
        return json.loads(match.group())
    except json.JSONDecodeError as e:
        logger.warning("[PARSER] JSON decode error: %s  raw=%r", e, raw[:200])
        return None


def validate_action(data: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Check that *data* has a valid whitelisted action.

    Returns (is_valid, error_message).
    """
    action = data.get("action", "")

    if not action:
        return False, "Missing 'action' field."

    if action == "UNKNOWN":
        return False, "LLM could not map the command to any action."

    if action not in ALLOWED_ACTIONS:
        return False, (
            f"Action '{action}' is not in the whitelist. "
            f"Allowed: {ALLOWED_ACTIONS}"
        )

    return True, ""


def parse_llm_response(raw: str) -> Dict[str, Any]:
    """
    Full parse pipeline: extract → validate → return clean dict.

    Raises LLMParseError with a human-readable message on failure.
    """
    data = extract_json(raw)

    if data is None:
        raise LLMParseError(
            f"Could not extract JSON from LLM response: {raw[:200]!r}"
        )

    is_valid, error = validate_action(data)
    if not is_valid:
        raise LLMParseError(error)

    logger.info("[PARSER] Extracted command: %s", data)
    return data
