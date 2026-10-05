/**
 * August Extension — Command schema (schema.js)
 *
 * Single whitelist + validator for every command the extension will execute,
 * regardless of where it came from (Tier 1 router, LLM, or Python backend).
 * Mirrors backend/commands/models.py.
 */

export const SEARCH_ENGINES = [
  "google", "youtube", "bing", "duckduckgo",
  "amazon", "wikipedia", "github", "reddit", "maps", "stackoverflow",
];

export const KEYS = [
  "Enter", "Escape", "Tab", "Space", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown", "Home", "End",
];

export const MEDIA_OPS = [
  "play", "pause", "toggle", "forward", "rewind", "speed", "faster", "slower", "restart",
];

export const ALLOWED_ACTIONS = [
  "OPEN_URL", "NEW_TAB", "NEW_WINDOW",
  "TAB_CLOSE", "TAB_CLOSE_OTHERS", "TAB_NEXT", "TAB_PREVIOUS", "TAB_GOTO",
  "TAB_REOPEN", "TAB_DUPLICATE", "TAB_PIN", "TAB_MUTE",
  "RELOAD", "GO_BACK", "GO_FORWARD",
  "SCROLL", "SEARCH", "CLICK", "TYPE", "PRESS_KEY", "EXTRACT_TEXT",
  "MEDIA", "ZOOM", "FULLSCREEN", "HINTS", "HELP", "STOP",
];

const SCROLL_DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"];
const ZOOM_DIRECTIONS = ["IN", "OUT", "RESET"];
const HINT_OPS = ["show", "hide", "click"];

function str(v, max = 2000) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function optBool(v) {
  return typeof v === "boolean" ? v : undefined;
}

function num(v, { min, max, fallback }) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeUrl(raw) {
  let url = str(raw);
  if (!url) throw new Error("URL is required");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || /^[\w.-]+:\d+(?:\/|$)/.test(url)) url = `https://${url}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }
  return parsed.href;
}

/**
 * Validate and sanitize a raw command object.
 * Returns a clean copy containing only known fields; throws on invalid input.
 */
export function validateCommand(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Command must be an object");
  const action = raw.action;
  if (!ALLOWED_ACTIONS.includes(action)) throw new Error(`Unsupported action: ${action}`);

  const cmd = { action };
  switch (action) {
    case "OPEN_URL":
      cmd.url = normalizeUrl(raw.url);
      break;
    case "NEW_TAB":
      if (raw.url) cmd.url = normalizeUrl(raw.url);
      break;
    case "NEW_WINDOW":
      cmd.incognito = raw.incognito === true;
      break;
    case "TAB_GOTO": {
      const query = str(raw.query, 200);
      if (raw.index !== undefined && raw.index !== null) {
        const idx = Math.trunc(Number(raw.index));
        if (!Number.isFinite(idx) || idx === 0 || idx < -1) throw new Error("Invalid tab index");
        cmd.index = idx;
      } else if (query) {
        cmd.query = query;
      } else {
        throw new Error("TAB_GOTO needs an index or a query");
      }
      break;
    }
    case "TAB_PIN":
      if (optBool(raw.pinned) !== undefined) cmd.pinned = raw.pinned;
      break;
    case "TAB_MUTE":
      if (optBool(raw.muted) !== undefined) cmd.muted = raw.muted;
      break;
    case "SCROLL":
      cmd.direction = SCROLL_DIRECTIONS.includes(raw.direction) ? raw.direction : "DOWN";
      cmd.amount = Math.round(num(raw.amount, { min: 1, max: 20000, fallback: 450 }));
      break;
    case "SEARCH": {
      cmd.engine = SEARCH_ENGINES.includes(raw.engine) ? raw.engine : "google";
      cmd.query = str(raw.query, 500);
      if (!cmd.query) throw new Error("Search query must not be empty");
      break;
    }
    case "CLICK":
      cmd.target = str(raw.target, 200);
      if (!cmd.target) throw new Error("Click target is required");
      break;
    case "TYPE":
      cmd.text = typeof raw.text === "string" ? raw.text.slice(0, 5000) : "";
      if (raw.target) cmd.target = str(raw.target, 200);
      if (raw.clear === true) cmd.clear = true;
      if (raw.submit === true) cmd.submit = true;
      if (!cmd.text && !cmd.clear) throw new Error("Nothing to type");
      break;
    case "PRESS_KEY":
      if (!KEYS.includes(raw.key)) throw new Error(`Unsupported key: ${raw.key}`);
      cmd.key = raw.key;
      break;
    case "EXTRACT_TEXT":
      if (raw.selector) cmd.selector = str(raw.selector, 300);
      cmd.source = raw.source === "selection" ? "selection" : "page";
      if (raw.speak === true) cmd.speak = true;
      break;
    case "MEDIA":
      if (!MEDIA_OPS.includes(raw.op)) throw new Error(`Unsupported media op: ${raw.op}`);
      cmd.op = raw.op;
      if (raw.op === "forward" || raw.op === "rewind") {
        cmd.seconds = Math.round(num(raw.seconds, { min: 1, max: 3600, fallback: 10 }));
      } else if (raw.op === "speed") {
        cmd.rate = num(raw.rate, { min: 0.25, max: 4, fallback: 1 });
      }
      break;
    case "ZOOM":
      if (!ZOOM_DIRECTIONS.includes(raw.direction)) throw new Error("Invalid zoom direction");
      cmd.direction = raw.direction;
      break;
    case "FULLSCREEN":
      if (optBool(raw.enabled) !== undefined) cmd.enabled = raw.enabled;
      break;
    case "HINTS":
      if (!HINT_OPS.includes(raw.op)) throw new Error(`Unsupported hints op: ${raw.op}`);
      cmd.op = raw.op;
      if (raw.op === "click") {
        const n = Math.trunc(Number(raw.number));
        if (!Number.isFinite(n) || n < 1) throw new Error("Hint number must be >= 1");
        cmd.number = n;
      }
      break;
    default:
      break;
  }
  return cmd;
}
