# August — Local Voice-Controlled Chrome Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-yellow.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Zero API Cost](https://img.shields.io/badge/Zero%20Cost-100%25%20Local-brightgreen.svg)]()

> **Completely local, private, zero-API-cost voice assistant for Google Chrome.**
> 
> Controls tabs, navigates, searches, clicks, scrolls, types, extracts content, and understands complex requests using a 3-tier intelligence architecture.

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

1. **Zero API Cost & 100% Privacy**: Runs entirely on your local machine (CPU or GPU).
2. **Three-Tier Intelligence**:
   - **Tier 0**: Push-to-talk (`Ctrl + Space` or in-browser mic button).
   - **Tier 1**: Instant deterministic router (< 1ms latency) for common browser actions.
   - **Tier 2**: Local Ollama LLM fallback for fuzzy/complex/contextual commands.
3. **Strict Origin & WebSocket Security**: Validates `chrome-extension://` origin and auth tokens to prevent unauthorized websites from controlling your browser.
4. **Non-Admin Execution**: Hotkeys and speech capture operate without Windows Administrator privileges.
5. **Live Browser Context**: Aware of active tab, page title, URL, and highlighted text.
6. **Natural Speech Feedback (TTS)**: Offline Chrome TTS for spoken confirmations (toggleable).
7. **Standalone Extension Option**: Extension can also run 100% in-browser without any Python backend.

---

## 🚀 Quick Start Guide

### 1. Requirements
- Windows, macOS, or Linux
- Python 3.10+
- Google Chrome
- [Ollama](https://ollama.com) (optional, for Tier 2 fallback)

### 2. Setup Backend & Python Environment

```bash
# Clone the repository
git clone https://github.com/Selak007/August.git
cd August

# Create virtual environment
python -m venv .venv

# Activate environment
# On Windows (CMD):
.venv\Scripts\activate.bat
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Setup Ollama (Local LLM Fallback)

```bash
ollama pull llama3.2:1b
ollama serve
```

### 4. Start August Backend

```bash
python -m backend.main
```

### 5. Install Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Turn ON **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `./extension` folder inside this repository
5. Click the **August** icon in the toolbar → **Open Side Panel** (or press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd>)
6. Status badge will turn green: **● Connected**

---

## 🎙 Voice Commands Reference

### 🌐 Quick Navigation & Shortcuts
| Voice Command | Action |
|---------------|--------|
| `"open smart"` | Opens ChatGPT (`https://chat.openai.com`) |
| `"open chatgpt"` | Opens ChatGPT |
| `"open youtube"` | Opens YouTube |
| `"open github"` | Opens GitHub |
| `"open google"` | Opens Google |
| `"open reddit"` | Opens Reddit |
| `"open wikipedia"` | Opens Wikipedia |
| `"open copilot"` / `"open gemini"` / `"open claude"` | Opens AI portals |

### 📑 Tab Management
| Voice Command | Action |
|---------------|--------|
| `"new tab"` / `"open new tab"` | Opens a blank tab |
| `"close tab"` / `"close this tab"` | Closes active tab |
| `"next tab"` | Switches to the tab on the right |
| `"previous tab"` / `"prev tab"` | Switches to the tab on the left |
| `"reload"` / `"refresh"` | Reloads current page |
| `"go back"` / `"back"` | Navigates back in history |
| `"go forward"` / `"forward"` | Navigates forward in history |

### 🔍 Search & Scrolling
| Voice Command | Action |
|---------------|--------|
| `"search google for machine learning"` | Searches Google |
| `"search youtube for python tutorials"` | Searches YouTube |
| `"search for transformers"` | Defaults to Google search |
| `"scroll down"` / `"scroll up"` | Smoothly scrolls page |
| `"scroll to top"` / `"scroll to bottom"` | Jumps to top or bottom |

### 🖱 Webpage DOM Interactions
| Voice Command | Action |
|---------------|--------|
| `"click the first video"` | Clicks first video on YouTube / search |
| `"click the second result"` | Clicks 2nd Google search result |
| `"click search button"` | Clicks search submit button |
| `"click play button"` / `"pause"` | Controls video playback |
| `"click skip ad"` | Skips YouTube advertisements |
| `"type hello world in search input"` | Types text into specific element |
| `"read this page"` / `"extract text"` | Reads content from the page |

### 🤖 Context-Aware & LLM Fallback (Tier 2)
| Voice Command | Behavior |
|---------------|----------|
| `"Find some good lofi music"` | Resolves intent → searches YouTube for lofi |
| `"Look up reinforcement learning papers"` | Resolves intent → searches Google |
| *(With text selected)* `"search for this"` | Uses browser context to search selected text |
| `"Take me to Microsoft"` | Resolves URL → opens microsoft.com |

---

## 🧪 Testing & Benchmarking

### Unit Tests
```bash
pytest tests/ -v
```

### Accuracy & Latency Benchmark (~100 Utterances)
```bash
python tests/benchmark.py
```

---

## 🔒 Security Architecture

- **Origin Header Verification**: Validates `chrome-extension://` origin; rejects all unauthorized websites (`http://`, `https://`) with `WS 1008 Policy Violation`.
- **Shared Auth Token**: Pre-shared session token ensures only verified extension clients can send browser actions.
- **Strict Pydantic Whitelist**: Only whitelisted browser commands can ever be executed.
- **No Arbitrary Code Execution**: LLM output is parsed into structured parameters and cannot execute arbitrary shell, Python, or JavaScript code.

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
