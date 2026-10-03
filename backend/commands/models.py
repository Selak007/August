"""
August – Pydantic command models.

Every action the Chrome extension can execute is described here.
Commands arriving over WebSocket are validated against these models before
being dispatched.  Anything that doesn't match is rejected cleanly.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Whitelisted actions ───────────────────────────────────────────────────────

class Action(str, Enum):
    OPEN_URL        = "OPEN_URL"
    NEW_TAB         = "NEW_TAB"
    TAB_CLOSE       = "TAB_CLOSE"
    TAB_NEXT        = "TAB_NEXT"
    TAB_PREVIOUS    = "TAB_PREVIOUS"
    RELOAD          = "RELOAD"
    GO_BACK         = "GO_BACK"
    GO_FORWARD      = "GO_FORWARD"
    SCROLL          = "SCROLL"
    SEARCH          = "SEARCH"
    CLICK           = "CLICK"
    TYPE            = "TYPE"
    EXTRACT_TEXT    = "EXTRACT_TEXT"


class ScrollDirection(str, Enum):
    UP   = "UP"
    DOWN = "DOWN"
    LEFT = "LEFT"
    RIGHT = "RIGHT"


class SearchEngine(str, Enum):
    GOOGLE  = "google"
    YOUTUBE = "youtube"
    BING    = "bing"
    DUCKDUCKGO = "duckduckgo"


# ── Individual command models ─────────────────────────────────────────────────

class OpenURLCommand(BaseModel):
    action: Literal[Action.OPEN_URL] = Action.OPEN_URL
    url: str

    @field_validator("url")
    @classmethod
    def ensure_scheme(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        return v


class NewTabCommand(BaseModel):
    action: Literal[Action.NEW_TAB] = Action.NEW_TAB
    url: Optional[str] = None


class TabCloseCommand(BaseModel):
    action: Literal[Action.TAB_CLOSE] = Action.TAB_CLOSE


class TabNextCommand(BaseModel):
    action: Literal[Action.TAB_NEXT] = Action.TAB_NEXT


class TabPreviousCommand(BaseModel):
    action: Literal[Action.TAB_PREVIOUS] = Action.TAB_PREVIOUS


class ReloadCommand(BaseModel):
    action: Literal[Action.RELOAD] = Action.RELOAD


class GoBackCommand(BaseModel):
    action: Literal[Action.GO_BACK] = Action.GO_BACK


class GoForwardCommand(BaseModel):
    action: Literal[Action.GO_FORWARD] = Action.GO_FORWARD


class ScrollCommand(BaseModel):
    action: Literal[Action.SCROLL] = Action.SCROLL
    direction: ScrollDirection = ScrollDirection.DOWN
    amount: int = Field(default=400, ge=1, le=5000)


class SearchCommand(BaseModel):
    action: Literal[Action.SEARCH] = Action.SEARCH
    engine: SearchEngine = SearchEngine.GOOGLE
    query: str

    @field_validator("query")
    @classmethod
    def non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("query must not be empty")
        return v


class ClickCommand(BaseModel):
    action: Literal[Action.CLICK] = Action.CLICK
    target: str  # semantic target, e.g. "first_video", "search_button"


class TypeCommand(BaseModel):
    action: Literal[Action.TYPE] = Action.TYPE
    text: str
    target: Optional[str] = None


class ExtractTextCommand(BaseModel):
    action: Literal[Action.EXTRACT_TEXT] = Action.EXTRACT_TEXT
    selector: Optional[str] = None


# ── Discriminated union ───────────────────────────────────────────────────────

AugustCommand = Union[
    OpenURLCommand,
    NewTabCommand,
    TabCloseCommand,
    TabNextCommand,
    TabPreviousCommand,
    ReloadCommand,
    GoBackCommand,
    GoForwardCommand,
    ScrollCommand,
    SearchCommand,
    ClickCommand,
    TypeCommand,
    ExtractTextCommand,
]


# ── Wire envelope ─────────────────────────────────────────────────────────────

class CommandEnvelope(BaseModel):
    """Top-level message sent over WebSocket to the extension."""
    id: str                     # uuid, for correlation
    command: Dict[str, Any]     # raw dict; validated by parse_command()
    source: str = "deterministic"  # "deterministic" | "llm"


class ResultEnvelope(BaseModel):
    """Message received back from the extension."""
    id: str
    status: Literal["SUCCESS", "FAILURE", "UNSUPPORTED"]
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


# ── Helper ────────────────────────────────────────────────────────────────────

from pydantic import TypeAdapter

_adapter: TypeAdapter[AugustCommand] = TypeAdapter(
    Annotated_union_workaround := AugustCommand  # type: ignore[assignment]
)


def parse_command(raw: Dict[str, Any]) -> AugustCommand:
    """
    Parse and validate a raw dict into a typed AugustCommand.

    Raises ValueError with a human-readable message on failure.
    """
    action_str = raw.get("action", "")
    if not action_str:
        raise ValueError("Command is missing the 'action' field.")

    try:
        Action(action_str)  # validate it's a known action
    except ValueError:
        raise ValueError(
            f"Unsupported action: '{action_str}'. "
            f"Allowed: {[a.value for a in Action]}"
        )

    # Route to the correct model
    _map = {
        Action.OPEN_URL:     OpenURLCommand,
        Action.NEW_TAB:      NewTabCommand,
        Action.TAB_CLOSE:    TabCloseCommand,
        Action.TAB_NEXT:     TabNextCommand,
        Action.TAB_PREVIOUS: TabPreviousCommand,
        Action.RELOAD:       ReloadCommand,
        Action.GO_BACK:      GoBackCommand,
        Action.GO_FORWARD:   GoForwardCommand,
        Action.SCROLL:       ScrollCommand,
        Action.SEARCH:       SearchCommand,
        Action.CLICK:        ClickCommand,
        Action.TYPE:         TypeCommand,
        Action.EXTRACT_TEXT: ExtractTextCommand,
    }

    model_cls = _map[Action(action_str)]
    return model_cls.model_validate(raw)
