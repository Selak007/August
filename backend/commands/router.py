"""
August – Deterministic command router (Tier 1).

Maps transcribed text → a command dict without touching the LLM.
Patterns are applied in order; the first match whose handler returns a
command wins.

Mirrors extension/router.js. Both are checked against the shared fixture
tests/router_parity_cases.json — update both when adding a pattern.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

Command = Dict[str, Any]
Context = Dict[str, Any]

# ── Site map & aliases ────────────────────────────────────────────────────────

SITE_MAP: Dict[str, str] = {
    "youtube":         "https://www.youtube.com",
    "youtube music":   "https://music.youtube.com",
    "google":          "https://www.google.com",
    "google docs":     "https://docs.google.com",
    "google drive":    "https://drive.google.com",
    "google maps":     "https://maps.google.com",
    "maps":            "https://maps.google.com",
    "google calendar": "https://calendar.google.com",
    "calendar":        "https://calendar.google.com",
    "github":          "https://www.github.com",
    "gmail":           "https://mail.google.com",
    "outlook":         "https://outlook.live.com",
    "twitter":         "https://www.twitter.com",
    "x":               "https://www.x.com",
    "reddit":          "https://www.reddit.com",
    "netflix":         "https://www.netflix.com",
    "twitch":          "https://www.twitch.tv",
    "wikipedia":       "https://www.wikipedia.org",
    "stackoverflow":   "https://stackoverflow.com",
    "hacker news":     "https://news.ycombinator.com",
    "linkedin":        "https://www.linkedin.com",
    "amazon":          "https://www.amazon.com",
    "chatgpt":         "https://chat.openai.com",
    "smart":           "https://chat.openai.com",   # "open smart" → ChatGPT
    "gpt":             "https://chat.openai.com",
    "copilot":         "https://copilot.microsoft.com",
    "gemini":          "https://gemini.google.com",
    "claude":          "https://claude.ai",
    "perplexity":      "https://www.perplexity.ai",
    "notion":          "https://www.notion.so",
    "spotify":         "https://open.spotify.com",
    "discord":         "https://discord.com",
    "whatsapp":        "https://web.whatsapp.com",
    "instagram":       "https://www.instagram.com",
    "facebook":        "https://www.facebook.com",
    "figma":           "https://www.figma.com",
    "vercel":          "https://vercel.com",
    "huggingface":     "https://huggingface.co",
}

_SITE_KEYS_BY_LENGTH = sorted(SITE_MAP, key=len, reverse=True)

SEARCH_ENGINES: Dict[str, str] = {
    "google":        "https://www.google.com/search?q={query}",
    "youtube":       "https://www.youtube.com/results?search_query={query}",
    "bing":          "https://www.bing.com/search?q={query}",
    "duckduckgo":    "https://duckduckgo.com/?q={query}",
    "amazon":        "https://www.amazon.com/s?k={query}",
    "wikipedia":     "https://en.wikipedia.org/w/index.php?search={query}",
    "github":        "https://github.com/search?q={query}",
    "reddit":        "https://www.reddit.com/search/?q={query}",
    "maps":          "https://www.google.com/maps/search/{query}",
    "stackoverflow": "https://stackoverflow.com/search?q={query}",
}

_ENGINES = "google|youtube|bing|duckduckgo|amazon|wikipedia|github|reddit|maps|stack ?overflow"

KEY_NAMES: Dict[str, str] = {
    "enter": "Enter", "return": "Enter",
    "escape": "Escape", "esc": "Escape",
    "tab": "Tab", "space": "Space", "spacebar": "Space",
    "backspace": "Backspace", "delete": "Delete",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "arrow up": "ArrowUp", "arrow down": "ArrowDown", "arrow left": "ArrowLeft", "arrow right": "ArrowRight",
    "page up": "PageUp", "page down": "PageDown", "home": "Home", "end": "End",
}

NUMBER_WORDS: Dict[str, int] = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30,
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7,
    "eighth": 8, "ninth": 9, "tenth": 10, "last": -1,
    # Common speech-recognition homophones
    "to": 2, "too": 2, "for": 4, "won": 1,
}

_NUM = r"(\d+(?:st|nd|rd|th)?|" + "|".join(NUMBER_WORDS) + ")"

# A "type X in Y" target must look like a form field, so "type I live in London" types the whole phrase.
_FIELD_NOUNS = ("search|box|bar|field|input|textbox|text box|area|textarea|editor|form|email|password|"
                "username|name|comment|message|address|url|title|subject|description|chat")

_DEICTIC = re.compile(
    r"^(?:this|that|it|selection|the selection|selected text|the selected text|highlighted text|"
    r"the highlighted text|what i selected)$",
    re.IGNORECASE,
)


def parse_number(raw: Optional[str]) -> Optional[int]:
    s = (raw or "").strip().lower()
    m = re.match(r"^(\d+)(?:st|nd|rd|th)?$", s)
    if m:
        return int(m.group(1))
    return NUMBER_WORDS.get(s)


def _underscore(s: str) -> str:
    return re.sub(r"\s+", "_", s.strip().lower())


def _engine(raw: str) -> str:
    return re.sub(r"\s+", "", raw.lower())


# ── Utterance normalization ───────────────────────────────────────────────────

_WAKE_WORD = re.compile(r"^(?:(?:hey|hi|ok|okay|yo)\s+)?august\b[\s,]*", re.IGNORECASE)
_POLITE_PREFIX = re.compile(
    r"^(?:please|can you|could you|would you|will you|i want to|i'd like to|i would like to|let's|lets)\s+",
    re.IGNORECASE,
)
_POLITE_SUFFIX = re.compile(r"\s+(?:please|for me)$", re.IGNORECASE)
_TYPE_PREFIX = re.compile(r"^(?:type|write|input|enter)\s+\S", re.IGNORECASE)
_TRAILING_PUNCT = re.compile(r"[.!?,;:]+$")


def normalize_utterance(text: Optional[str]) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    if not _TYPE_PREFIX.match(t):
        t = _TRAILING_PUNCT.sub("", t).strip()
    while True:
        prev = t
        stripped = _WAKE_WORD.sub("", t, count=1)
        if stripped:
            t = stripped.strip()
        t = _POLITE_PREFIX.sub("", t, count=1).strip()
        if t == prev:
            break
    if not _TYPE_PREFIX.match(t):
        t = _TRAILING_PUNCT.sub("", t).strip()
        while True:
            prev = t
            t = _POLITE_SUFFIX.sub("", t).strip()
            if t == prev:
                break
    return t


# ── Site resolution ───────────────────────────────────────────────────────────

def resolve_site_url(target: Optional[str]) -> Optional[str]:
    t = (target or "").lower().strip()
    t = re.sub(r"^(?:the|my)\s+", "", t)
    t = re.sub(r"\s+(?:website|web site|site|homepage|home page|page|app)$", "", t)
    t = re.sub(r"\s+dot\s+", ".", t).strip()
    if not t:
        return None

    bare = re.sub(r"/$", "", re.sub(r"^www\.", "", re.sub(r"^https?://", "", t)))
    for candidate in (t, re.sub(r"\s+", "", t), re.sub(r"\.com$", "", bare)):
        if candidate in SITE_MAP:
            return SITE_MAP[candidate]

    if re.match(r"^(?:https?://)?[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:/\S*)?$", t):
        return t if t.startswith("http") else f"https://{t}"

    for key in _SITE_KEYS_BY_LENGTH:
        if len(key) < 3:
            continue
        if re.search(rf"\b{re.escape(key)}\b", t):
            return SITE_MAP[key]
    return None


# ── Pattern registry ──────────────────────────────────────────────────────────

@dataclass
class Pattern:
    regex: re.Pattern
    handler: Callable[[re.Match, Context], Optional[Command]]
    description: str


_patterns: list[Pattern] = []


def _register(pattern: str, description: str):
    """Decorator – registers a compiled regex + its handler (order matters)."""
    def decorator(fn: Callable[[re.Match, Context], Optional[Command]]):
        _patterns.append(Pattern(re.compile(pattern, re.IGNORECASE), fn, description))
        return fn
    return decorator


# Meta

@_register(r"^(?:help|what can i say|what can you do|show (?:me )?(?:the |all )?commands|list (?:all )?commands|commands)$", "help")
def _help(m, ctx):
    return {"action": "HELP"}


@_register(r"^(?:stop|stop (?:reading|talking|speaking)|be quiet|quiet|shut up|silence|cancel|never mind|nevermind)$", "stop")
def _stop(m, ctx):
    return {"action": "STOP"}


# Click-by-number hints

@_register(r"^(?:show|display)(?: the)? (?:numbers|labels|hints|links|clickables|clickable elements)$", "show numbers")
def _hints_show(m, ctx):
    return {"action": "HINTS", "op": "show"}


@_register(r"^(?:hide|remove|clear)(?: the)? (?:numbers|labels|hints|links)$", "hide numbers")
def _hints_hide(m, ctx):
    return {"action": "HINTS", "op": "hide"}


@_register(rf"^(?:(?:click|press|tap|select|hit|choose|pick)(?: on)?(?: number)?|number|hint) {_NUM}$", "click <number>")
def _hints_click(m, ctx):
    n = parse_number(m.group(1))
    return {"action": "HINTS", "op": "click", "number": n} if n and n > 0 else None


@_register(r"^(\d{1,3})$", "<number>")
def _hints_bare(m, ctx):
    return {"action": "HINTS", "op": "click", "number": int(m.group(1))}


# Tabs & windows

@_register(r"^(?:new tab|open new tab|open a new tab|open tab)$", "new tab")
def _new_tab(m, ctx):
    return {"action": "NEW_TAB"}


@_register(r"^(?:open )?(?:a )?(?:new )?(?:incognito|private)(?: window| mode| tab)?$", "new incognito window")
def _incognito(m, ctx):
    return {"action": "NEW_WINDOW", "incognito": True}


@_register(r"^(?:open )?(?:a )?new window$", "new window")
def _new_window(m, ctx):
    return {"action": "NEW_WINDOW", "incognito": False}


@_register(r"^(?:close (?:all )?(?:the )?other tabs|close all tabs except (?:this|this one|the current one|current))$", "close other tabs")
def _close_others(m, ctx):
    return {"action": "TAB_CLOSE_OTHERS"}


@_register(r"^(?:close tab|close this tab|close current tab|close the tab|close the current tab)$", "close tab")
def _close_tab(m, ctx):
    return {"action": "TAB_CLOSE"}


@_register(r"^(?:reopen|restore|undo close|bring back|reopen closed|reopen last)(?: the)?(?: last)?(?: closed)? tab$", "reopen closed tab")
def _reopen(m, ctx):
    return {"action": "TAB_REOPEN"}


@_register(r"^duplicate(?: this| the| current)?(?: tab)?$", "duplicate tab")
def _duplicate(m, ctx):
    return {"action": "TAB_DUPLICATE"}


@_register(r"^(pin|unpin)(?: this| the| current)? tab$", "pin / unpin tab")
def _pin(m, ctx):
    return {"action": "TAB_PIN", "pinned": m.group(1).lower() == "pin"}


@_register(r"^(mute|unmute)(?: this| the| current)?(?: tab| page| site| video| audio| sound)?$", "mute / unmute tab")
def _mute(m, ctx):
    return {"action": "TAB_MUTE", "muted": m.group(1).lower() == "mute"}


@_register(r"^(?:next tab|switch to next tab|switch to the next tab|go to next tab|go to the next tab|tab right)$", "next tab")
def _next_tab(m, ctx):
    return {"action": "TAB_NEXT"}


@_register(r"^(?:previous tab|prev tab|switch to previous tab|switch to the previous tab|go to previous tab|go to the previous tab|tab left)$", "previous tab")
def _prev_tab(m, ctx):
    return {"action": "TAB_PREVIOUS"}


@_register(rf"^(?:(?:go|switch|jump|move) to )?(?:the )?tab (?:number )?{_NUM}$", "tab <n>")
def _tab_n(m, ctx):
    n = parse_number(m.group(1))
    return {"action": "TAB_GOTO", "index": n} if n else None


@_register(rf"^(?:(?:go|switch|jump|move) to )?(?:the )?{_NUM} tab$", "<nth> tab")
def _nth_tab(m, ctx):
    n = parse_number(m.group(1))
    return {"action": "TAB_GOTO", "index": n} if n else None


@_register(r"^(?:switch|jump|change) to (?:the )?(.+?)(?: tab)?$", "switch to <tab name>")
def _switch_to(m, ctx):
    return {"action": "TAB_GOTO", "query": m.group(1).strip()}


@_register(r"^(?:go to|find|show) (?:the |my )?(.+?) tab$", "go to <name> tab")
def _goto_named_tab(m, ctx):
    return {"action": "TAB_GOTO", "query": m.group(1).strip()}


# Refresh

@_register(r"^(?:reload|refresh)(?: the| this)?(?: page| tab)?$", "reload")
def _reload(m, ctx):
    return {"action": "RELOAD"}


# Media (before back/forward so "go back 10 seconds" seeks)

@_register(r"^(?:play|resume|unpause|continue)(?: the)?(?: video| music| audio| song| media)?$", "play")
def _play(m, ctx):
    return {"action": "MEDIA", "op": "play"}


@_register(r"^(?:pause|pause (?:the )?(?:video|music|audio|song|media)|stop (?:the )?(?:video|music|audio|song|media|playback))$", "pause")
def _pause(m, ctx):
    return {"action": "MEDIA", "op": "pause"}


@_register(r"^(?:play|watch|listen to) (.+?) on youtube$", "play <query> on youtube")
def _play_on_youtube(m, ctx):
    return {"action": "SEARCH", "engine": "youtube", "query": m.group(1).strip()}


@_register(rf"^(?:skip|fast forward|jump|seek)(?: ahead| forward)?(?: by)?(?: {_NUM}(?: seconds?| secs?| s)?)?$", "skip forward [n seconds]")
def _skip(m, ctx):
    return {"action": "MEDIA", "op": "forward", "seconds": (parse_number(m.group(1)) or 10) if m.group(1) else 10}


@_register(rf"^(?:go )?forward {_NUM} ?(?:seconds?|secs?|s)$", "forward <n> seconds")
def _forward_n(m, ctx):
    return {"action": "MEDIA", "op": "forward", "seconds": parse_number(m.group(1)) or 10}


@_register(rf"^(?:rewind|skip back(?:wards?)?|jump back|seek back)(?: by)?(?: {_NUM}(?: seconds?| secs?| s)?)?$", "rewind [n seconds]")
def _rewind(m, ctx):
    return {"action": "MEDIA", "op": "rewind", "seconds": (parse_number(m.group(1)) or 10) if m.group(1) else 10}


@_register(rf"^(?:go )?back {_NUM} ?(?:seconds?|secs?|s)$", "back <n> seconds")
def _back_n(m, ctx):
    return {"action": "MEDIA", "op": "rewind", "seconds": parse_number(m.group(1)) or 10}


@_register(r"^(?:restart|replay|start over)(?: the)?(?: video| song)?$", "restart video")
def _restart(m, ctx):
    return {"action": "MEDIA", "op": "restart"}


@_register(r"^(?:set )?(?:the )?(?:playback )?speed(?: to)? (\d+(?:\.\d+)?)(?: ?x| times)?$", "speed <rate>")
def _speed(m, ctx):
    rate = float(m.group(1))
    return {"action": "MEDIA", "op": "speed", "rate": int(rate) if rate.is_integer() else rate}


@_register(r"^(?:normal speed|reset speed|speed normal)$", "normal speed")
def _normal_speed(m, ctx):
    return {"action": "MEDIA", "op": "speed", "rate": 1}


@_register(r"^(?:play )?(faster|slower)$|^speed (up)$|^slow (down)$", "faster / slower")
def _faster_slower(m, ctx):
    word = m.group(1) or ("faster" if m.group(2) else "slower")
    return {"action": "MEDIA", "op": "faster" if word.lower() == "faster" else "slower"}


@_register(r"^skip (?:the )?ads?$", "skip ad")
def _skip_ad(m, ctx):
    return {"action": "CLICK", "target": "skip_ad"}


# Navigation history

@_register(r"^(?:go back|back|navigate back|previous page|go to (?:the )?previous page)$", "go back")
def _go_back(m, ctx):
    return {"action": "GO_BACK"}


@_register(r"^(?:go forward|forward|navigate forward|next page|go to (?:the )?next page)$", "go forward")
def _go_forward(m, ctx):
    return {"action": "GO_FORWARD"}


# Zoom & window

@_register(r"^zoom (in|out)$", "zoom in / out")
def _zoom(m, ctx):
    return {"action": "ZOOM", "direction": m.group(1).upper()}


@_register(r"^(?:make (?:it|the page|the text|text) )?(bigger|larger|smaller)$", "bigger / smaller")
def _bigger(m, ctx):
    return {"action": "ZOOM", "direction": "OUT" if m.group(1).lower() == "smaller" else "IN"}


@_register(r"^(?:reset zoom|zoom reset|actual size|normal size|zoom (?:to )?(?:normal|default|100(?: percent|%)?))$", "reset zoom")
def _zoom_reset(m, ctx):
    return {"action": "ZOOM", "direction": "RESET"}


@_register(r"^(?:exit|leave|close|stop) full ?screen(?: mode)?$", "exit fullscreen")
def _exit_fullscreen(m, ctx):
    return {"action": "FULLSCREEN", "enabled": False}


@_register(r"^(?:enter |go |toggle |make it )?full ?screen(?: mode)?$", "fullscreen")
def _fullscreen(m, ctx):
    return {"action": "FULLSCREEN"}


# Scrolling

@_register(r"^(?:scroll to (?:the )?top|go to (?:the )?top|top of (?:the )?page)$", "scroll to top")
def _scroll_top(m, ctx):
    return {"action": "SCROLL", "direction": "UP", "amount": 9999}


@_register(r"^(?:scroll to (?:the )?bottom|go to (?:the )?bottom|bottom of (?:the )?page)$", "scroll to bottom")
def _scroll_bottom(m, ctx):
    return {"action": "SCROLL", "direction": "DOWN", "amount": 9999}


@_register(rf"^(?:scroll|page) (down|up|left|right)(?: a bit| a little| a lot| more)?(?: by)?(?: {_NUM})?(?: times| pages| screens| pixels)?$", "scroll <direction> [amount]")
def _scroll(m, ctx):
    full = m.group(0).lower()
    amount = 1200 if "a lot" in full else 200 if ("a bit" in full or "a little" in full) else 450
    if m.group(2):
        n = parse_number(m.group(2))
        if n and n > 0:
            amount = n * 450 if n <= 20 else n
    return {"action": "SCROLL", "direction": m.group(1).upper(), "amount": amount}


# Search

@_register(rf"^(?:search|google|look up|look for|find)(?: for| up)? (.+?)(?: (?:on|in|using|with) ({_ENGINES}))?$", "search for this (selected text)")
def _search_selection(m, ctx):
    if not _DEICTIC.match(m.group(1).strip()):
        return None
    sel = (ctx.get("selectedText") or "").strip()
    if not sel:
        return None
    return {"action": "SEARCH", "engine": _engine(m.group(2)) if m.group(2) else "google", "query": sel[:500]}


@_register(rf"^search (?:(?:on|in|using|with) )?({_ENGINES}) (?:for )?(.+)$", "search <engine> for <query>")
def _search_engine_first(m, ctx):
    return {"action": "SEARCH", "engine": _engine(m.group(1)), "query": m.group(2).strip()}


@_register(rf"^(?:search|look up|look for|find)(?: for)? (.+) (?:on|in|using|with) ({_ENGINES})$", "search for <query> on <engine>")
def _search_query_first(m, ctx):
    return {"action": "SEARCH", "engine": _engine(m.group(2)), "query": m.group(1).strip()}


@_register(r"^(?:search youtube|youtube search) (?:for )?(.+)$", "search youtube for <query>")
def _search_youtube(m, ctx):
    return {"action": "SEARCH", "engine": "youtube", "query": m.group(1).strip()}


@_register(r"^(?:search|google|look up)(?: for)? (.+)$", "search <query>")
def _search_default(m, ctx):
    q = m.group(1).strip()
    return None if _DEICTIC.match(q) else {"action": "SEARCH", "engine": "google", "query": q}


# Keys & forms (before click, since "press enter" would match click)

@_register(r"^(?:press|hit|tap|push)(?: the)? (enter|return|escape|esc|tab|space|spacebar|backspace|delete|up|down|left|right|arrow up|arrow down|arrow left|arrow right|page up|page down|home|end)(?: key| button)?$", "press <key>")
def _press_key(m, ctx):
    return {"action": "PRESS_KEY", "key": KEY_NAMES[m.group(1).lower()]}


@_register(r"^(?:enter|escape|submit|submit (?:the |this )?form)$", "submit / escape")
def _submit(m, ctx):
    return {"action": "PRESS_KEY", "key": "Escape" if m.group(0).lower() == "escape" else "Enter"}


# Click & tap

@_register(r"^(?:click|press|tap|select|hit)(?: on)? (?:the )?(.+)$", "click <target>")
def _click(m, ctx):
    return {"action": "CLICK", "target": _underscore(m.group(1))}


# Type & input

_SUBMIT_SUFFIX = re.compile(r" and (?:press enter|hit enter|submit|search|send)$", re.IGNORECASE)


@_register(r"^(?:clear|erase|empty)(?: the| this)? (search box|search bar|search field|search input|search|input|field|text box|textbox|box)$", "clear <field>")
def _clear(m, ctx):
    return {"action": "TYPE", "text": "", "clear": True, "target": _underscore(m.group(1))}


@_register(rf"^(?:type|write|enter|input) [\"']?(.+?)[\"']? (?:in(?:to)?|inside) (?:the )?((?:[\w-]+ )?(?:{_FIELD_NOUNS}))(?: and (?:press enter|hit enter|submit|search|send))?$", "type <text> in <target> [and submit]")
def _type_into(m, ctx):
    cmd = {"action": "TYPE", "text": m.group(1).strip(), "target": _underscore(m.group(2))}
    if _SUBMIT_SUFFIX.search(m.group(0)):
        cmd["submit"] = True
    return cmd


@_register(r"^(?:type|write|enter|input) [\"']?(.+?)[\"']? and (?:press enter|hit enter|submit|search|send)$", "type <text> and submit")
def _type_submit(m, ctx):
    return {"action": "TYPE", "text": m.group(1).strip(), "submit": True}


@_register(r"^(?:type|write|enter|input) [\"']?(.+?)[\"']?$", "type <text>")
def _type_active(m, ctx):
    return {"action": "TYPE", "text": m.group(1).strip()}


# Read / extract

@_register(r"^(?:read|read out|read aloud)(?: the| this| my)? (?:selection|selected text|highlighted text|what i selected)(?: aloud| out loud)?$", "read selection")
def _read_selection(m, ctx):
    return {"action": "EXTRACT_TEXT", "source": "selection", "speak": True}


@_register(r"^(?:read (?:this|it)|read (?:this|it) (?:aloud|out loud))$", "read this")
def _read_this(m, ctx):
    source = "selection" if (ctx.get("selectedText") or "").strip() else "page"
    return {"action": "EXTRACT_TEXT", "source": source, "speak": True}


@_register(r"^(?:read page|read this page|read the page|read (?:the |this )?article|read aloud|read (?:the |this )?page (?:aloud|out loud)|what(?:'s| is) on (?:this|the) page)$", "read page aloud")
def _read_page(m, ctx):
    return {"action": "EXTRACT_TEXT", "source": "page", "speak": True}


@_register(r"^(?:extract text|get text|get (?:the )?page text|extract (?:the )?page text)$", "extract text")
def _extract_text(m, ctx):
    return {"action": "EXTRACT_TEXT", "source": "page"}


# Open URL / site (last: generic "open <x>")

@_register(r"^(?:open|go to|navigate to|visit|launch|take me to|show me)(?: up)? (.+)$", "open <site/url>")
def _open(m, ctx):
    url = resolve_site_url(m.group(1))
    return {"action": "OPEN_URL", "url": url} if url else None


# ── Public API ────────────────────────────────────────────────────────────────

class RouterResult:
    __slots__ = ("command", "confidence", "latency_ms", "tier", "description", "normalized")

    def __init__(
        self,
        command: Optional[Command],
        confidence: float,
        latency_ms: float,
        tier: str,
        description: str = "",
        normalized: str = "",
    ):
        self.command     = command
        self.confidence  = confidence
        self.latency_ms  = latency_ms
        self.tier        = tier   # "deterministic" | "none"
        self.description = description
        self.normalized  = normalized


def route(text: str, context: Optional[Context] = None) -> RouterResult:
    """
    Try to deterministically parse *text* into a command dict.

    *context* may contain ``selectedText`` for "search for this" / "read this".
    If ``.command`` is None, the caller should escalate to the LLM (Tier 2).
    """
    t0 = time.perf_counter()
    ctx = context or {}
    normalized = normalize_utterance(text)

    if not normalized:
        return RouterResult(None, 0.0, 0.0, "none", normalized=normalized)

    for pat in _patterns:
        m = pat.regex.match(normalized)
        if not m:
            continue
        result = pat.handler(m, ctx)
        if result is not None:
            latency = (time.perf_counter() - t0) * 1000
            logger.info(
                "[ROUTER] Deterministic match  pattern=%r  command=%s  %.1fms",
                pat.description, result, latency,
            )
            return RouterResult(result, 1.0, latency, "deterministic", pat.description, normalized)

    latency = (time.perf_counter() - t0) * 1000
    logger.info("[ROUTER] No deterministic match for %r  →  escalating  %.1fms", normalized, latency)
    return RouterResult(None, 0.0, latency, "none", normalized=normalized)
