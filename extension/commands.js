/**
 * August Extension — Command Dispatcher (commands.js)
 *
 * Contains the pure action handlers.  background.js imports this and
 * calls dispatch(command).  Each handler returns a Promise<string> with
 * a human-readable result message.
 *
 * Adding a new command = adding one case here.  Nothing else changes.
 */

// ── Search engine URL templates ───────────────────────────────────────────────

const SEARCH_URLS = {
  google:     q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube:    q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  bing:       q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

async function getAllTabs() {
  const window = await chrome.windows.getCurrent();
  return chrome.tabs.query({ windowId: window.id });
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleOpenUrl(cmd) {
  await chrome.tabs.create({ url: cmd.url });
  return `Opened ${cmd.url}`;
}

async function handleNewTab(cmd) {
  await chrome.tabs.create({ url: cmd.url || "chrome://newtab" });
  return "New tab opened";
}

async function handleTabClose() {
  const tab = await getActiveTab();
  await chrome.tabs.remove(tab.id);
  return "Tab closed";
}

async function handleTabNext() {
  const tabs = await getAllTabs();
  const active = tabs.find(t => t.active);
  if (!active) throw new Error("No active tab.");
  const next = tabs[(tabs.indexOf(active) + 1) % tabs.length];
  await chrome.tabs.update(next.id, { active: true });
  return `Switched to: ${next.title || next.url}`;
}

async function handleTabPrevious() {
  const tabs = await getAllTabs();
  const active = tabs.find(t => t.active);
  if (!active) throw new Error("No active tab.");
  const idx = tabs.indexOf(active);
  const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
  await chrome.tabs.update(prev.id, { active: true });
  return `Switched to: ${prev.title || prev.url}`;
}

async function handleReload() {
  const tab = await getActiveTab();
  await chrome.tabs.reload(tab.id);
  return "Page reloaded";
}

async function handleGoBack() {
  const tab = await getActiveTab();
  await chrome.tabs.goBack(tab.id);
  return "Navigated back";
}

async function handleGoForward() {
  const tab = await getActiveTab();
  await chrome.tabs.goForward(tab.id);
  return "Navigated forward";
}

async function handleScroll(cmd) {
  const tab = await getActiveTab();
  const { direction, amount } = cmd;
  const deltaY = direction === "UP" ? -amount : amount;
  const deltaX = direction === "LEFT" ? -amount : direction === "RIGHT" ? amount : 0;

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (dy, dx) => window.scrollBy({ top: dy, left: dx, behavior: "smooth" }),
    args: [deltaY, deltaX],
  });
  return `Scrolled ${direction.toLowerCase()} by ${amount}px`;
}

async function handleSearch(cmd) {
  const builder = SEARCH_URLS[cmd.engine] || SEARCH_URLS.google;
  const url = builder(cmd.query);
  await chrome.tabs.create({ url });
  return `Searching ${cmd.engine} for "${cmd.query}"`;
}

// ── DOM bridge (executeScript → content.js → result) ─────────────────────────

/**
 * Post a message to the content script and await its AUGUST_RESULT response.
 * Uses a unique msgId so concurrent commands don't cross-wire.
 */
async function contentScriptMessage(tabId, msgType, payload, timeoutMs = 5000) {
  const msgId = `aug-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error(`Content script timed out for ${msgType}`));
    }, timeoutMs);

    // Listen for the result from content.js (relayed via executeScript)
    // We poll via executeScript since service workers can't listen to page messages
    const check = async () => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (id) => window.__augustResults?.[id],
          args: [msgId],
        });
        const result = results[0]?.result;
        if (result !== undefined) {
          clearTimeout(timer);
          resolve(result);
        } else {
          setTimeout(check, 50);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    };

    // Inject message + result store initialisation
    chrome.scripting.executeScript({
      target: { tabId },
      func: (type, data, id) => {
        if (!window.__augustResults) window.__augustResults = {};
        // Listen for result once
        const handler = (ev) => {
          if (ev.source !== window) return;
          if (ev.data?.type === "AUGUST_RESULT" && ev.data?.msgId === id) {
            window.__augustResults[id] = ev.data.result;
            window.removeEventListener("message", handler);
          }
        };
        window.addEventListener("message", handler);
        window.postMessage({ type, ...data, msgId: id }, "*");
      },
      args: [msgType, payload, msgId],
    }).then(check).catch(reject);
  });
}

async function handleClick(cmd) {
  const tab = await getActiveTab();
  try {
    const result = await contentScriptMessage(
      tab.id, "AUGUST_CLICK", { target: cmd.target }
    );
    if (!result.ok) throw new Error(result.message);
    return result.message;
  } catch (e) {
    throw new Error(`Click failed: ${e.message}`);
  }
}

async function handleType(cmd) {
  const tab = await getActiveTab();
  const msgType = cmd.clear ? "AUGUST_CLEAR_TYPE" : "AUGUST_TYPE";
  try {
    const result = await contentScriptMessage(
      tab.id, msgType, { text: cmd.text, target: cmd.target || null }
    );
    if (!result.ok) throw new Error(result.message);
    return result.message;
  } catch (e) {
    throw new Error(`Type failed: ${e.message}`);
  }
}

async function handleExtractText(cmd) {
  const tab = await getActiveTab();
  try {
    const result = await contentScriptMessage(
      tab.id, "AUGUST_EXTRACT", { selector: cmd.selector || null }
    );
    if (!result.ok) throw new Error(result.message);
    return result.data?.text || result.message;
  } catch (e) {
    // Fallback: direct executeScript extraction
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 5000),
    });
    return results[0]?.result || "";
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function dispatch(command) {
  const action = command.action;

  switch (action) {
    case "OPEN_URL":      return handleOpenUrl(command);
    case "NEW_TAB":       return handleNewTab(command);
    case "TAB_CLOSE":     return handleTabClose();
    case "TAB_NEXT":      return handleTabNext();
    case "TAB_PREVIOUS":  return handleTabPrevious();
    case "RELOAD":        return handleReload();
    case "GO_BACK":       return handleGoBack();
    case "GO_FORWARD":    return handleGoForward();
    case "SCROLL":        return handleScroll(command);
    case "SEARCH":        return handleSearch(command);
    case "CLICK":         return handleClick(command);
    case "TYPE":          return handleType(command);
    case "EXTRACT_TEXT":  return handleExtractText();
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}
