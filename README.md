# August — Voice-Controlled Chrome Agent

> **Completely local, private, zero-API-cost voice assistant for Google Chrome.**
> 
> Controls tabs, navigates, searches, clicks, scrolls, types, extracts content, and understands complex requests using a 3-tier intelligence architecture.

---

## 🏛 3-Tier Architecture

```
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
   - **Tier 0**: Push-to-talk (`Ctrl + Space`).
   - **Tier 1**: Instant deterministic router (< 1ms latency) for common browser actions.
   - **Tier 2**: Local Ollama LLM fallback for fuzzy/complex/contextual commands.
3. **Live Browser Context**: The backend is aware of your active tab, page title, URL, and highlighted text.
4. **Natural Speech Feedback (TTS)**: Uses local Chrome TTS to speak back acknowledgements (can be toggled on/off).
5. **Modern Dark Side Panel**: Displays listening state, transcription, active tier, live context, and activity history.
6. **Smart Aliases**: `"open smart"` or `"open gpt"` opens ChatGPT directly.

---

## 🚀 Quick Start Guide

### 1. Requirements
- Windows 10/11
- Python 3.10+
- Google Chrome
- [Ollama](https://ollama.com) (for Tier 2 fallback)

### 2. Setup Backend & Python Environment

Open Command Prompt or PowerShell as **Administrator** (required for global keyboard listener):

```cmd
cd C:\Users\Akash\Downloads\Project
.venv\Scripts\activate.bat
pip install -r requirements.txt
```

### 3. Setup Ollama (Local LLM Fallback)

In any terminal:
```cmd
ollama pull llama3.2:1b
ollama serve
```

### 4. Start August Backend

```cmd
python -m backend.main
```

You will see:
```
============================================================
  August backend starting
  WebSocket  → ws://127.0.0.1:8765/ws
  Health     → http://127.0.0.1:8765/health
  Model      → Whisper tiny (cpu)
  Hotkey     → Ctrl+Space  (push-to-talk)
============================================================
```

### 5. Install & Load Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Turn ON **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `C:\Users\Akash\Downloads\Project\extension`
5. Click the **August** icon in the toolbar → **Open Side Panel**
6. The status badge will turn green: **● Connected**

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
| `"reload"` / `"refresh"` | Reloads the current page |
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

### 🖱 Webpage DOM Interactions (YouTube, Google, Any Page)
| Voice Command | Action |
|---------------|--------|
| `"click the first video"` | Clicks first video on YouTube / search |
| `"click the second result"` | Clicks 2nd Google search result |
| `"click search button"` | Clicks search submit button |
| `"click play button"` / `"pause"` | Controls video playback |
| `"click skip ad"` | Skips YouTube advertisements |
| `"type hello world in search input"` | Types text into specific element |
| `"read this page"` / `"extract text"` | Reads content from the page |

### 🤖 Context-Aware & LLM Fallback (Ollama Tier 2)
| Voice Command | Behavior |
|---------------|----------|
| `"Find some good lofi music"` | Understands intent → searches YouTube for lofi |
| `"Look up reinforcement learning papers"` | Understands intent → searches Google |
| *(With text selected)* `"search for this"` | Uses browser context to search selected text |
| `"Take me to Microsoft"` | Resolves URL → opens microsoft.com |

---

## 🧪 Running Unit Tests

```cmd
pytest tests/test_router.py -v
```

All 38 test suites verify:
- Deterministic routing
- Edge cases & schema validation
- LLM escalation conditions
- URL and search shortcuts (including `"open smart"`)

---

## 🔒 Security Architecture

- **Localhost WebSocket only**: `127.0.0.1` binding prevents remote network tampering.
- **Strict Pydantic Whitelist**: Only whitelisted browser commands can ever be executed.
- **No Arbitrary Code Execution**: The LLM output is parsed into structured parameters and cannot execute arbitrary Python or JavaScript.
