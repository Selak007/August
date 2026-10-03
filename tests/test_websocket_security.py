"""
August — WebSocket Security & Origin Verification Tests.

Ensures malicious webpages on the internet cannot connect to the local
WebSocket server to inject browser commands.
"""

import pytest
from starlette.websockets import WebSocketDisconnect
from fastapi.testclient import TestClient
from backend.main import app
from backend.config import config


def test_websocket_rejects_unauthorized_origin():
    """Websites like https://evil.com should be immediately rejected with 1008 policy violation."""
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(
            "/ws",
            headers={"origin": "https://evil.com"}
        ):
            pass
    assert exc_info.value.code == 1008
    assert "Unauthorized origin" in exc_info.value.reason


def test_websocket_accepts_chrome_extension_origin():
    """Chrome extension origins (chrome-extension://<id>) must be allowed."""
    client = TestClient(app)
    with client.websocket_connect(
        "/ws",
        headers={"origin": "chrome-extension://abcdefghijklmnop"}
    ) as ws:
        assert ws is not None


def test_websocket_accepts_localhost_origin():
    """Localhost origin (http://127.0.0.1) for local tools must be allowed."""
    client = TestClient(app)
    with client.websocket_connect(
        "/ws",
        headers={"origin": "http://127.0.0.1:8765"}
    ) as ws:
        assert ws is not None


def test_websocket_rejects_invalid_token():
    """Supplying a wrong auth token must be rejected with 1008 policy violation."""
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect(
            "/ws?token=invalid_hacker_token",
            headers={"origin": "chrome-extension://abcdefghijklmnop"}
        ):
            pass
    assert exc_info.value.code == 1008
    assert "Invalid authentication token" in exc_info.value.reason
