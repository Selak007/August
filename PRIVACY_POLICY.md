# Privacy Policy for August — Voice Browser Agent

**Last Updated: October 6, 2026**  
**Version: 1.1**

August ("August", "we", "our", or "the Extension") is an open-source, local-first voice assistant Chrome extension designed to provide hands-free browser control while preserving 100% user privacy.

This Privacy Policy explains how August handles your data, your voice audio, and browser permissions in accordance with the **Google Chrome Web Store Developer Program Policies**.

---

## 1. Core Privacy Principles

- **Zero Remote Data Collection**: We do not collect, store, sell, or transmit your personal information, browsing history, keystrokes, or search queries to any remote servers.
- **On-Device Speech Processing**: By default, voice recognition is powered by an in-browser Whisper WebAssembly model running entirely on your computer's CPU. Audio never leaves your device.
- **No Third-Party Analytics or Ads**: August contains zero tracking scripts, zero advertising libraries, and zero external telemetry.
- **Single-Purpose Extension**: August exists solely to allow you to control your web browser using natural voice commands and keyboard shortcuts.

---

## 2. Voice Audio and Speech Data

### A. In-Browser Whisper (Default Engine)
- **How it works**: When you activate the microphone, audio is captured into a temporary memory buffer (Float32Array) in your browser. A local WebAssembly worker processes this audio buffer directly on your CPU using OpenAI's Whisper model (quantized `Xenova/whisper-tiny.en`).
- **Data Destination**: **Nowhere.** The audio buffer is processed locally and immediately discarded. No audio recordings, spectrograms, or transcriptions are transmitted over the internet or written to persistent disk storage.

### B. Chrome Web Speech (Optional Engine)
- If you explicitly choose "Chrome Web Speech" in Settings, your browser uses Google's built-in speech recognition API (`webkitSpeechRecognition`). In this mode, audio is processed by Google in accordance with [Google's Privacy Policy](https://policies.google.com/privacy).

### C. Local Python Backend (Optional Developer Feature)
- If you run the optional local Python backend, communication occurs strictly over your computer's local loopback network (`ws://127.0.0.1:8765/ws`). Origin validation and token-based authentication ensure that unauthorized web pages cannot communicate with the backend.

---

## 3. Chrome Permissions & Why They Are Needed

August requests only the permissions strictly necessary to execute voice commands:

| Permission | Purpose & Scope |
| :--- | :--- |
| `tabs` & `activeTab` | Required to navigate, switch, duplicate, reload, pin, mute, zoom, and close tabs in response to your explicit voice commands (e.g., *"open youtube"*, *"close tab"*, *"zoom in"*). |
| `scripting` | Used to perform page actions commanded by the user, such as scrolling (*"scroll down"*), clicking numbered links (*"click 3"*), or extracting text for page summarization. |
| `sidePanel` | Provides the side-by-side voice assistant interface where you can see live transcription, status, and command shortcuts without leaving your web page. |
| `storage` | Stores your extension settings (TTS speed, preferred voice, STT engine choice) and temporary recent command history locally on your device via `chrome.storage.local`. |
| `tts` | Provides optional spoken confirmations for actions using Chrome's native on-device speech synthesis (e.g., *"Opened YouTube"*, *"Tab muted"*). |
| `windows` | Allows creating, focusing, or minimizing browser windows when instructed by voice. |
| `sessions` | Enables the *"reopen closed tab"* command using Chrome's tab restore API. |
| `alarms` | Used for periodic background timers and keep-alive checks. |
| Host Permissions (`<all_urls>`) | Required to allow the content script to interact with any website you are currently viewing when you issue voice commands like scrolling or clicking links. |

---

## 4. Data Storage and Retention

- **Local Settings**: Preferences (e.g., TTS speech rate, STT engine) are stored locally in your browser via `chrome.storage.local`. You can reset or clear these at any time.
- **Command History**: A list of recent voice commands is maintained in local memory/storage solely to display your recent activity in the side panel. You can purge this history instantly by clicking **"Clear history"** in the Settings panel.
- **Model Cache**: In-browser Whisper model weights are stored locally using the browser's standard `CacheStorage` API so the model runs instantly without re-downloading. You can delete cached models at any time by clearing your browser cache.

---

## 5. Third-Party Sharing and Disclosure

We **do not sell, rent, trade, or transfer** any user data to outside parties. Because August does not collect or transmit user data to external servers, no data exists to share with data brokers, advertisers, or third-party service providers.

---

## 6. Open Source Transparency

August is completely open source under the MIT License. The full source code, including all extension scripts, audio capture logic, WebAssembly workers, and local routing schemas, is publicly inspectable at:  
👉 **[https://github.com/Selak007/August](https://github.com/Selak007/August)**

---

## 7. Changes to this Privacy Policy

If we make modifications to this Privacy Policy, the updated version will be posted in this repository and included in the extension package with an updated revision date.

---

## 8. Contact

If you have questions, feedback, or concerns regarding your privacy when using August, please open an issue on GitHub:  
- **Repository**: [https://github.com/Selak007/August/issues](https://github.com/Selak007/August/issues)
