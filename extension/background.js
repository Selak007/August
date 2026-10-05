/**
 * August Extension — Service Worker (background.js)
 *
 * Works standalone; optionally bridges to the local Python backend.
 *   - Tier 1: deterministic router (router.js)
 *   - Tier 2: local LLM fallback (llm.js — Gemini Nano / Ollama)
 *   - Every command is validated (schema.js) before dispatch (commands.js)
 *   - chrome.tts feedback + read-aloud
 *   - Persistent settings & history (chrome.storage.local)
 *   - WebSocket client for backend/main.py (/ws) — Whisper push-to-talk mode
 */

import { dispatch, contentAction } from "./commands.js";
import { routeCommand, COMMAND_HELP } from "./router.js";
import { queryLocalLLM, DEFAULT_LLM_SETTINGS } from "./llm.js";
import { validateCommand } from "./schema.js";

// ── Settings & state ──────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  sttEngine: "whisper_offline", // "whisper_offline" (on-device, private) | "web_speech" (Chrome / Google Cloud)
  whisperModel: "Xenova/whisper-tiny.en",
  ttsEnabled: true,
  ttsRate: 1.05,
  lang: "en-US",
  handsFree: false,
  requireWakeWord: false,
  ...DEFAULT_LLM_SETTINGS,
  backendEnabled: false,
  backendUrl: "ws://127.0.0.1:8765/ws",
  backendToken: "",
};

const HISTORY_LIMIT = 50;
const WAKE_WORD = /^\s*(?:(?:hey|hi|ok|okay)\s+)?august\b/i;

let settings = { ...DEFAULT_SETTINGS };

const state = {
  backend:      "off",          // off | connecting | connected | offline
  connected:    true,           // standalone mode is always ready
  listening:    false,
  speaking:     false,
  transcript:   "",
  intent:       "",
  tier:         "",
  status:       "Ready",
  lastError:    "",
  lastResult:   null,
  ttsEnabled:   true,
  handsFree:    false,
  history:      [],
  currentUrl:   "",
  pageTitle:    "",
  selectedText: "",
};

const ready = chrome.storage.local
  .get({ settings: DEFAULT_SETTINGS, history: [], ttsEnabled: undefined })
  .then(items => {
    settings = { ...DEFAULT_SETTINGS, ...items.settings };
    if (typeof items.ttsEnabled === "boolean") settings.ttsEnabled = items.ttsEnabled; // v1.0 key
    state.history = items.history || [];
    syncSettingsIntoState();
    if (settings.backendEnabled) connectBackend();
  });

function syncSettingsIntoState() {
  state.ttsEnabled = settings.ttsEnabled;
  state.handsFree = settings.handsFree;
  state.settings = { ...settings, backendToken: settings.backendToken ? "••••" : "" };
}

async function updateSettings(patch) {
  await ready;
  const prevBackend = [settings.backendEnabled, settings.backendUrl, settings.backendToken].join("|");
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    if (k === "backendToken" && v === "••••") continue;
    clean[k] = typeof DEFAULT_SETTINGS[k] === "number" ? Number(v) || DEFAULT_SETTINGS[k]
      : typeof DEFAULT_SETTINGS[k] === "boolean" ? !!v
      : String(v ?? "").trim();
  }
  settings = { ...settings, ...clean };
  await chrome.storage.local.set({ settings });
  syncSettingsIntoState();
  if ([settings.backendEnabled, settings.backendUrl, settings.backendToken].join("|") !== prevBackend) {
    disconnectBackend();
    if (settings.backendEnabled) connectBackend();
  }
  broadcastState();
  return state.settings;
}

// ── State broadcasting ────────────────────────────────────────────────────────

function broadcastState(patch = {}) {
  Object.assign(state, patch);
  chrome.runtime.sendMessage({ type: "AUGUST_STATE", state }).catch(() => {});
}

function sendToPanel(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);
}

// ── Text-to-speech ────────────────────────────────────────────────────────────

let speechId = 0;

function ttsOptions(onDone) {
  return {
    rate: settings.ttsRate,
    lang: settings.lang,
    onEvent: e => {
      if (["end", "interrupted", "cancelled", "error"].includes(e.type)) onDone?.(e.type);
    },
  };
}

function speak(text) {
  if (!settings.ttsEnabled || !text) return;
  const id = ++speechId;
  broadcastState({ speaking: true });
  chrome.tts.speak(String(text).slice(0, 300), ttsOptions(() => {
    if (id === speechId) broadcastState({ speaking: false });
  }));
}

/** Split long text into sentence-sized chunks so read-aloud is interruptible and stable. */
export function chunkText(text, max = 220) {
  const sentences = String(text).replace(/\s+/g, " ").match(/[^.!?]+[.!?]*\s*/g) || [];
  const chunks = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > max && buf) { chunks.push(buf.trim()); buf = ""; }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

function readAloud(text) {
  const chunks = chunkText(text).slice(0, 200);
  if (!chunks.length) return;
  chrome.tts.stop();
  const id = ++speechId;
  broadcastState({ speaking: true });
  chunks.forEach((chunk, i) => {
    const last = i === chunks.length - 1;
    chrome.tts.speak(chunk, {
      ...ttsOptions(type => {
        if (id === speechId && (last || type !== "end")) broadcastState({ speaking: false });
      }),
      enqueue: i > 0,
    });
  });
}

function stopSpeaking() {
  speechId++;
  chrome.tts.stop();
  broadcastState({ speaking: false });
}

function spokenFeedback(command, message) {
  switch (command.action) {
    case "OPEN_URL":     return message.replace(/^Opened/, "Opening");
    case "SEARCH":       return `Searching ${command.engine} for ${command.query}`;
    case "SCROLL":       return null;
    case "PRESS_KEY":    return null;
    case "HINTS":        return command.op === "show" ? message.split(" —")[0] : null;
    case "TYPE":         return command.submit ? "Submitted" : "Typed";
    default:             return message;
  }
}

// ── History ───────────────────────────────────────────────────────────────────

function addHistoryItem(item) {
  state.history.unshift({ id: Date.now(), time: new Date().toLocaleTimeString(), ...item });
  state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
  chrome.storage.local.set({ history: state.history });
}

function commandTarget(c) {
  return c.url || c.target || c.query || c.text || c.key || c.op || (c.index !== undefined ? `#${c.index}` : "") || "";
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {{origin?: "voice"|"typed"}} [opts]
 */
export async function processVoiceInput(text, { origin = "typed" } = {}) {
  await ready;
  const clean = (text || "").trim();
  if (!clean) return { status: "IGNORED" };

  if (origin === "voice" && settings.handsFree && settings.requireWakeWord && !WAKE_WORD.test(clean)) {
    return { status: "IGNORED", message: "No wake word" };
  }

  broadcastState({ transcript: clean, status: "Processing…", lastError: "", intent: "", tier: "" });

  const routed = routeCommand(clean, { selectedText: state.selectedText });
  if (routed.command) {
    broadcastState({ intent: routed.command.action, tier: "deterministic", status: `⚡ ${routed.description || routed.command.action}` });
    return executeCommand(routed.command, "deterministic", { latencyMs: routed.latencyMs });
  }

  if (settings.llmEnabled) {
    broadcastState({ intent: "AI_FALLBACK", tier: "llm", status: "🤖 Thinking…" });
    const llm = await queryLocalLLM(clean, {
      url: state.currentUrl,
      title: state.pageTitle,
      selectedText: state.selectedText,
    }, settings);
    if (llm.command) {
      broadcastState({ intent: llm.command.action, tier: llm.tier, status: `🤖 ${llm.command.action}` });
      return executeCommand(llm.command, llm.tier, { latencyMs: llm.latencyMs });
    }
  }

  const msg = `Didn't understand "${clean}". Say "help" for examples.`;
  speak("Sorry, I didn't get that.");
  broadcastState({ status: "✗ Unrecognized command", lastError: msg, intent: "", tier: "" });
  addHistoryItem({ action: "UNKNOWN", status: "FAILURE", message: clean, target: "" });
  return { status: "FAILURE", message: msg };
}

/** Validate + run a command from any source. Returns a backend ResultEnvelope-shaped object. */
export async function executeCommand(raw, source = "deterministic", { latencyMs } = {}) {
  let command;
  try {
    command = validateCommand(raw);
  } catch (err) {
    broadcastState({ status: "✗ Rejected command", lastError: err.message });
    addHistoryItem({ action: raw?.action || "INVALID", status: "FAILURE", message: err.message, tier: source });
    return { status: "UNSUPPORTED", message: err.message };
  }

  try {
    const result = await runCommand(command);
    const spoken = result.spoken !== undefined ? result.spoken : spokenFeedback(command, result.message);
    if (spoken) speak(spoken);

    addHistoryItem({
      action: command.action,
      status: "SUCCESS",
      message: result.message,
      target: commandTarget(command),
      tier: source,
      latencyMs,
    });
    broadcastState({
      status: `✓ ${result.message}`,
      lastError: "",
      lastResult: { action: command.action, ok: true, message: result.message },
    });
    return { status: "SUCCESS", message: result.message, data: result.data };
  } catch (err) {
    const message = err?.message || String(err);
    console.warn("[August] Command failed:", command, err);
    speak(message.length < 90 ? message : "Command failed");
    addHistoryItem({ action: command.action, status: "FAILURE", message, target: commandTarget(command), tier: source });
    broadcastState({
      status: `✗ ${command.action} failed`,
      lastError: message,
      lastResult: { action: command.action, ok: false, message },
    });
    return { status: "FAILURE", message };
  }
}

async function runCommand(command) {
  switch (command.action) {
    case "HELP":
      sendToPanel("AUGUST_SHOW_HELP");
      return { message: "Showing commands", spoken: "Here's what you can say", data: { help: COMMAND_HELP } };

    case "STOP":
      stopSpeaking();
      contentAction({ type: "AUGUST_HINTS", op: "hide" }).catch(() => {});
      return { message: "Stopped", spoken: null };

    case "EXTRACT_TEXT": {
      const result = await dispatch(command);
      const text = result.data?.text || "";
      if (command.speak) {
        if (!text.trim()) throw new Error(command.source === "selection" ? "Nothing is selected" : "No readable text on this page");
        if (settings.ttsEnabled) readAloud(text);
        else sendToPanel("AUGUST_NOTICE", { message: "Voice feedback is off — turn on 🔊 to hear pages read aloud" });
        const words = text.split(/\s+/).length;
        return { message: `Reading ${command.source === "selection" ? "selection" : "page"} (${words} words) — say "stop" to end`, spoken: null, data: result.data };
      }
      return result;
    }

    default:
      return dispatch(command);
  }
}

// ── Python backend bridge (optional) ──────────────────────────────────────────

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let keepAlive = null;

function backendSend(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connectBackend() {
  if (!settings.backendEnabled || ws) return;
  clearTimeout(reconnectTimer);
  let url;
  try {
    url = new URL(settings.backendUrl);
    if (!/^wss?:$/.test(url.protocol)) throw new Error("bad scheme");
    if (settings.backendToken) url.searchParams.set("token", settings.backendToken);
  } catch {
    broadcastState({ backend: "offline", lastError: `Invalid backend URL: ${settings.backendUrl}` });
    return;
  }

  broadcastState({ backend: "connecting" });
  const sock = new WebSocket(url.href);
  ws = sock;

  sock.onopen = () => {
    reconnectDelay = 1000;
    broadcastState({ backend: "connected", status: "Connected to August backend" });
    sendContext();
    keepAlive = setInterval(() => backendSend({ type: "PING", ts: Date.now() }), 20000);
  };

  sock.onmessage = async event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === "NOTIFY") {
      broadcastState({
        status: data.status || state.status,
        transcript: data.transcript || state.transcript,
        intent: data.intent || state.intent,
        tier: "backend",
      });
      return;
    }
    if (data.type === "PONG") return;

    if (data.id && data.command) {
      broadcastState({ intent: data.command.action, tier: `backend·${data.source || "?"}` });
      const result = await executeCommand(data.command, `backend·${data.source || "?"}`);
      if (result.data?.text) result.data = { ...result.data, text: result.data.text.slice(0, 20000) };
      backendSend({ id: data.id, ...result });
    }
  };

  sock.onclose = () => {
    clearInterval(keepAlive);
    if (ws === sock) ws = null;
    if (!settings.backendEnabled) {
      broadcastState({ backend: "off" });
      return;
    }
    broadcastState({ backend: "offline" });
    reconnectTimer = setTimeout(connectBackend, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };

  sock.onerror = () => { /* onclose follows */ };
}

function disconnectBackend() {
  clearTimeout(reconnectTimer);
  clearInterval(keepAlive);
  const sock = ws;
  ws = null;
  sock?.close();
  broadcastState({ backend: settings.backendEnabled ? "offline" : "off" });
}

function sendContext() {
  backendSend({
    type: "CONTEXT",
    context: {
      url: state.currentUrl,
      title: state.pageTitle,
      tabId: state.tabId,
      selectedText: state.selectedText,
    },
  });
}

chrome.alarms.create("august-backend-watchdog", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== "august-backend-watchdog") return;
  await ready;
  if (settings.backendEnabled && !ws) connectBackend();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open_side_panel") {
    // sidePanel.open() must run synchronously inside the user-gesture handler.
    const opening = tab?.windowId !== undefined
      ? chrome.sidePanel.open({ windowId: tab.windowId })
      : Promise.reject(new Error("no window"));
    chrome.storage.session.set({ pendingListen: true });
    opening
      .catch(() => {})
      .then(() => sendToPanel("AUGUST_START_LISTENING"))
      .then(resp => { if (resp?.ok) chrome.storage.session.set({ pendingListen: false }); });
  } else if (command === "toggle_listening") {
    sendToPanel("AUGUST_TOGGLE_LISTENING").then(resp => {
      if (!resp?.ok) speak("Open the August side panel first");
    });
  } else if (command === "stop_speaking") {
    stopSpeaking();
  }
});

// ── Browser context tracking ──────────────────────────────────────────────────

async function refreshContext(extra = {}) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return;
    const tabChanged = tab.id !== state.tabId;
    state.tabId = tab.id;
    if (extra.selectedText !== undefined) state.selectedText = extra.selectedText;
    else if (tabChanged) state.selectedText = "";
    broadcastState({ currentUrl: tab.url || "", pageTitle: tab.title || "", selectedText: state.selectedText });
    sendContext();
  } catch { /* window closing */ }
}

chrome.tabs.onActivated.addListener(() => setTimeout(refreshContext, 150));
chrome.windows.onFocusChanged.addListener(() => setTimeout(refreshContext, 150));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url || changeInfo.title)) refreshContext();
});

// ── Runtime messages ──────────────────────────────────────────────────────────

const EXTENSION_PAGES = new Set(["popup.html", "sidepanel.html"].map(p => chrome.runtime.getURL(p)));

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && !sender.tab?.id && (!sender.url || EXTENSION_PAGES.has(sender.url.split(/[?#]/)[0]));
}

function fromOwnPageTab(sender) {
  // sidepanel.html opened in a normal tab to grant mic permission.
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg?.type) return false;

  // Content scripts may only report selection changes.
  if (msg.type === "AUGUST_SELECTION") {
    if (sender.tab?.active) refreshContext({ selectedText: String(msg.text || "").slice(0, 5000) });
    return false;
  }
  if (!fromExtensionPage(sender) && !fromOwnPageTab(sender)) return false;

  const reply = promise => {
    Promise.resolve(promise).then(sendResponse, err => sendResponse({ ok: false, message: err.message }));
    return true;
  };

  switch (msg.type) {
    case "AUGUST_GET_STATE":
      return reply(ready.then(() => ({ state })));
    case "AUGUST_GET_HELP":
      sendResponse({ help: COMMAND_HELP });
      return false;
    case "AUGUST_VOICE_INPUT":
      return reply(processVoiceInput(msg.text, { origin: (msg.origin && msg.origin.startsWith("voice")) ? "voice" : "typed" }));
    case "AUGUST_SET_TTS":
      return reply(updateSettings({ ttsEnabled: !!msg.enabled }).then(() => {
        if (settings.ttsEnabled) speak("Voice feedback on");
        else stopSpeaking();
        return { ok: true, ttsEnabled: settings.ttsEnabled };
      }));
    case "AUGUST_SET_SETTINGS":
      return reply(updateSettings(msg.settings).then(s => ({ ok: true, settings: s })));
    case "AUGUST_CLEAR_HISTORY":
      state.history = [];
      chrome.storage.local.set({ history: [] });
      broadcastState();
      sendResponse({ ok: true });
      return false;
    case "AUGUST_LISTENING":
      broadcastState({ listening: !!msg.listening });
      return false;
    case "AUGUST_STOP_SPEAKING":
      stopSpeaking();
      return false;
    case "AUGUST_OPEN_ONBOARDING":
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
      sendResponse({ ok: true });
      return false;
    case "AUGUST_OPEN_PRIVACY":
      chrome.tabs.create({ url: chrome.runtime.getURL("privacy.html") });
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(details => {
  refreshContext();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});
chrome.runtime.onStartup.addListener(() => refreshContext());
