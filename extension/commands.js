/**
 * August Extension — Command Dispatcher (commands.js)
 *
 * Pure action handlers. background.js validates a command (schema.js) and calls
 * dispatch(command). Each handler resolves to { message, data? }.
 *
 * Adding a new command = whitelist it in schema.js + one case here.
 */

// ── Search engine URL templates ───────────────────────────────────────────────

const SEARCH_URLS = {
  google:        q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube:       q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  bing:          q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo:    q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  amazon:        q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  wikipedia:     q => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  github:        q => `https://github.com/search?q=${encodeURIComponent(q)}`,
  reddit:        q => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  maps:          q => `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
  stackoverflow: q => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`,
};

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const RESTRICTED_URL = /^(?:chrome|edge|brave|about|devtools|view-source|chrome-extension|chrome-search):|^https:\/\/chrome(?:webstore)?\.google\.com\/(?:webstore)?/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

async function getWindowTabs(windowId) {
  return chrome.tabs.query({ windowId });
}

function isBlankTab(tab) {
  return /^(?:chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?|about:blank)$/i.test(tab?.url || tab?.pendingUrl || "");
}

/** Navigate the active tab if it's an empty new-tab page, otherwise open a new tab. */
async function openInBestTab(url) {
  const tab = await getActiveTab().catch(() => null);
  if (tab && isBlankTab(tab)) {
    await chrome.tabs.update(tab.id, { url });
  } else {
    await chrome.tabs.create({ url });
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ── Content-script bridge ─────────────────────────────────────────────────────

/**
 * Send a message to content.js in the active tab. Injects the script on demand
 * (tabs opened before install, or after an extension reload).
 */
async function sendToContent(tab, message) {
  if (RESTRICTED_URL.test(tab.url || "")) {
    throw new Error("August can't control browser-internal pages. Switch to a normal website.");
  }
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    result = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }
  if (!result) throw new Error("No response from page.");
  if (!result.ok) throw new Error(result.message || "Action failed on page.");
  return { message: result.message, data: result.data };
}

async function contentAction(message) {
  const tab = await getActiveTab();
  return sendToContent(tab, message);
}

// ── Navigation & tabs ─────────────────────────────────────────────────────────

async function handleOpenUrl(cmd) {
  await openInBestTab(cmd.url);
  return { message: `Opened ${hostOf(cmd.url)}` };
}

async function handleNewTab(cmd) {
  await chrome.tabs.create(cmd.url ? { url: cmd.url } : {});
  return { message: "New tab opened" };
}

async function handleNewWindow(cmd) {
  await chrome.windows.create({ incognito: !!cmd.incognito });
  return { message: cmd.incognito ? "Incognito window opened" : "New window opened" };
}

async function handleTabClose() {
  const tab = await getActiveTab();
  await chrome.tabs.remove(tab.id);
  return { message: "Tab closed" };
}

async function handleTabCloseOthers() {
  const tab = await getActiveTab();
  const tabs = await getWindowTabs(tab.windowId);
  const ids = tabs.filter(t => t.id !== tab.id && !t.pinned).map(t => t.id);
  if (ids.length) await chrome.tabs.remove(ids);
  return { message: `Closed ${ids.length} other tab${ids.length === 1 ? "" : "s"}` };
}

async function switchRelative(delta) {
  const tab = await getActiveTab();
  const tabs = await getWindowTabs(tab.windowId);
  const idx = tabs.findIndex(t => t.id === tab.id);
  const target = tabs[(idx + delta + tabs.length) % tabs.length];
  await chrome.tabs.update(target.id, { active: true });
  return { message: `Switched to ${target.title || target.url}` };
}

function scoreTab(tab, query) {
  const q = query.toLowerCase();
  const squashed = q.replace(/\s+/g, "");
  const title = (tab.title || "").toLowerCase();
  const host = hostOf(tab.url || "").toLowerCase();
  if (host.split(".")[0] === squashed) return 4;
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  if (host.includes(squashed) || (tab.url || "").toLowerCase().includes(squashed)) return 1;
  return 0;
}

async function handleTabGoto(cmd) {
  const active = await getActiveTab();
  const tabs = await getWindowTabs(active.windowId);
  let target;
  if (cmd.index !== undefined) {
    target = cmd.index === -1 ? tabs[tabs.length - 1] : tabs[cmd.index - 1];
    if (!target) throw new Error(`There is no tab ${cmd.index} (only ${tabs.length} open)`);
  } else {
    const all = await chrome.tabs.query({});
    const ranked = all
      .map(t => ({ t, s: scoreTab(t, cmd.query) + (t.windowId === active.windowId ? 0.5 : 0) }))
      .filter(x => x.s >= 1)
      .sort((a, b) => b.s - a.s);
    if (!ranked.length) throw new Error(`No open tab matches "${cmd.query}"`);
    target = ranked[0].t;
  }
  await chrome.tabs.update(target.id, { active: true });
  if (target.windowId !== active.windowId) await chrome.windows.update(target.windowId, { focused: true });
  return { message: `Switched to ${target.title || target.url}` };
}

async function handleTabReopen() {
  const session = await chrome.sessions.restore();
  if (!session) throw new Error("No recently closed tabs");
  return { message: session.tab ? `Reopened ${session.tab.title || "tab"}` : "Reopened window" };
}

async function handleTabDuplicate() {
  const tab = await getActiveTab();
  await chrome.tabs.duplicate(tab.id);
  return { message: "Tab duplicated" };
}

async function handleTabPin(cmd) {
  const tab = await getActiveTab();
  const pinned = cmd.pinned ?? !tab.pinned;
  await chrome.tabs.update(tab.id, { pinned });
  return { message: pinned ? "Tab pinned" : "Tab unpinned" };
}

async function handleTabMute(cmd) {
  const tab = await getActiveTab();
  const muted = cmd.muted ?? !tab.mutedInfo?.muted;
  await chrome.tabs.update(tab.id, { muted });
  return { message: muted ? "Tab muted" : "Tab unmuted" };
}

async function handleReload() {
  const tab = await getActiveTab();
  await chrome.tabs.reload(tab.id);
  return { message: "Page reloaded" };
}

async function handleGoBack() {
  const tab = await getActiveTab();
  await chrome.tabs.goBack(tab.id);
  return { message: "Navigated back" };
}

async function handleGoForward() {
  const tab = await getActiveTab();
  await chrome.tabs.goForward(tab.id);
  return { message: "Navigated forward" };
}

async function handleSearch(cmd) {
  const builder = SEARCH_URLS[cmd.engine] || SEARCH_URLS.google;
  await openInBestTab(builder(cmd.query));
  return { message: `Searching ${cmd.engine} for "${cmd.query}"` };
}

async function handleZoom(cmd) {
  const tab = await getActiveTab();
  if (cmd.direction === "RESET") {
    await chrome.tabs.setZoom(tab.id, 0);
    return { message: "Zoom reset" };
  }
  const current = await chrome.tabs.getZoom(tab.id);
  const next = cmd.direction === "IN"
    ? ZOOM_STEPS.find(z => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
    : [...ZOOM_STEPS].reverse().find(z => z < current - 0.001) ?? ZOOM_STEPS[0];
  await chrome.tabs.setZoom(tab.id, next);
  return { message: `Zoom ${Math.round(next * 100)}%` };
}

async function handleFullscreen(cmd) {
  const win = await chrome.windows.getLastFocused();
  const isFull = win.state === "fullscreen";
  const enable = cmd.enabled ?? !isFull;
  await chrome.windows.update(win.id, { state: enable ? "fullscreen" : "maximized" });
  return { message: enable ? "Fullscreen on" : "Fullscreen off" };
}

// ── Page actions (content script) ─────────────────────────────────────────────

async function handleScroll(cmd) {
  return contentAction({ type: "AUGUST_SCROLL", direction: cmd.direction, amount: cmd.amount });
}

async function handleClick(cmd) {
  return contentAction({ type: "AUGUST_CLICK", target: cmd.target });
}

async function handleType(cmd) {
  return contentAction({
    type: "AUGUST_TYPE",
    text: cmd.text,
    target: cmd.target || null,
    clear: !!cmd.clear,
    submit: !!cmd.submit,
  });
}

async function handlePressKey(cmd) {
  return contentAction({ type: "AUGUST_KEY", key: cmd.key });
}

async function handleMedia(cmd) {
  return contentAction({ type: "AUGUST_MEDIA", op: cmd.op, seconds: cmd.seconds, rate: cmd.rate });
}

async function handleHints(cmd) {
  return contentAction({ type: "AUGUST_HINTS", op: cmd.op, number: cmd.number });
}

async function handleExtractText(cmd) {
  const tab = await getActiveTab();
  try {
    return await sendToContent(tab, {
      type: "AUGUST_EXTRACT",
      selector: cmd.selector || null,
      source: cmd.source || "page",
    });
  } catch (e) {
    if (RESTRICTED_URL.test(tab.url || "")) throw e;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ text: document.body.innerText.slice(0, 20000), title: document.title, url: location.href }),
    });
    const data = results[0]?.result || { text: "" };
    return { message: `Extracted ${data.text.length} characters`, data };
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

const HANDLERS = {
  OPEN_URL:         handleOpenUrl,
  NEW_TAB:          handleNewTab,
  NEW_WINDOW:       handleNewWindow,
  TAB_CLOSE:        handleTabClose,
  TAB_CLOSE_OTHERS: handleTabCloseOthers,
  TAB_NEXT:         () => switchRelative(1),
  TAB_PREVIOUS:     () => switchRelative(-1),
  TAB_GOTO:         handleTabGoto,
  TAB_REOPEN:       handleTabReopen,
  TAB_DUPLICATE:    handleTabDuplicate,
  TAB_PIN:          handleTabPin,
  TAB_MUTE:         handleTabMute,
  RELOAD:           handleReload,
  GO_BACK:          handleGoBack,
  GO_FORWARD:       handleGoForward,
  SCROLL:           handleScroll,
  SEARCH:           handleSearch,
  CLICK:            handleClick,
  TYPE:             handleType,
  PRESS_KEY:        handlePressKey,
  EXTRACT_TEXT:     handleExtractText,
  MEDIA:            handleMedia,
  ZOOM:             handleZoom,
  FULLSCREEN:       handleFullscreen,
  HINTS:            handleHints,
};

/** @returns {Promise<{message: string, data?: object}>} */
export async function dispatch(command) {
  const handler = HANDLERS[command.action];
  if (!handler) throw new Error(`Unsupported action: ${command.action}`);
  return handler(command);
}

export { getActiveTab, contentAction };
