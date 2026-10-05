/**
 * August — Side Panel (sidepanel.js)
 *
 *   - Web Speech API recognition: push-to-talk or hands-free (continuous)
 *   - Shortcut-driven start/stop (messages from background.js)
 *   - Settings, help, history, live context rendering
 */

import { COMMAND_HELP } from "./router.js";

const $ = id => document.getElementById(id);

const statusBadge    = $("status-badge");
const statusText     = $("status-text");
const transcriptCard = $("card-transcript");
const transcriptText = $("transcript-text");
const intentCard     = $("card-intent");
const intentText     = $("intent-text");
const errorCard      = $("card-error");
const errorText      = $("error-text");
const devInput       = $("dev-input");
const devSend        = $("dev-send");
const devResult      = $("dev-result");
const ttsBtn         = $("tts-toggle-btn");
const ttsIcon        = $("tts-icon");
const handsFreeBtn   = $("handsfree-btn");
const helpBtn        = $("help-btn");
const settingsBtn    = $("settings-btn");
const historyList    = $("history-list");
const tierBadge      = $("tier-badge");
const latencyBadge   = $("latency-badge");
const micBtn         = $("mic-btn");
const micLabel       = $("mic-label");
const interimText    = $("interim-text");
const helpCard       = $("card-help");
const settingsCard   = $("card-settings");
const settingsForm   = $("settings-form");
const backendFooter  = $("backend-footer");

const contextCard  = $("card-context");
const ctxTitleRow  = $("ctx-title-row");
const ctxTitleEl   = $("ctx-title");
const ctxUrlRow    = $("ctx-url-row");
const ctxUrlEl     = $("ctx-url");
const ctxSelRow    = $("ctx-sel-row");
const ctxSelEl     = $("ctx-sel");

let lastState = {};
let wantListening = false;   // user intent (hands-free keeps restarting while true)
let isRecording = false;
let recognition = null;
let restartTimer = null;

// ── Speech recognition ────────────────────────────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function createRecognition() {
  const rec = new SpeechRecognition();
  rec.continuous = !!lastState.handsFree;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.lang = lastState.settings?.lang || "en-US";

  rec.onstart = () => {
    isRecording = true;
    renderMic();
    chrome.runtime.sendMessage({ type: "AUGUST_LISTENING", listening: true });
  };

  rec.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript.trim();
      if (res.isFinal) {
        interimText.textContent = "";
        // Ignore August hearing its own TTS — except "stop" to interrupt it.
        if (lastState.speaking && !/^(?:hey august,?\s*)?(?:stop|quiet|be quiet|cancel)\b/i.test(text)) continue;
        if (text) sendCommand(text, "voice");
        if (!lastState.handsFree) wantListening = false;
      } else {
        interim += text + " ";
      }
    }
    if (interim.trim()) interimText.textContent = `"${interim.trim()}…"`;
  };

  rec.onerror = event => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    console.warn("[August] Speech recognition error:", event.error);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      wantListening = false;
      showMicPermissionHelp();
    } else if (event.error === "network") {
      showError("Speech recognition needs an internet connection in Chrome. Use the Python backend for offline Whisper.");
      wantListening = false;
    }
  };

  rec.onend = () => {
    isRecording = false;
    interimText.textContent = "";
    if (wantListening && lastState.handsFree) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startRecognition, 250);
    } else {
      wantListening = false;
      chrome.runtime.sendMessage({ type: "AUGUST_LISTENING", listening: false });
    }
    renderMic();
  };

  return rec;
}

async function ensureMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      showMicPermissionHelp();
      return false;
    }
    return true; // no device info etc. — let recognition try
  }
}

function showMicPermissionHelp() {
  errorText.innerHTML = `Microphone permission needed.<br>
    <button id="grant-mic-btn" class="btn-primary" style="margin-top:6px">Grant microphone access</button>`;
  errorCard.style.display = "";
  $("grant-mic-btn")?.addEventListener("click", () => {
    // Side panels can't show the permission prompt; a normal tab can.
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html?grant=1") });
  });
}

function showError(message) {
  errorText.textContent = message;
  errorCard.style.display = "";
}

async function startRecognition() {
  if (!SpeechRecognition) return;
  if (isRecording) return;
  if (!(await ensureMicPermission())) return;
  recognition = createRecognition();
  try {
    recognition.start();
  } catch (e) {
    console.warn("[August] Could not start recognition:", e);
  }
}

function startListening() {
  wantListening = true;
  errorCard.style.display = "none";
  return startRecognition();
}

function stopListening() {
  wantListening = false;
  clearTimeout(restartTimer);
  recognition?.stop();
}

function toggleListening() {
  if (wantListening || isRecording) stopListening();
  else startListening();
}

micBtn.addEventListener("click", toggleListening);

function renderMic() {
  micBtn.classList.toggle("recording", isRecording);
  if (!SpeechRecognition) {
    micLabel.textContent = "Speech API not available";
    micBtn.disabled = true;
  } else if (isRecording) {
    micLabel.textContent = lastState.handsFree ? "Hands-free — listening…" : "Listening… speak now";
  } else {
    micLabel.textContent = lastState.handsFree ? "Click to start hands-free" : "Click mic to speak";
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function sendCommand(text, origin = "typed") {
  if (!text) return;
  devResult.textContent = "…";
  devResult.className = "dev-result";
  chrome.runtime.sendMessage({ type: "AUGUST_VOICE_INPUT", text, origin }, resp => {
    if (chrome.runtime.lastError || !resp) return;
    if (resp.status === "IGNORED") {
      devResult.textContent = resp.message ? `Ignored (${resp.message.toLowerCase()})` : "";
      return;
    }
    devResult.textContent = resp.message || resp.status;
    devResult.className = "dev-result " + (resp.status === "SUCCESS" ? "ok" : "err");
  });
}

function sendDevCommand() {
  const text = devInput.value.trim();
  if (!text) return;
  sendCommand(text, "typed");
  devInput.value = "";
}

devSend.addEventListener("click", sendDevCommand);
devInput.addEventListener("keydown", e => { if (e.key === "Enter") sendDevCommand(); });

// ── Help ──────────────────────────────────────────────────────────────────────

function renderHelp() {
  const groups = $("help-groups");
  groups.replaceChildren();
  for (const { group, examples } of COMMAND_HELP) {
    const title = document.createElement("div");
    title.className = "help-group";
    title.textContent = group;
    groups.appendChild(title);
    for (const ex of examples) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = ex;
      chip.addEventListener("click", () => {
        devInput.value = ex.replace(/\s*\(.*\)$/, "");
        devInput.focus();
      });
      groups.appendChild(chip);
    }
  }
}

function toggleCard(card, show) {
  const visible = show ?? card.style.display === "none";
  card.style.display = visible ? "" : "none";
  return visible;
}

helpBtn.addEventListener("click", () => toggleCard(helpCard) && renderHelp());
$("help-close").addEventListener("click", () => toggleCard(helpCard, false));

// ── Settings ──────────────────────────────────────────────────────────────────

function fillSettings(s = {}) {
  for (const el of settingsForm.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === "checkbox") el.checked = !!s[el.name];
    else el.value = s[el.name];
  }
  $("rate-val").textContent = `${Number(s.ttsRate || 1).toFixed(2)}x`;
}

function readSettings() {
  const out = {};
  for (const el of settingsForm.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}

function saveSettings(patch) {
  chrome.runtime.sendMessage({ type: "AUGUST_SET_SETTINGS", settings: patch }, resp => {
    if (resp?.ok) {
      lastState.settings = resp.settings;
      lastState.handsFree = resp.settings.handsFree;
      renderMic();
    }
  });
}

settingsBtn.addEventListener("click", () => {
  if (toggleCard(settingsCard)) fillSettings(lastState.settings);
});
$("settings-close").addEventListener("click", () => toggleCard(settingsCard, false));
settingsForm.ttsRate.addEventListener("input", e => { $("rate-val").textContent = `${Number(e.target.value).toFixed(2)}x`; });
settingsForm.addEventListener("submit", e => {
  e.preventDefault();
  const patch = readSettings();
  const handsFreeChanged = patch.handsFree !== lastState.handsFree;
  saveSettings(patch);
  if (handsFreeChanged && isRecording) stopListening();
  devResult.textContent = "Settings saved";
  devResult.className = "dev-result ok";
});
$("clear-history").addEventListener("click", () => chrome.runtime.sendMessage({ type: "AUGUST_CLEAR_HISTORY" }));
$("edit-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

handsFreeBtn.addEventListener("click", () => {
  const next = !lastState.handsFree;
  lastState.handsFree = next;
  saveSettings({ handsFree: next });
  if (next) startListening();
  else stopListening();
  renderHeader();
});

ttsBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "AUGUST_SET_TTS", enabled: !lastState.ttsEnabled }, resp => {
    if (resp?.ok) { lastState.ttsEnabled = resp.ttsEnabled; renderHeader(); }
  });
});

// ── Rendering ─────────────────────────────────────────────────────────────────

const BACKEND_BADGE = {
  connected:  ["● Backend connected", "badge-ok", "backend connected"],
  connecting: ["◌ Connecting…", "badge-warn", "connecting to backend"],
  offline:    ["○ Backend offline", "badge-err", "backend offline — standalone"],
  off:        ["● Standalone", "badge-ok", "standalone"],
};

function renderHeader() {
  const [label, cls, footer] = BACKEND_BADGE[lastState.backend] || BACKEND_BADGE.off;
  statusBadge.textContent = label;
  statusBadge.className = `badge ${cls}`;
  backendFooter.textContent = footer;

  const tts = lastState.ttsEnabled !== false;
  ttsIcon.textContent = tts ? "🔊" : "🔇";
  ttsBtn.className = "icon-btn " + (tts ? "tts-on" : "tts-off");
  ttsBtn.title = tts ? "Voice feedback ON (click to mute)" : "Voice feedback OFF (click to enable)";

  handsFreeBtn.classList.toggle("active", !!lastState.handsFree);
  handsFreeBtn.title = lastState.handsFree ? "Hands-free ON — keeps listening" : "Hands-free OFF — click to keep listening";
}

const TIER_LABEL = {
  deterministic: ["TIER 1 · INSTANT", "sub-label tier-1"],
  llm:           ["TIER 2 · LOCAL AI", "sub-label tier-2"],
  gemini_nano:   ["TIER 2 · GEMINI NANO", "sub-label tier-2"],
  ollama:        ["TIER 2 · OLLAMA", "sub-label tier-2"],
};

function render(state) {
  const handsFreeWas = lastState.handsFree;
  lastState = state;
  renderHeader();
  renderMic();
  if (handsFreeWas !== undefined && handsFreeWas !== state.handsFree && isRecording) {
    stopListening();
  }

  statusText.textContent = state.status || "Ready";
  const [tierLabel, tierCls] = TIER_LABEL[state.tier] ||
    (state.tier?.startsWith("backend") ? ["PYTHON BACKEND", "sub-label tier-2"] : [state.listening ? "LISTENING" : "READY", "sub-label"]);
  tierBadge.textContent = tierLabel;
  tierBadge.className = tierCls;

  transcriptCard.style.display = state.transcript ? "" : "none";
  transcriptText.textContent = state.transcript ? `"${state.transcript}"` : "";

  intentCard.style.display = state.intent ? "" : "none";
  intentText.textContent = state.intent || "";

  if (state.lastError) {
    if (!$("grant-mic-btn")) showError(state.lastError);
  } else if (!$("grant-mic-btn")) {
    errorCard.style.display = "none";
  }

  const hasTitle = !!state.pageTitle;
  const hasUrl   = !!state.currentUrl;
  const hasSel   = !!state.selectedText;
  contextCard.style.display = hasTitle || hasUrl || hasSel ? "" : "none";
  ctxTitleRow.style.display = hasTitle ? "flex" : "none";
  ctxTitleEl.textContent = state.pageTitle || "";
  ctxUrlRow.style.display = hasUrl ? "flex" : "none";
  if (hasUrl) {
    try {
      const u = new URL(state.currentUrl);
      ctxUrlEl.textContent = u.hostname + (u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
    } catch { ctxUrlEl.textContent = state.currentUrl.slice(0, 50); }
  }
  ctxSelRow.style.display = hasSel ? "flex" : "none";
  ctxSelEl.textContent = hasSel ? `"${state.selectedText.slice(0, 60)}${state.selectedText.length > 60 ? "…" : ""}"` : "";

  renderHistory(state.history || []);
}

function renderHistory(items) {
  historyList.replaceChildren();
  const latest = items.find(i => i.latencyMs !== undefined);
  latencyBadge.textContent = latest ? `${latest.latencyMs} ms` : "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = 'Click the mic or type a command. Say "help" to see examples.';
    historyList.appendChild(empty);
    return;
  }
  for (const item of items.slice(0, 10)) {
    const ok = item.status === "SUCCESS";
    const row = document.createElement("div");
    row.className = `history-item ${ok ? "hist-ok" : "hist-err"}`;
    row.innerHTML = `<div class="hist-row"><span class="hist-action"></span><span class="hist-time"></span></div><div class="hist-msg"></div>`;
    row.querySelector(".hist-action").textContent = item.action;
    if (item.tier) {
      const tier = document.createElement("span");
      tier.className = "hist-tier";
      tier.textContent = item.tier;
      row.querySelector(".hist-action").appendChild(tier);
    }
    row.querySelector(".hist-time").textContent = item.time;
    row.querySelector(".hist-msg").textContent = `${ok ? "✓" : "✗"} ${item.message || ""}`;
    historyList.appendChild(row);
  }
}

// ── Messages from background ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  switch (msg.type) {
    case "AUGUST_STATE":
      if (msg.state) render(msg.state);
      return false;
    case "AUGUST_START_LISTENING":
      startListening();
      sendResponse({ ok: true });
      return false;
    case "AUGUST_TOGGLE_LISTENING":
      toggleListening();
      sendResponse({ ok: true });
      return false;
    case "AUGUST_STOP_LISTENING":
      stopListening();
      sendResponse({ ok: true });
      return false;
    case "AUGUST_SHOW_HELP":
      toggleCard(helpCard, true);
      renderHelp();
      helpCard.scrollIntoView({ behavior: "smooth" });
      return false;
    case "AUGUST_NOTICE":
      devResult.textContent = msg.message;
      devResult.className = "dev-result";
      return false;
    default:
      return false;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  chrome.runtime.sendMessage({ type: "AUGUST_GET_STATE" }, resp => {
    if (resp?.state) render(resp.state);
  });

  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = commands.find(c => c.name === "open_side_panel")?.shortcut;
  if (shortcut) $("shortcut-kbd").textContent = shortcut;

  if (new URLSearchParams(location.search).has("grant")) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      statusText.textContent = "✓ Microphone allowed — you can close this tab and use the side panel.";
    } catch {
      showError("Microphone access was blocked. Allow it from the address bar's site settings.");
    }
    return;
  }

  const { pendingListen } = await chrome.storage.session.get("pendingListen").catch(() => ({}));
  if (pendingListen) {
    await chrome.storage.session.set({ pendingListen: false });
    startListening();
  }
}

renderMic();
boot();
