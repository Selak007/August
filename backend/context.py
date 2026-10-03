"""
August – Browser Context Store

Holds the live state of the user's browser as reported by the Chrome extension.
Updated via WebSocket messages whenever:
  - The active tab changes
  - The page URL changes
  - The user selects text
  - The page finishes loading

This context is injected into LLM prompts so it can make
situationally-aware decisions.

Example:
    User: "summarize this"
    Context: {url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need"}
    LLM → EXTRACT_TEXT  (knows there's something to read)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class TabInfo:
    id: int
    url: str
    title: str
    active: bool = False
    index: int = 0


@dataclass
class BrowserContext:
    """Live browser state, updated by the Chrome extension."""

    # Active tab
    current_url:   str = ""
    page_title:    str = ""
    tab_id:        Optional[int] = None

    # User selection
    selected_text: str = ""

    # All open tabs in current window
    open_tabs: list[TabInfo] = field(default_factory=list)

    # Timestamps
    last_updated: Optional[datetime] = None
    last_url_change: Optional[datetime] = None

    def update_from_dict(self, data: dict) -> None:
        """Apply a context update dict from the extension."""
        changed = []

        if "url" in data and data["url"] != self.current_url:
            self.current_url = data["url"]
            self.last_url_change = datetime.now()
            changed.append("url")

        if "title" in data:
            self.page_title = data["title"]
            changed.append("title")

        if "tabId" in data:
            self.tab_id = data["tabId"]

        if "selectedText" in data:
            text = data["selectedText"].strip()
            if text != self.selected_text:
                self.selected_text = text
                if text:
                    changed.append("selection")

        if "tabs" in data:
            self.open_tabs = [
                TabInfo(
                    id=t.get("id", 0),
                    url=t.get("url", ""),
                    title=t.get("title", ""),
                    active=t.get("active", False),
                    index=t.get("index", 0),
                )
                for t in data["tabs"]
            ]

        self.last_updated = datetime.now()

        if changed:
            logger.debug(
                "[CONTEXT] Updated: %s  url=%s  title=%r",
                changed, self.current_url[:60], self.page_title[:40],
            )

    def to_llm_context(self) -> dict:
        """Return a dict suitable for injecting into LLM prompts."""
        ctx = {}
        if self.current_url:
            ctx["url"]   = self.current_url
        if self.page_title:
            ctx["title"] = self.page_title
        if self.selected_text:
            ctx["selected_text"] = self.selected_text[:500]
        if self.open_tabs:
            ctx["open_tabs"] = len(self.open_tabs)
        return ctx

    def summary(self) -> str:
        """Human-readable one-liner for logging."""
        parts = []
        if self.current_url:
            parts.append(self.current_url[:60])
        if self.page_title:
            parts.append(f'"{self.page_title[:40]}"')
        if self.selected_text:
            parts.append(f'sel={self.selected_text[:30]!r}')
        return " | ".join(parts) if parts else "(no context)"


# ── Singleton ─────────────────────────────────────────────────────────────────

browser_context = BrowserContext()
