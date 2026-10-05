"""
August – Pydantic command models.

Every action the Chrome extension can execute is described here.
Commands arriving over WebSocket are validated against these models before
being dispatched.  Anything that doesn't match is rejected cleanly.

Mirrors extension/schema.js (the extension re-validates everything it receives).
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, Literal, Optional, Union
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Whitelisted actions ───────────────────────────────────────────────────────

class Action(str, Enum):
    OPEN_URL         = "OPEN_URL"
    NEW_TAB          = "NEW_TAB"
    NEW_WINDOW       = "NEW_WINDOW"
    TAB_CLOSE        = "TAB_CLOSE"
    TAB_CLOSE_OTHERS = "TAB_CLOSE_OTHERS"
    TAB_NEXT         = "TAB_NEXT"
    TAB_PREVIOUS     = "TAB_PREVIOUS"
    TAB_GOTO         = "TAB_GOTO"
    TAB_REOPEN       = "TAB_REOPEN"
    TAB_DUPLICATE    = "TAB_DUPLICATE"
    TAB_PIN          = "TAB_PIN"
    TAB_MUTE         = "TAB_MUTE"
    RELOAD           = "RELOAD"
    GO_BACK          = "GO_BACK"
    GO_FORWARD       = "GO_FORWARD"
    SCROLL           = "SCROLL"
    SEARCH           = "SEARCH"
    CLICK            = "CLICK"
    TYPE             = "TYPE"
    PRESS_KEY        = "PRESS_KEY"
    EXTRACT_TEXT     = "EXTRACT_TEXT"
    MEDIA            = "MEDIA"
    ZOOM             = "ZOOM"
    FULLSCREEN       = "FULLSCREEN"
    HINTS            = "HINTS"
    HELP             = "HELP"
    STOP             = "STOP"


class ScrollDirection(str, Enum):
    UP    = "UP"
    DOWN  = "DOWN"
    LEFT  = "LEFT"
    RIGHT = "RIGHT"


class SearchEngine(str, Enum):
    GOOGLE        = "google"
    YOUTUBE       = "youtube"
    BING          = "bing"
    DUCKDUCKGO    = "duckduckgo"
    AMAZON        = "amazon"
    WIKIPEDIA     = "wikipedia"
    GITHUB        = "github"
    REDDIT        = "reddit"
    MAPS          = "maps"
    STACKOVERFLOW = "stackoverflow"


Key = Literal[
    "Enter", "Escape", "Tab", "Space", "Backspace", "Delete",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "PageUp", "PageDown", "Home", "End",
]

MediaOp = Literal["play", "pause", "toggle", "forward", "rewind", "speed", "faster", "slower", "restart"]


def _normalize_url(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("url must not be empty")
    if not re.match(r"^[a-z][a-z0-9+.-]*:", v, re.I) or re.match(r"^[\w.-]+:\d+(?:/|$)", v):
        v = "https://" + v
    if urlparse(v).scheme not in ("http", "https"):
        raise ValueError(f"blocked URL scheme: {urlparse(v).scheme}")
    return v


# ── Individual command models ─────────────────────────────────────────────────

class OpenURLCommand(BaseModel):
    action: Literal[Action.OPEN_URL] = Action.OPEN_URL
    url: str

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        return _normalize_url(v)


class NewTabCommand(BaseModel):
    action: Literal[Action.NEW_TAB] = Action.NEW_TAB
    url: Optional[str] = None

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_url(v) if v else None


class NewWindowCommand(BaseModel):
    action: Literal[Action.NEW_WINDOW] = Action.NEW_WINDOW
    incognito: bool = False


class TabCloseCommand(BaseModel):
    action: Literal[Action.TAB_CLOSE] = Action.TAB_CLOSE


class TabCloseOthersCommand(BaseModel):
    action: Literal[Action.TAB_CLOSE_OTHERS] = Action.TAB_CLOSE_OTHERS


class TabNextCommand(BaseModel):
    action: Literal[Action.TAB_NEXT] = Action.TAB_NEXT


class TabPreviousCommand(BaseModel):
    action: Literal[Action.TAB_PREVIOUS] = Action.TAB_PREVIOUS


class TabGotoCommand(BaseModel):
    """Switch to tab by 1-based index (-1 = last) or by title/URL query."""
    action: Literal[Action.TAB_GOTO] = Action.TAB_GOTO
    index: Optional[int] = Field(default=None, ge=-1)
    query: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def index_or_query(self) -> "TabGotoCommand":
        if self.index == 0:
            raise ValueError("tab index is 1-based")
        if self.index is None and not (self.query or "").strip():
            raise ValueError("TAB_GOTO needs an index or a query")
        return self


class TabReopenCommand(BaseModel):
    action: Literal[Action.TAB_REOPEN] = Action.TAB_REOPEN


class TabDuplicateCommand(BaseModel):
    action: Literal[Action.TAB_DUPLICATE] = Action.TAB_DUPLICATE


class TabPinCommand(BaseModel):
    action: Literal[Action.TAB_PIN] = Action.TAB_PIN
    pinned: Optional[bool] = None   # None = toggle


class TabMuteCommand(BaseModel):
    action: Literal[Action.TAB_MUTE] = Action.TAB_MUTE
    muted: Optional[bool] = None    # None = toggle


class ReloadCommand(BaseModel):
    action: Literal[Action.RELOAD] = Action.RELOAD


class GoBackCommand(BaseModel):
    action: Literal[Action.GO_BACK] = Action.GO_BACK


class GoForwardCommand(BaseModel):
    action: Literal[Action.GO_FORWARD] = Action.GO_FORWARD


class ScrollCommand(BaseModel):
    action: Literal[Action.SCROLL] = Action.SCROLL
    direction: ScrollDirection = ScrollDirection.DOWN
    amount: int = Field(default=450, ge=1, le=20000)


class SearchCommand(BaseModel):
    action: Literal[Action.SEARCH] = Action.SEARCH
    engine: SearchEngine = SearchEngine.GOOGLE
    query: str = Field(max_length=500)

    @field_validator("query")
    @classmethod
    def non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("query must not be empty")
        return v


class ClickCommand(BaseModel):
    action: Literal[Action.CLICK] = Action.CLICK
    target: str = Field(min_length=1, max_length=200)  # semantic target, e.g. "first_video", "sign_in"


class TypeCommand(BaseModel):
    action: Literal[Action.TYPE] = Action.TYPE
    text: str = Field(default="", max_length=5000)
    target: Optional[str] = None
    clear: bool = False
    submit: bool = False

    @model_validator(mode="after")
    def something_to_do(self) -> "TypeCommand":
        if not self.text and not self.clear:
            raise ValueError("nothing to type")
        return self


class PressKeyCommand(BaseModel):
    action: Literal[Action.PRESS_KEY] = Action.PRESS_KEY
    key: Key


class ExtractTextCommand(BaseModel):
    action: Literal[Action.EXTRACT_TEXT] = Action.EXTRACT_TEXT
    selector: Optional[str] = None
    source: Literal["page", "selection"] = "page"
    speak: bool = False


class MediaCommand(BaseModel):
    action: Literal[Action.MEDIA] = Action.MEDIA
    op: MediaOp
    seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    rate: Optional[float] = Field(default=None, ge=0.25, le=4)


class ZoomCommand(BaseModel):
    action: Literal[Action.ZOOM] = Action.ZOOM
    direction: Literal["IN", "OUT", "RESET"]


class FullscreenCommand(BaseModel):
    action: Literal[Action.FULLSCREEN] = Action.FULLSCREEN
    enabled: Optional[bool] = None  # None = toggle


class HintsCommand(BaseModel):
    action: Literal[Action.HINTS] = Action.HINTS
    op: Literal["show", "hide", "click"]
    number: Optional[int] = Field(default=None, ge=1)

    @model_validator(mode="after")
    def number_for_click(self) -> "HintsCommand":
        if self.op == "click" and self.number is None:
            raise ValueError("HINTS click needs a number")
        return self


class HelpCommand(BaseModel):
    action: Literal[Action.HELP] = Action.HELP


class StopCommand(BaseModel):
    action: Literal[Action.STOP] = Action.STOP


# ── Union ─────────────────────────────────────────────────────────────────────

_MODELS: Dict[Action, type[BaseModel]] = {
    Action.OPEN_URL:         OpenURLCommand,
    Action.NEW_TAB:          NewTabCommand,
    Action.NEW_WINDOW:       NewWindowCommand,
    Action.TAB_CLOSE:        TabCloseCommand,
    Action.TAB_CLOSE_OTHERS: TabCloseOthersCommand,
    Action.TAB_NEXT:         TabNextCommand,
    Action.TAB_PREVIOUS:     TabPreviousCommand,
    Action.TAB_GOTO:         TabGotoCommand,
    Action.TAB_REOPEN:       TabReopenCommand,
    Action.TAB_DUPLICATE:    TabDuplicateCommand,
    Action.TAB_PIN:          TabPinCommand,
    Action.TAB_MUTE:         TabMuteCommand,
    Action.RELOAD:           ReloadCommand,
    Action.GO_BACK:          GoBackCommand,
    Action.GO_FORWARD:       GoForwardCommand,
    Action.SCROLL:           ScrollCommand,
    Action.SEARCH:           SearchCommand,
    Action.CLICK:            ClickCommand,
    Action.TYPE:             TypeCommand,
    Action.PRESS_KEY:        PressKeyCommand,
    Action.EXTRACT_TEXT:     ExtractTextCommand,
    Action.MEDIA:            MediaCommand,
    Action.ZOOM:             ZoomCommand,
    Action.FULLSCREEN:       FullscreenCommand,
    Action.HINTS:            HintsCommand,
    Action.HELP:             HelpCommand,
    Action.STOP:             StopCommand,
}

AugustCommand = Union[tuple(_MODELS.values())]  # type: ignore[valid-type]


# ── Wire envelopes ────────────────────────────────────────────────────────────

class CommandEnvelope(BaseModel):
    """Top-level message sent over WebSocket to the extension."""
    id: str                        # uuid, for correlation
    command: Dict[str, Any]        # raw dict; validated by parse_command()
    source: str = "deterministic"  # "deterministic" | "llm"


class ResultEnvelope(BaseModel):
    """Message received back from the extension."""
    id: str
    status: Literal["SUCCESS", "FAILURE", "UNSUPPORTED"]
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_command(raw: Dict[str, Any]) -> BaseModel:
    """
    Parse and validate a raw dict into a typed command model.

    Raises ValueError with a human-readable message on failure.
    """
    action_str = raw.get("action", "")
    if not action_str:
        raise ValueError("Command is missing the 'action' field.")

    try:
        action = Action(action_str)
    except ValueError:
        raise ValueError(
            f"Unsupported action: '{action_str}'. "
            f"Allowed: {[a.value for a in Action]}"
        )

    return _MODELS[action].model_validate(raw)


def command_to_wire(cmd: BaseModel) -> Dict[str, Any]:
    """JSON-safe dict for the extension (enums as strings, unset optionals dropped)."""
    return cmd.model_dump(mode="json", exclude_none=True)
