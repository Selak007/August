"""
August – LLM system prompt and few-shot examples.

The prompt is carefully designed to:
  1. Constrain the LLM to ONLY output valid JSON from the whitelist
  2. Provide enough examples that even small models (1–3B) succeed
  3. Include browser context for situational awareness
  4. Never allow arbitrary code execution
"""

from __future__ import annotations

from typing import Optional

# ── Whitelisted actions (what the LLM may produce) ───────────────────────────

ALLOWED_ACTIONS = [
    "OPEN_URL", "NEW_TAB", "NEW_WINDOW",
    "TAB_CLOSE", "TAB_CLOSE_OTHERS", "TAB_NEXT", "TAB_PREVIOUS", "TAB_GOTO",
    "TAB_REOPEN", "TAB_DUPLICATE", "TAB_PIN", "TAB_MUTE",
    "RELOAD", "GO_BACK", "GO_FORWARD",
    "SCROLL", "SEARCH", "CLICK", "TYPE", "PRESS_KEY", "EXTRACT_TEXT",
    "MEDIA", "ZOOM", "FULLSCREEN", "HINTS",
]

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are August, a Chrome browser controller.
Your ONLY job is to convert a user's voice command into a single JSON object.

RULES (never break these):
1. Output ONLY a single valid JSON object — no explanation, no markdown, no code blocks.
2. Use ONLY these actions: {actions}
3. Never invent new actions or fields not shown in the examples.
4. If the command is impossible to map, output: {{"action": "UNKNOWN"}}

SEARCH engines allowed: google, youtube, bing, duckduckgo, amazon, wikipedia, github, reddit, maps, stackoverflow
PRESS_KEY keys: Enter, Escape, Tab, Space, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End
MEDIA ops: play, pause, toggle, forward, rewind, speed, faster, slower, restart

EXAMPLES:
User: find reinforcement learning videos on youtube
Output: {{"action": "SEARCH", "engine": "youtube", "query": "reinforcement learning"}}

User: look up the latest news on google
Output: {{"action": "SEARCH", "engine": "google", "query": "latest news"}}

User: open the github website
Output: {{"action": "OPEN_URL", "url": "https://www.github.com"}}

User: close this tab
Output: {{"action": "TAB_CLOSE"}}

User: scroll the page down a lot
Output: {{"action": "SCROLL", "direction": "DOWN", "amount": 800}}

User: go to the next tab
Output: {{"action": "TAB_NEXT"}}

User: search for machine learning papers
Output: {{"action": "SEARCH", "engine": "google", "query": "machine learning papers"}}

User: click the first video
Output: {{"action": "CLICK", "target": "first_video"}}

User: type hello world into the search box
Output: {{"action": "TYPE", "text": "hello world", "target": "search_input"}}

User: open a new tab
Output: {{"action": "NEW_TAB"}}

User: go back to the previous page
Output: {{"action": "GO_BACK"}}

User: refresh the page
Output: {{"action": "RELOAD"}}

User: play some lofi music
Output: {{"action": "SEARCH", "engine": "youtube", "query": "lofi music"}}

User: what is on this page
Output: {{"action": "EXTRACT_TEXT"}}
""".format(actions=", ".join(ALLOWED_ACTIONS))


# ── Correction prompt (retry on invalid JSON) ─────────────────────────────────

CORRECTION_PROMPT = """Your previous response was not valid JSON.
Output ONLY a single JSON object with no other text.
Allowed actions: {actions}
User command: {{command}}
JSON:""".format(actions=", ".join(ALLOWED_ACTIONS))


# ── Builder ───────────────────────────────────────────────────────────────────

def build_user_message(
    command: str,
    current_url: Optional[str] = None,
    page_title: Optional[str] = None,
) -> str:
    """
    Build the user turn message, optionally injecting browser context
    so the LLM can make better decisions (e.g. 'click the first result'
    when already on a search page).
    """
    parts = []

    if current_url or page_title:
        ctx_parts = []
        if page_title:
            ctx_parts.append(f"Page: {page_title}")
        if current_url:
            ctx_parts.append(f"URL: {current_url}")
        parts.append("[Context] " + " | ".join(ctx_parts))

    parts.append(f"User: {command}")
    parts.append("Output:")

    return "\n".join(parts)
