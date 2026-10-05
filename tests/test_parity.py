"""
Router parity: backend/commands/router.py must agree with extension/router.js
on every case in tests/router_parity_cases.json (the JS side is checked by
tests/js/router.test.js). Every routed command must also pass the Pydantic models.
"""

import json
from pathlib import Path

import pytest

from backend.commands.models import command_to_wire, parse_command
from backend.commands.router import route

CASES = json.loads((Path(__file__).parent / "router_parity_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["utterance"] or "<empty>" for c in CASES])
def test_python_router_matches_fixture(case):
    assert route(case["utterance"], case.get("context")).command == case["expected"]


@pytest.mark.parametrize(
    "case", [c for c in CASES if c["expected"]], ids=[c["utterance"] for c in CASES if c["expected"]]
)
def test_routed_commands_validate(case):
    wire = command_to_wire(parse_command(case["expected"]))
    for key, value in case["expected"].items():
        if key == "url":
            assert wire[key].rstrip("/") == value.rstrip("/")
        else:
            assert wire[key] == value
