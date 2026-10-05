"""August — command model validation (mirrors extension/schema.js)."""

import pytest

from backend.commands.models import command_to_wire, parse_command


@pytest.mark.parametrize("raw", [
    {"action": "EVAL"},
    {},
    {"action": "OPEN_URL", "url": "javascript:alert(1)"},
    {"action": "OPEN_URL", "url": "file:///etc/passwd"},
    {"action": "SEARCH", "query": "   "},
    {"action": "TYPE", "text": ""},
    {"action": "PRESS_KEY", "key": "F12"},
    {"action": "TAB_GOTO"},
    {"action": "TAB_GOTO", "index": 0},
    {"action": "HINTS", "op": "click"},
    {"action": "MEDIA", "op": "explode"},
    {"action": "MEDIA", "op": "speed", "rate": 50},
    {"action": "ZOOM", "direction": "SIDEWAYS"},
])
def test_invalid_commands_rejected(raw):
    with pytest.raises(ValueError):
        parse_command(raw)


def test_wire_format_drops_nulls_and_uses_strings():
    assert command_to_wire(parse_command({"action": "TAB_GOTO", "query": "gmail"})) == {"action": "TAB_GOTO", "query": "gmail"}
    assert command_to_wire(parse_command({"action": "SEARCH", "engine": "amazon", "query": "mouse"})) == {
        "action": "SEARCH", "engine": "amazon", "query": "mouse",
    }
    assert command_to_wire(parse_command({"action": "TYPE", "text": "", "clear": True})) == {
        "action": "TYPE", "text": "", "clear": True, "submit": False,
    }


def test_open_url_adds_scheme():
    assert parse_command({"action": "OPEN_URL", "url": "github.com"}).url == "https://github.com"
    assert parse_command({"action": "OPEN_URL", "url": "localhost:3000/app"}).url == "https://localhost:3000/app"
