"""
August — Unit tests for the deterministic command router.

Run:  pytest tests/test_router.py -v
"""

import pytest
from backend.commands.router import route
from backend.commands.models import parse_command, Action


# ── Positive cases ────────────────────────────────────────────────────────────

class TestOpenSites:
    def test_open_youtube(self):
        r = route("open youtube")
        assert r.command == {"action": "OPEN_URL", "url": "https://www.youtube.com"}
        assert r.tier == "deterministic"

    def test_open_github(self):
        r = route("open github")
        assert r.command["action"] == "OPEN_URL"
        assert "github" in r.command["url"]

    def test_navigate_to_reddit(self):
        r = route("navigate to reddit")
        assert r.command["action"] == "OPEN_URL"

    def test_visit_google(self):
        r = route("visit google")
        assert r.command["action"] == "OPEN_URL"

    def test_open_smart(self):
        r = route("open smart")
        assert r.command == {"action": "OPEN_URL", "url": "https://chat.openai.com"}

    def test_open_chatgpt(self):
        r = route("open chatgpt")
        assert r.command == {"action": "OPEN_URL", "url": "https://chat.openai.com"}


class TestTabs:
    def test_new_tab(self):
        assert route("new tab").command == {"action": "NEW_TAB"}

    def test_open_new_tab(self):
        assert route("open new tab").command == {"action": "NEW_TAB"}

    def test_close_tab(self):
        assert route("close tab").command == {"action": "TAB_CLOSE"}

    def test_close_this_tab(self):
        assert route("close this tab").command == {"action": "TAB_CLOSE"}

    def test_next_tab(self):
        assert route("next tab").command == {"action": "TAB_NEXT"}

    def test_previous_tab(self):
        assert route("previous tab").command == {"action": "TAB_PREVIOUS"}

    def test_prev_tab(self):
        assert route("prev tab").command == {"action": "TAB_PREVIOUS"}


class TestNavigation:
    def test_go_back(self):
        assert route("go back").command == {"action": "GO_BACK"}

    def test_back(self):
        assert route("back").command == {"action": "GO_BACK"}

    def test_go_forward(self):
        assert route("go forward").command == {"action": "GO_FORWARD"}

    def test_reload(self):
        assert route("reload").command == {"action": "RELOAD"}

    def test_refresh(self):
        assert route("refresh").command == {"action": "RELOAD"}


class TestScroll:
    def test_scroll_down(self):
        r = route("scroll down")
        assert r.command["action"] == "SCROLL"
        assert r.command["direction"] == "DOWN"

    def test_scroll_up(self):
        r = route("scroll up")
        assert r.command["direction"] == "UP"

    def test_scroll_to_top(self):
        r = route("scroll to top")
        assert r.command["direction"] == "UP"
        assert r.command["amount"] == 9999

    def test_scroll_to_bottom(self):
        r = route("scroll to bottom")
        assert r.command["direction"] == "DOWN"
        assert r.command["amount"] == 9999


class TestSearch:
    def test_search_google(self):
        r = route("search google for machine learning")
        assert r.command == {"action": "SEARCH", "engine": "google", "query": "machine learning"}

    def test_search_youtube(self):
        r = route("search youtube for python tutorials")
        assert r.command == {"action": "SEARCH", "engine": "youtube", "query": "python tutorials"}

    def test_search_default(self):
        r = route("search for reinforcement learning")
        assert r.command["action"] == "SEARCH"
        assert r.command["engine"] == "google"
        assert "reinforcement" in r.command["query"]

    def test_google_shorthand(self):
        r = route("google transformers")
        assert r.command["action"] == "SEARCH"

    def test_search_query_first(self):
        r = route("search machine learning on youtube")
        assert r.command["engine"] == "youtube"
        assert "machine learning" in r.command["query"]


# ── Negative / escalation cases ───────────────────────────────────────────────

class TestEscalation:
    def test_empty_string(self):
        r = route("")
        assert r.command is None
        assert r.tier == "none"

    def test_gibberish(self):
        r = route("xyzzy plugh foobar")
        assert r.command is None

    def test_complex_command(self):
        r = route("find something interesting about reinforcement learning and open it")
        assert r.command is None  # Should escalate to LLM

    def test_whitespace_only(self):
        r = route("   ")
        assert r.command is None


# ── Model validation ──────────────────────────────────────────────────────────

class TestModelValidation:
    def test_open_url_adds_scheme(self):
        cmd = parse_command({"action": "OPEN_URL", "url": "youtube.com"})
        assert cmd.url == "https://youtube.com"

    def test_open_url_keeps_https(self):
        cmd = parse_command({"action": "OPEN_URL", "url": "https://github.com"})
        assert cmd.url == "https://github.com"

    def test_scroll_defaults(self):
        cmd = parse_command({"action": "SCROLL"})
        assert cmd.direction.value == "DOWN"
        assert cmd.amount == 450

    def test_scroll_amount_capped(self):
        with pytest.raises(Exception):
            parse_command({"action": "SCROLL", "amount": 99999})

    def test_missing_action(self):
        with pytest.raises(ValueError, match="missing the 'action' field"):
            parse_command({})

    def test_unknown_action(self):
        with pytest.raises(ValueError, match="Unsupported action"):
            parse_command({"action": "HACK_THE_PLANET"})

    def test_empty_search_query(self):
        with pytest.raises(Exception):
            parse_command({"action": "SEARCH", "query": "  ", "engine": "google"})
