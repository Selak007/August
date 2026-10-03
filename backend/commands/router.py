"""
August – Deterministic command router (Tier 1).

Maps transcribed text → a validated AugustCommand without touching the LLM.
Patterns are applied in order; first match wins.

Extend this file to add new voice patterns.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# ── URL shortcuts ─────────────────────────────────────────────────────────────

SITE_MAP: Dict[str, str] = {
    "youtube":    "https://www.youtube.com",
    "google":     "https://www.google.com",
    "github":     "https://www.github.com",
    "gmail":      "https://mail.google.com",
    "twitter":    "https://www.twitter.com",
    "x":          "https://www.x.com",
    "reddit":     "https://www.reddit.com",
    "netflix":    "https://www.netflix.com",
    "wikipedia":  "https://www.wikipedia.org",
    "stackoverflow": "https://stackoverflow.com",
    "linkedin":   "https://www.linkedin.com",
    "amazon":     "https://www.amazon.com",
    "chatgpt":    "https://chat.openai.com",
    "smart":      "https://chat.openai.com",   # "open smart" → ChatGPT
    "gpt":        "https://chat.openai.com",   # "open gpt"
    "copilot":    "https://copilot.microsoft.com",
    "gemini":     "https://gemini.google.com",
    "claude":     "https://claude.ai",
    "perplexity": "https://www.perplexity.ai",
    "notion":     "https://www.notion.so",
    "spotify":    "https://www.spotify.com",
    "discord":    "https://discord.com",
    "whatsapp":   "https://web.whatsapp.com",
    "instagram":  "https://www.instagram.com",
    "figma":      "https://www.figma.com",
    "vercel":     "https://vercel.com",
    "huggingface": "https://huggingface.co",
}

SEARCH_ENGINES: Dict[str, str] = {
    "google":     "https://www.google.com/search?q={query}",
    "youtube":    "https://www.youtube.com/results?search_query={query}",
    "bing":       "https://www.bing.com/search?q={query}",
    "duckduckgo": "https://duckduckgo.com/?q={query}",
}


# ── Pattern registry ──────────────────────────────────────────────────────────

@dataclass
class Pattern:
    regex: re.Pattern
    handler: Callable[[re.Match], Optional[Dict[str, Any]]]
    description: str


_patterns: list[Pattern] = []


def _register(pattern: str, description: str):
    """Decorator – registers a compiled regex + its handler."""
    def decorator(fn: Callable[[re.Match], Optional[Dict[str, Any]]]):
        _patterns.append(Pattern(
            regex=re.compile(pattern, re.IGNORECASE),
            handler=fn,
            description=description,
        ))
        return fn
    return decorator


# ── Pattern definitions ───────────────────────────────────────────────────────

@_register(
    r"^(?:open|go to|navigate to|visit)\s+(.+)$",
    "open <site>  |  open <url>"
)
def _open(m: re.Match) -> Optional[Dict[str, Any]]:
    target = m.group(1).strip().lower()
    # Check site map first
    for keyword, url in SITE_MAP.items():
        if keyword in target:
            return {"action": "OPEN_URL", "url": url}
    # Looks like a bare URL?
    if re.search(r"\.\w{2,}", target):
        return {"action": "OPEN_URL", "url": target}
    return None  # fall through to LLM


@_register(
    r"^(?:new tab|open new tab|open a new tab)$",
    "new tab"
)
def _new_tab(m: re.Match) -> Dict[str, Any]:
    return {"action": "NEW_TAB"}


@_register(
    r"^(?:close tab|close this tab|close current tab)$",
    "close tab"
)
def _close_tab(m: re.Match) -> Dict[str, Any]:
    return {"action": "TAB_CLOSE"}


@_register(
    r"^(?:next tab|switch to next tab|tab right)$",
    "next tab"
)
def _next_tab(m: re.Match) -> Dict[str, Any]:
    return {"action": "TAB_NEXT"}


@_register(
    r"^(?:previous tab|prev tab|switch to previous tab|tab left)$",
    "previous tab"
)
def _prev_tab(m: re.Match) -> Dict[str, Any]:
    return {"action": "TAB_PREVIOUS"}


@_register(
    r"^(?:reload|refresh|reload page|refresh page)$",
    "reload page"
)
def _reload(m: re.Match) -> Dict[str, Any]:
    return {"action": "RELOAD"}


@_register(
    r"^(?:go back|back|navigate back|previous page)$",
    "go back"
)
def _go_back(m: re.Match) -> Dict[str, Any]:
    return {"action": "GO_BACK"}


@_register(
    r"^(?:go forward|forward|navigate forward|next page)$",
    "go forward"
)
def _go_forward(m: re.Match) -> Dict[str, Any]:
    return {"action": "GO_FORWARD"}


@_register(
    r"^(?:scroll down|scroll down a bit|page down)(?:\s+(\d+))?$",
    "scroll down [amount]"
)
def _scroll_down(m: re.Match) -> Dict[str, Any]:
    amount = int(m.group(1)) if m.group(1) else 400
    return {"action": "SCROLL", "direction": "DOWN", "amount": amount}


@_register(
    r"^(?:scroll up|scroll up a bit|page up)(?:\s+(\d+))?$",
    "scroll up [amount]"
)
def _scroll_up(m: re.Match) -> Dict[str, Any]:
    amount = int(m.group(1)) if m.group(1) else 400
    return {"action": "SCROLL", "direction": "UP", "amount": amount}


@_register(
    r"^(?:scroll to top|go to top)$",
    "scroll to top"
)
def _scroll_top(m: re.Match) -> Dict[str, Any]:
    return {"action": "SCROLL", "direction": "UP", "amount": 9999}


@_register(
    r"^(?:scroll to bottom|go to bottom)$",
    "scroll to bottom"
)
def _scroll_bottom(m: re.Match) -> Dict[str, Any]:
    return {"action": "SCROLL", "direction": "DOWN", "amount": 9999}


# Search patterns ─────────────────────────────────────────────────────────────

@_register(
    r"^search\s+(?:(?:on|in|using|with)\s+)?(google|youtube|bing|duckduckgo)\s+(?:for\s+)?(.+)$",
    "search <engine> for <query>"
)
def _search_engine_first(m: re.Match) -> Dict[str, Any]:
    engine = m.group(1).lower()
    query  = m.group(2).strip()
    return {"action": "SEARCH", "engine": engine, "query": query}


@_register(
    r"^search\s+(?:for\s+)?(.+)\s+(?:on|in|using|with)\s+(google|youtube|bing|duckduckgo)$",
    "search for <query> on <engine>"
)
def _search_query_first(m: re.Match) -> Dict[str, Any]:
    query  = m.group(1).strip()
    engine = m.group(2).lower()
    return {"action": "SEARCH", "engine": engine, "query": query}


@_register(
    r"^(?:search|google)\s+(?:for\s+)?(.+)$",
    "search / google <query>  (defaults to Google)"
)
def _search_default(m: re.Match) -> Dict[str, Any]:
    query = m.group(1).strip()
    return {"action": "SEARCH", "engine": "google", "query": query}


@_register(
    r"^(?:search youtube|youtube search)\s+(?:for\s+)?(.+)$",
    "search youtube for <query>"
)
def _search_youtube(m: re.Match) -> Dict[str, Any]:
    query = m.group(1).strip()
    return {"action": "SEARCH", "engine": "youtube", "query": query}


# Click patterns ──────────────────────────────────────────────────────────────

@_register(
    r"^(?:click|press|tap|select|hit)\s+(?:the\s+)?(.+)$",
    "click <target>"
)
def _click(m: re.Match) -> Dict[str, Any]:
    target = m.group(1).strip().lower().replace(" ", "_")
    return {"action": "CLICK", "target": target}


# Type patterns ───────────────────────────────────────────────────────────────

@_register(
    r"^(?:type|write|enter|input)\s+[\"']?(.+?)[\"']?\s+(?:in(?:to)?|inside)\s+(?:the\s+)?(.+)$",
    "type <text> in <target>"
)
def _type_into(m: re.Match) -> Dict[str, Any]:
    return {"action": "TYPE", "text": m.group(1).strip(), "target": m.group(2).strip().lower().replace(" ", "_")}


@_register(
    r"^(?:type|write|enter|input)\s+[\"']?(.+?)[\"']?$",
    "type <text>  (into active element)"
)
def _type_active(m: re.Match) -> Dict[str, Any]:
    return {"action": "TYPE", "text": m.group(1).strip()}


# Extract / read patterns ─────────────────────────────────────────────────────

@_register(
    r"^(?:extract text|get text|read page|read this page|what(?:'s| is) on this page)$",
    "extract text from page"
)
def _extract_text(m: re.Match) -> Dict[str, Any]:
    return {"action": "EXTRACT_TEXT"}


# ── Public API ────────────────────────────────────────────────────────────────

class RouterResult:
    __slots__ = ("command", "confidence", "latency_ms", "tier")

    def __init__(
        self,
        command: Optional[Dict[str, Any]],
        confidence: float,
        latency_ms: float,
        tier: str,
    ):
        self.command     = command
        self.confidence  = confidence
        self.latency_ms  = latency_ms
        self.tier        = tier   # "deterministic" | "llm" | "none"


def route(text: str) -> RouterResult:
    """
    Try to deterministically parse *text* into a command dict.

    Returns a RouterResult.  If ``.command`` is None, the caller should
    escalate to the LLM fallback (Tier 2).
    """
    t0 = time.perf_counter()
    text = text.strip()

    if not text:
        return RouterResult(None, 0.0, 0.0, "none")

    for pat in _patterns:
        m = pat.regex.match(text)
        if m:
            result = pat.handler(m)
            latency = (time.perf_counter() - t0) * 1000
            if result is not None:
                logger.info(
                    "[ROUTER] Deterministic match  pattern=%r  command=%s  %.1fms",
                    pat.description, result, latency
                )
                return RouterResult(result, 1.0, latency, "deterministic")

    latency = (time.perf_counter() - t0) * 1000
    logger.info("[ROUTER] No deterministic match for %r  →  escalating  %.1fms", text, latency)
    return RouterResult(None, 0.0, latency, "none")
