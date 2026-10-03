/**
 * August — Standalone Side Panel Script (sidepanel.js)
 *
 * Implements:
 *   - In-browser Web Speech API (webkitSpeechRecognition)
 *   - Speech-to-text with zero external dependencies
 *   - Direct message sending to background worker
 *   - Local TTS toggle & activity history
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const statusBadge    = document.getElementById("status-badge");
const statusText     = document.getElementById("status-text");
const transcriptCard = document.getElementById("card-transcript");
const transcriptText = document.getElementById("transcript-text");
const intentCard     = document.getElementById("card-intent");
const intentText     = document.getElementById("intent-text");
const errorCard      = document.getElementById("card-error");
const errorText      = document.getElementById("error-text");
const devInput       = document.getElementById("dev-input");
const devSend        = document.getElementById("dev-send");
const devResult      = document.getElementById("dev-result");
const ttsBtn         = document.getElementById("tts-toggle-btn");
const ttsIcon        = document.getElementById("tts-icon");
const historyList    = document.getElementById("history-list");
const tierBadge      = document.getElementById("tier-badge");
const micBtn         = document.getElementById("mic-btn");
const micLabel       = document.getElementById("mic-label");

// Context refs
const contextCard  = document.getElementById("card-context");
const ctxTitleRow  = document.getElementById("ctx-title-row");
const ctxTitleEl   = document.getElementById("ctx-title");
const ctxUrlRow    = document.getElementById("ctx-url-row");
const ctxUrlEl     = document.getElementById("ctx-url");
const ctxSelRow    = document.getElementById("ctx-sel-row");
const ctxSelEl     = document.getElementById("ctx-sel");

let currentTts = true;
let isRecording = false;
let recognition = null;

// ── In-Browser Web Speech API Setup ───────────────────────────────────────────

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micLabel.textContent = "Speech API not available";
    micBtn.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micLabel.textContent = "Listening… (Speak now)";
    statusText.textContent = "🎙 Listening to your voice…";
  };

  recognition.onresult = (event) => {
    const interimTranscript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join("");

    if (interimTranscript) {
      transcriptText.textContent = `"${interimTranscript}"`;
      transcriptCard.style.display = "";
    }

    if (event.results[0].isFinal) {
      const finalTranscript = event.results[0][0].transcript.trim();
      console.log("[August] Final speech transcription:", finalTranscript);
      handleVoiceCommand(finalTranscript);
    }
  };

  recognition.onerror = async (event) => {
    console.warn("[August] Speech recognition error:", event.error);
    isRecording = false;
    micBtn.classList.remove("recording");
    micLabel.textContent = "Click Mic to Speak";

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      errorText.innerHTML = `
        Microphone permission needed.<br>
        <button id="grant-mic-btn" style="margin-top:6px;background:var(--accent);color:#fff;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-weight:600;">
          Grant Microphone Access
        </button>
      `;
      errorCard.style.display = "";
      document.getElementById("grant-mic-btn")?.addEventListener("click", requestMicPermission);
    }
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
    micLabel.textContent = "Click Mic to Speak";
  };
}

async function requestMicPermission() {
  try {
    // 1. Try in-panel getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    errorCard.style.display = "none";
    statusText.textContent = "✓ Microphone permission granted!";
    toggleRecording();
  } catch (err) {
    // 2. Open extension tab so Chrome shows the native address-bar prompt
    const extUrl = chrome.runtime.getURL("sidepanel.html");
    chrome.tabs.create({ url: extUrl });
  }
}

async function toggleRecording() {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return;

  if (isRecording) {
    recognition.stop();
  } else {
    try {
      errorCard.style.display = "none";
      // Ensure getUserMedia permission check
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (e) {
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          requestMicPermission();
          return;
        }
      }
      recognition.start();
    } catch (e) {
      console.warn("Could not start recognition:", e);
    }
  }
}

micBtn.addEventListener("click", toggleRecording);

// ── Voice Command Dispatcher ──────────────────────────────────────────────────

function handleVoiceCommand(text) {
  if (!text) return;
  chrome.runtime.sendMessage({
    type: "AUGUST_VOICE_INPUT",
    text: text,
  });
}

// ── State rendering ───────────────────────────────────────────────────────────

function render(state) {
  // Status
  statusText.textContent = state.status || "Ready (Standalone Local Mode)";

  // Tier indicator
  if (state.intent) {
    if (state.status?.includes("⚡")) {
      tierBadge.textContent = "TIER 1 · INSTANT DETERMINISTIC";
      tierBadge.className = "sub-label tier-1";
    } else if (state.status?.includes("🤖")) {
      tierBadge.textContent = "TIER 2 · LOCAL AI FALLBACK";
      tierBadge.className = "sub-label tier-2";
    } else {
      tierBadge.textContent = "ACTIVE";
      tierBadge.className = "sub-label";
    }
  } else {
    tierBadge.textContent = "STANDALONE READY";
    tierBadge.className = "sub-label";
  }

  // TTS Toggle button
  currentTts = state.ttsEnabled !== false;
  ttsIcon.textContent = currentTts ? "🔊" : "🔇";
  ttsBtn.className = "icon-btn " + (currentTts ? "tts-on" : "tts-off");
  ttsBtn.title = currentTts ? "Voice feedback ON (click to mute)" : "Voice feedback MUTED (click to enable)";

  // Transcript
  if (state.transcript) {
    transcriptText.textContent = `"${state.transcript}"`;
    transcriptCard.style.display = "";
  } else {
    transcriptCard.style.display = "none";
  }

  // Intent / action
  if (state.intent) {
    intentText.textContent = state.intent;
    intentCard.style.display = "";
  } else {
    intentCard.style.display = "none";
  }

  // Error
  if (state.lastError) {
    errorText.textContent = state.lastError;
    errorCard.style.display = "";
  } else {
    errorCard.style.display = "none";
  }

  // Browser context
  const hasTitle = !!state.pageTitle;
  const hasUrl   = !!state.currentUrl;
  const hasSel   = !!state.selectedText;
  const hasCtx   = hasTitle || hasUrl || hasSel;

  contextCard.style.display = hasCtx ? "" : "none";

  ctxTitleRow.style.display = hasTitle ? "flex" : "none";
  if (hasTitle) ctxTitleEl.textContent = state.pageTitle;

  ctxUrlRow.style.display = hasUrl ? "flex" : "none";
  if (hasUrl) {
    try {
      const u = new URL(state.currentUrl);
      ctxUrlEl.textContent = u.hostname + (u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
    } catch { ctxUrlEl.textContent = state.currentUrl.slice(0, 50); }
  }

  ctxSelRow.style.display = hasSel ? "flex" : "none";
  if (hasSel) ctxSelEl.textContent = `"${state.selectedText.slice(0, 60)}…"`;

  // History List
  renderHistory(state.history || []);
}

function renderHistory(items) {
  if (!items || items.length === 0) {
    historyList.innerHTML = '<div class="history-empty">Click the mic or type a command to get started.</div>';
    return;
  }

  historyList.innerHTML = items.slice(0, 8).map(item => {
    const isOk = item.status === "SUCCESS";
    const statusIcon = isOk ? "✓" : "✗";
    const statusClass = isOk ? "hist-ok" : "hist-err";
    const targetText = item.target ? `<span class="hist-target">${escapeHtml(item.target)}</span>` : "";
    return `
      <div class="history-item ${statusClass}">
        <div class="hist-row">
          <span class="hist-action">${item.action}</span>
          <span class="hist-time">${item.time}</span>
        </div>
        <div class="hist-msg">${statusIcon} ${escapeHtml(item.message || "")} ${targetText}</div>
      </div>
    `;
  }).join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Polling & Live Updates ────────────────────────────────────────────────────

function poll() {
  chrome.runtime.sendMessage({ type: "AUGUST_GET_STATE" }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp?.state) render(resp.state);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "AUGUST_STATE" && msg.state) {
    render(msg.state);
  }
});

poll();
setInterval(poll, 2000);
initSpeechRecognition();

// ── TTS Toggle ────────────────────────────────────────────────────────────────

ttsBtn.addEventListener("click", () => {
  const next = !currentTts;
  chrome.runtime.sendMessage({ type: "AUGUST_SET_TTS", enabled: next }, (resp) => {
    if (resp?.ok) {
      currentTts = resp.ttsEnabled;
      ttsIcon.textContent = currentTts ? "🔊" : "🔇";
      ttsBtn.className = "icon-btn " + (currentTts ? "tts-on" : "tts-off");
    }
  });
});

// ── Dev Quick Runner ──────────────────────────────────────────────────────────

function sendDevCommand() {
  const text = devInput.value.trim();
  if (!text) return;
  handleVoiceCommand(text);
  devInput.value = "";
}

devSend.addEventListener("click", sendDevCommand);
devInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendDevCommand();
});
