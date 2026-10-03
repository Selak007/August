/**
 * August Extension — Standalone Service Worker (background.js)
 *
 * Runs 100% inside Chrome without requiring any Python backend or terminal.
 * Integrates:
 *   - Pure in-browser deterministic router (router.js)
 *   - Local LLM fallback (llm.js)
 *   - Direct Chrome APIs (commands.js)
 *   - Offline Chrome Text-to-Speech (chrome.tts)
 */

import { dispatch } from "./commands.js";
import { routeCommand } from "./router.js";
import { queryLocalLLM } from "./llm.js";

// ── Shared State ──────────────────────────────────────────────────────────────

let ttsEnabled = true;

chrome.storage.local.get({ ttsEnabled: true }, (items) => {
  ttsEnabled = items.ttsEnabled;
});

const state = {
  connected:   true,       // Standalone mode is always ready!
  listening:   false,
  transcript:  "",
  intent:      "",
  target:      "",
  status:      "Ready (Standalone Local Mode)",
  lastError:   "",
  ttsEnabled:  true,
  history:     [],
  currentUrl:  "",
  pageTitle:   "",
  selectedText: "",
};

// ── State Broadcasting ────────────────────────────────────────────────────────

function broadcastState(patch = {}) {
  Object.assign(state, patch);
  chrome.runtime.sendMessage({ type: "AUGUST_STATE", state }).catch(() => {});
}

// ── Text-to-Speech ────────────────────────────────────────────────────────────

function speak(text) {
  if (!ttsEnabled || !text) return;
  try {
    chrome.tts.stop();
    chrome.tts.speak(text, {
      rate: 1.05,
      pitch: 1.0,
      volume: 0.95,
      lang: "en-US",
    });
  } catch (err) {
    console.warn("[August] TTS error:", err);
  }
}

function getSpokenFeedback(command, message) {
  if (!command || !command.action) return message || "Done";
  switch (command.action) {
    case "OPEN_URL": {
      let host = "website";
      try {
        const u = new URL(command.url);
        host = u.hostname.replace(/^www\./, "");
      } catch {
        host = command.url;
      }
      return `Opening ${host}`;
    }
    case "NEW_TAB":      return "Opened new tab";
    case "TAB_CLOSE":    return "Tab closed";
    case "TAB_NEXT":     return "Next tab";
    case "TAB_PREVIOUS": return "Previous tab";
    case "RELOAD":       return "Reloaded page";
    case "GO_BACK":      return "Going back";
    case "GO_FORWARD":   return "Going forward";
    case "SCROLL":       return `Scrolled ${command.direction === "UP" ? "up" : "down"}`;
    case "SEARCH":       return `Searching ${command.engine || "Google"} for ${command.query}`;
    case "CLICK":        return `Clicked ${command.target?.replace(/_/g, " ") || "element"}`;
    case "TYPE":         return `Typed text`;
    case "EXTRACT_TEXT": return "Read page content";
    default:             return message || "Done";
  }
}

function addHistoryItem(item) {
  state.history.unshift({
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    ...item,
  });
  if (state.history.length > 20) {
    state.history.pop();
  }
}

// ── Core Voice Command Pipeline ───────────────────────────────────────────────

export async function processVoiceInput(text) {
  const clean = (text || "").trim();
  if (!clean) return;

  console.log(`[August] Processing voice input: "${clean}"`);
  broadcastState({
    transcript: clean,
    status: "Processing…",
    lastError: "",
  });

  // ── Tier 1: In-Browser Deterministic Router (< 1ms) ─────────────────────────
  const routerResult = routeCommand(clean);

  if (routerResult.command) {
    const cmd = routerResult.command;
    console.log(`[August] Tier 1 match ->`, cmd);
    broadcastState({
      intent: cmd.action,
      status: `⚡ ${cmd.action}`,
    });
    return await executeCommand(cmd, "deterministic");
  }

  // ── Tier 2: In-Browser / Local LLM Fallback ──────────────────────────────────
  broadcastState({
    intent: "AI_FALLBACK",
    status: "🤖 Thinking…",
  });

  const context = {
    url: state.currentUrl,
    title: state.pageTitle,
    selectedText: state.selectedText,
  };

  const llmResult = await queryLocalLLM(clean, context);

  if (llmResult.command) {
    const cmd = llmResult.command;
    console.log(`[August] Tier 2 (${llmResult.tier}) ->`, cmd);
    broadcastState({
      intent: cmd.action,
      status: `🤖 ${cmd.action}`,
    });
    return await executeCommand(cmd, llmResult.tier);
  }

  // Not understood
  const msg = `Could not understand: "${clean}"`;
  speak("Sorry, I did not understand that command.");
  broadcastState({
    status: `✗ Unrecognized command`,
    lastError: msg,
  });
  addHistoryItem({
    action: "UNKNOWN",
    status: "FAILURE",
    message: clean,
    target: "",
  });
}

// ── Command Executor ──────────────────────────────────────────────────────────

async function executeCommand(command, source = "deterministic") {
  try {
    const message = await dispatch(command);
    console.log(`[August] Success (${source}):`, message);

    const spoken = getSpokenFeedback(command, message);
    speak(spoken);

    addHistoryItem({
      action: command.action,
      status: "SUCCESS",
      message: message,
      target: command.url || command.target || command.query || "",
    });

    broadcastState({
      status: `✓ ${message}`,
      lastError: "",
    });

    return { status: "SUCCESS", message };
  } catch (err) {
    console.error(`[August] Execution error:`, err);
    speak("Command failed");

    addHistoryItem({
      action: command.action,
      status: "FAILURE",
      message: err.message,
      target: command.url || command.target || command.query || "",
    });

    broadcastState({
      status: `✗ ${command.action} failed`,
      lastError: err.message,
    });

    return { status: "FAILURE", message: err.message };
  }
}

// ── Global Chrome Keyboard Shortcuts ──────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open_side_panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// ── Browser Context Tracker ───────────────────────────────────────────────────

async function refreshContext(extra = {}) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    state.currentUrl = tab.url || "";
    state.pageTitle  = tab.title || "";
    if (extra.selectedText !== undefined) {
      state.selectedText = extra.selectedText;
    }

    broadcastState({
      currentUrl: state.currentUrl,
      pageTitle: state.pageTitle,
      selectedText: state.selectedText,
    });
  } catch {}
}

chrome.tabs.onActivated.addListener(() => setTimeout(refreshContext, 200));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    refreshContext();
  }
});

// ── Runtime Messages ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "AUGUST_GET_STATE") {
    sendResponse({ state });
    return true;
  }

  if (msg.type === "AUGUST_VOICE_INPUT") {
    processVoiceInput(msg.text).then(sendResponse);
    return true;
  }

  if (msg.type === "AUGUST_SET_TTS") {
    ttsEnabled = !!msg.enabled;
    state.ttsEnabled = ttsEnabled;
    chrome.storage.local.set({ ttsEnabled });
    if (ttsEnabled) speak("Voice feedback enabled");
    broadcastState({ ttsEnabled });
    sendResponse({ ok: true, ttsEnabled });
    return true;
  }

  if (msg.type === "AUGUST_SELECTION") {
    refreshContext({ selectedText: msg.text });
    sendResponse({ ok: true });
    return true;
  }
});
