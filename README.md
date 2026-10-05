# August — Local Voice-Controlled Chrome Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-yellow.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Zero API Cost](https://img.shields.io/badge/Zero%20Cost-100%25%20Local-brightgreen.svg)]()

> **Completely local, private, zero-API-cost voice assistant for Google Chrome.**
> 
> Controls tabs, windows, media, zoom and pages; clicks anything by number; types, reads pages aloud, and understands fuzzy requests with a local LLM — using a 3-tier architecture. Runs standalone in Chrome, or with an optional Python backend for offline Whisper speech.

---

## 🏛 3-Tier Architecture

```text
                                 MICROPHONE
                                     │ (Push-to-Talk: Ctrl + Space)
                                     ▼
                          Voice Activity Detection (VAD)
                                     │
                                     ▼
                          Speech-to-Text (Whisper tiny/base)
                                     │
                                     ▼
                              Command Router
                                /         \
                               /           \
                 Tier 1: Deterministic     Tier 2: Complex / Contextual
                    Regex Intent Map               Ollama LLM Fallback
                               \           /
                                \         /
                                     ▼
                              Validated JSON Command
                                     │
                                     ▼
                          Local WebSocket (127.0.0.1:8765)
                                     │
                                     ▼
                          Manifest V3 Chrome Extension
                           ├── Background Service Worker
                           ├── Content Scripts (DOM Engine)
                           ├── Side Panel (Live State & History)
                           └── Chrome TTS (Spoken Feedback)
```

---

## ⚡ Features

1. **Zero API cost, local first** — the extension works on its own; the Python backend is optional.
2. **Three tiers**
   - **Tier 0** — voice input: side-panel mic (push-to-talk or **hands-free**), or the backend's Whisper push-to-talk (`Ctrl + Space`).
   - **Tier 1** — deterministic router (< 1 ms) with wake-word/politeness cleanup ("hey August, please open github").
   - **Tier 2** — local AI fallback: Chrome built-in Gemini Nano (Prompt API) or Ollama.
3. **One command whitelist** — every command (router, LLM, backend) goes through `extension/schema.js` / `backend/commands/models.py` before it runs.
4. **Click anything** — "show numbers" puts a number on every clickable element; "click 12" clicks it.
5. **Tabs, media, zoom, keys, reading aloud** — see the command reference below or say **"help"**.
6. **Live browser context** — active tab, title, URL and selected text ("search for this", "read this").
7. **Persistent settings & history** — voice, speech rate, language, hands-free, wake word, AI fallback, backend connection.

---

## 🚀 Quick Start

### Option A — Extension only (no install)

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, pick `./extension`.
2. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> on macOS) — the side panel opens and starts listening.
3. The first time, click **Grant microphone access** if prompted (Chrome only shows the prompt in a normal tab).
4. Say **"help"** to see what you can say. Click **♾** for hands-free mode.

> Chrome's Web Speech API sends audio to Google's speech service. For fully offline speech, use Option B.

### Option B — With the Python backend (offline Whisper push-to-talk)

```bash
git clone https://github.com/Selak007/August.git && cd August
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt          # bridge + REST + tests
pip install -r requirements-audio.txt    # optional: mic + Whisper (needs PortAudio)
python -m backend.main
```

Then in the side panel: **⚙ Settings → Python backend → Connect to local backend** (default `ws://127.0.0.1:8765/ws`). Set the auth token if you changed `AUGUST_AUTH_TOKEN`. The badge shows **● Backend connected**; the extension reconnects automatically if the backend restarts.

Without the audio extras the backend still runs (bridge, `/command/text`, `/command/raw`) and logs that voice input is disabled.

### Optional — Local AI fallback

- **Gemini Nano**: used automatically when Chrome's built-in Prompt API is available.
- **Ollama**: `ollama pull llama3.2:1b && ollama serve`. URL/model can be changed in Settings.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> | Open side panel and start listening |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> | Start / stop listening (panel open) |
| *(unassigned)* | Stop speaking — set it in `chrome://extensions/shortcuts` |

---

## 🎙 Voice Commands

"Hey August", "please", "can you" and trailing punctuation are ignored. Say **"help"** for the in-panel list.

| Area | Examples |
|---|---|
| **Navigate** | "open youtube", "open netflix", "go to python.org", "open python dot org", "go back", "go forward", "reload" |
| **Search** | "search for cats", "search amazon for headphones", "find rust tutorials on github", "play lofi beats on youtube", *(text selected)* "search for this" |
| **Tabs** | "new tab", "close tab", "close other tabs", "next tab", "tab 3", "second tab", "last tab", "switch to gmail", "reopen closed tab", "duplicate tab", "pin tab", "mute tab" |
| **Windows** | "new window", "new incognito window", "fullscreen", "exit fullscreen" |
| **Page** | "scroll down", "scroll down 3", "scroll down a bit", "scroll to top", "zoom in", "zoom out", "reset zoom", "make it bigger" |
| **Click** | "show numbers" → "click 12" / "12", "hide numbers", "click sign in", "click the second result", "click the first video", "skip ad" |
| **Type & keys** | "type hello in search box", "type cats and submit", "type I live in London" (types into the focused field), "clear search box", "press enter", "press escape", "page down", "submit" |
| **Media** | "play", "pause", "skip 30 seconds", "rewind", "go back 10 seconds", "speed 1.5", "faster", "slower", "normal speed", "restart video" |
| **Read aloud** | "read page", "read this", "read selection", "stop" |
| **Meta** | "help", "stop" / "be quiet" |

Anything else goes to the Tier 2 fallback (if enabled), e.g. "take me to microsoft's website", "find something chill to listen to".

---

## 🗂 Project Layout

```text
extension/
  manifest.json     MV3 manifest (permissions, shortcuts)
  background.js     service worker: pipeline, settings/history, TTS, backend WebSocket client
  router.js         Tier 1 deterministic router + help text
  schema.js         command whitelist + validation (mirrors backend/commands/models.py)
  llm.js            Tier 2: Gemini Nano / Ollama
  commands.js       Chrome API handlers (tabs, windows, zoom, search, …)
  content.js        page actions: click/type/keys/scroll/media/number hints/read
  sidepanel.*       mic, hands-free, help, settings, history
  popup.*           quick status + command box
backend/
  main.py           FastAPI: /ws, /health, /command/text, /command/raw
  commands/         router.py (parity with router.js), models.py (Pydantic whitelist)
  websocket/        extension bridge (origin + token checks, PING/PONG, CONTEXT)
  pipeline.py       Whisper push-to-talk → router → LLM → extension (audio deps optional)
tests/
  router_parity_cases.json   shared JS/Python router fixture
  js/                        node:test suites for router, schema, LLM parsing
```

### Adding a command

1. Add the action to `extension/schema.js` (`ALLOWED_ACTIONS` + validation) and `backend/commands/models.py`.
2. Add a handler in `extension/commands.js` (Chrome APIs) or `extension/content.js` (page DOM).
3. Add a pattern to **both** `extension/router.js` and `backend/commands/router.py`, plus a case in `tests/router_parity_cases.json`.
4. Add an example to `COMMAND_HELP` in `router.js`.

---

## 🧪 Testing

```bash
npm test                     # JS: router parity, schema, LLM parsing (Node 20+, no deps)
npm run check                # syntax-check every extension file
python -m pytest -q          # Python: router, parity, models, WebSocket security/protocol
python tests/benchmark.py    # accuracy + latency benchmark (~100 utterances)
```

CI runs all of the above on every PR (`.github/workflows/ci.yml`).

---

## 🔒 Security Architecture

- **Origin Header Verification**: Validates `chrome-extension://` origin; rejects all unauthorized websites (`http://`, `https://`) with `WS 1008 Policy Violation`.
- **Shared Auth Token**: Pre-shared session token ensures only verified extension clients can send browser actions.
- **Strict Whitelist, Twice**: commands are validated by Pydantic in the backend *and* by `schema.js` in the extension; only `http(s)` URLs can be opened.
- **No Page-Forgeable Messages**: the content script only accepts commands over `chrome.runtime` messaging from the extension itself — web pages can't trigger August actions with `postMessage`.
- **Restricted Pages Skipped**: August refuses to inject into `chrome://`, the Web Store, and other browser-internal pages.
- **No Arbitrary Code Execution**: LLM output is parsed into structured parameters and cannot execute arbitrary shell, Python, or JavaScript code.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
